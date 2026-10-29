/**
 * Offline browser demo uses ONLY shipped, synthetic fixtures.
 * Never reads LDAP environment variables or connects to Active Directory.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplateCatalog } from '../catalog/load.js';

const FIXTURES = fileURLToPath(new URL('../../test/fixtures/demo/', import.meta.url));
const GROUP = 'CN=Signature-DEMO,OU=Groups,DC=example,DC=invalid';
export const DEMO_ACCOUNT = 'example.user';
export const DEMO_KEY = 'DEMO';

export async function loadOfflineDemo({ outputRoot = '/output' } = {}) {
  const values = JSON.parse(await readFile(join(FIXTURES, 'user.json'), 'utf8'));
  const { catalog, assetsByKey } = await loadTemplateCatalog({
    rootDirectory: FIXTURES,
    profiles: [{ key: DEMO_KEY, encoding: 'utf-8', images: ['DEMO-Dateien/logo.svg'] }],
  });
  const user = Object.freeze({
    accountName: DEMO_ACCOUNT,
    userPrincipalName: values.mail,
    displayName: values.displayName,
    givenName: 'Alex',
    sn: 'Müller',
    mail: values.mail,
    title: values.title,
    department: values.department,
    telephoneNumber: '',
    mobile: values.mobile,
    groups: Object.freeze([GROUP]),
  });
  return Object.freeze({
    username: DEMO_ACCOUNT,
    requestedKeys: [DEMO_KEY],
    directory: Object.freeze({
      async getUser(account) { return account === DEMO_ACCOUNT ? user : null; },
    }),
    mappings: [{ groupDn: GROUP, signatureKey: DEMO_KEY }],
    catalog,
    assetsByKey,
    staticValues: { footer: values.footer },
    outputRoot,
  });
}
