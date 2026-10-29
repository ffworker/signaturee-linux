import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalWorkbench } from '../../src/demo/workbench.js';
import { createOfflineDemoServer } from '../../src/demo/http.js';
import { prepareSignaturePreview } from '../../src/core/preview.js';
import { generateSignatureSnapshot } from '../../src/services/generate.js';

const environment = {
  SIGNATUREE_OFFLINE_PROFILE: 'HR',
  SIGNATUREE_PROFILES_JSON: JSON.stringify([{ key: 'HR', encoding: 'utf-8', images: [] }]),
  SIGNATUREE_OFFLINE_USER_JSON: JSON.stringify({
    displayName: 'Ada Example', mail: 'ada@example.invalid', title: 'Engineer',
  }),
  SIGNATUREE_STATIC_VALUES_JSON: '{"footer":"Sample Lab"}',
  SIGNATUREE_LDAP_BIND_PASSWORD: 'SENSITIVE-BUT-MUST-NOT-BE-READ',
  SIGNATUREE_LDAP_URL: 'ldap://unreachable.example.invalid:389',
};
const fakeRtf = Buffer.from('{\\rtf1\\ansi ' + 'synthetic '.repeat(10) + '}');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'signaturee-offline-workbench-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const templates = join(root, 'templates');
  const outputs = join(root, 'outputs');
  await mkdir(templates);
  await mkdir(outputs);
  await writeFile(join(templates, 'HR_Template.htm'),
    '<html><body><strong>$displayName</strong> - $title - $footer</body></html>');
  await writeFile(join(templates, 'HR_Template.txt'),
    '$displayName | $mail | $footer');
  return { templates, outputs };
}

test('workbench uses local HR template and synthetic user only', async t => {
  const { templates, outputs } = await fixture(t);
  const config = await loadLocalWorkbench({
    env: environment, templatesRoot: templates, outputRoot: outputs,
  });
  assert.equal(config.username, 'example.user');
  assert.deepEqual(config.requestedKeys, ['HR']);
  const rendered = await prepareSignaturePreview(config);
  assert.equal(rendered.signatures[0].key, 'HR');
  assert.match(rendered.signatures[0].html, /Ada Example/);
  assert.match(rendered.signatures[0].html, /Sample Lab/);
  assert.doesNotMatch(JSON.stringify(config), /SENSITIVE-BUT-MUST-NOT-BE-READ/);
  assert.equal(rendered.eligibleKeys.length, 1);
});

test('workbench rejects mismatched keys, unsafe user data, and missing template files', async t => {
  const { templates, outputs } = await fixture(t);
  const base = { templatesRoot: templates, outputRoot: outputs };
  await assert.rejects(loadLocalWorkbench({
    ...base, env: { ...environment, SIGNATUREE_OFFLINE_PROFILE: 'ADMIN' },
  }), /Offline profile must occur/);
  await assert.rejects(loadLocalWorkbench({
    ...base, env: { ...environment, SIGNATUREE_OFFLINE_USER_JSON: '{"accountName":"administrator"}' },
  }), /Invalid offline user attribute/);
  await assert.rejects(loadLocalWorkbench({
    ...base, env: { ...environment, SIGNATUREE_OFFLINE_USER_JSON: '{"title":"bad\\nnewline"}' },
  }), /Invalid offline user attribute/);
  await assert.rejects(loadLocalWorkbench({
    ...base, env: { ...environment, SIGNATUREE_PROFILES_JSON: '[{"key":"MISSING"}]', SIGNATUREE_OFFLINE_PROFILE: 'MISSING' },
  }), { code: 'TEMPLATE_UNAVAILABLE', filename: 'MISSING_Template.htm' });
});

test('workbench HTTP uses configured HR, downloads its RTF, and rejects arbitrary user', async t => {
  const { templates, outputs } = await fixture(t);
  const server = createOfflineDemoServer({
    outputRoot: outputs, mode: 'offline-workbench',
    loadContext: () => loadLocalWorkbench({
      env: environment, templatesRoot: templates, outputRoot: outputs,
    }),
    generate: config => generateSignatureSnapshot({
      ...config, converter: async () => fakeRtf,
    }),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(await (await fetch(base + '/api/health')).json(),
    { status: 'ok', mode: 'offline-workbench', ldap: false });
  const preview = await (await fetch(base + '/api/preview')).json();
  assert.equal(preview.key, 'HR');
  assert.match(preview.html, /Ada Example/);
  assert.equal((await fetch(base + '/api/preview?user=administrator')).status, 400);
  const response = await fetch(base + '/api/generate', {
    method: 'POST', headers: { origin: base },
  });
  assert.equal(response.status, 200);
  const generated = await response.json();
  assert.equal(generated.key, 'HR');
  assert.match(generated.snapshot, /^example\.user--/);
  assert.match((await fetch(base + '/api/download/htm')).headers.get('content-disposition'), /HR\.htm/);
  assert.deepEqual(Buffer.from(await (await fetch(base + '/api/download/rtf')).arrayBuffer()), fakeRtf);
  assert.deepEqual(await readFile(join(outputs, generated.snapshot, 'HR.rtf')), fakeRtf);

  // A template removed after startup must produce an actionable *safe* UI error.
  await rm(join(templates, 'HR_Template.txt'));
  const unavailable = await fetch(base + '/api/preview');
  assert.equal(unavailable.status, 422);
  assert.deepEqual(await unavailable.json(), {
    error: 'Offline template validation failed',
    code: 'TEMPLATE_UNAVAILABLE', file: 'HR_Template.txt',
  });
});
