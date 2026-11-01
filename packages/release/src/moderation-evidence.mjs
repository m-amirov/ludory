import path from 'node:path';
import { readRegularBytes, SHA_256, sha256 } from './archive.mjs';
import { ReleaseInputError } from './errors.mjs';
import { inspectPromoImage } from './promo-image.mjs';

class IncompleteEvidence extends Error {
  constructor(code) { super(code); this.code = code; }
}

const fail = code => { throw new ReleaseInputError(code, 'Invalid local QA evidence'); };
const blocked = code => { throw new IncompleteEvidence(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fields(value, allowed, code) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(code);
}

function required(value, name, code) {
  if (!Object.hasOwn(value, name)) blocked(code);
  return value[name];
}

function text(value, limit, code) {
  if (value === undefined || value === '') blocked(code);
  if (typeof value !== 'string' || value.length > limit) fail(code);
  if (!value.trim()) blocked(code);
}

/** Reject duplicate object keys, including differently escaped identical keys. */
function uniqueJsonKeys(source) {
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]:,]/gs;
  const stack = [];
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    const current = stack.at(-1);
    if (token === '{') stack.push({ object: true, keys: new Set(), expectsKey: true });
    else if (token === '[') stack.push({ object: false });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && current?.object) current.expectsKey = true;
    else if (token.startsWith('"') && current?.object && current.expectsKey) {
      const key = JSON.parse(token);
      if (current.keys.has(key)) fail('QA_JSON_DUPLICATE_KEY');
      current.keys.add(key);
      current.expectsKey = false;
    }
  }
}

function jsonFile(filename) {
  const bytes = readRegularBytes(filename, 1024 * 1024);
  const source = bytes.toString('utf8');
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { fail('QA_EVIDENCE_JSON_INVALID'); }
  uniqueJsonKeys(source);
  return { value: parsed, evidenceSha256: sha256(bytes) };
}

function gate(action) {
  try {
    const result = action();
    return { status: 'PASS', ...(typeof result === 'string' ? { reasonCode: result } : result) };
  }
  catch (error) {
    const code = error?.code ?? 'QA_INPUT_ERROR';
    return { status: error instanceof IncompleteEvidence || code === 'INPUT_MISSING' ? 'BLOCKED' : 'FAIL',
      reasonCode: code };
  }
}

function validateMetadataIdentity(metadata, { target, candidateSha256, projectId }) {
  fields(metadata, ['schemaVersion', 'target', 'candidateSha256', 'projectId', 'listing', 'content', 'promo'], 'QA_METADATA_FORMAT');
  if (metadata.schemaVersion !== 1 || metadata.target !== target ||
      metadata.candidateSha256 !== candidateSha256 || !SHA_256.test(metadata.candidateSha256 ?? '') ||
      metadata.projectId !== projectId) fail('QA_METADATA_CANDIDATE_MISMATCH');
  return 'QA_METADATA_IDENTITY_MATCH';
}

function validateListing(metadata, projectVersion) {
  const listing = required(metadata, 'listing', 'QA_METADATA_INCOMPLETE');
  fields(listing, ['name', 'description', 'howToPlay', 'category', 'version', 'platforms', 'orientation'], 'QA_LISTING_FORMAT');
  for (const [name, max] of [['name', 160], ['description', 5000], ['howToPlay', 5000],
    ['category', 120], ['version', 64]]) {
    text(required(listing, name, 'QA_LISTING_INCOMPLETE'), max, 'QA_LISTING_FORMAT');
  }
  if (!projectVersion) blocked('QA_MANIFEST_VERSION_NOT_PROVIDED');
  if (listing.version !== projectVersion) fail('QA_LISTING_VERSION_MISMATCH');
  const platforms = required(listing, 'platforms', 'QA_LISTING_INCOMPLETE');
  if (!Array.isArray(platforms)) fail('QA_LISTING_FORMAT');
  if (!platforms.length) blocked('QA_LISTING_INCOMPLETE');
  if (platforms.length > 2 || new Set(platforms).size !== platforms.length ||
      platforms.some(item => !['desktop', 'mobile'].includes(item))) fail('QA_LISTING_FORMAT');
  const orientation = required(listing, 'orientation', 'QA_LISTING_INCOMPLETE');
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) fail('QA_LISTING_FORMAT');
  const content = required(metadata, 'content', 'QA_CONTENT_DECLARATION_INCOMPLETE');
  fields(content, ['ageRating', 'contentWarnings'], 'QA_CONTENT_DECLARATION_FORMAT');
  text(required(content, 'ageRating', 'QA_CONTENT_DECLARATION_INCOMPLETE'), 40, 'QA_CONTENT_DECLARATION_FORMAT');
  const warnings = required(content, 'contentWarnings', 'QA_CONTENT_DECLARATION_INCOMPLETE');
  if (!Array.isArray(warnings) || warnings.length > 20 ||
      warnings.some(value => typeof value !== 'string' || !value.trim() || value.length > 250)) {
    fail('QA_CONTENT_DECLARATION_FORMAT');
  }
  return 'LOCAL_LISTING_DECLARATIONS_COMPLETE';
}

function safePromoPath(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') ||
      relative.includes('\0') || path.isAbsolute(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..') ||
      !/\.(png|jpe?g|webp)$/i.test(relative)) fail('QA_PROMO_PATH_INVALID');
  return relative;
}

