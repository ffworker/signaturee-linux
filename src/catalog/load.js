import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { decodeTemplate } from '../core/template-encoding.js';

export class TemplateCatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TemplateCatalogError';
    this.code = code;
  }
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const SAFE_COMPONENT = /^[\p{L}\p{N} _().-]+$/u;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|bmp|svg)$/i;

function invalidConfig() {
  return new TemplateCatalogError('INVALID_CATALOG', 'Invalid template catalog configuration');
}

function validateImageName(filename, key) {
  if (typeof filename !== 'string' || filename.length > 256 ||
      filename.includes('\\') || filename.startsWith('/') ||
      /[\x00-\x1f:]/.test(filename) ||
      filename !== filename.normalize('NFC')) throw invalidConfig();
  const parts = filename.split('/');
  if (parts.length < 2 || parts.length > 5 ||
      parts[0] !== key + '-Dateien' ||
      parts.some(part => !part || part === '.' || part === '..' ||
        part.startsWith('.') || !SAFE_COMPONENT.test(part)) ||
      !IMAGE_FILE.test(parts.at(-1))) throw invalidConfig();
  return parts;
}

function validateProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 50) throw invalidConfig();
  const seen = new Set();
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
        typeof profile.key !== 'string' || !KEY.test(profile.key) ||
        !['utf-8', 'windows-1252', undefined].includes(profile.encoding) ||
        (profile.images !== undefined && (!Array.isArray(profile.images) ||
          profile.images.length > 50))) throw invalidConfig();
    const key = profile.key.toLowerCase();
    if (seen.has(key)) throw invalidConfig();
    seen.add(key);
    const seenImages = new Set();
    for (const image of profile.images ?? []) {
      validateImageName(image, profile.key);
      if (seenImages.has(image.toLowerCase())) throw invalidConfig();
      seenImages.add(image.toLowerCase());
    }
  }
}

async function validateRoot(rootDirectory) {
  if (typeof rootDirectory !== 'string' || !isAbsolute(rootDirectory)) {
    throw new TemplateCatalogError('INVALID_TEMPLATE_ROOT',
      'Template root must be an existing absolute directory');
  }
  const root = resolve(rootDirectory);
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        await realpath(root) !== root) throw Error('Untrusted root');
  } catch {
    throw new TemplateCatalogError('INVALID_TEMPLATE_ROOT',
      'Template root must be an existing real directory');
  }
  return root;
}

/** Read only regular files, never symlinks, bounded by size. */
async function readBoundedFile(root, parts, maxBytes) {
  let path = root;
  let handle;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      path = join(path, parts[i]);
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Unsafe directory');
    }
    path = join(path, parts.at(-1));
    if (!path.startsWith(root + sep)) throw Error('Path escaped root');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() ||
        stat.size < 1 || stat.size > maxBytes) throw Error('Invalid file');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size < 1 || opened.size > maxBytes) throw Error('Invalid size');
    const bytes = await handle.readFile();
    if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) throw Error('Invalid size');
    return bytes;
  } catch {
    throw new TemplateCatalogError('TEMPLATE_UNAVAILABLE',
      'Template file is missing, unsafe or too large');
  } finally {
    if (handle) await handle.close();
  }
}

/**
 * Read an admin-owned, convention-based catalog. Templates:
 *   HR_Template.htm + HR_Template.txt
 *   HR-Dateien/logo.png (opt-in, listed in images)
 *
 * The server provides profiles and root; request bodies MUST NOT.
 * Returns null-prototype maps to avoid collisions with __proto__/constructor.
 */
export async function loadTemplateCatalog({ rootDirectory, profiles } = {}) {
  validateProfiles(profiles); // validate *all* configuration before filesystem access
  const root = await validateRoot(rootDirectory);
  const catalog = Object.create(null);
  const assetsByKey = Object.create(null);

  for (const { key, encoding = 'utf-8', images = [] } of profiles) {
    const [htmlBytes, textBytes] = await Promise.all([
      readBoundedFile(root, [key + '_Template.htm'], 1_048_576),
      readBoundedFile(root, [key + '_Template.txt'], 1_048_576),
    ]);
    let html, text;
    try {
      html = decodeTemplate(htmlBytes, { encoding });
      text = decodeTemplate(textBytes, { encoding });
    } catch {
      throw new TemplateCatalogError('INVALID_TEMPLATE_ENCODING',
        'Template encoding does not match the declared format');
    }
    if (!html.trim() || !text.trim()) throw new TemplateCatalogError(
      'INVALID_TEMPLATE', 'Template content cannot be empty');

    const assets = [];
    for (const asset of images) {
      const bytes = await readBoundedFile(root, validateImageName(asset, key),
        5 * 1_048_576);
      assets.push(Object.freeze({ path: asset, bytes }));
    }
    catalog[key] = Object.freeze({ html, text });
    assetsByKey[key] = Object.freeze(assets);
  }
  return Object.freeze({
    catalog: Object.freeze(catalog),
    assetsByKey: Object.freeze(assetsByKey),
  });
}
