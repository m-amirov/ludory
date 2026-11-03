export const ECONOMY_ERROR_CODES = Object.freeze([
  'DISABLED', 'INVALID_OPERATION', 'INSUFFICIENT_FUNDS', 'BALANCE_OVERFLOW',
  'CORRUPT_STATE', 'CAPACITY_EXCEEDED', 'STALE_DAILY_CLAIM',
]);

export class EconomyError extends Error {
  constructor(code, message) {
    if (!ECONOMY_ERROR_CODES.includes(code)) throw new TypeError('unknown EconomyError code');
    super(message);
    this.name = 'EconomyError';
    this.code = code;
  }
}
