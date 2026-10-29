import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Experimental Linux HTML -> RTF adapter using headless LibreOffice.
 * Input HTML/templates must be trusted admin-owned data. This is NOT a
 * general-purpose sandbox for arbitrary web pages or external resources.
 * No persistent output or Windows ACL operations happen here.
 */
export class RtfConversionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RtfConversionError';
    this.code = code;
  }
}

const MAX_HTML_BYTES = 1_048_576;
const MAX_ASSET_BYTES = 5 * 1_048_576;
const MAX_ASSETS = 50;
const MAX_RTF_BYTES = 30 * 1_048_576;
const ALLOWED_IMAGES = /\.(?:png|jpe?g|gif|bmp|svg)$/i;
const SAFE_PATH_COMPONENT = /^[\p{L}\p{N} _().-]+$/u;

function assertAssetPath(relative) {
  if (typeof relative !== 'string' || relative.length > 256 ||
      relative.includes('\\') || relative.startsWith('/') ||
      /[\x00-\x1f:]/.test(relative)) {
    throw new RtfConversionError('INVALID_ASSET', 'Invalid image asset path');
  }
  const segments = relative.split('/');
  if (segments.length < 2 || segments.length > 5 ||
      segments.some(s => !s || s === '.' || s === '..' ||
        s.startsWith('.') || !SAFE_PATH_COMPONENT.test(s)) ||
      !ALLOWED_IMAGES.test(segments.at(-1))) {
    throw new RtfConversionError('INVALID_ASSET', 'Invalid image asset path');
  }
}

function validateInputs({ html, assets, timeoutMs, sofficePath }) {
  if (typeof html !== 'string' || !html.trim() ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new RtfConversionError('INVALID_HTML', 'HTML must be nonempty and at most 1 MiB');
  }
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) {
    throw new RtfConversionError('INVALID_ASSET', 'Invalid image asset collection');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new RtfConversionError('INVALID_TIMEOUT', 'Invalid conversion timeout');
  }
  if (typeof sofficePath !== 'string' || !sofficePath.trim() ||
      /[\x00\r\n]/.test(sofficePath)) {
    throw new RtfConversionError('INVALID_EXECUTABLE', 'Invalid LibreOffice executable');
  }

  let total = 0;
  const seen = new Set();
  for (const asset of assets) {
    assertAssetPath(asset?.path);
    if (!(asset.bytes instanceof Uint8Array) ||
        asset.bytes.byteLength === 0 || asset.bytes.byteLength > MAX_ASSET_BYTES) {
      throw new RtfConversionError('INVALID_ASSET', 'Invalid image asset data');
    }
    total += asset.bytes.byteLength;
    const key = asset.path.toLowerCase();
    if (total > MAX_RTF_BYTES || seen.has(key)) {
      throw new RtfConversionError('INVALID_ASSET', 'Duplicate or oversized images');
    }
    seen.add(key);
  }
}

function runConverter(executable, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    let timedOut = false;
    let done = false;
    let timer;

    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }

    try {
      child = spawn(executable, args, {
        cwd,
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
    } catch {
      finish(new RtfConversionError('CONVERTER_UNAVAILABLE', 'Cannot start LibreOffice'));
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.once('error', () => {
      finish(new RtfConversionError('CONVERTER_UNAVAILABLE', 'Cannot start LibreOffice'));
    });
    child.once('close', (code, signal) => {
      if (timedOut) {
        finish(new RtfConversionError('CONVERSION_TIMEOUT', 'LibreOffice conversion timed out'));
      } else if (code !== 0 || signal) {
        finish(new RtfConversionError('CONVERSION_FAILED', 'LibreOffice conversion failed'));
      } else {
        finish();
      }
    });
  });
}

export function validateRtf(bytes) {
  if (!(bytes instanceof Uint8Array) ||
      bytes.byteLength < 32 || bytes.byteLength > MAX_RTF_BYTES ||
      Buffer.from(bytes.subarray(0, 6)).toString('ascii') !== '{\\rtf1') {
    throw new RtfConversionError('INVALID_RTF', 'LibreOffice returned invalid RTF');
  }
  return true;
}

/**
 * Returns RTF bytes; the output publisher is a separate, future component.
 * Every call gets its own temporary source, output and LibreOffice profile.
 * Template images may be supplied by relative safe paths such as
 * "DEMO-Dateien/logo.svg"; the caller must provide every referenced image.
 */
export async function convertHtmlToRtf({
  html,
  assets = [],
  timeoutMs = 45000,
  sofficePath = 'soffice',
} = {}) {
  validateInputs({ html, assets, timeoutMs, sofficePath });

  const temporary = await mkdtemp(join(tmpdir(), 'signaturee-rtf-'));
  try {
    const sourceDir = join(temporary, 'source');
    const outputDir = join(temporary, 'output');
    const profileDir = join(temporary, 'profile');
    await Promise.all([
      mkdir(sourceDir, { mode: 0o700 }),
      mkdir(outputDir, { mode: 0o700 }),
      mkdir(profileDir, { mode: 0o700 }),
    ]);
    const htmlPath = join(sourceDir, 'signature.htm');
    await writeFile(htmlPath, html, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

    for (const asset of assets) {
      const assetPath = join(sourceDir, asset.path);
      await mkdir(dirname(assetPath), { recursive: true, mode: 0o700 });
      await writeFile(assetPath, asset.bytes, { flag: 'wx', mode: 0o600 });
    }

    await runConverter(sofficePath, [
      '-env:UserInstallation=' + pathToFileURL(profileDir).href,
      '--headless',
      '--norestore',
      '--nodefault',
      '--convert-to', 'rtf:Rich Text Format',
      '--outdir', outputDir,
      htmlPath,
    ], sourceDir, timeoutMs);

    let rtf;
    try {
      rtf = await readFile(join(outputDir, 'signature.rtf'));
    } catch {
      throw new RtfConversionError('CONVERSION_FAILED', 'LibreOffice produced no RTF output');
    }
    validateRtf(rtf);
    return rtf;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
