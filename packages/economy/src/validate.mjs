const idPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const currencyTypes = new Set(['scene', 'dialogue', 'cg', 'outfit']);

export function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${label} has a symbol key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label}.${key} must be an own data value`);
    }
    Object.defineProperty(output, key, {
      value: descriptor.value,
      enumerable: true, configurable: true, writable: true,
    });
  }
  return output;
}

export function exact(value, keys, label) {
  const object = plain(value, label);
  const present = Object.keys(object);
  if (present.length !== keys.length || present.some(key => !keys.includes(key))) {
    throw new TypeError(`${label} has missing or unexpected fields`);
  }
  return object;
}

export function id(value, label) {
  if (typeof value !== 'string' || !idPattern.test(value)) {
    throw new TypeError(`${label} must be a lowercase safe ID`);
  }
  return value;
}

export function amount(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`${label} must be a safe integer >= ${min}`);
  }
  return value;
}

function label(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${name} must be nonempty text <= ${maxLength} characters`);
  }
  return value;
}

function map(value, name, inspect) {
  const input = plain(value, name);
  const output = {};
  for (const key of Object.keys(input)) {
    id(key, `${name} key`);
    Object.defineProperty(output, key, {
      value: inspect(input[key], `${name}.${key}`), enumerable: true, writable: true, configurable: true,
    });
  }
  return output;
}

function deepFreeze(value) {
  for (const key of Object.keys(value)) if (value[key] && typeof value[key] === 'object') deepFreeze(value[key]);
  return Object.freeze(value);
}

export function defineEconomy(raw) {
  const data = exact(raw,
    ['schemaVersion', 'enabled', 'gameId', 'configVersion', 'currency', 'maxBalance', 'rewards', 'premium', 'products'],
    'economy config');
  if (data.schemaVersion !== 1 || data.configVersion !== 1) throw new TypeError('unsupported economy config version');
  if (typeof data.enabled !== 'boolean') throw new TypeError('economy enabled must be boolean');
  const gameId = id(data.gameId, 'game ID');
  const currency = exact(data.currency, ['id', 'displayName', 'icon'], 'currency');
  const maxBalance = amount(data.maxBalance, 'maxBalance', 1);
  const rewards = exact(data.rewards, ['starter', 'episode', 'daily', 'rewarded'], 'rewards');
  const output = {
    schemaVersion: 1, enabled: data.enabled, gameId, configVersion: 1,
    currency: {
      id: id(currency.id, 'currency ID'),
      displayName: label(currency.displayName, 'currency displayName', 64),
      icon: label(currency.icon, 'currency icon', 32),
    },
    maxBalance,
    rewards: Object.fromEntries(Object.entries(rewards).map(([key, value]) => {
      amount(value, `rewards.${key}`);
      if (value > maxBalance) throw new TypeError(`rewards.${key} exceeds maxBalance`);
      return [key, value];
    })),
    premium: map(data.premium, 'premium', (rawItem, name) => {
      const item = exact(rawItem, ['cost', 'type'], name);
      const cost = amount(item.cost, `${name}.cost`, 1);
      if (cost > maxBalance || !currencyTypes.has(item.type)) throw new TypeError(`${name} has invalid cost/type`);
      return { cost, type: item.type };
    }),
    products: map(data.products, 'products', (rawItem, name) => {
      const item = exact(rawItem, ['currencyAmount'], name);
      const currencyAmount = amount(item.currencyAmount, `${name}.currencyAmount`, 1);
      if (currencyAmount > maxBalance) throw new TypeError(`${name} exceeds maxBalance`);
      return { currencyAmount };
    }),
  };
  return deepFreeze(output);
}
