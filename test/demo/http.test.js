import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfflineDemoServer } from '../../src/demo/http.js';
import { generateSignatureSnapshot } from '../../src/services/generate.js';

const fakeRtf = Buffer.from('{\rtf1\ansi ' + 'synthetic data '.repeat(8) + '}');

async function start(t) {
  const root = await mkdtemp(join(tmpdir(), 'signaturee-offline-http-'));
  const server = createOfflineDemoServer({
    outputRoot: root,
    generate: args => generateSignatureSnapshot({
      ...args, converter: async () => fakeRtf,
    }),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { base: 'http://127.0.0.1:' + server.address().port, root };
}
test('offline UI serves only synthetic data and no credential fields', async t => {
  const { base } = await start(t);
  const health = await (await fetch(base + '/api/health')).json();
  assert.deepEqual(health, { status: 'ok', mode: 'offline-demo', ldap: false });
  const response = await fetch(base + '/api/preview');
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.accountName, 'example.user');
  assert.equal(preview.key, 'DEMO');
  assert.match(preview.html, /Alex Müller/);
  assert.match(preview.html, /data:image\/svg\+xml;base64,/);
  assert.match(preview.text, /Entwicklung/);
  assert.equal(JSON.stringify(preview).includes('SIGNATUREE_LDAP_BIND_PASSWORD'), false);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Offline Demo/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
});
test('offline API rejects arbitrary selection, request bodies and forged origin', async t => {
  const { base } = await start(t);
  assert.equal((await fetch(base + '/api/preview?user=administrator')).status, 400);
  assert.equal((await fetch(base + '/api/download/rtf')).status, 404);
  assert.equal((await fetch(base + '/api/generate', { method: 'POST', headers: {
    Origin: 'https://evil.example',
  } })).status, 403);
  assert.equal((await fetch(base + '/api/generate', { method: 'POST', headers: {
    Origin: base, 'Content-Type': 'application/json',
  }, body: '{"user":"administrator"}' })).status, 400);
  assert.equal((await fetch(base + '/does-not-exist')).status, 404);
});
test('offline browser workflow publishes only DEMO and serves downloadable RTF', async t => {
  const { base, root } = await start(t);
  const response = await fetch(base + '/api/generate', {
    method: 'POST', headers: { Origin: base },
  });
  assert.equal(response.status, 200);
  const generated = await response.json();
  assert.equal(generated.status, 'generated');
  assert.equal(generated.accountName, 'example.user');
  assert.match(generated.snapshot, /^example\.user--[a-f0-9-]+$/);
  assert.deepEqual(generated.formats, ['htm', 'txt', 'rtf']);
  const downloaded = Buffer.from(await (await fetch(base + '/api/download/rtf')).arrayBuffer());
  assert.deepEqual(downloaded, fakeRtf);
  const stored = await readFile(join(root, generated.snapshot, 'DEMO.rtf'));
  assert.deepEqual(stored, downloaded);
  const html = await (await fetch(base + '/api/download/htm')).text();
  assert.match(html, /Alex Müller/);
});
