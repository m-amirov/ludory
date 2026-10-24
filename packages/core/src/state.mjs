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

/** In-memory JSON-compatible state with explicit revision and copy-in/copy-out. */
export function createStateStore(initialState = {}) {
  let state = copyRootState(initialState);
  let revision = 0;
  const listeners = new Set();

  function notify() {
    for (const listener of [...listeners]) listener(copyRootState(state), revision);
  }

  return Object.freeze({
    getState: () => copyRootState(state),
    getRevision: () => revision,
    setState(nextState) {
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
      if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new TypeError('state snapshot must be an object');
      }
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
