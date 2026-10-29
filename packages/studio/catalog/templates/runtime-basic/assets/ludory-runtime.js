// packages/runtime/src/errors.mjs
var errorCodes = {
  INVALID_RUNTIME_TRANSITION: "INVALID_RUNTIME_TRANSITION",
  RUNTIME_OPERATION_IN_PROGRESS: "RUNTIME_OPERATION_IN_PROGRESS",
  INITIALIZE_FAILED: "INITIALIZE_FAILED",
  INPUT_QUEUE_OVERFLOW: "INPUT_QUEUE_OVERFLOW",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  DIGEST_UNAVAILABLE: "DIGEST_UNAVAILABLE",
  SAVE_FAILED: "SAVE_FAILED",
  RESTORE_FAILED: "RESTORE_FAILED",
  RESTORE_CORRUPT: "RESTORE_CORRUPT",
  RESTORE_INCOMPATIBLE: "RESTORE_INCOMPATIBLE",
  AUDIO_UNAVAILABLE: "AUDIO_UNAVAILABLE"
};
var RUNTIME_ERROR_CODES = Object.freeze(errorCodes);
var validCodes = new Set(Object.values(RUNTIME_ERROR_CODES));
var RuntimeError = class extends Error {
  constructor(code, options = {}) {
    if (!validCodes.has(code)) throw new TypeError(`Unknown RuntimeError code: ${String(code)}`);
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("RuntimeError options must be an object");
    }
    const message = options.message === void 0 ? code : options.message;
    if (typeof message !== "string" || !message) throw new TypeError("RuntimeError message must be a non-empty string");
    super(message, Object.hasOwn(options, "cause") ? { cause: options.cause } : void 0);
    this.name = "RuntimeError";
    this.code = code;
  }
};

// packages/core/src/definition.mjs
var slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
var fields = /* @__PURE__ */ new Set(["schemaVersion", "id", "version", "title", "engine", "targets"]);
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function defineGame(input) {
  if (!isRecord(input)) throw new TypeError("game definition must be an object");
  for (const field of Object.keys(input)) {
    if (!fields.has(field)) throw new TypeError(`game definition has unknown field: ${field}`);
  }
  if (input.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1");
  if (typeof input.id !== "string" || !slugPattern.test(input.id)) {
    throw new TypeError("id must be a lowercase kebab-case slug");
  }
  if (typeof input.version !== "string" || !semverPattern.test(input.version)) {
    throw new TypeError("version must be SemVer");
  }
  const prerelease = input.version.match(/^\d+\.\d+\.\d+-([^+]+)/)?.[1];
  if (prerelease?.split(".").some((part) => /^0\d+$/.test(part))) {
    throw new TypeError("version must be SemVer (numeric prerelease identifiers cannot have leading zeros)");
  }
  if (typeof input.engine !== "string" || !slugPattern.test(input.engine)) {
    throw new TypeError("engine must be a lowercase kebab-case identifier");
  }
  if (!isRecord(input.title) || Object.keys(input.title).length === 0) {
    throw new TypeError("title must contain at least one localized string");
  }
  const title = {};
  for (const [lang, value] of Object.entries(input.title)) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(lang) || typeof value !== "string" || !value.trim()) {
      throw new TypeError(`title contains invalid locale or text: ${lang}`);
    }
    Object.defineProperty(title, lang, { value: value.trim(), enumerable: true, writable: true, configurable: true });
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new TypeError("targets must be a non-empty array");
  }
  const targets = [];
  const seen = /* @__PURE__ */ new Set();
  for (const target of input.targets) {
    if (typeof target !== "string" || !slugPattern.test(target)) {
      throw new TypeError("targets must be lowercase kebab-case identifiers");
    }
    if (seen.has(target)) throw new TypeError(`duplicate target: ${target}`);
    seen.add(target);
    targets.push(target);
  }
  return Object.freeze({
    schemaVersion: 1,
    id: input.id,
    version: input.version,
    title: Object.freeze(title),
    engine: input.engine,
    targets: Object.freeze(targets)
  });
}

