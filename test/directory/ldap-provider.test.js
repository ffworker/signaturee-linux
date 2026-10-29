import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDirectoryProvider, escapeLdapValue, buildAccountFilter, buildSearchFilter,
  normalizeAdUser, validateDirectoryConfig, directoryClientOptions,
} from '../../src/directory/ldap-provider.js';

const conf = Object.freeze({
  url: 'ldaps://dc.example.invalid:636',
  baseDN: 'OU=People,DC=example,DC=invalid',
  bindDN: 'CN=Signaturee Reader,OU=Service,DC=example,DC=invalid',
  bindPassword: 'fake-test-secret',
});

const member = Object.freeze({
  dn: 'CN=Test User,OU=People,DC=example,DC=invalid',
  sAMAccountName: 'test.user',
  userPrincipalName: 'test.user@example.invalid',
  displayName: 'Tést Müller',
  givenName: 'Tést', sn: 'Müller', mail: 'test.user@example.invalid',
  memberOf: ['CN=Signature-HR,OU=Groups,DC=example,DC=invalid', 'CN=Signature-Sales,OU=Groups,DC=example,DC=invalid'],
  userAccountControl: '512',
});

function fakeDirectory({ entries = [member], userBindError = null, serviceBindError = null } = {}) {
  const calls = [];
  const factory = async (options) => {
    const client = {
      async bind(dn, password) {
        calls.push({ op: 'bind', dn, credentialType: dn === conf.bindDN ? 'service' : 'user' });
        if (dn === conf.bindDN && serviceBindError) throw serviceBindError;
        if (dn !== conf.bindDN && userBindError) throw userBindError;
        if (typeof password !== 'string') throw new Error('Unexpected non-string credential');
      },
      async search(baseDN, options) {
        calls.push({ op: 'search', baseDN, options });
        return { searchEntries: entries };
      },
      async unbind() { calls.push({ op: 'unbind' }); },
    };
    calls.push({ op: 'client', options });
    return client;
  };
  return { calls, factory };
}

test('enforces LDAPS, a scoped base DN, TLS verification and finite timeouts', () => {
  assert.throws(() => validateDirectoryConfig({ ...conf, url: 'ldap://dc.example.invalid:389' }), TypeError);
  assert.throws(() => validateDirectoryConfig({ ...conf, url: 'ldaps://user:pass@dc.example.invalid' }), TypeError);
  assert.throws(() => validateDirectoryConfig({ ...conf, url: 'ldaps://dc.example.invalid/path' }), TypeError);
  assert.throws(() => validateDirectoryConfig({ ...conf, timeoutMs: 0 }), TypeError);
  assert.throws(() => validateDirectoryConfig({ ...conf, bindPassword: '' }), TypeError);
  const settings = directoryClientOptions(validateDirectoryConfig(conf));
  assert.equal(settings.tlsOptions.rejectUnauthorized, true);
  assert.equal(settings.tlsOptions.minVersion, 'TLSv1.2');
  assert.ok(settings.connectTimeout > 0);
});

test('plaintext LDAP is rejected unless explicitly opted in for isolated lab', () => {
  const plain = { ...conf, url: 'ldap://dc.example.invalid:389' };
  assert.throws(() => validateDirectoryConfig(plain), TypeError);
  assert.throws(() => validateDirectoryConfig({ ...plain, allowInsecureTestLdap: 'true' }), TypeError);
  assert.throws(() => validateDirectoryConfig({ ...plain, caCertificate: '-----BEGIN CERTIFICATE-----test' , allowInsecureTestLdap: true }), TypeError);
  const accepted = validateDirectoryConfig({ ...plain, allowInsecureTestLdap: true });
  const options = directoryClientOptions(accepted);
  assert.equal(options.url, plain.url);
  assert.equal('tlsOptions' in options, false);
  assert.equal(directoryClientOptions(validateDirectoryConfig(conf)).tlsOptions.rejectUnauthorized, true);
});

test('LDAP filters escape user-controlled assertion values and never broaden to all', () => {
  assert.equal(escapeLdapValue('a*)(|(cn=*))'), 'a\\2a\\29\\28|\\28cn=\\2a\\29\\29');
  assert.ok(buildAccountFilter('a*').includes('(sAMAccountName=a\\2a)'));
  assert.ok(buildSearchFilter('Müller').includes('Müller'));
  assert.throws(() => buildAccountFilter(''), { code: 'INVALID_IDENTITY' });
  assert.throws(() => buildSearchFilter('*'), { code: 'INVALID_SEARCH' });
  assert.ok(buildSearchFilter('ab').includes('!(userAccountControl:1.2.840.113556.1.4.803:=2)'));
});

