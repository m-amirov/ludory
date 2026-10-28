const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const eventTypes = new Set(['keyboard', 'pointer', 'touch']);
const eventSources = new Set(['input', 'renderer']);
const pointerPhases = new Set(['down', 'move', 'up', 'cancel']);
const keyboardPhases = new Set(['down', 'up']);
const viewportOrientations = new Set(['landscape', 'portrait']);
const commonEventFields = ['schemaVersion', 'type', 'action', 'phase', 'timestamp', 'source'];

function isSemver(value) {
  if (typeof value !== 'string' || !semverPattern.test(value)) return false;
  const prerelease = value.match(/^\d+\.\d+\.\d+-([^+]+)$/)?.[1];
  return !prerelease?.split('.').some(part => /^0\d+$/.test(part));
}

function isUtcTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const canonical = new Date(parsed).toISOString();
  return value.includes('.') ? canonical === value : canonical.replace('.000Z', 'Z') === value;
}

/**
 * @typedef {object} RuntimeHost
 * @property {() => Promise<void>} initialize
 * @property {() => void} start
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => Promise<void>} save
 * @property {() => Promise<void>} restore
 * @property {() => void} stop
 * @property {() => Promise<void>} destroy
 * @property {() => 'IDLE'|'READY'|'RUNNING'|'PAUSED'|'STOPPED'|'FAULTED'|'DESTROYED'} getStatus
 * @property {() => object} getSnapshot
 * @property {(listener: (event: RuntimeHostEventV1) => void) => () => void} subscribe
 */

/** @typedef {{schemaVersion: 1, type: 'status'|'error', status: string, errorCode?: string}} RuntimeHostEventV1 */

/**
 * @typedef {object} RuntimeRenderer
 * @property {(context: {root: unknown, viewport: RuntimeViewport, snapshot: CoreSnapshot, dispatchInput: (event: RuntimeInputEventV1) => void}) => (void|Promise<void>)} mount
 * @property {(viewport: RuntimeViewport) => void} resize
 * @property {(snapshot: CoreSnapshot) => void} render
 * @property {() => (void|Promise<void>)} unmount
 */

/**
 * @typedef {object} RuntimeInput
 * @property {(listener: (event: RuntimeInputEventV1) => void) => () => void} subscribe
 * @property {() => void} enable
 * @property {() => void} disable
 * @property {() => void} destroy
 */

/**
 * @typedef {object} RuntimeStorage
 * @property {(key: string) => Promise<null|PersistedRecordV1>} load
 * @property {(key: string, record: PersistedRecordV1) => Promise<void>} save
 * @property {(key: string) => Promise<void>} clear
 */

/**
 * @typedef {object} RuntimeAudio
 * @property {(muted: boolean) => void} setMuted
 * @property {(volume: number) => void} setMasterVolume
 * @property {(asset: string, options?: {loop?: boolean, volume?: number}) => unknown|Promise<unknown>} play
 * @property {(handle: unknown) => void} stop
 * @property {() => void} pauseAll
 * @property {() => void} resumeAll
 * @property {() => void} destroy
 */

/**
 * @typedef {object} RuntimeEnvironment
 * @property {unknown} root
 * @property {() => number} now
 * @property {() => string} [utcNow]
 * @property {(bytes: Uint8Array) => Promise<string>} [digestSha256]
 * @property {(callback: () => void) => unknown} requestFrame
 * @property {(handle: unknown) => void} cancelFrame
 * @property {(listener: (viewport: RuntimeViewport) => void) => () => void} observeViewport
 * @property {() => RuntimeViewport} getViewport
 */

/** @typedef {{schemaVersion: 1, width: number, height: number, dpr: number, orientation: 'landscape'|'portrait'}} RuntimeViewport */

/**
 * @typedef {object} RuntimeInputEventV1
 * @property {1} schemaVersion
 * @property {'keyboard'|'pointer'|'touch'} type
 * @property {string} action
 * @property {'down'|'move'|'up'|'cancel'} phase
 * @property {number} timestamp
 * @property {'input'|'renderer'} source
 * @property {string} [key]
 * @property {{id: number, x: number, y: number, button?: number}} [pointer]
 */
/** @typedef {RuntimeInputEventV1} RuntimeInputEvent */

