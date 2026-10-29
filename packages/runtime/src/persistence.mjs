import { validatePersistedRecordShape } from './contracts.mjs';
import { RuntimeError } from './errors.mjs';

const digestPattern = /^[0-9a-f]{64}$/;
const placeholderDigest = '0'.repeat(64);

function fail(code, message, cause) {
  return new RuntimeError(code, { message, ...(cause === undefined ? {} : { cause }) });
}

function ownValue(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}

function incompatibleRecord(record) {
  const format = ownValue(record, 'formatVersion');
  if (Number.isSafeInteger(format) && format >= 0 && format !== 1) return true;
  const snapshot = ownValue(record, 'snapshot');
  const schema = ownValue(snapshot, 'schemaVersion');
  return Number.isSafeInteger(schema) && schema >= 0 && schema !== 1;
}

// The canonical JSON writer owns the ordering. JSON.stringify(objects) alone
// reorders integer-like keys even if they were inserted in sorted order.
const encoder = new TextEncoder();
const byteKey = key => encoder.encode(key);
function compareKeys(left, right) {
  const a = byteKey(left);
  const b = byteKey(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  // Distinct JS strings can have equal UTF-8 bytes after lone-surrogate replacement.
  return a.length - b.length || (left < right ? -1 : left > right ? 1 : 0);
}

function writeCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(writeCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareKeys)
      .map(key => `${JSON.stringify(key)}:${writeCanonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateSnapshot(snapshot) {
  return validatePersistedRecordShape({
    formatVersion: 1, savedAt: '2000-01-01T00:00:00.000Z',
    snapshot, snapshotSha256: placeholderDigest,
  }).snapshot;
}

/** Version 1 canonical UTF-8 snapshot bytes, independent of insertion order. */
export function encodeCanonicalSnapshot(snapshot) {
  return encoder.encode(writeCanonical(validateSnapshot(snapshot)));
}

async function calculateDigest(snapshot, digestSha256) {
  if (typeof digestSha256 !== 'function') throw fail('DIGEST_UNAVAILABLE', 'SHA-256 provider is unavailable');
  let result;
  try { result = await digestSha256(encoder.encode(writeCanonical(snapshot))); }
  catch (error) { throw fail('DIGEST_UNAVAILABLE', 'SHA-256 provider failed', error); }
  if (typeof result !== 'string' || !digestPattern.test(result)) {
    throw fail('DIGEST_UNAVAILABLE', 'SHA-256 provider returned an invalid digest');
  }
  return result;
}

/** Construct a detached persisted envelope from an actual Core snapshot. */
export async function encodePersistedRecord(snapshot, { savedAt, digestSha256 } = {}) {
  const detached = validatePersistedRecordShape({
    formatVersion: 1, savedAt, snapshot, snapshotSha256: placeholderDigest,
  });
  return {
    ...detached,
    snapshotSha256: await calculateDigest(detached.snapshot, digestSha256),
  };
}

/** Verify envelope, identity and hash before returning a clean Core snapshot. */
export async function decodePersistedRecord(record, { game, digestSha256 } = {}) {
  if (incompatibleRecord(record)) throw fail('RESTORE_INCOMPATIBLE', 'Persisted format or snapshot schema is unsupported');
  let clean;
  try { clean = validatePersistedRecordShape(record); }
  catch (error) { throw fail('RESTORE_CORRUPT', 'Persisted record is malformed', error); }
  if (!game || clean.snapshot.gameId !== game.id || clean.snapshot.gameVersion !== game.version) {
    throw fail('RESTORE_INCOMPATIBLE', 'Persisted game identity or version is incompatible');
  }
  const actual = await calculateDigest(clean.snapshot, digestSha256);
  if (actual !== clean.snapshotSha256) throw fail('RESTORE_CORRUPT', 'Persisted snapshot digest mismatch');
  return clean.snapshot;
}
