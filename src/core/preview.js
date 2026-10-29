import { renderSelectedSignatures } from './render.js';
import { resolveAuthorizedKeys } from './assignments.js';

export class SignaturePreparationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SignaturePreparationError';
    this.code = code;
    this.status = status;
  }
}

const USER_FIELDS = Object.freeze([
  'accountName', 'userPrincipalName', 'displayName', 'givenName', 'sn',
  'mail', 'title', 'department', 'telephoneNumber', 'mobile',
]);

export function resolveTemplateValues(user, staticValues = {}) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw new TypeError('Normalized directory user is required');
  }
  if (staticValues === null || typeof staticValues !== 'object' ||
      Array.isArray(staticValues)) {
    throw new TypeError('Admin-provided static variables must be an object');
  }
  const values = Object.create(null);
  for (const [key, value] of Object.entries(staticValues)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) ||
        USER_FIELDS.includes(key) || !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new TypeError('Invalid or reserved admin template variable');
    }
    values[key] = value;
  }
  for (const key of USER_FIELDS) {
    if (!Object.hasOwn(user, key) || typeof user[key] !== 'string') {
      throw new TypeError('Invalid normalized directory attribute: ' + key);
    }
    values[key] = user[key];
  }
  return Object.freeze(values);
}

/**
 * In-memory preview bridge. No writes, no impersonation, no RTF.
 * Directory and catalog/mappings must all be constructed on the SERVER.
 * The request may name the user and selected keys, but NEVER grants rights.
 */
export async function prepareSignaturePreview({
  directory,
  username,
  requestedKeys,
  mappings,
  catalog,
  staticValues = {},
}) {
  if (!directory || typeof directory.getUser !== 'function') {
    throw new TypeError('Directory provider with getUser is required');
  }
  if (typeof username !== 'string' || !username.trim() ||
      username.length > 128 || /[\x00\r\n]/.test(username)) {
    throw new SignaturePreparationError('INVALID_IDENTITY', 'Invalid username');
  }
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new TypeError('Server-discovered template catalog is required');
  }

  const user = await directory.getUser(username);
  if (!user) {
    throw new SignaturePreparationError('USER_NOT_AVAILABLE', 'User unavailable', 404);
  }
  const eligibleKeys = resolveAuthorizedKeys({
    directGroupDns: user.groups,
    mappings,
    catalogKeys: Object.keys(catalog),
  });
  const values = resolveTemplateValues(user, staticValues);
  const signatures = renderSelectedSignatures({
    requestedKeys,
    eligibleKeys,
    catalog,
    values,
  });
  return Object.freeze({
    accountName: user.accountName,
    eligibleKeys,
    signatures,
  });
}
