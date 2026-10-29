import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { validateRtf } from '../conversion/rtf.js';

/**
 * Linux-only, write-once snapshot publisher.
 *
 * A COMPLETE batch of signatures is staged in a private, same-filesystem
 * directory and becomes visible with ONE directory rename. Existing snapshots
 * are never intentionally overwritten. Stable "current" aliases, retention,
 * and end-user access are deferred to a separate, reviewed integration.
 *
 * Security boundary: rootDirectory is an ADMIN-CONFIGURED, trusted mount,
 * not a browser-supplied path. The mounted volume must not be concurrently
 * modified by hostile processes running with the same permissions.
 */
export class SignaturePublishError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SignaturePublishError';
    this.code = code;
  }
}

const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const SAFE_ASSET_SEGMENT = /^[\p{L}\p{N} _().-]+$/u;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|bmp|svg)$/i;
const MAX_SIGNATURES = 50;
const MAX_HTML_OR_TEXT_BYTES = 1_048_576;
const MAX_ASSETS = 50;
const MAX_ASSET_BYTES = 5 * 1_048_576;
const MAX_TOTAL_BYTES = 40 * 1_048_576;

function badInput() {
  return new SignaturePublishError('INVALID_OUTPUT', 'Invalid signature output batch');
}

function assertPathName(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value) ||
      value.endsWith('.') || value.includes('..')) throw badInput();
}

function validateAssetPath(path, key) {
  if (typeof path !== 'string' || path.length > 256 ||
      path.includes('\\') || path.startsWith('/') ||
      /[\x00-\x1f:]/.test(path) || path !== path.normalize('NFC')) throw badInput();

  const parts = path.split('/');
  if (parts.length < 2 || parts.length > 5 ||
      parts[0] !== key + '-Dateien' ||
      parts.some(part => !part || part === '.' || part === '..' ||
        part.startsWith('.') || !SAFE_ASSET_SEGMENT.test(part)) ||
      !IMAGE_FILE.test(parts.at(-1))) throw badInput();
  return parts;
}

function validateBatch(accountName, signatures) {
  assertPathName(accountName, ACCOUNT);
  if (!Array.isArray(signatures) || signatures.length === 0 ||
      signatures.length > MAX_SIGNATURES) throw badInput();

  const seenKeys = new Set();
  let totalBytes = 0;
  for (const signature of signatures) {
    if (!signature || typeof signature !== 'object' || Array.isArray(signature)) throw badInput();
    const { key, html, text, rtf, assets = [] } = signature;
    assertPathName(key, KEY);
    const normalized = key.toLowerCase();
    if (seenKeys.has(normalized)) throw badInput();
    seenKeys.add(normalized);

    if (typeof html !== 'string' || !html.trim() ||
        Buffer.byteLength(html, 'utf8') > MAX_HTML_OR_TEXT_BYTES ||
        typeof text !== 'string' ||
        Buffer.byteLength(text, 'utf8') > MAX_HTML_OR_TEXT_BYTES) throw badInput();

    if (!(rtf instanceof Uint8Array)) throw badInput();
    try { validateRtf(rtf); } catch { throw badInput(); }
    totalBytes += Buffer.byteLength(html, 'utf8') +
      Buffer.byteLength(text, 'utf8') + rtf.byteLength;

    if (!Array.isArray(assets) || assets.length > MAX_ASSETS) throw badInput();
    const seenAssets = new Set();
    for (const asset of assets) {
      if (!asset || typeof asset !== 'object') throw badInput();
      validateAssetPath(asset.path, key);
      if (!(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength === 0 ||
          asset.bytes.byteLength > MAX_ASSET_BYTES) throw badInput();

      const name = asset.path.toLowerCase();
      if (seenAssets.has(name)) throw badInput();
      seenAssets.add(name);
      totalBytes += asset.bytes.byteLength;
    }
    if (totalBytes > MAX_TOTAL_BYTES) throw badInput();
  }
}

/**
 * @param {{
 *   rootDirectory: string, // trusted, existing, absolute destination (host mount)
 *   accountName: string,
 *   signatures: Array<{key:string, html:string, text:string, rtf:Uint8Array,
 *                       assets?:Array<{path:string,bytes:Uint8Array}>}>
 * }} batch
 * @returns {Promise<{snapshotPath: string, accountName: string, keys: string[]}>}
 */
export async function publishSignatureSnapshot({ rootDirectory, accountName, signatures } = {}) {
  // Validate every signature and every asset *before* touching the filesystem.
  validateBatch(accountName, signatures);
  if (typeof rootDirectory !== 'string' || !isAbsolute(rootDirectory)) {
    throw new SignaturePublishError('INVALID_ROOT', 'Output root must be an absolute path');
  }
  const root = resolve(rootDirectory);
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) {
      throw new SignaturePublishError('INVALID_ROOT', 'Output root must be a real directory');
    }
  } catch (error) {
    if (error instanceof SignaturePublishError) throw error;
    throw new SignaturePublishError('INVALID_ROOT', 'Output root does not exist or is inaccessible');
  }

  let staging;
  try {
    staging = await mkdtemp(join(root, '.signaturee-staging-'));
    // Private stage is created with mode 0700 by mkdtemp.
    for (const { key, html, text, rtf, assets = [] } of signatures) {
      await writeFile(join(staging, key + '.htm'), html, { flag: 'wx', mode: 0o600 });
      await writeFile(join(staging, key + '.txt'), text, { flag: 'wx', mode: 0o600 });
      await writeFile(join(staging, key + '.rtf'), rtf, { flag: 'wx', mode: 0o600 });
      for (const asset of assets) {
        const target = join(staging, ...asset.path.split('/'));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, asset.bytes, { flag: 'wx', mode: 0o600 });
      }
    }

    // UUID names make collisions practically impossible. There is no support
    // for replacing existing output: any existing target is an error.
    const target = join(root, accountName + '--' + randomUUID());
    try {
      await lstat(target);
      throw new SignaturePublishError('OUTPUT_EXISTS', 'Output snapshot already exists');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    await rename(staging, target); // one atomic visibility point, same mount
    staging = undefined;
    return Object.freeze({
      snapshotPath: target,
      accountName,
      keys: Object.freeze(signatures.map(signature => signature.key)),
    });
  } catch (error) {
    if (error instanceof SignaturePublishError) throw error;
    throw new SignaturePublishError('PUBLISH_FAILED', 'Cannot publish signature output');
  } finally {
    if (staging) {
      try { await rm(staging, { recursive: true, force: true }); }
      catch { /* Never hide the original error. */ }
    }
  }
}
