/**
 * Generate a synthetic RTF demo from the existing synthetic HTML demo.
 * Requires a locally installed LibreOffice (soffice); no LDAP/SMB access.
 * Usage: npm run demo:rtf
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { convertHtmlToRtf } from '../src/conversion/rtf.js';

const directory = resolve(process.argv[2] || 'artifacts/demo');
const [html, logo] = await Promise.all([
  readFile(join(directory, 'DEMO.htm'), 'utf8'),
  readFile(join(directory, 'DEMO-Dateien', 'logo.svg')),
]);
const rtf = await convertHtmlToRtf({
  html, assets: [{ path: 'DEMO-Dateien/logo.svg', bytes: logo }],
});
await writeFile(join(directory, 'DEMO.rtf'), rtf, { flag: 'wx', mode: 0o600 });
console.log('RTF demo generated: ' + join(directory, 'DEMO.rtf'));
console.log('Synthetic data only; final Classic Outlook layout has NOT been validated.');
