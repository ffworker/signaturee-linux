import { assertAuthorizedSignatureSelection } from './selection.js';

const PLACEHOLDERS = /\$\$|\$\{([A-Za-z][A-Za-z0-9_]*)\}|\$([A-Za-z][A-Za-z0-9_]*)/g;

export class SignatureRenderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SignatureRenderError';
    this.code = code;
  }
}

export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

export function escapeHtmlText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Templates are authored by trusted admins. Only inserted values are escaped.
 * No filesystem operations, AD/LDAP calls or authorization decisions here.
 * Supported placeholders: $mail and braced variables; $$ is a literal $.
 */
export function renderTemplate(template, values, { format } = {}) {
  if (typeof template !== 'string') {
    throw new TypeError('Template must be a string');
  }
  if (format !== 'html' && format !== 'text') {
    throw new TypeError('format must be html or text');
  }
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new TypeError('values must be a server-resolved attribute map');
  }
  return normalizeNewlines(template).replace(PLACEHOLDERS, (token, braced, plain) => {
    if (token === '$$') return '$';
    const key = braced || plain;
    if (!Object.hasOwn(values, key)) {
      throw new SignatureRenderError('MISSING_VARIABLE', 'Missing template variable: ' + key);
    }
    const value = values[key];
    if (value !== null && value !== undefined &&
        !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new SignatureRenderError('INVALID_VARIABLE', 'Invalid value for variable: ' + key);
    }
    const raw = value == null ? '' : normalizeNewlines(String(value));
    return format === 'html' ? escapeHtmlText(raw) : raw;
  });
}

export function renderSignaturePair({ htmlTemplate, txtTemplate, values }) {
  return Object.freeze({
    html: renderTemplate(htmlTemplate, values, { format: 'html' }),
    text: renderTemplate(txtTemplate, values, { format: 'text' }),
  });
}

/**
 * A pure boundary for later API use. Eligible keys and catalog must be
 * server-derived. Rendering never expands choices using group membership.
 */
export function renderSelectedSignatures({ requestedKeys, eligibleKeys, catalog, values }) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new TypeError('catalog must be a server-discovered template map');
  }
  const selected = assertAuthorizedSignatureSelection({
    requestedKeys,
    eligibleKeys,
    catalogKeys: Object.keys(catalog),
  });
  return Object.freeze(selected.map((key) => {
    const pair = catalog[key];
    if (!pair || typeof pair !== 'object' || Array.isArray(pair)) {
      throw new TypeError('Invalid catalog entry');
    }
    const rendered = renderSignaturePair({
      htmlTemplate: pair.html,
      txtTemplate: pair.text,
      values,
    });
    return Object.freeze({ key, ...rendered });
  }));
}