/** @typedef {{schemaVersion: 1, gameId: string, gameVersion: string, revision: number, state: Record<string, unknown>}} CoreSnapshot */
/** @typedef {{formatVersion: 1, savedAt: string, snapshot: CoreSnapshot, snapshotSha256: string}} PersistedRecordV1 */
/** @typedef {PersistedRecordV1} PersistedRecord */

function fail(label, message) {
  throw new TypeError(`${label} ${message}`);
}

function ownDataDescriptor(value, key, label) {
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
  catch { fail(label, 'contains an unreadable property'); }
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
    fail(label, `.${String(key)} must be an enumerable own data property`);
  }
  return descriptor.value;
}

function plainRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(label, 'must be a plain object');
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(label, 'must expose readable own properties');
  }
  if (![Object.prototype, null].includes(prototype)) fail(label, 'has an unsupported prototype');
  for (const key of keys) {
    if (typeof key !== 'string') fail(label, 'cannot contain symbol properties');
    ownDataDescriptor(value, key, label);
  }
  return keys;
}

function exactRecord(value, fields, label) {
  const keys = plainRecord(value, label);
  const allowed = new Set(fields);
  if (keys.length !== fields.length || keys.some(key => !allowed.has(key))) {
    fail(label, 'has missing or unexpected fields');
  }
  return Object.fromEntries(fields.map(field => [field, ownDataDescriptor(value, field, label)]));
}

function allowedRecord(value, required, allowed, label) {
  const keys = plainRecord(value, label);
  const allowedSet = new Set(allowed);
  for (const key of keys) if (!allowedSet.has(key)) fail(label, `has unexpected field: ${key}`);
  for (const field of required) if (!Object.hasOwn(value, field)) fail(label, `is missing field: ${field}`);
  return Object.fromEntries(keys.map(key => [key, ownDataDescriptor(value, key, label)]));
}

