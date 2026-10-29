import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDirectoryProvider } from '../../src/directory/ldap-provider.js';
import { resolveAuthorizedKeys } from '../../src/core/assignments.js';
import { prepareSignaturePreview, resolveTemplateValues } from '../../src/core/preview.js';

const groupHr = 'CN=Signature-HR,OU=Groups,DC=example,DC=invalid';
const groupSales = 'CN=Signature-Sales,OU=Groups,DC=example,DC=invalid';
const sameCnWrongOu = 'CN=Signature-HR,OU=Archive,DC=example,DC=invalid';
const sample = Object.freeze({
  dn: 'CN=Test User,OU=People,DC=example,DC=invalid',
  sAMAccountName: 'test.user',
  userPrincipalName: 'test.user@example.invalid',
  displayName: 'Alex Müller & Partner',
  givenName: 'Alex',
  sn: 'Müller',
  mail: 'alex.mueller@example.invalid',
  title: 'Entwicklung <Team>',
  department: 'IT "R&D"',
  telephoneNumber: '',
  mobile: '+49 123 456789',
  memberOf: [groupHr, groupSales],
  userAccountControl: '512',
});
const config = {
  url: 'ldaps://dc.example.invalid:636',
  baseDN: 'OU=People,DC=example,DC=invalid',
  bindDN: 'CN=Reader,OU=Service,DC=example,DC=invalid',
  bindPassword: 'synthetic-secret',
};
const fixtures = fileURLToPath(new URL('../fixtures/demo/', import.meta.url));
const html = readFileSync(join(fixtures, 'DEMO_Template.htm'), 'utf8');
const txt = readFileSync(join(fixtures, 'DEMO_Template.txt'), 'utf8');

function setup(entries = [sample]) {
  const calls = [];
  const factory = async (options) => {
    calls.push({ kind: 'client', tls: options.tlsOptions.rejectUnauthorized });
    return {
      async bind(dn) { calls.push({ kind: 'bind', service: dn === config.bindDN }); },
      async search(base, options) {
        calls.push({ kind: 'search', filter: options.filter, sizeLimit: options.sizeLimit });
        return { searchEntries: entries };
      },
      async unbind() { calls.push({ kind: 'close' }); },
    };
  };
  return { provider: createDirectoryProvider(config, factory), calls };
}
const catalog = {
  HR: { html, text: txt },
  Sales: { html: '<p>$mail</p>', text: '$mail' },
};
const mappings = [
  { groupDn: groupHr, signatureKey: 'HR' },
  { groupDn: groupSales, signatureKey: 'Sales' },
];
function previewArgs(directory) {
  return {
    directory,
    username: 'test.user',
    requestedKeys: ['HR'],
    mappings,
    catalog,
    staticValues: { footer: 'GmbH & Co. KG' },
  };
}

test('a service-account lookup feeds the renderer with explicitly selected HR only', async () => {
  const { provider, calls } = setup();
  const result = await prepareSignaturePreview(previewArgs(provider));
  assert.deepEqual(result.eligibleKeys, ['HR', 'Sales']);
  assert.deepEqual(result.signatures.map((entry) => entry.key), ['HR']);
  assert.equal(result.signatures[0].html, readFileSync(join(fixtures, 'expected/DEMO.htm'), 'utf8'));
  assert.equal(result.signatures[0].text, readFileSync(join(fixtures, 'expected/DEMO.txt'), 'utf8'));
  assert.deepEqual(calls.filter(c => c.kind === 'bind').map(c => c.service), [true]);
  assert.equal(calls.filter(c => c.kind === 'close').length, 1);
  assert.equal(calls[0].tls, true);
});

test('AD group membership only authorizes signature selection, never expands it', async () => {
  const { provider } = setup();
  const result = await prepareSignaturePreview({ ...previewArgs(provider), requestedKeys: ['Sales'] });
  assert.deepEqual(result.signatures.map(x => x.key), ['Sales']);
});

test('no CN substring or different OU grants a signature', () => {
  const authorized = resolveAuthorizedKeys({
    directGroupDns: [sameCnWrongOu],
    mappings,
    catalogKeys: ['HR', 'Sales'],
  });
  assert.deepEqual(authorized, []);
});

test('group DNs match exactly, case-insensitively, without nested traversal', () => {
  const authorized = resolveAuthorizedKeys({
    directGroupDns: [groupHr.toLowerCase()],
    mappings: [{ groupDn: groupHr, signatureKey: 'hr' }],
    catalogKeys: ['HR', 'Sales'],
  });
  assert.deepEqual(authorized, ['HR']);
});

test('unassigned or disabled AD user never yields a signature', async () => {
  const { provider } = setup([{ ...sample, userAccountControl: '514' }]);
  await assert.rejects(prepareSignaturePreview(previewArgs(provider)),
    { code: 'USER_NOT_AVAILABLE', status: 404 });
  const noGroups = setup([{ ...sample, memberOf: [] }]);
  await assert.rejects(prepareSignaturePreview(previewArgs(noGroups.provider)),
    { code: 'SELECTION_NOT_AUTHORIZED', status: 403 });
});

test('request cannot invent signature permissions by claiming to belong to a group', async () => {
  const { provider } = setup([{ ...sample, memberOf: [groupHr] }]);
  await assert.rejects(prepareSignaturePreview({
    ...previewArgs(provider),
    requestedKeys: ['Sales'],
    groups: [groupSales],
    eligibleKeys: ['Sales'],
  }), { code: 'SELECTION_NOT_AUTHORIZED', status: 403 });
});

test('bad admin group map and ambiguous template keys fail closed', () => {
  assert.throws(() => resolveAuthorizedKeys({
    directGroupDns: [groupHr],
    mappings: [{ groupDn: groupHr, signatureKey: 'Missing' }],
    catalogKeys: ['HR'],
  }), TypeError);
  assert.throws(() => resolveAuthorizedKeys({
    directGroupDns: [groupHr],
    mappings: mappings.slice(0, 1),
    catalogKeys: ['HR', 'hr'],
  }), TypeError);
  assert.throws(() => resolveAuthorizedKeys({
    directGroupDns: [groupHr],
    mappings: [mappings[0], mappings[0]],
    catalogKeys: ['HR'],
  }), TypeError);
});

test('admin static variables must not override LDAP-derived attributes', () => {
  const user = { accountName: 'test.user',
    userPrincipalName: 'test.user@example.invalid',
    displayName: 'Alex', givenName: 'Alex', sn: 'Müller',
    mail: 'test.user@example.invalid', title: '', department: '',
    telephoneNumber: '', mobile: '' };
  assert.throws(() => resolveTemplateValues(user, { mail: 'forged@example.invalid' }), TypeError);
  const values = resolveTemplateValues(user, { footer: 'EXAMPLE ONLY' });
  assert.equal(values.mail, 'test.user@example.invalid');
  assert.equal(values.footer, 'EXAMPLE ONLY');
  assert.equal(Object.isFrozen(values), true);
});

test('an LDAP failure bubbles up safely; no partial rendering occurs', async () => {
  const badDirectory = { async getUser() { throw new Error('simulated unavailable'); } };
  await assert.rejects(prepareSignaturePreview(previewArgs(badDirectory)), /simulated unavailable/);
});
