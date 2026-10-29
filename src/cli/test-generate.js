import { readFile, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createDirectoryProvider } from '../directory/ldap-provider.js';
import { loadTemplateCatalog } from '../catalog/load.js';
import { prepareSignaturePreview } from '../core/preview.js';
import { generateSignatureSnapshot } from '../services/generate.js';

export class TestCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
  }
}

const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

function fail() {
  throw new TestCliError('INVALID_ARGUMENTS', 'Invalid test CLI arguments');
}

/** Explicit flags only. No dynamic LDAP/group/output paths from CLI flags. */
export function parseTestArguments(args) {
  if (!Array.isArray(args)) fail();
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const result = { signatures: [], mode: null, configFile: null, username: null };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--config', '--user', '--signature', '--preview', '--generate',
      '--ack-test-directory', '--ack-test-output'].includes(flag)) fail();
    if (['--preview', '--generate', '--ack-test-directory', '--ack-test-output'].includes(flag)) {
      if (seen.has(flag)) fail();
      seen.add(flag);
      if (flag === '--preview' || flag === '--generate') {
        if (result.mode) fail();
        result.mode = flag.substring(2);
      } else if (flag === '--ack-test-directory') {
        result.ackDirectory = true;
      } else {
        result.ackOutput = true;
      }
    } else {
      const value = args[++i];
      if (!value || value.startsWith('--')) fail();
      if (flag === '--signature') result.signatures.push(value);
      else {
        if (seen.has(flag)) fail();
        seen.add(flag);
        if (flag === '--user') result.username = value;
        else result.configFile = value;
      }
    }
  }
  if (!result.configFile || !isAbsolute(result.configFile) ||
      !ACCOUNT.test(result.username ?? '') ||
      result.username.includes('..') ||
      result.signatures.length < 1 || result.signatures.length > 50 ||
      result.signatures.some(key => !KEY.test(key)) ||
      new Set(result.signatures.map(key => key.toLowerCase())).size !== result.signatures.length ||
      !result.ackDirectory || !result.mode ||
      (result.mode === 'generate' && !result.ackOutput) ||
      (result.mode === 'preview' && result.ackOutput)) fail();
  return Object.freeze(result);
}

function validateTestConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      config.schema !== 1 || !Array.isArray(config.allowedTestAccounts) ||
      !Array.isArray(config.profiles) || !Array.isArray(config.mappings) ||
      !isAbsolute(config.templatesRoot ?? '') ||
      !isAbsolute(config.outputRoot ?? '')) {
    throw new TestCliError('INVALID_CONFIG', 'Invalid test generator configuration');
  }
  if (config.allowedTestAccounts.length === 0 || config.allowedTestAccounts.length > 50 ||
      config.allowedTestAccounts.some(v => typeof v !== 'string' ||
        !ACCOUNT.test(v) || v.includes('..')) ||
      new Set(config.allowedTestAccounts.map(v => v.toLowerCase())).size !==
        config.allowedTestAccounts.length) {
    throw new TestCliError('INVALID_CONFIG', 'Invalid allowed test-account list');
  }
  if (config.staticValues !== undefined &&
      (typeof config.staticValues !== 'object' || config.staticValues === null ||
       Array.isArray(config.staticValues))) {
    throw new TestCliError('INVALID_CONFIG', 'Invalid static values');
  }
  return config;
}

export async function loadTestConfig(filePath) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
    throw new TestCliError('INVALID_CONFIG', 'Config file must have absolute path');
  }
  const path = resolve(filePath);
  let file;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 10 ||
        info.size > 65_536 || (info.mode & 0o077) !== 0 ||
        await realpath(path) !== path) throw Error('Unsafe configuration file');
    file = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new TestCliError('INVALID_CONFIG', 'Missing, unsafe or invalid test configuration');
  }
  return validateTestConfig(file);
}

export const TEST_CLI_HELP = [
  'Test-AD generator. This is not a public web server or a production deployment.',
  'Usage:',
  '  node scripts/generate-test.js --config /absolute/test.json --user test.user',
  '    --signature HR [--signature SALES] --preview --ack-test-directory',
  '  node scripts/generate-test.js --config /absolute/test.json --user test.user',
  '    --signature HR --generate --ack-test-directory --ack-test-output',
  'Environment: SIGNATUREE_LDAP_URL, _BASE_DN, _BIND_DN, _BIND_PASSWORD',
  'Optional: SIGNATUREE_LDAP_CA_FILE (PEM CA certificate)',
  'Docker: use SIGNATUREE_LDAP_BIND_PASSWORD_FILE as a mounted secret (instead of password env)',
].join('\n');

