/**
 * Native Active Directory LDAPS provider.
 *
 * No PowerShell, Windows domain join, or Windows DirectoryServices dependency.
 * The caller controls the service-account credentials; they must never be sent
 * to a browser or logged. The default client factory loads ldapts at runtime.
 * Tests inject an isolated client factory with no real network access.
 */

export class DirectoryError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'DirectoryError';
    this.code = code;
    this.status = status;
  }
}

/** RFC 4515 filter value escaping (UTF-8 literals remain valid). */
export function escapeLdapValue(value) {
  if (typeof value !== 'string') throw new TypeError('LDAP filter value must be a string');
  return value.replace(/[\x00()*\\]/g, (char) => {
    const hex = char.charCodeAt(0).toString(16).padStart(2, '0');
    return '\\' + hex;
  });
}

export function validateDirectoryConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Directory configuration is required');
  }
  const { url, baseDN, bindDN, bindPassword, caCertificate, timeoutMs = 8000, allowInsecureTestLdap = false } = input;
  if (typeof allowInsecureTestLdap !== 'boolean') throw new TypeError('Invalid insecure LDAP opt-in');
  if (typeof url !== 'string') throw new TypeError('Directory URL is required');
  let parsed;
  try { parsed = new URL(url); } catch { throw new TypeError('Invalid directory URL'); }
  if (!['ldaps:', 'ldap:'].includes(parsed.protocol) ||
      (parsed.protocol === 'ldap:' && !allowInsecureTestLdap) ||
      (parsed.protocol === 'ldap:' && caCertificate !== undefined) ||
      !parsed.hostname || parsed.username ||
      parsed.password || parsed.search || parsed.hash ||
      (parsed.pathname !== '' && parsed.pathname !== '/')) {
    throw new TypeError('Directory URL must be an LDAPS host/port URL without credentials or paths');
  }
  if (typeof baseDN !== 'string' || !baseDN.trim() ||
      baseDN.length > 512 || /[\x00\r\n]/.test(baseDN)) {
    throw new TypeError('Invalid directory search base');
  }
  if (typeof bindDN !== 'string' || !bindDN.trim() || /[\x00\r\n]/.test(bindDN)) {
    throw new TypeError('Directory service bind identity is required');
  }
  if (typeof bindPassword !== 'string' || bindPassword.length === 0) {
    throw new TypeError('Directory service bind password is required');
  }
  if (caCertificate !== undefined && (typeof caCertificate !== 'string' ||
      !caCertificate.includes('-----BEGIN CERTIFICATE-----'))) {
    throw new TypeError('CA certificate must be a PEM-encoded certificate');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new TypeError('Directory timeout must be between 1000 and 30000 ms');
  }
  return Object.freeze({ url, baseDN, bindDN, bindPassword, caCertificate, timeoutMs, allowInsecureTestLdap });
}

export function directoryClientOptions(config) {
  return {
    url: config.url,
    timeout: config.timeoutMs,
    connectTimeout: config.timeoutMs,
    strictDN: true,
    ...(new URL(config.url).protocol === 'ldaps:' ? { tlsOptions: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      ...(config.caCertificate ? { ca: [config.caCertificate] } : {}),
    } } : {}),
  };
}

export function buildAccountFilter(username) {
  if (typeof username !== 'string' || !username.trim() ||
      username.length > 128 || /[\x00\r\n]/.test(username)) {
    throw new DirectoryError('INVALID_IDENTITY', 'Invalid directory username', 400);
  }
  const safe = escapeLdapValue(username.trim());
  return '(&(objectCategory=person)(objectClass=user)' +
    '(!(userAccountControl:1.2.840.113556.1.4.803:=2))' +
    '(|(sAMAccountName=' + safe + ')(userPrincipalName=' + safe + ')))';
}

export function buildSearchFilter(search) {
  if (typeof search !== 'string' || search.trim().length < 2 ||
      search.length > 80 || /[\x00\r\n]/.test(search)) {
    throw new DirectoryError('INVALID_SEARCH', 'Search requires 2–80 characters', 400);
  }
  const safe = escapeLdapValue(search.trim());
  return '(&(objectCategory=person)(objectClass=user)' +
    '(!(userAccountControl:1.2.840.113556.1.4.803:=2))' +
    '(|(sAMAccountName=*' + safe + '*)(displayName=*' + safe + '*)(mail=*' + safe + '*)))';
}

const USER_ATTRS = Object.freeze([
  'sAMAccountName', 'userPrincipalName', 'displayName', 'givenName', 'sn',
  'mail', 'title', 'department', 'telephoneNumber', 'mobile', 'memberOf',
  'userAccountControl',
]);

