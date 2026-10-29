import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSignaturePreview } from '../core/preview.js';
import { generateSignatureSnapshot } from '../services/generate.js';
import { DEMO_ACCOUNT, loadOfflineDemo } from './offline.js';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const PUBLIC = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
});
const DOWNLOADS = Object.freeze({
  htm: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  rtf: 'application/rtf',
});

function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
    "frame-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
}

function send(res, code, data, contentType = 'application/json; charset=utf-8') {
  res.statusCode = code;
  res.setHeader('Content-Type', contentType);
  res.end(contentType.startsWith('application/json') ? JSON.stringify(data) : data);
}
function error(res, code, message) { send(res, code, { error: message }); }

/**
 * This is an intentionally LOCAL, unauthenticated demo, not a production API.
 * Host validation and POST Origin validation mitigate DNS rebinding / CSRF.
 * Only the hardcoded fake user and shipped template are ever processed.
 */
export function createOfflineDemoServer({
  outputRoot = '/output',
  loadContext = loadOfflineDemo,
  preview = prepareSignaturePreview,
  generate = generateSignatureSnapshot,
  mode = 'offline-demo',
} = {}) {
  let lastSnapshot = null;
  let generating = false;

  return createServer((req, res) => {
    headers(res);
    (async () => {
      const host = req.headers.host ?? '';
      if (!/^(?:localhost|127\.0\.0\.1):[0-9]{1,5}$/.test(host)) {
        return error(res, 403, 'Localhost only');
      }
      if (!req.url || req.url.length > 128) return error(res, 400, 'Invalid request');
      let url;
      try { url = new URL(req.url, 'http://' + host); }
      catch { return error(res, 400, 'Invalid request'); }
      // Browsers and test tools often append tracking/cache-buster queries to
      // document and static asset URLs. They never affect which file is served.
      // For read-only demo APIs allow only inert cache-buster keys, while
      // rejecting all identity/template selection and every POST query.
      const staticGet = req.method === 'GET' && Object.hasOwn(PUBLIC, url.pathname);
      const readOnlyApi = req.method === 'GET' &&
        ['/api/health', '/api/preview'].includes(url.pathname);
      const cacheKeysOnly = [...url.searchParams].length <= 2 &&
        [...url.searchParams].every(([key, value]) =>
          (key === '_' || key === 'v') && value.length <= 64);
      if (url.hash || (url.search &&
          !(staticGet || (readOnlyApi && cacheKeysOnly)))) {
        return error(res, 400, 'Unsupported parameters');
      }

      if (req.method === 'GET' && Object.hasOwn(PUBLIC, url.pathname)) {
        const [name, mime] = PUBLIC[url.pathname];
        return send(res, 200, await readFile(join(WEB, name)), mime);
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { status: 'ok', mode, ldap: false });
      }
      if (req.method === 'GET' && url.pathname === '/api/preview') {
        const ctx = await loadContext({ outputRoot });
        const result = await preview(ctx);
        const signature = result.signatures[0];
        const key = ctx.requestedKeys?.[0];
        if (ctx.username !== DEMO_ACCOUNT || result.accountName !== DEMO_ACCOUNT ||
            ctx.requestedKeys.length !== 1 || result.signatures.length !== 1 ||
            signature?.key !== key) {
          throw new Error('Unexpected demo identity');
        }
        let safePreview = signature.html;
        const assets = ctx.assetsByKey[key] ?? [];
        const imageMimes = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
          jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
        for (const asset of assets) {
          const extension = asset.path.split('.').at(-1).toLowerCase();
          const mime = imageMimes[extension];
          if (!mime) throw new Error('Unexpected demo image');
          const dataUri = 'data:' + mime + ';base64,' + Buffer.from(asset.bytes).toString('base64');
          safePreview = safePreview.replaceAll(asset.path, dataUri);
        }
        return send(res, 200, {
          accountName: result.accountName, key: signature.key,
          html: safePreview, text: signature.text,
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/generate') {
        if (req.headers.origin !== 'http://' + host) return error(res, 403, 'Same-origin request required');
        // The demo accepts NO input fields: user, keys, templates and output are server-owned.
        if (req.headers['transfer-encoding'] ||
            Number(req.headers['content-length'] ?? 0) !== 0) {
          return error(res, 400, 'Request body not allowed');
        }
        if (generating) return error(res, 409, 'Generation already running');
        generating = true;
        try {
          const ctx = await loadContext({ outputRoot });
          const result = await generate(ctx);
          const key = ctx.requestedKeys?.[0];
          if (ctx.username !== DEMO_ACCOUNT || result.accountName !== DEMO_ACCOUNT ||
              ctx.requestedKeys.length !== 1 ||
              result.keys.length !== 1 || result.keys[0] !== key) {
            throw new Error('Unexpected generation result');
          }
          lastSnapshot = { path: result.snapshotPath, key };
          return send(res, 200, {
            status: 'generated', accountName: DEMO_ACCOUNT, key,
            snapshot: basename(lastSnapshot.path), formats: Object.keys(DOWNLOADS),
          });
        } finally {
          generating = false;
        }
      }
      const download = /^\/api\/download\/(htm|txt|rtf)$/.exec(url.pathname);
      if (req.method === 'GET' && download) {
        if (!lastSnapshot) return error(res, 404, 'Generate a demo signature first');
        const ext = download[1];
        res.setHeader('Content-Disposition',
          'attachment; filename="' + lastSnapshot.key + '.' + ext + '"');
        return send(res, 200,
          await readFile(join(lastSnapshot.path, lastSnapshot.key + '.' + ext)),
          DOWNLOADS[ext]);
      }
      return error(res, 404, 'Not found');
    })().catch(err => {
      if (!res.headersSent) {
        // Only known, fixed codes and admin-declared relative filenames.
        // Never forward raw exceptions, paths, credentials or template content.
        const safeCodes = new Set([
          'TEMPLATE_UNAVAILABLE', 'INVALID_TEMPLATE_ROOT', 'INVALID_TEMPLATE_ENCODING',
          'INVALID_TEMPLATE', 'INVALID_CATALOG', 'MISSING_VARIABLE',
          'INVALID_VARIABLE', 'SELECTION_NOT_AUTHORIZED',
        ]);
        if (safeCodes.has(err?.code)) {
          const file = typeof err.filename === 'string' &&
            /^(?:[A-Za-z0-9_-]+_Template\.(?:htm|txt)|[A-Za-z0-9_-]+-Dateien\/[\p{L}\p{N} _().\/-]+)$/u.test(err.filename)
            ? err.filename : undefined;
          return send(res, 422, {
            error: 'Offline template validation failed',
            code: err.code,
            ...(file ? { file } : {}),
          });
        }
        error(res, 500, 'Demo operation failed');
      } else res.destroy();
    });
  });
}