/**
 * Authorized LOCAL CLI boundary for test-AD only.
 * The account allowlist is enforced before any network call.
 * Logs only generic statuses and selected signature keys.
 */
export async function runTestCommand({
  args, env = process.env, log = console.log,
  directoryFactory = createDirectoryProvider,
  catalogLoader = loadTemplateCatalog,
  preview = prepareSignaturePreview,
  generate = generateSignatureSnapshot,
} = {}) {
  const options = parseTestArguments(args);
  if (options.help) {
    log(TEST_CLI_HELP);
    return Object.freeze({ help: true });
  }
  const config = await loadTestConfig(options.configFile);
  if (!config.allowedTestAccounts.some(account =>
    account.toLowerCase() === options.username.toLowerCase())) {
    throw new TestCliError('TEST_USER_NOT_ALLOWED', 'Account is not in test allowlist');
  }
  if (!env.SIGNATUREE_LDAP_URL || !env.SIGNATUREE_LDAP_BASE_DN ||
      !env.SIGNATUREE_LDAP_BIND_DN) {
    throw new TestCliError('DIRECTORY_NOT_CONFIGURED', 'Test directory not configured');
  }
  if (env.SIGNATUREE_LDAP_BIND_PASSWORD &&
      env.SIGNATUREE_LDAP_BIND_PASSWORD_FILE) {
    throw new TestCliError('DIRECTORY_NOT_CONFIGURED', 'Use only one LDAP secret source');
  }
  let bindPassword = env.SIGNATUREE_LDAP_BIND_PASSWORD;
  if (env.SIGNATUREE_LDAP_BIND_PASSWORD_FILE) {
    const secretPath = env.SIGNATUREE_LDAP_BIND_PASSWORD_FILE;
    try {
      if (!isAbsolute(secretPath)) throw Error('Non-absolute secret path');
      const stat = await lstat(secretPath);
      if (!stat.isFile() || stat.isSymbolicLink() ||
          stat.size < 1 || stat.size > 16_384 ||
          await realpath(secretPath) !== resolve(secretPath)) {
        throw Error('Unsafe secret file');
      }
      bindPassword = (await readFile(secretPath, 'utf8')).replace(/\r?\n$/, '');
    } catch {
      throw new TestCliError('DIRECTORY_NOT_CONFIGURED', 'Invalid LDAP secret file');
    }
  }
  if (!bindPassword || /[\r\n]/.test(bindPassword)) {
    throw new TestCliError('DIRECTORY_NOT_CONFIGURED', 'Test directory not configured');
  }
  const caCertificate = env.SIGNATUREE_LDAP_CA_FILE
    ? await readFile(env.SIGNATUREE_LDAP_CA_FILE, 'utf8') : undefined;
  const backendDirectory = directoryFactory({
    url: env.SIGNATUREE_LDAP_URL,
    baseDN: env.SIGNATUREE_LDAP_BASE_DN,
    bindDN: env.SIGNATUREE_LDAP_BIND_DN,
    bindPassword,
    ...(caCertificate ? { caCertificate } : {}),
  });
  // AD aliases/UPNs must not redirect an allowlisted request to an
  // unrelated account. This CLI accepts only exact sAMAccountName matches.
  const directory = {
    async getUser(account) {
      const user = await backendDirectory.getUser(account);
      if (user && (typeof user.accountName !== 'string' ||
          user.accountName.toLowerCase() !== options.username.toLowerCase())) {
        throw new TestCliError('TEST_USER_NOT_ALLOWED', 'Resolved account not in test allowlist');
      }
      return user;
    },
  };
  const { catalog, assetsByKey } = await catalogLoader({
    rootDirectory: config.templatesRoot, profiles: config.profiles,
  });
  const params = {
    directory, username: options.username,
    requestedKeys: options.signatures, mappings: config.mappings,
    catalog, assetsByKey, staticValues: config.staticValues ?? {},
    outputRoot: config.outputRoot,
  };
  if (options.mode === 'preview') {
    const result = await preview(params);
    log('PASS: Authorized preview rendered for ' + result.signatures.length + ' signature(s).');
    log('Selected keys: ' + result.signatures.map(s => s.key).join(', '));
    log('No files written.');
    return Object.freeze({ mode: 'preview', count: result.signatures.length });
  }
  const published = await generate(params);
  log('PASS: A complete test snapshot was published.');
  log('Selected keys: ' + published.keys.join(', '));
  log('Snapshot: ' + published.snapshotPath);
  return Object.freeze({ mode: 'generate', snapshotPath: published.snapshotPath });
}