function first(value) {
  if (Array.isArray(value)) return first(value[0]);
  return typeof value === 'string' ? value : '';
}
function directGroupDns(value) {
  const raw = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  return Object.freeze(raw.filter((entry) => typeof entry === 'string' &&
    entry.length > 0 && entry.length <= 1024));
}
export function normalizeAdUser(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.dn !== 'string' ||
      !entry.dn || !first(entry.sAMAccountName)) {
    return null;
  }
  const uac = first(entry.userAccountControl);
  // A missing/non-integer UAC is *not* evidence of an enabled account.
  if (!/^\d+$/.test(uac) || (Number(uac) & 2) !== 0) return null;

  return Object.freeze({
    dn: entry.dn,
    accountName: first(entry.sAMAccountName),
    userPrincipalName: first(entry.userPrincipalName),
    displayName: first(entry.displayName),
    givenName: first(entry.givenName),
    sn: first(entry.sn),
    mail: first(entry.mail),
    title: first(entry.title),
    department: first(entry.department),
    telephoneNumber: first(entry.telephoneNumber),
    mobile: first(entry.mobile),
    groups: directGroupDns(entry.memberOf), // direct memberOf only, no expansion
  });
}

export async function defaultClientFactory(options) {
  const { Client } = await import('ldapts');
  return new Client(options);
}

function isInvalidCredentials(error) {
  return error?.name === 'InvalidCredentialsError' ||
    error?.code === 49 || error?.code === '49';
}

/**
 * All operations bind with a dedicated read-only service identity, not an
 * administrator password. Login verifies a user via a separate user bind.
 */
export function createDirectoryProvider(rawConfig, clientFactory = defaultClientFactory) {
  const config = validateDirectoryConfig(rawConfig);
  if (typeof clientFactory !== 'function') throw new TypeError('Invalid LDAP client factory');
  const options = directoryClientOptions(config);

  async function withServiceClient(work) {
    let client;
    try {
      client = await clientFactory(options);
      await client.bind(config.bindDN, config.bindPassword);
      return await work(client);
    } catch (error) {
      if (error instanceof DirectoryError) throw error;
      // Do not leak driver messages, distinguished names or credentials in API
      // errors; observability can log only error category/correlation ID.
      throw new DirectoryError('DIRECTORY_UNAVAILABLE', 'Directory service unavailable');
    } finally {
      if (client) {
        try { await client.unbind(); } catch { /* Close best-effort; never mask outcome. */ }
      }
    }
  }

  async function lookupSingle(username) {
    const filter = buildAccountFilter(username);
    return withServiceClient(async (client) => {
      const result = await client.search(config.baseDN, {
        scope: 'sub',
        filter,
        attributes: USER_ATTRS,
        sizeLimit: 2,
        paged: false,
        timeLimit: Math.ceil(config.timeoutMs / 1000),
      });
      const entries = result?.searchEntries ?? [];
      if (entries.length > 1) {
        throw new DirectoryError('AMBIGUOUS_IDENTITY', 'Multiple directory identities matched');
      }
      return entries.length === 1 ? normalizeAdUser(entries[0]) : null;
    });
  }

  return Object.freeze({
    async getUser(username) {
      return lookupSingle(username);
    },

    async searchUsers(query, { limit = 30 } = {}) {
      const filter = buildSearchFilter(query);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        throw new DirectoryError('INVALID_LIMIT', 'Invalid search result limit', 400);
      }
      return withServiceClient(async (client) => {
        const result = await client.search(config.baseDN, {
          scope: 'sub',
          filter,
          attributes: USER_ATTRS,
          sizeLimit: limit + 1,
          paged: false,
          timeLimit: Math.ceil(config.timeoutMs / 1000),
        });
        const entries = result?.searchEntries ?? [];
        if (entries.length > limit) {
          throw new DirectoryError('RESULT_LIMIT', 'Too many directory matches', 422);
        }
        return Object.freeze(entries.map(normalizeAdUser).filter(Boolean));
      });
    },

    async authenticate(username, password) {
      // Never issue an anonymous / empty password bind. Fail without a request.
      if (typeof password !== 'string' || password.length === 0) return null;
      const user = await lookupSingle(username);
      if (!user) return null;

      let client;
      try {
        client = await clientFactory(options);
        await client.bind(user.dn, password);
        return user;
      } catch (error) {
        if (isInvalidCredentials(error)) return null;
        throw new DirectoryError('DIRECTORY_UNAVAILABLE', 'Directory service unavailable');
      } finally {
        if (client) {
          try { await client.unbind(); } catch { /* Close best-effort; never mask outcome. */ }
        }
      }
    },
  });
}
