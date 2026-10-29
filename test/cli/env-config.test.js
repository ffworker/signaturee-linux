import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvTestConfig, parseTestArguments } from '../../src/cli/test-generate.js';

const env = {
  SIGNATUREE_ALLOWED_TEST_ACCOUNTS_JSON: '["test.user"]',
  SIGNATUREE_PROFILES_JSON: '[{"key":"HR","encoding":"utf-8","images":[]}]',
  SIGNATUREE_MAPPINGS_JSON: '[{"groupDn":"CN=HR,DC=example,DC=invalid","signatureKey":"HR"}]',
};
test('env-only test mode parses required explicit acknowledgments', () => {
  const x = parseTestArguments(['--env-config','--user','test.user','--signature','HR','--preview','--ack-test-directory']);
  assert.equal(x.envConfig, true);
  assert.equal(x.configFile, null);
});
test('env mode cannot combine with config path', () => {
  assert.throws(() => parseTestArguments(['--config','/tmp/a.json','--env-config','--user','test.user','--signature','HR','--preview','--ack-test-directory']));
});
test('env mode still needs generation output acknowledgment', () => {
  assert.throws(() => parseTestArguments(['--env-config','--user','test.user','--signature','HR','--generate','--ack-test-directory']));
});
test('valid env configuration is restricted to the container mounts', () => {
  const c = loadEnvTestConfig(env);
  assert.equal(c.templatesRoot, '/templates');
  assert.equal(c.outputRoot, '/output');
  assert.deepEqual(c.allowedTestAccounts, ['test.user']);
});
test('missing or malformed JSON fails closed', () => {
  assert.throws(() => loadEnvTestConfig({ ...env, SIGNATUREE_MAPPINGS_JSON: '{bad' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => loadEnvTestConfig({ ...env, SIGNATUREE_ALLOWED_TEST_ACCOUNTS_JSON: '[]' }), { code: 'INVALID_CONFIG' });
});
