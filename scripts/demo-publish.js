/**
 * Creates real synthetic HTML/TXT/RTF output using LibreOffice and publishes
 * one complete write-once snapshot under artifacts/published/.
 * No LDAP, network shares, domain users, or production templates are touched.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { renderSelectedSignatures } from '../src/core/render.js';
import { convertHtmlToRtf } from '../src/conversion/rtf.js';
import { publishSignatureSnapshot } from '../src/publish/snapshot.js';

const fixture = fileURLToPath(new URL('../test/fixtures/demo/', import.meta.url));
const rootDirectory = resolve('artifacts/published');
await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
const values = JSON.parse(await readFile(join(fixture, 'user.json'), 'utf8'));
const [htmlTemplate, txtTemplate, logo] = await Promise.all([
  readFile(join(fixture, 'DEMO_Template.htm'), 'utf8'),
  readFile(join(fixture, 'DEMO_Template.txt'), 'utf8'),
  readFile(join(fixture, 'DEMO-Dateien/logo.svg')),
]);
const [rendered] = renderSelectedSignatures({
  requestedKeys: ['DEMO'],
  eligibleKeys: ['DEMO'],
  catalog: { DEMO: { html: htmlTemplate, text: txtTemplate } },
  values,
});
const assets = [{ path: 'DEMO-Dateien/logo.svg', bytes: logo }];
const rtf = await convertHtmlToRtf({ html: rendered.html, assets });
const result = await publishSignatureSnapshot({
  rootDirectory, accountName: 'test.user',
  signatures: [{ ...rendered, rtf, assets }],
});
console.log('Synthetic signature snapshot published to: ' + result.snapshotPath);
console.log('Nothing was written to production or LDAP.');
