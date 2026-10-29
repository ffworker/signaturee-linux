import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTestArguments, runTestCommand, loadTestConfig } from '../../src/cli/test-generate.js';
import { publishSignatureSnapshot } from '../../src/publish/snapshot.js';

const HR = 'CN=Signature-HR,OU=Groups,DC=example,DC=invalid';
const params = {
  url: 'ldaps://dc-test.example.invalid:636',
  baseDN: 'DC=example,DC=invalid',
  bindDN: 'CN=Reader,DC=example,DC=invalid',
  bindPassword: 'fake-test-secret',
};
const env = {
  SIGNATUREE_LDAP_URL: params.url,
  SIGNATUREE_LDAP_BASE_DN: params.baseDN,
  SIGNATUREE_LDAP_BIND_DN: params.bindDN,
  SIGNATUREE_LDAP_BIND_PASSWORD: params.bindPassword,
};
const normalizedUser = {
  accountName: 'test.user',
  userPrincipalName: 'test.user@example.invalid',
  displayName: 'Alex Müller',
  givenName: 'Alex', sn: 'Müller',
  mail: 'alex@example.invalid', title: 'IT',
  department: 'Development', telephoneNumber: '', mobile: '12345',
  groups: [HR],
};
const rtf = Buffer.from('{\\rtf1\\ansi ' + 'synthetic '.repeat(8) + '}');

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'signaturee-cli-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const templates = join(root, 'templates');
  const output = join(root, 'output');
  await mkdir(templates);
  await mkdir(output);
  await writeFile(join(templates, 'HR_Template.htm'), '<p>$displayName</p>');
  await writeFile(join(templates, 'HR_Template.txt'), '$mail');
  const configFile = join(root, 'test-config.json');
  const config = {
    schema: 1,
    allowedTestAccounts: ['test.user'],
    templatesRoot: templates,
    outputRoot: output,
    profiles: [{ key: 'HR' }],
    mappings: [{ groupDn: HR, signatureKey: 'HR' }],
    staticValues: {},
  };
  async function updateConfig(data) {
    await writeFile(configFile, JSON.stringify(data), { mode: 0o600 });
    await chmod(configFile, 0o600);
  }
  await updateConfig(config);
  return { root, templates, output, configFile, config, updateConfig };
}

function flags(file, ...extra) {
  return ['--config', file, '--user', 'test.user',
    '--signature', 'HR', ...extra];
}

test('requires explicit mode, acknowledgements and bounded signature keys', () => {
  assert.deepEqual(parseTestArguments(['--help']), { help: true });
  assert.throws(() => parseTestArguments(['--user', 'test.user']), { code: 'INVALID_ARGUMENTS' });
  assert.throws(() => parseTestArguments(flags('/tmp/x', '--generate', '--ack-test-directory')),
    { code: 'INVALID_ARGUMENTS' });
  assert.throws(() => parseTestArguments(flags('/tmp/x', '--preview')),
    { code: 'INVALID_ARGUMENTS' });
  assert.throws(() => parseTestArguments(flags('/tmp/x', '--preview', '--ack-test-directory',
    '--ack-test-output')), { code: 'INVALID_ARGUMENTS' });
  assert.throws(() => parseTestArguments(flags('/tmp/x', '--preview', '--ack-test-directory',
    '--signature', 'hr')), { code: 'INVALID_ARGUMENTS' });
  assert.throws(() => parseTestArguments(flags('/tmp/x', '--preview', '--ack-test-directory',
    '--unknown')), { code: 'INVALID_ARGUMENTS' });
});

test('missing, insecure and symlink config files are rejected', async t => {
  const s = await sandbox(t);
  assert.equal((await loadTestConfig(s.configFile)).schema, 1);
  await chmod(s.configFile, 0o644);
  await assert.rejects(loadTestConfig(s.configFile), { code: 'INVALID_CONFIG' });
  await chmod(s.configFile, 0o600);
  const link = join(s.root, 'linked-config.json');
  await symlink(s.configFile, link);
  await assert.rejects(loadTestConfig(link), { code: 'INVALID_CONFIG' });
});

