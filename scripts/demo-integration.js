/**
 * Full synthetic generation pipeline. Fake directory mimics an already
 * authenticated, normalized user; production LDAPS is never contacted.
 * The real LibreOffice converter and publisher do run on this machine.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSignatureSnapshot } from '../src/services/generate.js';

const demo = fileURLToPath(new URL('../test/fixtures/demo/', import.meta.url));
const root = resolve('artifacts/integration');
await mkdir(root, { recursive: true, mode: 0o700 });
const user = JSON.parse(await readFile(join(demo, 'user.json'), 'utf8'));
const groupDn = 'CN=Signature-DEMO,OU=Groups,DC=example,DC=invalid';
const directory = {
  async getUser(name) {
    if (name !== 'example.user') return null;
    return {
      accountName: name,
      userPrincipalName: user.mail,
      displayName: user.displayName,
      givenName: 'Alex',
      sn: 'Müller',
      mail: user.mail,
      title: user.title,
      department: user.department,
      telephoneNumber: '',
      mobile: user.mobile,
      groups: [groupDn],
    };
  },
};
const [html, text, logo] = await Promise.all([
  readFile(join(demo, 'DEMO_Template.htm'), 'utf8'),
  readFile(join(demo, 'DEMO_Template.txt'), 'utf8'),
  readFile(join(demo, 'DEMO-Dateien/logo.svg')),
]);
const result = await generateSignatureSnapshot({
  directory, username: 'example.user', requestedKeys: ['DEMO'],
  mappings: [{ groupDn, signatureKey: 'DEMO' }],
  catalog: { DEMO: { html, text } },
  assetsByKey: { DEMO: [{ path: 'DEMO-Dateien/logo.svg', bytes: logo }] },
  staticValues: { footer: user.footer },
  outputRoot: root,
});
console.log('Complete synthetic LDAP-shaped -> RTF snapshot: ' + result.snapshotPath);
console.log('No live LDAP, SMTP, SMB or production employees were used.');
