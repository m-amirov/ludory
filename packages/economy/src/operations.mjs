import { EconomyError } from './errors.mjs';
import { exact, id, plain } from './validate.mjs';
import { validateEconomyState, freezeEconomyState } from './state.mjs';

export const MAX_JOURNAL_ENTRIES = 2000;

function invalidOperation(message) {
  throw new EconomyError('INVALID_OPERATION', message);
}

function fields(raw, keys) {
  try { return exact(raw, keys, 'economy operation'); }
  catch { return invalidOperation('Operation has invalid fields'); }
}

function sourceId(value, field) {
  try { return id(value, field); }
  catch { return invalidOperation(`${field} must be a lowercase safe ID`); }
}

export function utcDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalidOperation('Daily claim requires a YYYY-MM-DD UTC date');
  }
  const [year, month, day] = value.split('-').map(Number);
  const days = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    invalidOperation('Daily claim requires a real UTC date');
  }
  return value;
}

export function normalizeOperation(config, raw) {
  let type;
  try { type = plain(raw, 'economy operation').type; }
  catch { return invalidOperation('Operation must be a plain data record'); }
  switch (type) {
    case 'GRANT_STARTER': {
      fields(raw, ['type']);
      return { operationId: `starter:${config.gameId}`, type, delta: config.rewards.starter, contentId: null, sku: null };
    }
    case 'GRANT_EPISODE': {
      const op = fields(raw, ['type', 'episodeId']);
      return { operationId: `episode:${sourceId(op.episodeId, 'episodeId')}`, type, delta: config.rewards.episode, contentId: null, sku: null };
    }
    case 'GRANT_DAILY': {
      const op = fields(raw, ['type', 'date']);
      return { operationId: `daily:${utcDate(op.date)}`, type, delta: config.rewards.daily, contentId: null, sku: null };
    }
    case 'GRANT_REWARDED': {
      const op = fields(raw, ['type', 'attemptId']);
      return { operationId: `rewarded:${sourceId(op.attemptId, 'attemptId')}`, type, delta: config.rewards.rewarded, contentId: null, sku: null };
    }
    case 'GRANT_PURCHASE': {
      const op = fields(raw, ['type', 'sku', 'tokenDigest']);
      const sku = sourceId(op.sku, 'sku');
      if (!Object.hasOwn(config.products, sku)) invalidOperation('Unknown purchase SKU');
      if (typeof op.tokenDigest !== 'string' || !/^[0-9a-f]{64}$/.test(op.tokenDigest)) {
        invalidOperation('Purchase evidence must be a lowercase SHA-256 digest');
      }
      return { operationId: `purchase:${op.tokenDigest}`, type,
        delta: config.products[sku].currencyAmount, contentId: null, sku };
    }
    case 'UNLOCK_PREMIUM': {
      const op = fields(raw, ['type', 'contentId']);
      const contentId = sourceId(op.contentId, 'contentId');
      if (!Object.hasOwn(config.premium, contentId)) invalidOperation('Unknown premium content');
      return { operationId: `premium:${contentId}`, type,
        delta: -config.premium[contentId].cost, contentId, sku: null };
    }
    default: return invalidOperation('Unknown economy operation');
  }
}

export function applyEconomyOperation(config, state, operation) {
  if (!config.enabled) throw new EconomyError('DISABLED', 'Economy is disabled');
  const clean = validateEconomyState(config, state);
  const result = applyUnchecked(config, clean, operation);
  return Object.freeze({
    state: freezeEconomyState(result.state),
    receipt: Object.freeze(result.receipt),
  });
}

// Internal replay primitive: callers must validate snapshots before invoking it.
export function applyUnchecked(config, state, operation) {
  const entry = normalizeOperation(config, operation);
  const already = state.journal.find(item => item.operationId === entry.operationId);
  if (already) {
    if (already.type !== entry.type || already.sku !== entry.sku || already.contentId !== entry.contentId) {
      invalidOperation('Idempotency key is bound to another operation');
    }
    return {
      state: copyState(state),
      receipt: { operationId: entry.operationId, type: entry.type, applied: false, delta: 0, balance: state.balance },
    };
  }
  if (entry.type === 'GRANT_DAILY' && state.lastDailyClaim && entry.operationId.slice(6) < state.lastDailyClaim) {
    throw new EconomyError('STALE_DAILY_CLAIM', 'Daily claim cannot move backward');
  }
  if (state.journal.length >= MAX_JOURNAL_ENTRIES) throw new EconomyError('CAPACITY_EXCEEDED', 'Economy journal is full');
  const nextBalance = state.balance + entry.delta;
  if (nextBalance < 0) throw new EconomyError('INSUFFICIENT_FUNDS', 'Not enough currency');
  if (!Number.isSafeInteger(nextBalance) || nextBalance > config.maxBalance) {
    throw new EconomyError('BALANCE_OVERFLOW', 'Economy balance exceeds configured limit');
  }
  const next = copyState(state);
  next.balance = nextBalance;
  next.journal.push(entry);
  next.revision++;
  if (entry.type === 'GRANT_PURCHASE') next.purchaseTokens.push(entry.operationId.slice('purchase:'.length));
  else if (entry.type === 'UNLOCK_PREMIUM') next.entitlements.push(entry.contentId);
  else next.completedGrants.push(entry.operationId);
  if (entry.type === 'GRANT_DAILY') next.lastDailyClaim = entry.operationId.slice(6);
  return {
    state: next,
    receipt: { operationId: entry.operationId, type: entry.type, applied: true, delta: entry.delta, balance: next.balance },
  };
}

export function getPremiumAccess(config, state, contentId) {
  const selected = sourceId(contentId, 'contentId');
  if (!Object.hasOwn(config.premium, selected)) invalidOperation('Unknown premium content');
  const clean = validateEconomyState(config, state);
  return Object.freeze({ unlocked: clean.entitlements.includes(selected), cost: config.premium[selected].cost });
}

export function getEconomyView(config, state) {
  const clean = validateEconomyState(config, state);
  return Object.freeze({
    enabled: config.enabled,
    balance: clean.balance,
    currency: Object.freeze({ ...config.currency }),
    entitlements: Object.freeze([...clean.entitlements]),
  });
}

export function copyState(state) {
  return {
    ...state,
    entitlements: [...state.entitlements],
    completedGrants: [...state.completedGrants],
    purchaseTokens: [...state.purchaseTokens],
    journal: state.journal.map(entry => ({ ...entry })),
  };
}