function verifyPromo(metadata, promoRoot, metadataHash) {
  const items = required(metadata, 'promo', 'QA_PROMO_INCOMPLETE');
  if (!Array.isArray(items) || items.length > 2) fail('QA_PROMO_FORMAT');
  const found = new Set();
  const paths = [];
  for (const item of items) {
    fields(item, ['kind', 'path', 'sha256'], 'QA_PROMO_FORMAT');
    if (!['icon', 'cover'].includes(item.kind) || found.has(item.kind) ||
        !SHA_256.test(item.sha256 ?? '')) fail('QA_PROMO_FORMAT');
    found.add(item.kind);
    paths.push(safePromoPath(item.path));
  }
  if (items.length < 2) blocked('QA_PROMO_INCOMPLETE');
  if (!promoRoot || typeof promoRoot !== 'string') blocked('QA_PROMO_ROOT_NOT_PROVIDED');
  const hashes = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index], relative = paths[index];
    const bytes = readRegularBytes(path.join(promoRoot, ...relative.split('/')), 10 * 1024 * 1024);
    const hash = sha256(bytes);
    if (hash !== item.sha256) fail('QA_PROMO_FILE_MISMATCH');
    try { inspectPromoImage(bytes, relative); }
    catch { fail('QA_PROMO_FILE_MISMATCH'); }
    hashes.push(hash);
  }
  return { reasonCode: 'LOCAL_PROMO_BYTES_HASH_MATCH',
    evidenceSha256: sha256([metadataHash, ...hashes].join(':')) };
}

function verifyVkMedia(rightsPath, candidateSha256, mediaFiles) {
  if (rightsPath === undefined) blocked('QA_VK_MEDIA_DECLARATIONS_MISSING');
  const { value: rights, evidenceSha256 } = jsonFile(rightsPath);
  fields(rights, ['schemaVersion', 'target', 'candidateSha256', 'assets'], 'QA_VK_RIGHTS_FORMAT');
  if (rights.schemaVersion !== 1 || rights.target !== 'vk-games' ||
      rights.candidateSha256 !== candidateSha256 || !SHA_256.test(rights.candidateSha256 ?? '')) {
    fail('QA_VK_RIGHTS_CANDIDATE_MISMATCH');
  }
  const assets = required(rights, 'assets', 'QA_VK_MEDIA_DECLARATIONS_MISSING');
  if (!Array.isArray(assets)) fail('QA_VK_RIGHTS_FORMAT');
  if (assets.length > mediaFiles.length) fail('QA_VK_RIGHTS_EXTRA');
  const expected = new Map(mediaFiles.map(file => [file.path, file.sha256]));
  const seen = new Set();
  for (const asset of assets) {
    fields(asset, ['path', 'sha256', 'provenance', 'evidence'], 'QA_VK_RIGHTS_FORMAT');
    if (!expected.has(asset.path) || seen.has(asset.path)) fail('QA_VK_RIGHTS_EXTRA');
    if (expected.get(asset.path) !== asset.sha256 || !SHA_256.test(asset.sha256 ?? '')) {
      fail('QA_VK_RIGHTS_FILE_MISMATCH');
    }
    if (asset.provenance === undefined || asset.evidence === undefined || asset.evidence === '') {
      blocked('QA_VK_MEDIA_DECLARATIONS_INCOMPLETE');
    }
    if (!['owned', 'licensed', 'public-domain'].includes(asset.provenance) ||
        typeof asset.evidence !== 'string' || asset.evidence.length > 2048) fail('QA_VK_RIGHTS_FORMAT');
    if (!asset.evidence.trim()) blocked('QA_VK_MEDIA_DECLARATIONS_INCOMPLETE');
    seen.add(asset.path);
  }
  if (assets.length < mediaFiles.length) blocked('QA_VK_MEDIA_DECLARATIONS_MISSING');
  return { reasonCode: 'LOCAL_VK_MEDIA_DECLARATIONS_MATCH', evidenceSha256 };
}

/** Untrusted declarations are checked for byte consistency, not granted platform or legal authority. */
export function inspectModerationEvidence({ target, candidateSha256, projectId, projectVersion,
  metadataPath, promoRoot, rightsPath, mediaFiles = [] } = {}) {
  const media = target === 'yandex-games'
    ? { status: 'NOT_APPLICABLE', reasonCode: 'YANDEX_RELEASE_RIGHTS_GATE' }
    : gate(() => verifyVkMedia(rightsPath, candidateSha256, mediaFiles));
  if (metadataPath === undefined) return { listing: { status: 'BLOCKED', reasonCode: 'QA_METADATA_NOT_PROVIDED' },
    promo: { status: 'BLOCKED', reasonCode: 'QA_METADATA_NOT_PROVIDED' }, media };
  let metadata;
  let metadataHash;
  const identity = gate(() => {
    ({ value: metadata, evidenceSha256: metadataHash } = jsonFile(metadataPath));
    return validateMetadataIdentity(metadata, { target, candidateSha256, projectId });
  });
  const listing = identity.status === 'PASS' ? gate(() => ({
    reasonCode: validateListing(metadata, projectVersion), evidenceSha256: metadataHash,
  })) : identity;
  const promo = identity.status === 'PASS'
    ? gate(() => verifyPromo(metadata, promoRoot, metadataHash))
    : { status: 'BLOCKED', reasonCode: 'QA_METADATA_DEPENDENCY_UNAVAILABLE' };
  return { listing, promo, media };
}
