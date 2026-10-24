function copyJson(value, path, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new TypeError(`${path} contains a nonfinite number`);
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains a non-JSON value`);
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
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) ||
          !Number.isSafeInteger(Number(key)) || Number(key) >= value.length) {
        throw new TypeError(`${path} contains a non-JSON array property`);
      }
    }
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) throw new TypeError(`${path} has an array hole`);
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${path} contains an accessor`);
      result.push(copyJson(descriptor.value, `${path}[${i}]`, ancestors));
    }
  } else {
    result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError(`${path} contains a symbol key`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError(`${path} contains non-JSON property: ${key}`);
      }
      Object.defineProperty(result, key, {
        value: copyJson(descriptor.value, `${path}.${key}`, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  ancestors.delete(value);
  return result;
}

function copyRootState(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('state must be a JSON-compatible root object');
  }
  return copyJson(state, 'state');
}

/** Internal validator for exact plain, own-data-field snapshot records. */
export function assertOwnDataFields(value, expectedFields, label = 'snapshot') {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedFields.length || keys.some(key => !expectedFields.includes(key))) {
    throw new TypeError(`${label} has missing or unexpected fields`);
  }
  for (const field of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label}.${field} must be an own data field`);
    }
  }
}

/** In-memory JSON-compatible state with explicit revision and copy-in/copy-out. */
export function createStateStore(initialState = {}) {
  let state = copyRootState(initialState);
  let revision = 0;
  const listeners = new Set();
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
    if (errors.length) throw new AggregateError(errors, 'state subscriber notification failed');
  }

  return Object.freeze({
    getState: () => copyRootState(state),
    getRevision: () => revision,
    setState(nextState) {
      if (revision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError('state revision overflow: cannot advance safely');
      }
      const next = copyRootState(nextState);
      state = next;
      revision += 1;
      notify();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore(snapshot) {
      assertOwnDataFields(snapshot, ['revision', 'state'], 'state snapshot');
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
        throw new TypeError('snapshot revision must be a non-negative safe integer');
      }
      const next = copyRootState(snapshot.state);
      state = next;
      revision = snapshot.revision;
      notify();
    },
  });
}
