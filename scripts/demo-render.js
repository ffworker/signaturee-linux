/**
 * Synthetic-only demo. No AD, SMB, RTF or real employee data.
 * Usage: npm run demo -- artifacts/demo
 */
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSelectedSignatures } from '../src/core/render.js';
import { decodeTemplate } from '../src/core/template-encoding.js';

const fixture = fileURLToPath(new URL('../test/fixtures/demo/', import.meta.url));
const output = resolve(process.argv[2] || 'artifacts/demo');
const values = JSON.parse(await readFile(join(fixture, 'user.json'), 'utf8'));
const catalog = {
  DEMO: {
    html: decodeTemplate(await readFile(join(fixture, 'DEMO_Template.htm'))),
    text: decodeTemplate(await readFile(join(fixture, 'DEMO_Template.txt'))),
  },
};
const [rendered] = renderSelectedSignatures({
  requestedKeys: ['DEMO'], eligibleKeys: ['DEMO'], catalog, values,
});
await mkdir(join(output, 'DEMO-Dateien'), { recursive: true });
await writeFile(join(output, 'DEMO.htm'), rendered.html, 'utf8');
await writeFile(join(output, 'DEMO.txt'), rendered.text, 'utf8');
await copyFile(join(fixture, 'DEMO-Dateien/logo.svg'), join(output, 'DEMO-Dateien/logo.svg'));
console.log('Rendered synthetic HTML/TXT demo to: ' + output);
console.log('Open DEMO.htm in a browser. LDAP, RTF and Docker are not implemented yet.');
