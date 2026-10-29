import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplateCatalog } from '../../src/catalog/load.js';

const demoRoot = fileURLToPath(new URL('../fixtures/demo/', import.meta.url));
const demoProfile = [{ key: 'DEMO', encoding: 'utf-8', images: ['DEMO-Dateien/logo.svg'] }];

test('discovers declared convention-based HTML/TXT and opt-in assets', async () => {
  const result = await loadTemplateCatalog({ rootDirectory: demoRoot, profiles: demoProfile });
  assert.deepEqual(Object.keys(result.catalog), ['DEMO']);
  assert.equal(result.catalog.DEMO.html.includes('DEMO-Dateien/logo.svg'), true);
  assert.equal(result.catalog.DEMO.text.includes('$displayName'), true);
  assert.equal(result.assetsByKey.DEMO[0].path, 'DEMO-Dateien/logo.svg');
  assert.equal(Buffer.from(result.assetsByKey.DEMO[0].bytes).toString('utf8').includes('EXAMPLE ONLY'), true);
  assert.equal(Object.getPrototypeOf(result.catalog), null);
  assert.ok(Object.isFrozen(result.catalog));
  assert.ok(Object.isFrozen(result.assetsByKey.DEMO));
});

test('case-ambiguous keys and invalid asset declarations fail before I/O', async () => {
  for (const profiles of [
    [], [{ key: '../BAD' }],
    [{ key: 'DEMO' }, { key: 'demo' }],
    [{ key: 'DEMO', images: ['../escape.svg'] }],
    [{ key: 'DEMO', images: ['DEMO-Dateien/../../escape.svg'] }],
    [{ key: 'DEMO', images: ['DEMO-Dateien/a.svg', 'demo-dateien/A.svg'] }],
    [{ key: 'DEMO', encoding: 'utf-16' }],
  ]) {
    await assert.rejects(loadTemplateCatalog({ rootDirectory: '/not/used', profiles }),
      { code: 'INVALID_CATALOG' });
  }
});

test('missing templates and undeclared files are not silently accepted', async t => {
  const root = await mkdtemp(join(tmpdir(), 'signaturee-catalog-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'HR_Template.htm'), '<p>Test</p>');
  await assert.rejects(loadTemplateCatalog({ rootDirectory: root, profiles: [{ key: 'HR' }] }),
    { code: 'TEMPLATE_UNAVAILABLE' });
});

test('leaf-file and image directory symlinks are forbidden', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'signaturee-catalog-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'templates');
  await mkdir(root);
  await writeFile(join(parent, 'private.htm'), '<p>PRIVATE</p>');
  await symlink(join(parent, 'private.htm'), join(root, 'HR_Template.htm'));
  await writeFile(join(root, 'HR_Template.txt'), 'Safe text');
  await assert.rejects(loadTemplateCatalog({ rootDirectory: root, profiles: [{ key: 'HR' }] }),
    { code: 'TEMPLATE_UNAVAILABLE' });
  await rm(join(root, 'HR_Template.htm'));
  await writeFile(join(root, 'HR_Template.htm'), '<p>safe</p>');
  await mkdir(join(parent, 'outside'));
  await writeFile(join(parent, 'outside', 'logo.svg'), '<svg/>');
  await symlink(join(parent, 'outside'), join(root, 'HR-Dateien'));
  await assert.rejects(loadTemplateCatalog({
    rootDirectory: root,
    profiles: [{ key: 'HR', images: ['HR-Dateien/logo.svg'] }],
  }), { code: 'TEMPLATE_UNAVAILABLE' });
});

test('root must be real, absolute and already exist', async t => {
  const root = await mkdtemp(join(tmpdir(), 'signaturee-catalog-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const link = join(root, 'link');
  await symlink(demoRoot, link, 'dir');
  await assert.rejects(loadTemplateCatalog({
    rootDirectory: link, profiles: demoProfile,
  }), { code: 'INVALID_TEMPLATE_ROOT' });
  await assert.rejects(loadTemplateCatalog({
    rootDirectory: './templates', profiles: demoProfile,
  }), { code: 'INVALID_TEMPLATE_ROOT' });
});

test('explicit cp1252 input decodes but incorrect UTF-8 fails closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'signaturee-catalog-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x80]);
  await writeFile(join(root, 'HR_Template.htm'), legacy);
  await writeFile(join(root, 'HR_Template.txt'), legacy);
  await assert.rejects(loadTemplateCatalog({
    rootDirectory: root, profiles: [{ key: 'HR' }],
  }), { code: 'INVALID_TEMPLATE_ENCODING' });
  const loaded = await loadTemplateCatalog({
    rootDirectory: root, profiles: [{ key: 'HR', encoding: 'windows-1252' }],
  });
  assert.equal(loaded.catalog.HR.html, 'Müller €');
});

test('invalid file types and oversized templates are rejected', async t => {
  const root = await mkdtemp(join(tmpdir(), 'signaturee-catalog-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'HR_Template.htm'));
  await writeFile(join(root, 'HR_Template.txt'), 'text');
  await assert.rejects(loadTemplateCatalog({
    rootDirectory: root, profiles: [{ key: 'HR' }],
  }), { code: 'TEMPLATE_UNAVAILABLE' });
  await rm(join(root, 'HR_Template.htm'), { recursive: true });
  await writeFile(join(root, 'HR_Template.htm'), 'x'.repeat(1_048_577));
  await assert.rejects(loadTemplateCatalog({
    rootDirectory: root, profiles: [{ key: 'HR' }],
  }), { code: 'TEMPLATE_UNAVAILABLE' });
});
