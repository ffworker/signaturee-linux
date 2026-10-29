import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { renderTemplate, renderSignaturePair, renderSelectedSignatures } from '../../src/core/render.js';
import { decodeTemplate } from '../../src/core/template-encoding.js';

const fixture = fileURLToPath(new URL('../fixtures/demo/', import.meta.url));
const fromFixture = (path) => readFileSync(join(fixture, path), 'utf8');
const values = JSON.parse(fromFixture('user.json'));
const catalog = { DEMO: {
  html: fromFixture('DEMO_Template.htm'),
  text: fromFixture('DEMO_Template.txt'),
} };

test('HTML/TXT match synthetic golden files, including umlauts, escaping and a logo reference', () => {
  const [result] = renderSelectedSignatures({
    requestedKeys: ['DEMO'], eligibleKeys: ['DEMO'], catalog, values,
  });
  assert.equal(result.key, 'DEMO');
  assert.equal(result.html, fromFixture('expected/DEMO.htm'));
  assert.equal(result.text, fromFixture('expected/DEMO.txt'));
  assert.ok(result.html.includes('DEMO-Dateien/logo.svg'));
  assert.ok(readFileSync(join(fixture, 'DEMO-Dateien/logo.svg'), 'utf8').includes('EXAMPLE ONLY'));
  assert.ok(Object.isFrozen(result));
});

test('selected subset cannot expand to other eligible groups', () => {
  const rendered = renderSelectedSignatures({
    requestedKeys: ['demo'], eligibleKeys: ['DEMO', 'SALES'],
    catalog: { ...catalog, SALES: catalog.DEMO }, values,
  });
  assert.deepEqual(rendered.map((entry) => entry.key), ['DEMO']);
});

test('unauthorized selection fails before rendering', () => {
  assert.throws(() => renderSelectedSignatures({
    requestedKeys: ['SALES'], eligibleKeys: ['DEMO'],
    catalog: { ...catalog, SALES: catalog.DEMO }, values,
  }), { code: 'SELECTION_NOT_AUTHORIZED', status: 403 });
});

test('HTML escapes injected values in text and quoted attributes', () => {
  const raw = '" onmouseover="alert(1) & <script>';
  const result = renderSignaturePair({
    htmlTemplate: '<a title="$name">$name</a>', txtTemplate: '$name',
    values: { name: raw },
  });
  const escaped = '&quot; onmouseover=&quot;alert(1) &amp; &lt;script&gt;';
  assert.equal(result.html, '<a title="' + escaped + '">' + escaped + '</a>');
  assert.equal(result.text, raw);
});

test('replacement is single pass and literal dollars and braced variables work', () => {
  assert.equal(renderTemplate('$one / $two', { one: '$two', two: 'actual' }, { format: 'text' }),
    '$two / actual');
  assert.equal(renderTemplate('$$10, $' + '{mail} and $mail',
    { mail: 'a@example.invalid' }, { format: 'text' }),
    '$10, a@example.invalid and a@example.invalid');
});

test('missing, inherited, and invalid variables fail closed', () => {
  assert.throws(() => renderTemplate('$missing', {}, { format: 'html' }),
    { code: 'MISSING_VARIABLE' });
  assert.throws(() => renderTemplate('$toString', {}, { format: 'html' }),
    { code: 'MISSING_VARIABLE' });
  assert.throws(() => renderTemplate('$name', { name: { nested: true } }, { format: 'text' }),
    { code: 'INVALID_VARIABLE' });
  assert.equal(renderTemplate('$optional', { optional: null }, { format: 'text' }), '');
});

test('line endings normalize to LF in all outputs', () => {
  assert.equal(renderTemplate('Hi\r\n$mail\rOK', { mail: 'x' }, { format: 'text' }), 'Hi\nx\nOK');
});

test('UTF-8 is strict and legacy Windows-1252 requires explicit selection', () => {
  const bytes = Uint8Array.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x80]);
  assert.throws(() => decodeTemplate(bytes), TypeError);
  assert.equal(decodeTemplate(bytes, { encoding: 'windows-1252' }), 'Müller €');
  assert.equal(decodeTemplate(Buffer.from('Grüße', 'utf8')), 'Grüße');
  assert.throws(() => decodeTemplate(bytes, { encoding: 'latin1' }), RangeError);
});

test('renderer is pure and returns immutable result', () => {
  const attributes = Object.freeze({ mail: 'a@example.invalid' });
  const result = renderSignaturePair({
    htmlTemplate: '<p>$mail</p>', txtTemplate: '$mail', values: attributes,
  });
  assert.equal(result.html, '<p>a@example.invalid</p>');
  assert.equal(result.text, 'a@example.invalid');
  assert.deepEqual(attributes, { mail: 'a@example.invalid' });
  assert.ok(Object.isFrozen(result));
});
