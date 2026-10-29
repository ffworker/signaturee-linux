import { convertHtmlToRtf } from '../conversion/rtf.js';
import { publishSignatureSnapshot } from '../publish/snapshot.js';
import { prepareSignaturePreview } from '../core/preview.js';

/**
 * Internal, server-owned orchestration ONLY, not an HTTP endpoint.
 *
 * The caller MUST authorize the operator separately before passing a target
 * username. The directory, group map, templates, images and output root must
 * come from trusted server configuration, never from browser input.
 *
 * Rendering and *all* RTF conversions finish before the publisher is called.
 * A failed conversion cannot leave a partial published snapshot.
 */
export async function generateSignatureSnapshot({
  directory,
  username,
  requestedKeys,
  mappings,
  catalog,
  assetsByKey = {},
  staticValues = {},
  outputRoot,
  converter = convertHtmlToRtf,
  publisher = publishSignatureSnapshot,
}) {
  if (typeof converter !== 'function' || typeof publisher !== 'function') {
    throw new TypeError('Generator requires converter and publisher functions');
  }
  if (!assetsByKey || typeof assetsByKey !== 'object' || Array.isArray(assetsByKey)) {
    throw new TypeError('Asset map must be server-configured object');
  }

  const preview = await prepareSignaturePreview({
    directory, username, requestedKeys, mappings, catalog, staticValues,
  });

  // Do not let an untrusted requested key index a prototype property.
  const prepared = [];
  for (const signature of preview.signatures) {
    const assets = Object.hasOwn(assetsByKey, signature.key)
      ? assetsByKey[signature.key] : [];
    if (!Array.isArray(assets)) throw new TypeError('Invalid configured signature assets');

    // The converter must not mutate admin-owned asset buffers. Copy them for
    // isolation between conversions, especially if a converter is mocked.
    const safeAssets = assets.map((asset) => {
      if (!asset || typeof asset.path !== 'string' ||
          !(asset.bytes instanceof Uint8Array)) {
        throw new TypeError('Invalid configured signature image');
      }
      return { path: asset.path, bytes: Buffer.from(asset.bytes) };
    });

    const rtf = await converter({ html: signature.html, assets: safeAssets });
    if (!(rtf instanceof Uint8Array)) {
      throw new TypeError('Converter did not return RTF bytes');
    }
    prepared.push({
      key: signature.key,
      html: signature.html,
      text: signature.text,
      rtf,
      assets: safeAssets,
    });
  }

  const publication = await publisher({
    rootDirectory: outputRoot,
    accountName: preview.accountName,
    signatures: prepared,
  });
  return Object.freeze({
    accountName: preview.accountName,
    keys: publication.keys,
    snapshotPath: publication.snapshotPath,
  });
}
