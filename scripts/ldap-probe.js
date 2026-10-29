#!/usr/bin/env node
/**
 * Read-only LDAPS smoke test. Never logs employee attributes, credentials, or
 * group names. Deliberately no login/password test or output generation.
 *
 * Requires an explicit test-account name and acknowledgment, plus service
 * bind credentials supplied via environment (never via command-line flags).
 */
import { readFile } from 'node:fs/promises';
import { createDirectoryProvider } from '../src/directory/ldap-provider.js';

function usage() {
  console.log('Usage: npm run ldap:probe -- --user TEST_ACCOUNT --ack-test-directory');
  console.log('Set SIGNATUREE_LDAP_URL, _BASE_DN, _BIND_DN, _BIND_PASSWORD');
  console.log('Optional: SIGNATUREE_LDAP_CA_FILE points to a trusted CA PEM file.');
  console.log('Read-only lookup of one enabled test account; no PII or passwords are printed.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    usage();
    return;
  }
  if (args.length !== 3 || args[0] !== '--user' ||
      !args[1] || args[2] !== '--ack-test-directory') {
    usage();
    process.exitCode = 2;
    return;
  }
  const config = {
    url: process.env.SIGNATUREE_LDAP_URL,
    baseDN: process.env.SIGNATUREE_LDAP_BASE_DN,
    bindDN: process.env.SIGNATUREE_LDAP_BIND_DN,
    bindPassword: process.env.SIGNATUREE_LDAP_BIND_PASSWORD,
  };
  if (process.env.SIGNATUREE_LDAP_CA_FILE) {
    config.caCertificate = await readFile(process.env.SIGNATUREE_LDAP_CA_FILE, 'utf8');
  }
  const provider = createDirectoryProvider(config);
  const user = await provider.getUser(args[1]);
  if (!user) {
    console.error('FAIL: No enabled matching test account found.');
    process.exitCode = 1;
    return;
  }
  console.log('PASS: LDAPS service bind, enabled-user lookup and direct group retrieval.');
  console.log('Direct group count: ' + user.groups.length);
  console.log('This probe did NOT test user-password login, rendering or production access.');
}

main().catch((error) => {
  // Never print exception details: they can include LDAP usernames or secrets.
  if (error?.code && typeof error.code === 'string' &&
      /^[A-Z_]+$/.test(error.code)) {
    console.error('FAIL: ' + error.code);
  } else {
    console.error('FAIL: Configuration invalid or directory unavailable.');
  }
  process.exitCode = 1;
});