test('normalization omits disabled/unknown enabled state and keeps direct group DNs', () => {
  assert.equal(normalizeAdUser({ ...member, userAccountControl: '514' }), null);
  assert.equal(normalizeAdUser({ ...member, userAccountControl: undefined }), null);
  const parsed = normalizeAdUser(member);
  assert.equal(parsed.displayName, 'Tést Müller');
  assert.deepEqual(parsed.groups, member.memberOf);
  assert.ok(Object.isFrozen(parsed.groups));
});

test('search and identity lookup do not perform a user bind or expand membership', async () => {
  const fake = fakeDirectory();
  const directory = createDirectoryProvider(conf, fake.factory);
  const users = await directory.searchUsers('Tést');
  assert.equal(users.length, 1);
  assert.equal(users[0].accountName, 'test.user');
  assert.deepEqual(users[0].groups, member.memberOf);
  const found = await directory.getUser('test.user');
  assert.equal(found.accountName, 'test.user');
  assert.ok(fake.calls.filter(c => c.op === 'bind').every(c => c.dn === conf.bindDN));
  assert.equal(fake.calls.filter(c => c.op === 'unbind').length, 2);
  assert.ok(fake.calls.filter(c => c.op === 'search').every(c => c.options.sizeLimit <= 31));
});

test('authentication requires unique enabled account and actual user bind', async () => {
  const fake = fakeDirectory();
  const directory = createDirectoryProvider(conf, fake.factory);
  const user = await directory.authenticate('test.user', 'synthetic-password');
  assert.equal(user.accountName, 'test.user');
  assert.equal(fake.calls.filter(c => c.op === 'bind').length, 2);
  assert.ok(fake.calls.some(c => c.op === 'bind' && c.dn === member.dn && c.credentialType === 'user'));
  assert.equal(fake.calls.filter(c => c.op === 'unbind').length, 2);
  assert.equal(JSON.stringify(fake.calls).includes('synthetic-password'), false);
});

test('empty password and incorrect user credential fail closed', async () => {
  const fake = fakeDirectory({ userBindError: { name: 'InvalidCredentialsError', code: 49 } });
  const directory = createDirectoryProvider(conf, fake.factory);
  assert.equal(await directory.authenticate('test.user', ''), null);
  assert.equal(fake.calls.length, 0);
  assert.equal(await directory.authenticate('test.user', 'incorrect'), null);
  assert.equal(fake.calls.filter(c => c.op === 'unbind').length, 2);
});

test('no matching users cannot be authenticated and no additional bind occurs', async () => {
  const fake = fakeDirectory({ entries: [] });
  const directory = createDirectoryProvider(conf, fake.factory);
  assert.equal(await directory.authenticate('unknown', 'nonempty'), null);
  assert.equal(fake.calls.filter(c => c.op === 'bind').length, 1);
});

test('ambiguous identity and LDAP outages must fail closed without leaking a secret', async () => {
  const ambiguous = createDirectoryProvider(conf, fakeDirectory({ entries: [member, member] }).factory);
  await assert.rejects(ambiguous.authenticate('test.user', 'secret'),
    { code: 'AMBIGUOUS_IDENTITY', message: 'Multiple directory identities matched' });
  const failing = createDirectoryProvider(conf, fakeDirectory({
    serviceBindError: new Error('Secret: ' + conf.bindPassword),
  }).factory);
  await assert.rejects(failing.searchUsers('Te'), error => {
    assert.equal(error.code, 'DIRECTORY_UNAVAILABLE');
    assert.equal(error.message.includes(conf.bindPassword), false);
    return true;
  });
});

test('directory errors expose safe categories without leaking driver messages', async () => {
  const failures = [
    ['ETIMEDOUT', 'DIRECTORY_TIMEOUT'],
    ['ENOTFOUND', 'DIRECTORY_DNS_FAILED'],
    ['EAI_AGAIN', 'DIRECTORY_DNS_FAILED'],
    ['ECONNREFUSED', 'DIRECTORY_PORT_UNREACHABLE'],
    [49, 'DIRECTORY_BIND_REJECTED'],
    [8, 'DIRECTORY_BIND_REJECTED'],
    ['UNKNOWN', 'DIRECTORY_UNAVAILABLE'],
  ];
  for (const [code, expected] of failures) {
    const error = Object.assign(new Error('SECRET ' + conf.bindPassword), { code });
    const directory = createDirectoryProvider(conf, fakeDirectory({
      serviceBindError: error,
    }).factory);
    await assert.rejects(directory.getUser('test.user'), failure => {
      assert.equal(failure.code, expected);
      assert.equal(failure.message.includes(conf.bindPassword), false);
      assert.equal(failure.message.includes('SECRET'), false);
      return true;
    });
  }
});

test('too many search results and invalid limits are rejected', async () => {
  const directory = createDirectoryProvider(conf, fakeDirectory({ entries: [member, member] }).factory);
  await assert.rejects(directory.searchUsers('Te', { limit: 1 }),
    { code: 'RESULT_LIMIT' });
  await assert.rejects(directory.searchUsers('Te', { limit: 51 }), { code: 'INVALID_LIMIT' });
});
