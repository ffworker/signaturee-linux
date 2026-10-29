import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSignaturePreview } from '../core/preview.js';
import { generateSignatureSnapshot } from '../services/generate.js';
import { DEMO_ACCOUNT, DEMO_KEY, loadOfflineDemo } from './offline.js';

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
        return send(res, 200, { status: 'ok', mode: 'offline-demo', ldap: false });
      }
      if (req.method === 'GET' && url.pathname === '/api/preview') {
        const ctx = await loadContext({ outputRoot });
        const result = await preview(ctx);
        const signature = result.signatures[0];
        if (result.accountName !== DEMO_ACCOUNT || signature?.key !== DEMO_KEY) {
          throw new Error('Unexpected demo identity');
        }
        const logo = ctx.assetsByKey[DEMO_KEY][0].bytes;
        // An inline local image keeps the sandboxed preview free of external assets.
        const image = 'data:image/svg+xml;base64,' + Buffer.from(logo).toString('base64');
        const safePreview = signature.html.replaceAll('DEMO-Dateien/logo.svg', image);
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
          if (result.accountName !== DEMO_ACCOUNT ||
              result.keys.length !== 1 || result.keys[0] !== DEMO_KEY) {
            throw new Error('Unexpected generation result');
          }
          lastSnapshot = result.snapshotPath;
          return send(res, 200, {
            status: 'generated', accountName: DEMO_ACCOUNT,
            snapshot: basename(lastSnapshot), formats: Object.keys(DOWNLOADS),
          });
        } finally {
          generating = false;
        }
      }
      const download = /^\/api\/download\/(htm|txt|rtf)$/.exec(url.pathname);
      if (req.method === 'GET' && download) {
        if (!lastSnapshot) return error(res, 404, 'Generate a demo signature first');
        const ext = download[1];
        res.setHeader('Content-Disposition', 'attachment; filename="DEMO.' + ext + '"');
        return send(res, 200, await readFile(join(lastSnapshot, DEMO_KEY + '.' + ext)), DOWNLOADS[ext]);
      }
      return error(res, 404, 'Not found');
    })().catch(() => {
      if (!res.headersSent) error(res, 500, 'Demo operation failed');
      else res.destroy();
    });
  });
}
