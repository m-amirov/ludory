import { EconomyError } from './errors.mjs';
import { defineEconomy, exact, id, amount } from './validate.mjs';
import { normalizeOperation, MAX_JOURNAL_ENTRIES } from './operations.mjs';

/** Start with an empty wallet; earning the configured starter bonus is an explicit transaction. */
export function createEconomyState(rawConfig) {
  const config = defineEconomy(rawConfig);
  return freezeEconomyState({
    schemaVersion: 1,
    gameId: config.gameId,
    configVersion: config.configVersion,
    balance: 0,
    entitlements: [],
    completedGrants: [],
    purchaseTokens: [],
    journal: [],
    lastDailyClaim: null,
    revision: 0,
  });
}

function corrupt(message) {
  throw new EconomyError('CORRUPT_STATE', message);
}

const journalFields = ['operationId', 'type', 'delta', 'contentId', 'sku'];
const sameJournalEntry = (left, right) => journalFields.every(key => Object.is(left[key], right[key]));
const sameValues = (left, right) => left.length === right.length &&
  left.every((value, index) => value === right[index]);

function safeArray(value, name, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) {
    corrupt(`${name} must be a bounded plain array`);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) corrupt(`${name} has unexpected fields`);
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      corrupt(`${name}[${index}] must be an own data value`);
    }
    return descriptor.value;
  });
}

function operationFromJournal(entry) {
  const { operationId, type, contentId, sku } = entry;
  if (typeof operationId !== 'string' || operationId.length > 80) corrupt('Invalid operation ID');
  switch (type) {
    case 'GRANT_STARTER':
      if (contentId !== null || sku !== null) corrupt('Invalid starter journal entry');
      return { type };
    case 'GRANT_EPISODE':
      if (contentId !== null || sku !== null || !operationId.startsWith('episode:')) corrupt('Invalid episode journal entry');
      return { type, episodeId: operationId.slice(8) };
    case 'GRANT_DAILY':
      if (contentId !== null || sku !== null || !operationId.startsWith('daily:')) corrupt('Invalid daily journal entry');
      return { type, date: operationId.slice(6) };
    case 'GRANT_REWARDED':
      if (contentId !== null || sku !== null || !operationId.startsWith('rewarded:')) corrupt('Invalid rewarded journal entry');
      return { type, attemptId: operationId.slice(9) };
    case 'GRANT_PURCHASE':
      if (contentId !== null || typeof sku !== 'string' || !operationId.startsWith('purchase:')) corrupt('Invalid purchase journal entry');
      return { type, sku, tokenDigest: operationId.slice(9) };
    case 'UNLOCK_PREMIUM':
      if (sku !== null || typeof contentId !== 'string' || operationId !== `premium:${contentId}`) corrupt('Invalid premium journal entry');
      return { type, contentId };
    default: return corrupt('Unknown journal operation');
  }
}

export function freezeEconomyState(state) {
  for (const entry of state.journal) Object.freeze(entry);
  Object.freeze(state.journal);
  Object.freeze(state.entitlements);
  Object.freeze(state.completedGrants);
  Object.freeze(state.purchaseTokens);
  return Object.freeze(state);
}

export function validateEconomyState(config, raw) {
  let state;
  try {
    state = exact(raw, [
      'schemaVersion', 'gameId', 'configVersion', 'balance', 'entitlements',
      'completedGrants', 'purchaseTokens', 'journal', 'lastDailyClaim', 'revision',
    ], 'economy state');
    if (state.schemaVersion !== 1 || state.configVersion !== config.configVersion || state.gameId !== config.gameId) {
      corrupt('Economy state version or game ID mismatch');
    }
    amount(state.balance, 'balance');
    amount(state.revision, 'revision');
    if (state.balance > config.maxBalance) corrupt('Balance over maxBalance');
    if (!Array.isArray(state.journal)) corrupt('Journal must be an array');
    if (state.journal.length > MAX_JOURNAL_ENTRIES) {
      throw new EconomyError('CAPACITY_EXCEEDED', 'Economy journal exceeds retention limit');
    }
    const journal = safeArray(state.journal, 'journal', MAX_JOURNAL_ENTRIES).map((rawEntry, index) => {
      const entry = exact(rawEntry, journalFields, `journal[${index}]`);
      if (!Number.isSafeInteger(entry.delta)) corrupt('Journal delta is not a safe integer');
      return entry;
    });
    const entitlements = safeArray(state.entitlements, 'entitlements', MAX_JOURNAL_ENTRIES);
    const completedGrants = safeArray(state.completedGrants, 'completedGrants', MAX_JOURNAL_ENTRIES);
    const purchaseTokens = safeArray(state.purchaseTokens, 'purchaseTokens', MAX_JOURNAL_ENTRIES);
    for (const value of entitlements) id(value, 'entitlement');
    for (const value of completedGrants) {
      if (typeof value !== 'string' || value.length > 80) corrupt('Invalid grant ID');
    }
    for (const value of purchaseTokens) {
      if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) corrupt('Invalid purchase evidence digest');
    }
    if (state.lastDailyClaim !== null &&
        (typeof state.lastDailyClaim !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.lastDailyClaim))) {
      corrupt('Invalid daily claim');
    }
    // Replay in one pass. Calling applyUnchecked here repeatedly would clone
    // the growing journal for every entry and make wallet reads O(n²).
    const rebuilt = {
      ...createEconomyState(config),
      entitlements: [], completedGrants: [], purchaseTokens: [], journal: [],
    };
    const seenOperationIds = new Set();
    for (const entry of journal) {
      const operation = operationFromJournal(entry);
      const expected = normalizeOperation(config, operation);
      if (seenOperationIds.has(expected.operationId) || !sameJournalEntry(expected, entry)) {
        corrupt('Journal is not a valid deterministic operation sequence');
      }
      if (entry.type === 'GRANT_DAILY' && rebuilt.lastDailyClaim &&
          entry.operationId.slice(6) < rebuilt.lastDailyClaim) {
        corrupt('Daily claim sequence moves backward');
      }
      const nextBalance = rebuilt.balance + expected.delta;
      if (!Number.isSafeInteger(nextBalance) || nextBalance < 0 || nextBalance > config.maxBalance) {
        corrupt('Journal balance is outside configured limits');
      }
      seenOperationIds.add(expected.operationId);
      rebuilt.balance = nextBalance;
      rebuilt.revision++;
      rebuilt.journal.push(expected);
      if (entry.type === 'GRANT_PURCHASE') rebuilt.purchaseTokens.push(expected.operationId.slice(9));
      else if (entry.type === 'UNLOCK_PREMIUM') rebuilt.entitlements.push(expected.contentId);
      else rebuilt.completedGrants.push(expected.operationId);
      if (entry.type === 'GRANT_DAILY') rebuilt.lastDailyClaim = expected.operationId.slice(6);
    }
    for (const key of ['balance', 'revision', 'lastDailyClaim']) {
      if (state[key] !== rebuilt[key]) corrupt(`${key} differs from journal replay`);
    }
    for (const [key, values] of Object.entries({ entitlements, completedGrants, purchaseTokens })) {
      if (!sameValues(values, rebuilt[key])) corrupt(`${key} differs from journal replay`);
    }
    return freezeEconomyState(rebuilt);
  } catch (error) {
    if (error instanceof EconomyError && error.code === 'CAPACITY_EXCEEDED') throw error;
    if (error instanceof EconomyError && error.code === 'CORRUPT_STATE') throw error;
    throw new EconomyError('CORRUPT_STATE', `Invalid economy state: ${error?.message ?? 'unknown error'}`);
  }
}
