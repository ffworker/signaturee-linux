import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSignatureSnapshot } from '../../src/services/generate.js';

const HR = 'CN=Signature-HR,OU=Groups,DC=example,DC=invalid';
const SALES = 'CN=Signature-Sales,OU=Groups,DC=example,DC=invalid';
const normalizedUser = Object.freeze({
  accountName: 'test.user',
  userPrincipalName: 'test.user@example.invalid',
  displayName: 'Alex Müller',
  givenName: 'Alex',
  sn: 'Müller',
  mail: 'alex@example.invalid',
  title: 'IT',
  department: 'Development',
  telephoneNumber: '',
  mobile: '12345',
  groups: Object.freeze([HR, SALES]),
});
const directory = { async getUser() { return normalizedUser; } };
const catalog = {
  HR: { html: '<strong>$displayName</strong>', text: '$displayName' },
  Sales: { html: '<p>$mail</p>', text: '$mail' },
};
const mappings = [
  { groupDn: HR, signatureKey: 'HR' },
  { groupDn: SALES, signatureKey: 'Sales' },
];
const rtf = Buffer.from('{\\rtf1\\ansi ' + 'synthetic '.repeat(8) + '}');
function inputs(root, changes = {}) {
  return {
    directory, username: 'test.user', requestedKeys: ['HR'], mappings, catalog,
    outputRoot: root, converter: async () => rtf,
    ...changes,
  };
}
async function rootForTest(t) {
  const parent = await mkdtemp(join(tmpdir(), 'signaturee-pipeline-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'outputs');
  await mkdir(root);
  return root;
}

test('LDAP-authorized subset → HTML/TXT → RTF → one complete snapshot', async t => {
  const root = await rootForTest(t);
  const called = [];
  const result = await generateSignatureSnapshot(inputs(root, {
    converter: async ({ html, assets }) => {
      called.push({ html, assets });
      return rtf;
    },
    assetsByKey: { HR: [{ path: 'HR-Dateien/logo.svg',
      bytes: Buffer.from('<svg>EXAMPLE</svg>') }] },
  }));
  assert.equal(result.accountName, 'test.user');
  assert.deepEqual(result.keys, ['HR']);
  assert.equal(called.length, 1, 'Sales must never be converted implicitly');
  assert.equal(called[0].html, '<strong>Alex Müller</strong>');
  assert.equal(await readFile(join(result.snapshotPath, 'HR.htm'), 'utf8'),
    '<strong>Alex Müller</strong>');
  assert.equal(await readFile(join(result.snapshotPath, 'HR.txt'), 'utf8'),
    'Alex Müller');
  assert.deepEqual(await readFile(join(result.snapshotPath, 'HR.rtf')), rtf);
  assert.equal(await readFile(join(result.snapshotPath, 'HR-Dateien/logo.svg'), 'utf8'),
    '<svg>EXAMPLE</svg>');
  assert.equal((await readdir(result.snapshotPath)).includes('Sales.htm'), false);
  assert.equal((await readdir(root)).length, 1);
});

test('two selected signatures publish together, never as partial batches', async t => {
  const root = await rootForTest(t);
  const result = await generateSignatureSnapshot(inputs(root, {
    requestedKeys: ['HR', 'Sales'],
  }));
  assert.deepEqual(result.keys, ['HR', 'Sales']);
  assert.equal((await readdir(result.snapshotPath)).filter(name => name.endsWith('.rtf')).length, 2);
});

test('converter failure on later signature leaves NO published snapshot', async t => {
  const root = await rootForTest(t);
  let number = 0;
  await assert.rejects(generateSignatureSnapshot(inputs(root, {
    requestedKeys: ['HR', 'Sales'],
    converter: async () => {
      if (++number === 2) throw new Error('converter failure');
      return rtf;
    },
  })), /converter failure/);
  assert.deepEqual(await readdir(root), []);
});

test('unauthorized selection fails before calling converter or publisher', async t => {
  const root = await rootForTest(t);
  let called = 0;
  await assert.rejects(generateSignatureSnapshot(inputs(root, {
    directory: { async getUser() { return { ...normalizedUser, groups: [HR] }; } },
    requestedKeys: ['Sales'],
    converter: async () => { called++; return rtf; },
    publisher: async () => { called++; throw Error('should never run'); },
  })), { code: 'SELECTION_NOT_AUTHORIZED' });
  assert.equal(called, 0);
  assert.deepEqual(await readdir(root), []);
});

test('disabled/missing LDAP user fails without touching filesystem', async t => {
  const root = await rootForTest(t);
  await assert.rejects(generateSignatureSnapshot(inputs(root, {
    directory: { async getUser() { return null; } },
  })), { code: 'USER_NOT_AVAILABLE' });
  assert.deepEqual(await readdir(root), []);
});

test('invalid image config fails before publisher and keeps previous snapshots', async t => {
  const root = await rootForTest(t);
  const old = await generateSignatureSnapshot(inputs(root));
  await assert.rejects(generateSignatureSnapshot(inputs(root, {
    assetsByKey: { HR: [{ path: 'HR-Dateien/logo.svg', bytes: 'not bytes' }] },
  })), TypeError);
  assert.deepEqual(await readdir(root), [old.snapshotPath.split('/').at(-1)]);
});

test('publisher rejection does not claim success', async t => {
  const root = await rootForTest(t);
  await assert.rejects(generateSignatureSnapshot(inputs(root, {
    publisher: async () => { throw new Error('disk full'); },
  })), /disk full/);
  assert.deepEqual(await readdir(root), []);
});

test('invalid converter result is rejected, not written', async t => {
  const root = await rootForTest(t);
  await assert.rejects(generateSignatureSnapshot(inputs(root, {
    converter: async () => 'not bytes',
  })), TypeError);
  assert.deepEqual(await readdir(root), []);
});
