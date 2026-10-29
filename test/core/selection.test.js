import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthorizedSignatureSelection as select } from '../../src/core/selection.js';

const domain = Object.freeze({
  catalogKeys: ['HR', 'Sales', 'IT'],
  eligibleKeys: ['HR', 'Sales'],
});

test('only explicitly selected signatures are returned (never all group memberships)', () => {
  const result = select({ ...domain, requestedKeys: ['HR'] });
  assert.deepEqual(result, ['HR']);
  assert.equal(Object.isFrozen(result), true);
});

test('request order is preserved, and keys are canonicalized to template catalog spelling', () => {
  assert.deepEqual(
    select({ ...domain, requestedKeys: ['sales', 'hr'] }),
    ['Sales', 'HR'],
  );
});

test('no implicit fallback to all eligible signatures', () => {
  assert.throws(() => select({ ...domain, requestedKeys: [] }), { code: 'SELECTION_REQUIRED' });
  assert.throws(() => select({ ...domain }), { code: 'SELECTION_REQUIRED' });
});

test('request cannot add a catalogued but unauthorized signature', () => {
  assert.throws(
    () => select({ ...domain, requestedKeys: ['HR', 'IT'] }),
    { code: 'SELECTION_NOT_AUTHORIZED', status: 403 },
  );
});

test('unknown signatures are rejected with the same error as unauthorized signatures', () => {
  assert.throws(
    () => select({ ...domain, requestedKeys: ['HR', 'Finance'] }),
    { code: 'SELECTION_NOT_AUTHORIZED', status: 403 },
  );
});

test('no eligibility means no generated signatures', () => {
  assert.throws(
    () => select({ ...domain, eligibleKeys: [], requestedKeys: ['HR'] }),
    { code: 'SELECTION_NOT_AUTHORIZED', status: 403 },
  );
});

test('ambiguous, duplicate, or unsafe request keys fail closed', () => {
  assert.throws(
    () => select({ ...domain, requestedKeys: ['HR', 'hr'] }),
    { code: 'DUPLICATE_SELECTION' },
  );
  for (const bad of ['../HR', 'HR/Sales', '', ' ', 'a'.repeat(41), 42, null]) {
    assert.throws(
      () => select({ ...domain, requestedKeys: [bad] }),
      { code: 'INVALID_SELECTION' },
    );
  }
});

test('invalid or ambiguous trusted catalog/eligibility is rejected, not guessed', () => {
  assert.throws(
    () => select({ eligibleKeys: ['HR'], catalogKeys: ['HR', 'hr'], requestedKeys: ['HR'] }),
    { name: 'TypeError' },
  );
  assert.throws(
    () => select({ eligibleKeys: 'HR', catalogKeys: ['HR'], requestedKeys: ['HR'] }),
    { name: 'TypeError' },
  );
});