test('preview authorizes HR but never publishes files', async t => {
  const s = await sandbox(t);
  let readCount = 0;
  const lines = [];
  const result = await runTestCommand({
    args: flags(s.configFile, '--preview', '--ack-test-directory'),
    env, log: message => lines.push(message),
    directoryFactory() {
      return { async getUser() { readCount++; return normalizedUser; } };
    },
  });
  assert.equal(result.mode, 'preview');
  assert.equal(result.count, 1);
  assert.equal(readCount, 1);
  assert.deepEqual(await readdir(s.output), []);
  assert.ok(lines.some(line => line.includes('No files written.')));
  assert.equal(lines.join('\n').includes(env.SIGNATUREE_LDAP_BIND_PASSWORD), false);
});

test('generate produces an actual private write-once signature snapshot', async t => {
  const s = await sandbox(t);
  const lines = [];
  const result = await runTestCommand({
    args: flags(s.configFile, '--generate', '--ack-test-directory', '--ack-test-output'),
    env, log: message => lines.push(message),
    directoryFactory() {
      return { async getUser() { return normalizedUser; } };
    },
    generate: async inputs => {
      const { generateSignatureSnapshot } = await import('../../src/services/generate.js');
      return generateSignatureSnapshot({
        ...inputs, converter: async () => rtf,
        publisher: publishSignatureSnapshot,
      });
    },
  });
  assert.equal(result.mode, 'generate');
  assert.equal(await readFile(join(result.snapshotPath, 'HR.htm'), 'utf8'),
    '<p>Alex Müller</p>');
  assert.equal(await readFile(join(result.snapshotPath, 'HR.txt'), 'utf8'),
    'alex@example.invalid');
  assert.deepEqual(await readFile(join(result.snapshotPath, 'HR.rtf')), rtf);
  assert.equal((await readdir(s.output)).length, 1);
  assert.equal(lines.join('\n').includes(env.SIGNATUREE_LDAP_BIND_PASSWORD), false);
});

test('non-allowlisted accounts are rejected before any directory connection', async t => {
  const s = await sandbox(t);
  let initialized = false;
  await assert.rejects(runTestCommand({
    args: ['--config', s.configFile, '--user', 'other.user', '--signature', 'HR',
      '--preview', '--ack-test-directory'],
    env,
    directoryFactory() { initialized = true; throw Error('must not initialize'); },
  }), { code: 'TEST_USER_NOT_ALLOWED' });
  assert.equal(initialized, false);
});

test('AD account mismatch after alias resolution is not authorized', async t => {
  const s = await sandbox(t);
  await assert.rejects(runTestCommand({
    args: flags(s.configFile, '--preview', '--ack-test-directory'),
    env,
    directoryFactory() {
      return { async getUser() { return { ...normalizedUser, accountName: 'other.user' }; } };
    },
  }), { code: 'TEST_USER_NOT_ALLOWED' });
  assert.deepEqual(await readdir(s.output), []);
});

test('missing credential fails before contacting LDAP', async t => {
  const s = await sandbox(t);
  let initialized = false;
  await assert.rejects(runTestCommand({
    args: flags(s.configFile, '--preview', '--ack-test-directory'),
    env: { ...env, SIGNATUREE_LDAP_BIND_PASSWORD: '' },
    directoryFactory() { initialized = true; return {}; },
  }), { code: 'DIRECTORY_NOT_CONFIGURED' });
  assert.equal(initialized, false);
});

test('broken test config and duplicate allowlist are refused', async t => {
  const s = await sandbox(t);
  await s.updateConfig({ ...s.config, allowedTestAccounts: ['test.user', 'TEST.USER'] });
  await assert.rejects(loadTestConfig(s.configFile), { code: 'INVALID_CONFIG' });
  await s.updateConfig({ ...s.config, schema: 42 });
  await assert.rejects(loadTestConfig(s.configFile), { code: 'INVALID_CONFIG' });
});
