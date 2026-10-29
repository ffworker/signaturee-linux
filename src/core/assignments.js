/**
 * Convert direct LDAP memberOf groups to signature keys using an admin-owned
 * exact-DN map. There is intentionally no CN-only or substring matching:
 * CN=Signature-HR in two different OUs must NOT grant the same signature.
 */
const SIGNATURE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

function groupIdentity(dn) {
  if (typeof dn !== 'string' || !dn.trim() || dn.length > 1024 ||
      /[\x00\r\n]/.test(dn) || !/^[A-Za-z][A-Za-z0-9-]*=/.test(dn)) {
    throw new TypeError('Invalid direct group DN');
  }
  // Deliberately strict: no parsing/expanding relative DNs, no CN-only matches.
  // AD returns full DNs. Admin mapping should copy the exact distinguishedName.
  return dn.trim().toLowerCase();
}

/**
 * Inputs MUST be supplied by the server:
 *   directGroupDns: direct memberOf DNs from a validated LDAP user
 *   mappings: [{ groupDn: full DN, signatureKey: template key }]
 *   catalogKeys: template keys discovered by the backend
 */
export function resolveAuthorizedKeys({ directGroupDns, mappings, catalogKeys }) {
  if (!Array.isArray(directGroupDns) || !Array.isArray(mappings) ||
      !Array.isArray(catalogKeys)) {
    throw new TypeError('Groups, mappings and catalog must be server-provided arrays');
  }
  const discovered = new Map();
  for (const key of catalogKeys) {
    if (typeof key !== 'string' || !SIGNATURE_KEY.test(key) ||
        discovered.has(key.toLowerCase())) {
      throw new TypeError('Invalid or case-ambiguous template catalog');
    }
    discovered.set(key.toLowerCase(), key);
  }

  const directGroups = new Set(directGroupDns.map(groupIdentity));
  const assigned = new Set();
  const seenMapping = new Set();

  for (const mapping of mappings) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
        !SIGNATURE_KEY.test(mapping.signatureKey ?? '')) {
      throw new TypeError('Invalid signature group mapping');
    }
    const group = groupIdentity(mapping.groupDn);
    const key = mapping.signatureKey.toLowerCase();
    if (!discovered.has(key)) {
      // Broken admin mapping must be corrected, not silently interpreted.
      throw new TypeError('Signature group mapping refers to an unknown template');
    }
    const unique = group + '\x00' + key;
    if (seenMapping.has(unique)) {
      throw new TypeError('Duplicate signature group mapping');
    }
    seenMapping.add(unique);
    if (directGroups.has(group)) assigned.add(key);
  }

  // Canonical key spelling and deterministic order are inherited from catalog.
  return Object.freeze([...discovered].filter(([lower]) => assigned.has(lower))
    .map(([, canonical]) => canonical));
}