function copyJson(value, label, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(label, 'contains a non-finite number');
    return value;
  }
  if (typeof value !== 'object') fail(label, 'contains a non-JSON value');
  if (ancestors.has(value)) fail(label, 'contains a cyclic reference');
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(label, 'contains unreadable properties');
  }
    if (Array.isArray(value) ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) {
      fail(label, 'contains an object with an unsupported prototype');
    }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (!Number.isSafeInteger(value.length) || keys.length !== value.length + 1 || !keys.includes('length')) {
        fail(label, 'contains an invalid array');
      }
      const result = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) fail(label, 'contains an array hole');
        const key = String(index);
        if (!keys.includes(key)) fail(label, 'contains an invalid array index');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(label, 'contains an array accessor');
        result.push(copyJson(descriptor.value, `${label}[${index}]`, ancestors));
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      if (typeof key !== 'string') fail(label, 'contains a symbol key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(label, `.${key} is not an own data field`);
      Object.defineProperty(result, key, {
        value: copyJson(descriptor.value, `${label}.${key}`, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function coreSnapshot(value, label = 'snapshot') {
  const fields = exactRecord(value, ['schemaVersion', 'gameId', 'gameVersion', 'revision', 'state'], label);
  if (fields.schemaVersion !== 1) fail(label, 'schemaVersion must be 1');
  if (typeof fields.gameId !== 'string' || !slugPattern.test(fields.gameId)) fail(label, 'gameId is invalid');
  if (!isSemver(fields.gameVersion)) fail(label, 'gameVersion is invalid');
  if (!Number.isSafeInteger(fields.revision) || fields.revision < 0) fail(label, 'revision must be a non-negative safe integer');
  if (fields.state === null || typeof fields.state !== 'object' || Array.isArray(fields.state)) fail(label, 'state must be a plain object');
  const state = copyJson(fields.state, `${label}.state`);
  return { schemaVersion: 1, gameId: fields.gameId, gameVersion: fields.gameVersion, revision: fields.revision, state };
}

function pointer(value, type) {
  const allowed = type === 'pointer' ? ['id', 'x', 'y', 'button'] : ['id', 'x', 'y'];
  const fields = allowedRecord(value, ['id', 'x', 'y'], allowed, `${type} pointer`);
  if (!Number.isSafeInteger(fields.id) || fields.id < 0) fail(`${type} pointer`, 'id must be a non-negative safe integer');
  for (const coordinate of ['x', 'y']) {
    if (typeof fields[coordinate] !== 'number' || !Number.isFinite(fields[coordinate])) fail(`${type} pointer`, `${coordinate} must be finite`);
  }
  if (Object.hasOwn(fields, 'button') && (!Number.isSafeInteger(fields.button) || fields.button < 0)) {
    fail(`${type} pointer`, 'button must be a non-negative safe integer');
  }
  return Object.fromEntries(allowed.filter(field => Object.hasOwn(fields, field)).map(field => [field, fields[field]]));
}

/** Validate and detach a version 1 normalized input event. */
export function validateRuntimeInputEvent(event) {
  const fields = plainRecord(event, 'input event');
  const allowed = [...commonEventFields, 'key', 'pointer'];
  if (fields.some(key => !allowed.includes(key))) fail('input event', 'has unexpected fields');
  for (const field of commonEventFields) if (!Object.hasOwn(event, field)) fail('input event', `is missing field: ${field}`);
  const common = Object.fromEntries(commonEventFields.map(field => [field, ownDataDescriptor(event, field, 'input event')]));
  if (common.schemaVersion !== 1) fail('input event', 'schemaVersion must be 1');
  if (!eventTypes.has(common.type)) fail('input event', 'type is unsupported');
  if (typeof common.action !== 'string' || !common.action) fail('input event', 'action must be a non-empty string');
  if (!Number.isFinite(common.timestamp) || common.timestamp < 0) fail('input event', 'timestamp must be finite and non-negative');
  if (!eventSources.has(common.source)) fail('input event', 'source is unsupported');
  const phases = common.type === 'keyboard' ? keyboardPhases : pointerPhases;
  if (!phases.has(common.phase)) fail('input event', 'phase is unsupported for type');
  const result = { ...common };
  if (common.type === 'keyboard') {
    if (!Object.hasOwn(event, 'key') || typeof event.key !== 'string' || !event.key) fail('keyboard event', 'key is required');
    if (Object.hasOwn(event, 'pointer')) fail('keyboard event', 'pointer is not allowed');
    result.key = ownDataDescriptor(event, 'key', 'keyboard event');
    if (typeof result.key !== 'string' || !result.key) fail('keyboard event', 'key must be a non-empty string');
  } else {
    if (!Object.hasOwn(event, 'pointer')) fail(`${common.type} event`, 'pointer is required');
    if (Object.hasOwn(event, 'key')) fail(`${common.type} event`, 'key is not allowed');
    result.pointer = pointer(ownDataDescriptor(event, 'pointer', `${common.type} event`), common.type);
  }
  return result;
}

/** Validate and detach a version 1 Runtime viewport. */
export function validateViewport(viewport) {
  const fields = exactRecord(viewport, ['width', 'height', 'dpr', 'orientation'], 'viewport');
  for (const field of ['width', 'height', 'dpr']) {
    if (typeof fields[field] !== 'number' || !Number.isFinite(fields[field]) || fields[field] <= 0) {
      fail('viewport', `${field} must be a positive finite number`);
    }
  }
  if (!viewportOrientations.has(fields.orientation)) fail('viewport', 'orientation is unsupported');
  const derived = fields.width > fields.height ? 'landscape' : 'portrait';
  if (fields.orientation !== derived) fail('viewport', 'orientation does not match dimensions');
  return { width: fields.width, height: fields.height, dpr: fields.dpr, orientation: fields.orientation };
}

/** Validate and detach the outer shape of a version 1 persisted record. */
export function validatePersistedRecordShape(record) {
  const fields = exactRecord(record, ['formatVersion', 'savedAt', 'snapshot', 'snapshotSha256'], 'persisted record');
  if (fields.formatVersion !== 1) fail('persisted record', 'formatVersion must be 1');
  if (!isUtcTimestamp(fields.savedAt)) fail('persisted record', 'savedAt must be an ISO-8601 UTC timestamp');
  if (typeof fields.snapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fields.snapshotSha256)) {
    fail('persisted record', 'snapshotSha256 must be lowercase SHA-256 hex');
  }
  return {
    formatVersion: 1,
    savedAt: fields.savedAt,
    snapshot: coreSnapshot(fields.snapshot),
    snapshotSha256: fields.snapshotSha256,
  };
}
