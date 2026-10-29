/**
 * Local template workbench: administrator-owned on-disk templates and an
 * explicitly synthetic employee. Never constructs or calls an LDAP client.
 * No directory-related environment variable is consulted.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadTemplateCatalog } from '../catalog/load.js';
import { DEMO_ACCOUNT } from './offline.js';

const DEMO_USER_FILE = fileURLToPath(new URL('../../test/fixtures/demo/user.json', import.meta.url));
const PROFILE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const USER_OVERRIDES = new Set([
  'displayName', 'givenName', 'sn', 'mail', 'title', 'department',
  'telephoneNumber', 'mobile', 'userPrincipalName',
]);

function parseJsonEnv(value, label, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string' || value.length > 8192) {
    throw new TypeError('Invalid offline ' + label);
  }
  try { return JSON.parse(value); }
  catch { throw new TypeError('Invalid offline ' + label); }
}

export async function loadLocalWorkbench({
  env = process.env, templatesRoot = '/templates', outputRoot = '/output',
} = {}) {
  const key = env.SIGNATUREE_OFFLINE_PROFILE || 'HR';
  if (typeof key !== 'string' || !PROFILE_KEY.test(key)) {
    throw new TypeError('Invalid offline template profile');
  }
  const profiles = parseJsonEnv(env.SIGNATUREE_PROFILES_JSON, 'profiles', []);
  if (!Array.isArray(profiles)) throw new TypeError('Invalid offline profiles');
  const matches = profiles.filter(profile => profile?.key === key);
  if (matches.length !== 1) throw new TypeError('Offline profile must occur exactly once');
  // Only the selected profile is loaded. Unrelated templates need not exist.
  const { catalog, assetsByKey } = await loadTemplateCatalog({
    rootDirectory: templatesRoot, profiles: [matches[0]],
  });

  const fake = JSON.parse(await readFile(DEMO_USER_FILE, 'utf8'));
  const overrides = parseJsonEnv(env.SIGNATUREE_OFFLINE_USER_JSON, 'user', {});
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Invalid offline user');
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!USER_OVERRIDES.has(name) || typeof value !== 'string' ||
        value.length > 256 || /[\x00-\x1f]/.test(value)) {
      throw new TypeError('Invalid offline user attribute');
    }
  }
  const user = Object.freeze({
    accountName: DEMO_ACCOUNT,
    userPrincipalName: overrides.userPrincipalName ?? fake.mail,
    displayName: overrides.displayName ?? fake.displayName,
    givenName: overrides.givenName ?? 'Alex',
    sn: overrides.sn ?? 'Müller',
    mail: overrides.mail ?? fake.mail,
    title: overrides.title ?? fake.title,
    department: overrides.department ?? fake.department,
    telephoneNumber: overrides.telephoneNumber ?? '',
    mobile: overrides.mobile ?? fake.mobile,
    groups: Object.freeze(['CN=Offline-' + key + ',OU=Synthetic,DC=example,DC=invalid']),
  });
  const staticValues = parseJsonEnv(env.SIGNATUREE_STATIC_VALUES_JSON, 'static values', {});
  if (!staticValues || typeof staticValues !== 'object' ||
      Array.isArray(staticValues)) throw new TypeError('Invalid offline static values');

  return Object.freeze({
    username: DEMO_ACCOUNT,
    requestedKeys: [key],
    directory: Object.freeze({
      async getUser(account) { return account === DEMO_ACCOUNT ? user : null; },
    }),
    mappings: [{ groupDn: user.groups[0], signatureKey: key }],
    catalog,
    assetsByKey,
    staticValues: { footer: fake.footer, ...staticValues },
    outputRoot,
  });
}
