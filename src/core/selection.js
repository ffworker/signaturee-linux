/**
 * A pure, fail-closed authorization boundary for signature selection.
 *
 * IMPORTANT: eligibleKeys and catalogKeys must be computed on the SERVER.
 * Never pass browser-provided "allowed" keys to this function.
 * The renderer must consume only the returned selection.
 */
const SIGNATURE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export class SignatureSelectionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SignatureSelectionError';
    this.code = code;
    this.status = status;
  }
}

function trustedIndex(keys, label) {
  if (!Array.isArray(keys)) {
    throw new TypeError(label + ' must be a server-provided array');
  }

  const index = new Map();
  for (const key of keys) {
    if (typeof key !== 'string' || !SIGNATURE_KEY_PATTERN.test(key)) {
      throw new TypeError(label + ' contains an invalid signature key');
    }
    const normalized = key.toLowerCase();
    if (index.has(normalized)) {
      throw new TypeError(label + ' contains duplicate or case-ambiguous signature keys');
    }
    index.set(normalized, key);
  }
  return index;
}

/**
 * Return the explicitly requested subset of server-authorized, available
 * signatures. Never infer selections from group memberships or CSV data here.
 *
 * @param {object} selection
 * @param {string[]} selection.requestedKeys - Untrusted user selection.
 * @param {string[]} selection.eligibleKeys - Server-verified authorization.
 * @param {string[]} selection.catalogKeys - Server-discovered templates.
 * @returns {ReadonlyArray<string>} Canonical keys in requested order.
 */
export function assertAuthorizedSignatureSelection({ requestedKeys, eligibleKeys, catalogKeys }) {
  const available = trustedIndex(catalogKeys, 'catalogKeys');
  const eligible = trustedIndex(eligibleKeys, 'eligibleKeys');

  if (!Array.isArray(requestedKeys) || requestedKeys.length === 0) {
    throw new SignatureSelectionError('SELECTION_REQUIRED', 'Select at least one signature.');
  }

  const seen = new Set();
  const selected = [];
  for (const key of requestedKeys) {
    if (typeof key !== 'string' || !SIGNATURE_KEY_PATTERN.test(key)) {
      throw new SignatureSelectionError('INVALID_SELECTION', 'Invalid signature selection.');
    }

    const normalized = key.toLowerCase();
    if (seen.has(normalized)) {
      throw new SignatureSelectionError('DUPLICATE_SELECTION', 'Duplicate signature selection.');
    }
    seen.add(normalized);

    if (!eligible.has(normalized) || !available.has(normalized)) {
      throw new SignatureSelectionError(
        'SELECTION_NOT_AUTHORIZED',
        'A requested signature is unavailable or not authorized.',
        403,
      );
    }
    selected.push(available.get(normalized));
  }

  return Object.freeze(selected);
}
