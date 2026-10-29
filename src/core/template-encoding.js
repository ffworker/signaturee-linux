import { TextDecoder } from 'node:util';

/** Legacy Windows templates may be cp1252; require explicit import selection. */
export function decodeTemplate(bytes, { encoding = 'utf-8' } = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('Template source must be a Uint8Array or Buffer');
  }
  if (encoding !== 'utf-8' && encoding !== 'windows-1252') {
    throw new RangeError('Unsupported template encoding: ' + String(encoding));
  }
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}