// packages/core/src/state.mjs
function copyJson(value, path, ancestors = /* @__PURE__ */ new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError(`${path} contains a nonfinite number`);
  }
  if (typeof value !== "object") throw new TypeError(`${path} contains a non-JSON value`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cyclic reference`);
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${path} must contain only plain JSON objects and arrays`);
  }
  ancestors.add(value);
  let result;
  if (array) {
    result = [];
    if (Object.keys(value).length !== value.length) {
      throw new TypeError(`${path} has holes or extra array properties`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) >= value.length) {
        throw new TypeError(`${path} contains a non-JSON array property`);
      }
    }
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) throw new TypeError(`${path} has an array hole`);
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!Object.hasOwn(descriptor, "value")) throw new TypeError(`${path} contains an accessor`);
      result.push(copyJson(descriptor.value, `${path}[${i}]`, ancestors));
    }
  } else {
    result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${path} contains a symbol key`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${path} contains non-JSON property: ${key}`);
      }
      Object.defineProperty(result, key, {
        value: copyJson(descriptor.value, `${path}.${key}`, ancestors),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
  }
  ancestors.delete(value);
  return result;
}
function copyRootState(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("state must be a JSON-compatible root object");
  }
  return copyJson(state, "state");
}
function assertOwnDataFields(value, expectedFields, label = "snapshot") {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedFields.length || keys.some((key) => !expectedFields.includes(key))) {
    throw new TypeError(`${label} has missing or unexpected fields`);
  }
  for (const field of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label}.${field} must be an own data field`);
    }
  }
}
function createStateStore(initialState = {}) {
  let state = copyRootState(initialState);
  let revision = 0;
  const listeners = /* @__PURE__ */ new Set();
  const pending = [];
  let dispatching = false;
  function notify() {
    pending.push({ state: copyRootState(state), revision, listeners: [...listeners] });
    if (dispatching) return;
    dispatching = true;
    const errors = [];
    try {
      while (pending.length) {
        const event = pending.shift();
        for (const listener of event.listeners) {
          try {
            listener(copyRootState(event.state), event.revision);
          } catch (error) {
            errors.push(error);
          }
        }
      }
    } finally {
      dispatching = false;
    }
    if (errors.length) throw new AggregateError(errors, "state subscriber notification failed");
  }
  return Object.freeze({
    getState: () => copyRootState(state),
    getRevision: () => revision,
    setState(nextState) {
      if (revision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError("state revision overflow: cannot advance safely");
      }
      const next = copyRootState(nextState);
      state = next;
      revision += 1;
      notify();
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore(snapshot) {
      assertOwnDataFields(snapshot, ["revision", "state"], "state snapshot");
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
        throw new TypeError("snapshot revision must be a non-negative safe integer");
      }
      const next = copyRootState(snapshot.state);
      state = next;
      revision = snapshot.revision;
      notify();
    }
  });
}

// packages/core/src/session.mjs
function createGameSession({ definition, initialState = {}, onUpdate = () => {
} } = {}) {
  const game = defineGame(definition);
  if (typeof onUpdate !== "function") throw new TypeError("onUpdate must be a function");
  if (Object.prototype.toString.call(onUpdate) === "[object AsyncFunction]") {
    throw new TypeError("onUpdate must be synchronous");
  }
  const store = createStateStore(initialState);
  let status = "idle";
  function transition(expected, next) {
    if (!expected.includes(status)) {
      throw new Error(`Invalid lifecycle transition: ${status} \u2192 ${next}`);
    }
    status = next;
  }
  return Object.freeze({
    getStatus: () => status,
    initialize: () => transition(["idle"], "ready"),
    start: () => transition(["ready"], "running"),
    pause: () => transition(["running"], "paused"),
    resume: () => transition(["paused"], "running"),
    stop: () => transition(["ready", "running", "paused"], "stopped"),
    tick(deltaMs) {
      if (status !== "running") throw new Error(`Cannot tick unless running (status: ${status})`);
      if (typeof deltaMs !== "number" || !Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new TypeError("deltaMs must be a finite non-negative number");
      }
      let activeTick = true;
      const tickSetState = (next) => {
        if (!activeTick || status !== "running") {
          throw new Error("Cannot update state outside the active tick");
        }
        store.setState(next);
      };
      try {
        const result = onUpdate({ deltaMs, state: store.getState(), setState: tickSetState });
        if (result !== null && typeof result === "object" && typeof result.then === "function") {
          Promise.resolve(result).catch(() => {
          });
          throw new TypeError("onUpdate must be synchronous");
        }
      } finally {
        activeTick = false;
      }
    },
    getState: store.getState,
    setState: store.setState,
    snapshot() {
      return {
        schemaVersion: 1,
        gameId: game.id,
        gameVersion: game.version,
        revision: store.getRevision(),
        state: store.getState()
      };
    },
    restore(snapshot) {
      if (!["idle", "ready"].includes(status)) {
        throw new Error(`Cannot restore after gameplay starts (status: ${status})`);
      }
      assertOwnDataFields(snapshot, ["schemaVersion", "gameId", "gameVersion", "revision", "state"]);
      if (snapshot.schemaVersion !== 1 || snapshot.gameId !== game.id || snapshot.gameVersion !== game.version) {
        throw new TypeError("snapshot schema, game ID or game version mismatch");
      }
      store.restore({ revision: snapshot.revision, state: snapshot.state });
    }
  });
}

// packages/runtime/src/contracts.mjs
var slugPattern2 = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var semverPattern2 = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
var eventTypes = /* @__PURE__ */ new Set(["keyboard", "pointer", "touch"]);
var eventSources = /* @__PURE__ */ new Set(["input", "renderer"]);
var eventPhases = /* @__PURE__ */ new Set(["down", "move", "up", "cancel"]);
var viewportOrientations = /* @__PURE__ */ new Set(["landscape", "portrait"]);
var commonEventFields = ["schemaVersion", "type", "action", "phase", "timestamp", "source"];
function isSemver(value) {
  if (typeof value !== "string" || !semverPattern2.test(value)) return false;
  const prerelease = value.match(/^\d+\.\d+\.\d+-([^+]+)/)?.[1];
  return !prerelease?.split(".").some((part) => /^0\d+$/.test(part));
}
function isUtcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const canonical = new Date(parsed).toISOString();
  return value.includes(".") ? canonical === value : canonical.replace(".000Z", "Z") === value;
}
function fail(label, message) {
  throw new TypeError(`${label} ${message}`);
}
function ownDataDescriptor(value, key, label) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    fail(label, "contains an unreadable property");
  }
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(label, `.${String(key)} must be an enumerable own data property`);
  }
  return descriptor.value;
}
function plainRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label, "must be a plain object");
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(label, "must expose readable own properties");
  }
  if (![Object.prototype, null].includes(prototype)) fail(label, "has an unsupported prototype");
  for (const key of keys) {
    if (typeof key !== "string") fail(label, "cannot contain symbol properties");
    ownDataDescriptor(value, key, label);
  }
  return keys;
}
function exactRecord(value, fields2, label) {
  const keys = plainRecord(value, label);
  const allowed = new Set(fields2);
  if (keys.length !== fields2.length || keys.some((key) => !allowed.has(key))) {
    fail(label, "has missing or unexpected fields");
  }
  return Object.fromEntries(fields2.map((field) => [field, ownDataDescriptor(value, field, label)]));
}
function allowedRecord(value, required, allowed, label) {
  const keys = plainRecord(value, label);
  const allowedSet = new Set(allowed);
  for (const key of keys) if (!allowedSet.has(key)) fail(label, `has unexpected field: ${key}`);
  for (const field of required) if (!Object.hasOwn(value, field)) fail(label, `is missing field: ${field}`);
  return Object.fromEntries(keys.map((key) => [key, ownDataDescriptor(value, key, label)]));
}
function copyJson2(value, label, ancestors = /* @__PURE__ */ new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(label, "contains a non-finite number");
    return value;
  }
  if (typeof value !== "object") fail(label, "contains a non-JSON value");
  if (ancestors.has(value)) fail(label, "contains a cyclic reference");
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(label, "contains unreadable properties");
  }
  if (Array.isArray(value) ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) {
    fail(label, "contains an object with an unsupported prototype");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let lengthDescriptor;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      } catch {
        fail(label, "contains an unreadable array length");
      }
      const length = lengthDescriptor?.value;
      if (!Object.hasOwn(lengthDescriptor ?? {}, "value") || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1 || !keys.includes("length")) {
        fail(label, "contains an invalid array");
      }
      const result2 = [];
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(value, index)) fail(label, "contains an array hole");
        const key = String(index);
        if (!keys.includes(key)) fail(label, "contains an invalid array index");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail(label, "contains an array accessor");
        result2.push(copyJson2(descriptor.value, `${label}[${index}]`, ancestors));
      }
      return result2;
    }
    const result = {};
    for (const key of keys) {
      if (typeof key !== "string") fail(label, "contains a symbol key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail(label, `.${key} is not an own data field`);
      Object.defineProperty(result, key, {
        value: copyJson2(descriptor.value, `${label}.${key}`, ancestors),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
function coreSnapshot(value, label = "snapshot") {
  const fields2 = exactRecord(value, ["schemaVersion", "gameId", "gameVersion", "revision", "state"], label);
  if (fields2.schemaVersion !== 1) fail(label, "schemaVersion must be 1");
  if (typeof fields2.gameId !== "string" || !slugPattern2.test(fields2.gameId)) fail(label, "gameId is invalid");
  if (!isSemver(fields2.gameVersion)) fail(label, "gameVersion is invalid");
  if (!Number.isSafeInteger(fields2.revision) || fields2.revision < 0) fail(label, "revision must be a non-negative safe integer");
  if (fields2.state === null || typeof fields2.state !== "object" || Array.isArray(fields2.state)) fail(label, "state must be a plain object");
  const state = copyJson2(fields2.state, `${label}.state`);
  return { schemaVersion: 1, gameId: fields2.gameId, gameVersion: fields2.gameVersion, revision: fields2.revision, state };
}
function pointer(value, type) {
  const allowed = type === "pointer" ? ["id", "x", "y", "button"] : ["id", "x", "y"];
  const fields2 = allowedRecord(value, ["id", "x", "y"], allowed, `${type} pointer`);
  if (!Number.isSafeInteger(fields2.id) || fields2.id < 0) fail(`${type} pointer`, "id must be a non-negative safe integer");
  for (const coordinate of ["x", "y"]) {
    if (typeof fields2[coordinate] !== "number" || !Number.isFinite(fields2[coordinate])) fail(`${type} pointer`, `${coordinate} must be finite`);
  }
  if (Object.hasOwn(fields2, "button") && (!Number.isSafeInteger(fields2.button) || fields2.button < -1)) {
    fail(`${type} pointer`, "button must be a safe integer >= -1");
  }
  return Object.fromEntries(allowed.filter((field) => Object.hasOwn(fields2, field)).map((field) => [field, fields2[field]]));
}
function validateRuntimeInputEvent(event) {
  const fields2 = plainRecord(event, "input event");
  const allowed = [...commonEventFields, "key", "pointer"];
  if (fields2.some((key) => !allowed.includes(key))) fail("input event", "has unexpected fields");
  for (const field of commonEventFields) if (!Object.hasOwn(event, field)) fail("input event", `is missing field: ${field}`);
  const common = Object.fromEntries(commonEventFields.map((field) => [field, ownDataDescriptor(event, field, "input event")]));
  if (common.schemaVersion !== 1) fail("input event", "schemaVersion must be 1");
  if (!eventTypes.has(common.type)) fail("input event", "type is unsupported");
  if (typeof common.action !== "string" || !common.action) fail("input event", "action must be a non-empty string");
  if (!Number.isFinite(common.timestamp) || common.timestamp < 0) fail("input event", "timestamp must be finite and non-negative");
  if (!eventSources.has(common.source)) fail("input event", "source is unsupported");
  if (!eventPhases.has(common.phase)) fail("input event", "phase is unsupported");
  const result = { ...common };
  if (common.type === "keyboard") {
    if (Object.hasOwn(event, "pointer")) fail("keyboard event", "pointer is not allowed");
    if (fields2.includes("key")) {
      result.key = ownDataDescriptor(event, "key", "keyboard event");
      if (typeof result.key !== "string" || !result.key) fail("keyboard event", "key must be a non-empty string");
    }
  } else {
    if (Object.hasOwn(event, "key")) fail(`${common.type} event`, "key is not allowed");
    if (fields2.includes("pointer")) {
      result.pointer = pointer(ownDataDescriptor(event, "pointer", `${common.type} event`), common.type);
    }
  }
  return result;
}
function validateViewport(viewport) {
  const fields2 = exactRecord(viewport, ["width", "height", "dpr", "orientation"], "viewport");
  for (const field of ["width", "height", "dpr"]) {
    if (typeof fields2[field] !== "number" || !Number.isFinite(fields2[field]) || fields2[field] <= 0) {
      fail("viewport", `${field} must be a positive finite number`);
    }
  }
  if (!viewportOrientations.has(fields2.orientation)) fail("viewport", "orientation is unsupported");
  const derived = fields2.width > fields2.height ? "landscape" : "portrait";
  if (fields2.orientation !== derived) fail("viewport", "orientation does not match dimensions");
  return { width: fields2.width, height: fields2.height, dpr: fields2.dpr, orientation: fields2.orientation };
}
function validatePersistedRecordShape(record) {
  const fields2 = exactRecord(record, ["formatVersion", "savedAt", "snapshot", "snapshotSha256"], "persisted record");
  if (fields2.formatVersion !== 1) fail("persisted record", "formatVersion must be 1");
  if (!isUtcTimestamp(fields2.savedAt)) fail("persisted record", "savedAt must be an ISO-8601 UTC timestamp");
  if (typeof fields2.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(fields2.snapshotSha256)) {
    fail("persisted record", "snapshotSha256 must be lowercase SHA-256 hex");
  }
  return {
    formatVersion: 1,
    savedAt: fields2.savedAt,
    snapshot: coreSnapshot(fields2.snapshot),
    snapshotSha256: fields2.snapshotSha256
  };
}

// packages/runtime/src/input.mjs
function createInputQueue({ limit = 256, onOverflow } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
    throw new TypeError("Runtime input queue limit must be an integer from 1 to 256");
  }
  if (onOverflow !== void 0 && typeof onOverflow !== "function") {
    throw new TypeError("Runtime input queue onOverflow must be a function");
  }
  let events = [];
  function push(event) {
    const accepted = validateRuntimeInputEvent(event);
    if (events.length >= limit) {
      onOverflow?.(new RuntimeError("INPUT_QUEUE_OVERFLOW"));
      return false;
    }
    events.push(accepted);
    return true;
  }
  function drain() {
    const batch = events;
    events = [];
    return batch;
  }
  return Object.freeze({ push, drain, clear() {
    events = [];
  }, size() {
    return events.length;
  } });
}

// packages/runtime/src/scheduler.mjs
function createFrameScheduler({ now, requestFrame, cancelFrame, onFrame, onError }) {
  let running = false;
  let pending = null;
  let lastTime = null;
  function stop() {
    running = false;
    lastTime = null;
    const scheduled = pending;
    pending = null;
    if (scheduled?.handle !== void 0) cancelFrame(scheduled.handle);
  }
  function schedule() {
    if (!running || pending) return;
    const scheduled = { handle: void 0 };
    pending = scheduled;
    try {
      const handle = requestFrame(() => {
        if (!running || pending !== scheduled) return;
        pending = null;
        try {
          const timestamp = now();
          if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) {
            throw new TypeError("Runtime clock must provide finite non-negative milliseconds");
          }
          const deltaMs = lastTime === null ? 0 : Math.min(100, Math.max(0, timestamp - lastTime));
          lastTime = timestamp;
          onFrame(deltaMs);
          if (running) schedule();
        } catch (error) {
          try {
            stop();
          } catch {
          }
          onError(error);
        }
      });
      if (pending === scheduled) scheduled.handle = handle;
    } catch (error) {
      pending = null;
      running = false;
      lastTime = null;
      throw error;
    }
  }
  function start() {
    if (running) return;
    running = true;
    lastTime = null;
    schedule();
  }
  return Object.freeze({ start, stop });
}

// packages/runtime/src/viewport.mjs
function sameViewport(a, b) {
  return a?.width === b.width && a.height === b.height && a.dpr === b.dpr && a.orientation === b.orientation;
}
function createViewportTracker({ getViewport, observeViewport, onResize, onError, isActive = () => true }) {
  for (const [name, method] of Object.entries({ getViewport, observeViewport, onResize, onError, isActive })) {
    if (typeof method !== "function") throw new TypeError(`Viewport tracker ${name} must be a function`);
  }
  let last = null;
  let unsubscribe = null;
  let generation = 0;
  function initial() {
    last = validateViewport(getViewport());
    return { ...last };
  }
  function apply(next) {
    const normalized = validateViewport(next);
    if (sameViewport(last, normalized)) return;
    last = normalized;
    onResize({ ...normalized });
  }
  function attach() {
    if (unsubscribe !== null) throw new TypeError("Viewport observer is already attached");
    const epoch = ++generation;
    const listener = (next) => {
      if (epoch !== generation || !isActive()) return;
      try {
        apply(next);
      } catch (error) {
        onError(error);
      }
    };
    const detached = observeViewport(listener);
    if (typeof detached !== "function") throw new TypeError("Viewport observer must return unsubscribe");
    unsubscribe = detached;
    if (isActive()) apply(getViewport());
  }
  function detach() {
    generation++;
    const detached = unsubscribe;
    unsubscribe = null;
    detached?.();
  }
  return Object.freeze({ initial, attach, detach });
}

// packages/runtime/src/persistence.mjs
var digestPattern = /^[0-9a-f]{64}$/;
var placeholderDigest = "0".repeat(64);
function fail2(code, message, cause) {
  return new RuntimeError(code, { message, ...cause === void 0 ? {} : { cause } });
}
function ownValue(value, key) {
  if (!value || typeof value !== "object") return void 0;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : void 0;
  } catch {
    return void 0;
  }
}
function incompatibleRecord(record) {
  const format = ownValue(record, "formatVersion");
  if (Number.isSafeInteger(format) && format >= 0 && format !== 1) return true;
  const snapshot = ownValue(record, "snapshot");
  const schema = ownValue(snapshot, "schemaVersion");
  return Number.isSafeInteger(schema) && schema >= 0 && schema !== 1;
}
var encoder = new TextEncoder();
var byteKey = (key) => encoder.encode(key);
function compareKeys(left, right) {
  const a = byteKey(left);
  const b = byteKey(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length || (left < right ? -1 : left > right ? 1 : 0);
}
function writeCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(writeCanonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareKeys).map((key) => `${JSON.stringify(key)}:${writeCanonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function validateSnapshot(snapshot) {
  return validatePersistedRecordShape({
    formatVersion: 1,
    savedAt: "2000-01-01T00:00:00.000Z",
    snapshot,
    snapshotSha256: placeholderDigest
  }).snapshot;
}
function encodeCanonicalSnapshot(snapshot) {
  return encoder.encode(writeCanonical(validateSnapshot(snapshot)));
}
async function calculateDigest(snapshot, digestSha256) {
  if (typeof digestSha256 !== "function") throw fail2("DIGEST_UNAVAILABLE", "SHA-256 provider is unavailable");
  let result;
  try {
    result = await digestSha256(encoder.encode(writeCanonical(snapshot)));
  } catch (error) {
    throw fail2("DIGEST_UNAVAILABLE", "SHA-256 provider failed", error);
  }
  if (typeof result !== "string" || !digestPattern.test(result)) {
    throw fail2("DIGEST_UNAVAILABLE", "SHA-256 provider returned an invalid digest");
  }
  return result;
}
async function encodePersistedRecord(snapshot, { savedAt, digestSha256 } = {}) {
  const detached = validatePersistedRecordShape({
    formatVersion: 1,
    savedAt,
    snapshot,
    snapshotSha256: placeholderDigest
  });
  return {
    ...detached,
    snapshotSha256: await calculateDigest(detached.snapshot, digestSha256)
  };
}
async function decodePersistedRecord(record, { game, digestSha256 } = {}) {
  if (incompatibleRecord(record)) throw fail2("RESTORE_INCOMPATIBLE", "Persisted format or snapshot schema is unsupported");
  let clean;
  try {
    clean = validatePersistedRecordShape(record);
  } catch (error) {
    throw fail2("RESTORE_CORRUPT", "Persisted record is malformed", error);
  }
  if (!game || clean.snapshot.gameId !== game.id || clean.snapshot.gameVersion !== game.version) {
    throw fail2("RESTORE_INCOMPATIBLE", "Persisted game identity or version is incompatible");
  }
  const actual = await calculateDigest(clean.snapshot, digestSha256);
  if (actual !== clean.snapshotSha256) throw fail2("RESTORE_CORRUPT", "Persisted snapshot digest mismatch");
  return clean.snapshot;
}

// packages/runtime/src/host.mjs
var ACTIVE = /* @__PURE__ */ new Set(["READY", "RUNNING", "PAUSED", "STOPPED"]);
function runtimeError(code, message, cause) {
  return new RuntimeError(code, { message, ...cause === void 0 ? {} : { cause } });
}
function requiredMethod(value, method, name) {
  if (value === null || typeof value !== "object" || typeof value[method] !== "function") {
    throw new TypeError(`${name}.${method} must be a function`);
  }
}
function createRuntimeHost(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("Runtime host options must be an object");
  }
  const { game, initialState, update, renderer, input, environment, audio, storage, saveKey } = config;
  let status = "IDLE";
  let lastError = null;
  let session = null;
  let scheduler = null;
  let operation = null;
  let mounted = false;
  let detachInput = null;
  let detachViewport = null;
  let inputGeneration = 0;
  let inputSince = null;
  let pendingSaves = 0;
  let saveTail = Promise.resolve();
  const subscribers = /* @__PURE__ */ new Set();
  const subscriberErrors = [];
  const eventQueue = [];
  let dispatchingEvents = false;
  const inputQueue = createInputQueue({
    onOverflow(error) {
      emit({ schemaVersion: 1, type: "error", status, errorCode: error.code });
    }
  });
  function emit(event) {
    eventQueue.push(event);
    if (dispatchingEvents) return;
    dispatchingEvents = true;
    try {
      while (eventQueue.length) {
        const next = eventQueue.shift();
        for (const listener of [...subscribers]) {
          try {
            listener({ ...next });
          } catch (error) {
            subscriberErrors.push(error);
            if (subscriberErrors.length > 64) subscriberErrors.shift();
          }
        }
      }
    } finally {
      dispatchingEvents = false;
    }
  }
  function setStatus(next) {
    status = next;
    emit({ schemaVersion: 1, type: "status", status });
  }
  function checkOperation() {
    if (operation !== null) {
      throw runtimeError("RUNTIME_OPERATION_IN_PROGRESS", `Runtime ${operation} is still in progress`);
    }
  }
  function requireStatus(accepted, action) {
    checkOperation();
    if (!accepted.includes(status)) {
      throw runtimeError("INVALID_RUNTIME_TRANSITION", `Cannot ${action} from ${status}`);
    }
  }
  function gameplayActive() {
    return status === "RUNNING" && operation === null && session?.getStatus() === "running";
  }
  function ingestInput(event, source) {
    if (!gameplayActive()) return false;
    try {
      const normalized = validateRuntimeInputEvent(event);
      if (normalized.source !== source) return false;
      if (inputSince === null || normalized.timestamp < inputSince) return false;
      return inputQueue.push(normalized);
    } catch (error) {
      if (error instanceof TypeError) return false;
      throw error;
    }
  }
  function safeDisable() {
    try {
      input?.disable();
    } catch {
    }
  }
  function safePauseAudio() {
    try {
      audio?.pauseAll?.();
    } catch {
    }
  }
  function detachAdapters() {
    const listeners = [detachInput, detachViewport];
    detachInput = null;
    detachViewport = null;
    let firstError;
    for (const unsubscribe of listeners) {
      try {
        unsubscribe?.();
      } catch (error) {
        firstError ??= error;
      }
    }
    return firstError;
  }
  function fail3(error) {
    if (["FAULTED", "DESTROYED"].includes(status)) return lastError;
    try {
      scheduler?.stop();
    } catch {
    }
    inputQueue.clear();
    inputSince = null;
    safeDisable();
    safePauseAudio();
    if (session && !["stopped", "idle"].includes(session.getStatus())) {
      try {
        session.stop();
      } catch {
      }
    }
    const fault = runtimeError("INVALID_RUNTIME_TRANSITION", "Runtime frame failed", error);
    lastError = fault;
    status = "FAULTED";
    emit({ schemaVersion: 1, type: "error", status, errorCode: fault.code });
    emit({ schemaVersion: 1, type: "status", status });
    return fault;
  }
  function validateDependencies() {
    if (typeof update !== "function" || Object.prototype.toString.call(update) === "[object AsyncFunction]") {
      throw new TypeError("Runtime update must be a synchronous function");
    }
    for (const method of ["mount", "resize", "render", "unmount"]) requiredMethod(renderer, method, "renderer");
    for (const method of ["subscribe", "enable", "disable"]) requiredMethod(input, method, "input");
    for (const method of ["now", "requestFrame", "cancelFrame", "observeViewport", "getViewport"]) {
      requiredMethod(environment, method, "environment");
    }
    if (!("root" in environment)) throw new TypeError("environment.root is required");
    if (audio !== void 0) {
      for (const method of ["pauseAll", "resumeAll"]) requiredMethod(audio, method, "audio");
    }
    if (storage !== void 0) {
      for (const method of ["load", "save", "clear"]) requiredMethod(storage, method, "storage");
      if (typeof saveKey !== "string" || !saveKey.trim() || typeof game?.id !== "string" || !(saveKey === game.id || saveKey.startsWith(`${game.id}:`) || saveKey.startsWith(`${game.id}/`))) {
        throw new TypeError("saveKey must be a non-empty game-namespaced storage key");
      }
    }
  }
  async function initialize() {
    requireStatus(["IDLE"], "initialize");
    operation = "initialize";
    const generation = ++inputGeneration;
    try {
      validateDependencies();
      inputQueue.clear();
      const viewportTracker = createViewportTracker({
        getViewport: () => environment.getViewport(),
        observeViewport: (listener) => environment.observeViewport(listener),
        onResize: (viewport2) => renderer.resize(viewport2),
        onError: fail3,
        isActive: () => status !== "FAULTED" && (operation === "initialize" || operation === null && ["READY", "RUNNING", "PAUSED"].includes(status))
      });
      const viewport = viewportTracker.initial();
      session = createGameSession({
        definition: game,
        initialState,
        onUpdate({ deltaMs, state, setState }) {
          return update({ deltaMs, inputs: inputQueue.drain(), state, setState });
        }
      });
      scheduler = createFrameScheduler({
        now: () => environment.now(),
        requestFrame: (callback) => environment.requestFrame(callback),
        cancelFrame: (handle) => environment.cancelFrame(handle),
        onFrame(deltaMs) {
          session.tick(deltaMs);
          if (status === "RUNNING" && operation === null && session.getStatus() === "running") {
            renderer.render(session.snapshot());
          }
        },
        onError: fail3
      });
      mounted = true;
      await renderer.mount({
        root: environment.root,
        viewport,
        snapshot: session.snapshot(),
        dispatchInput(event) {
          if (generation === inputGeneration) ingestInput(event, "renderer");
        }
      });
      session.initialize();
      detachInput = input.subscribe((event) => {
        if (generation === inputGeneration) ingestInput(event, "input");
      });
      if (typeof detachInput !== "function") throw new TypeError("input.subscribe must return unsubscribe");
      detachViewport = () => viewportTracker.detach();
      viewportTracker.attach();
      input.disable();
      if (status === "FAULTED") throw lastError;
      lastError = null;
      setStatus("READY");
    } catch (error) {
      inputGeneration++;
      inputSince = null;
      try {
        scheduler?.stop();
      } catch {
      }
      inputQueue.clear();
      detachAdapters();
      safeDisable();
      if (mounted) {
        try {
          await renderer.unmount();
        } catch {
        }
      }
      mounted = false;
      session = null;
      scheduler = null;
      status = "IDLE";
      lastError = runtimeError("INITIALIZE_FAILED", "Runtime initialization failed", error);
      throw lastError;
    } finally {
      operation = null;
    }
  }
  function start() {
    requireStatus(["READY"], "start");
    try {
      const since = environment.now();
      if (typeof since !== "number" || !Number.isFinite(since) || since < 0) {
        throw new TypeError("Runtime input clock must provide finite non-negative milliseconds");
      }
      session.start();
      inputSince = since;
      setStatus("RUNNING");
      if (gameplayActive()) input.enable();
      if (gameplayActive()) scheduler.start();
    } catch (error) {
      throw fail3(error);
    }
  }
  function pause() {
    requireStatus(["RUNNING", "PAUSED"], "pause");
    if (status === "PAUSED") return;
    try {
      scheduler.stop();
      input.disable();
      session.pause();
      inputQueue.clear();
      inputSince = null;
      safePauseAudio();
      setStatus("PAUSED");
    } catch (error) {
      throw fail3(error);
    }
  }
  function resume() {
    requireStatus(["RUNNING", "PAUSED"], "resume");
    if (status === "RUNNING") return;
    try {
      inputQueue.clear();
      const since = environment.now();
      if (typeof since !== "number" || !Number.isFinite(since) || since < 0) {
        throw new TypeError("Runtime input clock must provide finite non-negative milliseconds");
      }
      session.resume();
      inputSince = since;
      setStatus("RUNNING");
      if (gameplayActive()) input.enable();
      if (gameplayActive()) {
        try {
          audio?.resumeAll?.();
        } catch {
        }
      }
      if (gameplayActive()) scheduler.start();
    } catch (error) {
      throw fail3(error);
    }
  }
  function stop() {
    requireStatus(["READY", "RUNNING", "PAUSED", "STOPPED"], "stop");
    if (status === "STOPPED") return;
    try {
      scheduler.stop();
      input.disable();
      inputQueue.clear();
      inputSince = null;
      session.stop();
      safePauseAudio();
      setStatus("STOPPED");
    } catch (error) {
      throw fail3(error);
    }
  }
  async function destroy() {
    checkOperation();
    if (pendingSaves > 0) {
      throw runtimeError("RUNTIME_OPERATION_IN_PROGRESS", "Runtime saves are still in progress");
    }
    if (status === "DESTROYED") return;
    operation = "destroy";
    inputGeneration++;
    inputSince = null;
    let cleanupError;
    try {
      try {
        scheduler?.stop();
      } catch (error) {
        cleanupError ??= error;
      }
      inputQueue.clear();
      try {
        input?.disable();
      } catch (error) {
        cleanupError ??= error;
      }
      if (session && !["stopped", "idle"].includes(session.getStatus())) {
        try {
          session.stop();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      const detachError = detachAdapters();
      cleanupError ??= detachError;
      if (mounted) {
        try {
          await renderer.unmount();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      mounted = false;
      setStatus("DESTROYED");
      if (cleanupError) {
        lastError = runtimeError("INVALID_RUNTIME_TRANSITION", "Runtime cleanup failed", cleanupError);
        throw lastError;
      }
    } finally {
      operation = null;
    }
  }
  function getSnapshot() {
    requireStatus(["READY", "RUNNING", "PAUSED", "STOPPED", "FAULTED"], "getSnapshot");
    return session.snapshot();
  }
  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Runtime subscriber must be a function");
    requireStatus(["IDLE", ...ACTIVE, "FAULTED"], "subscribe");
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }
  async function save() {
    requireStatus(["READY", "RUNNING", "PAUSED", "STOPPED", "FAULTED"], "save");
    if (!storage) throw runtimeError("STORAGE_UNAVAILABLE", "Runtime storage is not configured");
    const snapshot = session.snapshot();
    pendingSaves++;
    const run = async () => {
      try {
        const record = await encodePersistedRecord(snapshot, {
          savedAt: environment.utcNow?.(),
          digestSha256: typeof environment.digestSha256 === "function" ? (bytes) => environment.digestSha256(bytes) : void 0
        });
        try {
          const completed = storage.save(saveKey, record);
          if (!completed || typeof completed.then !== "function") {
            throw new TypeError("RuntimeStorage.save must return a completion promise");
          }
          await completed;
        } catch (error) {
          throw runtimeError("SAVE_FAILED", "Runtime save write failed", error);
        }
      } catch (error) {
        if (error instanceof RuntimeError && ["DIGEST_UNAVAILABLE", "SAVE_FAILED"].includes(error.code)) throw error;
        throw runtimeError("SAVE_FAILED", "Runtime save failed", error);
      } finally {
        pendingSaves--;
      }
    };
    const result = saveTail.then(run, run);
    saveTail = result.catch(() => {
    });
    return result;
  }
  async function restore() {
    requireStatus(["READY"], "restore");
    if (pendingSaves > 0) {
      throw runtimeError("RUNTIME_OPERATION_IN_PROGRESS", "Runtime saves are still in progress");
    }
    if (!storage) throw runtimeError("STORAGE_UNAVAILABLE", "Runtime storage is not configured");
    if (typeof environment.digestSha256 !== "function") {
      throw runtimeError("DIGEST_UNAVAILABLE", "Runtime SHA-256 provider is unavailable");
    }
    operation = "restore";
    try {
      let record;
      try {
        record = await storage.load(saveKey);
      } catch (error) {
        if (error instanceof RuntimeError && error.code === "RESTORE_CORRUPT") throw error;
        throw runtimeError("RESTORE_FAILED", "Runtime storage read failed", error);
      }
      if (record === null) throw runtimeError("RESTORE_FAILED", "No saved record exists");
      const snapshot = await decodePersistedRecord(record, {
        game,
        digestSha256: (bytes) => environment.digestSha256(bytes)
      });
      try {
        session.restore(snapshot);
      } catch (error) {
        throw runtimeError("RESTORE_CORRUPT", "Core rejected persisted state", error);
      }
      try {
        renderer.render(session.snapshot());
      } catch (error) {
        throw fail3(error);
      }
    } finally {
      operation = null;
    }
  }
  return Object.freeze({
    initialize,
    start,
    pause,
    resume,
    save,
    restore,
    stop,
    destroy,
    getStatus: () => status,
    getSnapshot,
    getLastError: () => lastError,
    subscribe
  });
}

// packages/runtime/src/browser-storage.mjs
function requireKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new TypeError("storage key must be non-empty");
  return key;
}
function createBrowserStorage({ storage, namespace = "ludory" } = {}) {
  if (typeof namespace !== "string" || !namespace.trim()) throw new TypeError("namespace must be non-empty");
  let provider;
  try {
    provider = storage ?? globalThis.localStorage;
    if (!provider || ["getItem", "setItem", "removeItem"].some((name) => typeof provider[name] !== "function")) {
      throw new TypeError("Browser localStorage capability is unavailable");
    }
  } catch (error) {
    throw new RuntimeError("STORAGE_UNAVAILABLE", { message: "Browser storage is unavailable", cause: error });
  }
  const scoped = (key) => `${namespace}:${requireKey(key)}`;
  return Object.freeze({
    async load(key) {
      const raw = provider.getItem(scoped(key));
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch (error) {
        throw new RuntimeError("RESTORE_CORRUPT", { message: "Stored JSON is invalid", cause: error });
      }
    },
    async save(key, record) {
      const detached = validatePersistedRecordShape(record);
      provider.setItem(scoped(key), JSON.stringify(detached));
    },
    async clear(key) {
      provider.removeItem(scoped(key));
    }
  });
}

// packages/runtime/src/browser-environment.mjs
function createBrowserEnvironment({
  root,
  windowObject = globalThis.window,
  cryptoObject = globalThis.crypto,
  utcNow = () => (/* @__PURE__ */ new Date()).toISOString()
} = {}) {
  if (!root || typeof root.getBoundingClientRect !== "function") throw new TypeError("Browser root must expose getBoundingClientRect");
  if (!windowObject || typeof windowObject.requestAnimationFrame !== "function" || typeof windowObject.cancelAnimationFrame !== "function" || typeof windowObject.addEventListener !== "function" || typeof windowObject.removeEventListener !== "function" || typeof windowObject.performance?.now !== "function") {
    throw new TypeError("Browser window must expose frame timing, performance and resize events");
  }
  function getViewport() {
    const { width, height } = root.getBoundingClientRect();
    return {
      width,
      height,
      dpr: windowObject.devicePixelRatio || 1,
      orientation: width > height ? "landscape" : "portrait"
    };
  }
  return Object.freeze({
    root,
    now: () => windowObject.performance.now(),
    utcNow,
    async digestSha256(bytes) {
      if (typeof cryptoObject?.subtle?.digest !== "function") {
        throw new RuntimeError("DIGEST_UNAVAILABLE", { message: "Web Crypto SHA-256 is unavailable" });
      }
      const hash = await cryptoObject.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    },
    requestFrame: (callback) => windowObject.requestAnimationFrame(callback),
    cancelFrame: (handle) => windowObject.cancelAnimationFrame(handle),
    getViewport,
    observeViewport(listener) {
      const onResize = () => listener(getViewport());
      windowObject.addEventListener("resize", onResize);
      const ResizeObserverClass = windowObject.ResizeObserver;
      const observer = typeof ResizeObserverClass === "function" ? new ResizeObserverClass(onResize) : null;
      try {
        observer?.observe(root);
      } catch (error) {
        windowObject.removeEventListener("resize", onResize);
        observer?.disconnect();
        throw error;
      }
      return () => {
        windowObject.removeEventListener("resize", onResize);
        observer?.disconnect();
      };
    }
  });
}

// packages/runtime/src/audio.mjs
function unavailable(cause) {
  return new RuntimeError("AUDIO_UNAVAILABLE", {
    message: "Browser audio playback is unavailable",
    ...cause === void 0 ? {} : { cause }
  });
}
function volume(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a number in [0,1]`);
  }
  return value;
}
function readOptions(options) {
  if (options === void 0) return { loop: false, volume: 1 };
  if (!options || typeof options !== "object" || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    throw new TypeError("Audio options must be a plain object");
  }
  const fields2 = {};
  for (const key of Reflect.ownKeys(options)) {
    if (!["loop", "volume"].includes(key)) throw new TypeError("Unknown audio option");
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("Audio options must contain own data fields");
    }
    fields2[key] = descriptor.value;
  }
  const loop = Object.hasOwn(fields2, "loop") ? fields2.loop : false;
  if (typeof loop !== "boolean") throw new TypeError("Audio loop must be boolean");
  return { loop, volume: volume(Object.hasOwn(fields2, "volume") ? fields2.volume : 1, "Audio volume") };
}
function createBrowserAudio({ resolveAsset, AudioClass = globalThis.Audio } = {}) {
  if (typeof resolveAsset !== "function") throw new TypeError("Audio asset resolver must be a function");
  const tracks = /* @__PURE__ */ new Map();
  let muted = false;
  let masterVolume = 1;
  let suspended = false;
  let destroyed = false;
  function silence(track) {
    try {
      track.element.pause();
    } catch {
    }
    try {
      track.element.currentTime = 0;
    } catch {
    }
  }
  function stop(handle) {
    const track = tracks.get(handle);
    if (!track) return;
    tracks.delete(handle);
    track.resumeAfterPause = false;
    track.resumePending = false;
    track.wantPlaying = false;
    if (typeof track.element.removeEventListener === "function") {
      track.element.removeEventListener("ended", track.onEnded);
      track.element.removeEventListener("error", track.onError);
    }
    silence(track);
  }
  function applyMix() {
    for (const track of tracks.values()) {
      track.element.volume = volume(masterVolume * track.volume, "Effective volume");
      track.element.muted = muted;
    }
  }
  return Object.freeze({
    setMuted(value) {
      if (typeof value !== "boolean") throw new TypeError("Audio mute must be boolean");
      muted = value;
      applyMix();
    },
    setMasterVolume(value) {
      masterVolume = volume(value, "Master volume");
      applyMix();
    },
    async play(asset, options) {
      if (typeof asset !== "string" || !asset.trim()) throw new TypeError("Audio asset ID must be non-empty");
      const settings = readOptions(options);
      if (destroyed || typeof AudioClass !== "function") throw unavailable();
      let element;
      try {
        const resolved = resolveAsset(asset);
        if (typeof resolved !== "string" || !resolved.trim()) throw new Error("Unknown audio asset");
        element = new AudioClass(resolved);
        element.loop = settings.loop;
        element.volume = settings.volume * masterVolume;
        element.muted = muted;
      } catch (error) {
        throw unavailable(error);
      }
      const handle = Object.freeze({});
      const track = {
        element,
        volume: settings.volume,
        resumeAfterPause: false,
        resumePending: false,
        resumeAttempt: 0,
        wantPlaying: false
      };
      track.onEnded = () => {
        if (!settings.loop) stop(handle);
      };
      track.onError = () => stop(handle);
      if (typeof element.addEventListener === "function") {
        element.addEventListener("ended", track.onEnded);
        element.addEventListener("error", track.onError);
      }
      tracks.set(handle, track);
      try {
        await element.play();
        if (destroyed || !tracks.has(handle)) {
          if (tracks.has(handle)) stop(handle);
          else silence(track);
          throw unavailable();
        }
        if (suspended) element.pause();
        else track.wantPlaying = true;
        return handle;
      } catch (error) {
        stop(handle);
        if (error instanceof RuntimeError && error.code === "AUDIO_UNAVAILABLE") throw error;
        throw unavailable(error);
      }
    },
    stop,
    pauseAll() {
      if (destroyed || suspended) return;
      suspended = true;
      for (const track of tracks.values()) {
        if (track.element.paused !== false && !track.resumePending) continue;
        track.resumeAfterPause = true;
        track.wantPlaying = false;
        try {
          track.element.pause();
        } catch {
          track.resumeAfterPause = false;
        }
      }
    },
    resumeAll() {
      if (destroyed || !suspended) return;
      suspended = false;
      for (const [handle, track] of tracks) {
        if (!track.resumeAfterPause) continue;
        track.resumeAfterPause = false;
        track.wantPlaying = true;
        track.resumePending = true;
        const attempt = ++track.resumeAttempt;
        const settled = (succeeded) => {
          if (tracks.get(handle) !== track) {
            silence(track);
            return;
          }
          if (attempt !== track.resumeAttempt) {
            if (!track.wantPlaying || suspended) {
              try {
                track.element.pause();
              } catch {
              }
            }
            return;
          }
          track.resumePending = false;
          if (!succeeded) track.wantPlaying = false;
          if (!succeeded || destroyed || suspended || !track.wantPlaying) {
            try {
              track.element.pause();
            } catch {
            }
          }
        };
        try {
          Promise.resolve(track.element.play()).then(() => settled(true), () => settled(false));
        } catch {
          settled(false);
        }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const handle of [...tracks.keys()]) stop(handle);
    }
  });
}
export {
  RUNTIME_ERROR_CODES,
  RuntimeError,
  createBrowserAudio,
  createBrowserEnvironment,
  createBrowserStorage,
  createInputQueue,
  createRuntimeHost,
  decodePersistedRecord,
  encodeCanonicalSnapshot,
  encodePersistedRecord,
  validatePersistedRecordShape,
  validateRuntimeInputEvent,
  validateViewport
};
