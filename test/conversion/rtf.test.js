import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { convertHtmlToRtf, validateRtf } from '../../src/conversion/rtf.js';

test('rejects invalid or oversized HTML without starting a converter', async () => {
  await assert.rejects(convertHtmlToRtf({ html: '' }), { code: 'INVALID_HTML' });
  await assert.rejects(convertHtmlToRtf({ html: 'x'.repeat(1_048_577) }),
    { code: 'INVALID_HTML' });
  await assert.rejects(convertHtmlToRtf({ html: '<p>x</p>', timeoutMs: 0 }),
    { code: 'INVALID_TIMEOUT' });
});

test('asset paths must be confined to the temporary source tree', async () => {
  for (const path of [
    '../logo.png', '/etc/passwd', 'C:/logo.png', 'x/../../logo.png',
    'x\\logo.png', 'https://example.invalid/logo.png', 'x/.hidden/logo.png',
    'x/data.txt',
  ]) {
    await assert.rejects(convertHtmlToRtf({
      html: '<p>x</p>', assets: [{ path, bytes: Buffer.from('data') }],
    }), { code: 'INVALID_ASSET' });
  }
});

test('empty, duplicate and oversized assets fail before conversion', async () => {
  await assert.rejects(convertHtmlToRtf({
    html: '<p>x</p>', assets: [{ path: 'DEMO-Dateien/logo.svg', bytes: Buffer.alloc(0) }],
  }), { code: 'INVALID_ASSET' });
  await assert.rejects(convertHtmlToRtf({
    html: '<p>x</p>', assets: [
      { path: 'DEMO-Dateien/logo.svg', bytes: Buffer.from('1') },
      { path: 'demo-dateien/LOGO.svg', bytes: Buffer.from('2') },
    ],
  }), { code: 'INVALID_ASSET' });
});

test('strict RTF validation prevents empty or fake outputs', () => {
  for (const bytes of [
    Buffer.from(''),
    Buffer.from('not RTF at all'.repeat(5)),
    Buffer.from('{\\rtf1'),
  ]) {
    assert.throws(() => validateRtf(bytes), { code: 'INVALID_RTF' });
  }
  assert.equal(validateRtf(Buffer.from('{\\rtf1\\ansi ' + 'x'.repeat(100) + '}')), true);
});

test('missing LibreOffice produces a safe error without disclosing input', async () => {
  await assert.rejects(convertHtmlToRtf({
    html: '<p>Synthetic private example text</p>',
    sofficePath: '/this/binary/must/not/exist/soffice',
  }), (error) => {
    assert.equal(error.code, 'CONVERTER_UNAVAILABLE');
    assert.equal(error.message.includes('Synthetic private'), false);
    return true;
  });
});

test('real LibreOffice converts German HTML and embeds local image into valid RTF',
  { skip: process.env.SIGNATUREE_TEST_LIBREOFFICE !== '1', timeout: 120000 },
  async () => {
    const fixture = new URL('../fixtures/demo/', import.meta.url);
    const [html, image] = await Promise.all([
      readFile(fileURLToPath(new URL('DEMO_Template.htm', fixture)), 'utf8'),
      readFile(fileURLToPath(new URL('DEMO-Dateien/logo.svg', fixture))),
    ]);
    const rtf = await convertHtmlToRtf({
      html: html.replaceAll('$displayName', 'Alex Müller')
        .replaceAll('$title', 'Entwicklung')
        .replaceAll('$mail', 'alex@example.invalid')
        .replaceAll('$department', 'Test')
        .replaceAll('$mobile', '123')
        .replaceAll('$footer', 'TEST'),
      assets: [{ path: 'DEMO-Dateien/logo.svg', bytes: image }],
    });
    assert.ok(rtf.byteLength > 1000);
    assert.equal(validateRtf(rtf), true);
    assert.ok(rtf.toString('latin1').includes('\\pict'),
      'RTF should contain an embedded image, not a missing external logo');
  });
