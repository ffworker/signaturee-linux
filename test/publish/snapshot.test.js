import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, lstat, readdir, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishSignatureSnapshot } from '../../src/publish/snapshot.js';

const rtf = Buffer.from('{\\rtf1\\ansi ' + 'synthetic data '.repeat(8) + '}');
const asset = () => ({ path: 'HR-Dateien/logo.svg',
  bytes: Buffer.from('<svg>EXAMPLE ONLY</svg>') });
const sample = (key = 'HR') => ({ key, html: '<p>Müller &amp; Co.</p>',
  text: 'Müller & Co.', rtf,
  assets: key === 'HR' ? [asset()] : [] });

async function sandbox(t) {
  const base = await mkdtemp(join(tmpdir(), 'signaturee-publisher-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'output');
  await mkdir(root, { mode: 0o700 });
  return { base, root };
}

test('publishes a whole HTML/TXT/RTF + image batch as one visible snapshot', async t => {
  const { root } = await sandbox(t);
  const result = await publishSignatureSnapshot({
    rootDirectory: root, accountName: 'test.user',
    signatures: [sample(), sample('Sales')],
  });
  assert.match(result.snapshotPath, /test\.user--[a-f0-9-]+$/);
  assert.deepEqual(result.keys, ['HR', 'Sales']);
  const dirs = await readdir(root);
  assert.deepEqual(dirs, [result.snapshotPath.split('/').at(-1)]);
  assert.equal(await readFile(join(result.snapshotPath, 'HR.htm'), 'utf8'), '<p>Müller &amp; Co.</p>');
  assert.equal(await readFile(join(result.snapshotPath, 'Sales.txt'), 'utf8'), 'Müller & Co.');
  assert.deepEqual(await readFile(join(result.snapshotPath, 'Sales.rtf')), rtf);
  assert.equal(await readFile(join(result.snapshotPath, 'HR-Dateien/logo.svg'), 'utf8'), '<svg>EXAMPLE ONLY</svg>');
  if (process.platform !== 'win32') {
    assert.equal((await lstat(result.snapshotPath)).mode & 0o777, 0o700);
    assert.equal((await lstat(join(result.snapshotPath, 'HR.htm'))).mode & 0o777, 0o600);
  }
});

test('two generations never overwrite a previous snapshot', async t => {
  const { root } = await sandbox(t);
  const first = await publishSignatureSnapshot({
    rootDirectory: root, accountName: 'test.user', signatures: [sample()],
  });
  const second = await publishSignatureSnapshot({
    rootDirectory: root, accountName: 'test.user', signatures: [sample()],
  });
  assert.notEqual(first.snapshotPath, second.snapshotPath);
  assert.equal((await readdir(root)).length, 2);
  assert.ok((await readFile(join(first.snapshotPath, 'HR.htm'), 'utf8')).includes('Müller'));
});

test('parallel jobs generate independent complete directories', async t => {
  const { root } = await sandbox(t);
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    publishSignatureSnapshot({ rootDirectory: root, accountName: 'test.user',
      signatures: [sample()] })));
  assert.equal(new Set(results.map(r => r.snapshotPath)).size, 6);
  assert.equal((await readdir(root)).length, 6);
});

test('invalid batch does not create any files, including stage directories', async t => {
  const { root } = await sandbox(t);
  for (const invalid of [
    { ...sample(), rtf: Buffer.from('not rtf '.repeat(10)) },
    { ...sample(), key: '../HR' },
    { ...sample(), assets: [{ path: '../outside.svg', bytes: Buffer.from('x') }] },
    { ...sample(), assets: [{ path: 'HR-Dateien/../../oops.svg', bytes: Buffer.from('x') }] },
    { ...sample(), assets: [{ path: 'HR-Dateien/script.exe', bytes: Buffer.from('x') }] },
    { ...sample(), assets: [{ path: 'Other-Dateien/logo.svg', bytes: Buffer.from('x') }] },
    { ...sample(), assets: [asset(), asset()] },
    { ...sample(), html: 'x'.repeat(1_048_577) },
  ]) {
    await assert.rejects(publishSignatureSnapshot({
      rootDirectory: root, accountName: 'test.user', signatures: [invalid],
    }), { code: 'INVALID_OUTPUT' });
  }
  await assert.rejects(publishSignatureSnapshot({
    rootDirectory: root, accountName: '../escape', signatures: [sample()],
  }), { code: 'INVALID_OUTPUT' });
  await assert.rejects(publishSignatureSnapshot({
    rootDirectory: root, accountName: 'test.user',
    signatures: [sample(), { ...sample(), key: 'hr' }],
  }), { code: 'INVALID_OUTPUT' });
  assert.deepEqual(await readdir(root), []);
});

test('symlink output root and relative output root are rejected', async t => {
  const { base, root } = await sandbox(t);
  const link = join(base, 'linked');
  await symlink(root, link, 'dir');
  await assert.rejects(publishSignatureSnapshot({
    rootDirectory: link, accountName: 'test.user', signatures: [sample()],
  }), { code: 'INVALID_ROOT' });
  await assert.rejects(publishSignatureSnapshot({
    rootDirectory: '../output', accountName: 'test.user', signatures: [sample()],
  }), { code: 'INVALID_ROOT' });
  assert.deepEqual(await readdir(root), []);
});

test('missing root is not automatically created', async t => {
  const { base } = await sandbox(t);
  await assert.rejects(publishSignatureSnapshot({
    rootDirectory: join(base, 'missing'), accountName: 'test.user',
    signatures: [sample()],
  }), { code: 'INVALID_ROOT' });
  assert.deepEqual((await readdir(base)).sort(), ['output']);
});
