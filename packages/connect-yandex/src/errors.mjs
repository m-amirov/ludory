export const YANDEX_CONNECT_ERROR_CODES = Object.freeze(Object.fromEntries([
  'SDK_UNAVAILABLE', 'SDK_LOAD_FAILED', 'SDK_INIT_FAILED', 'SDK_TIMEOUT',
  'CAPABILITY_UNAVAILABLE', 'LIFECYCLE_FAILED',
].map(code => [code, code])));

/** Observable Connect-specific error; never claim platform success on failure. */
export class YandexConnectError extends Error {
  constructor(code, { message = code, cause } = {}) {
    if (!Object.hasOwn(YANDEX_CONNECT_ERROR_CODES, code)) {
      throw new TypeError(`Unknown Yandex Connect error code: ${String(code)}`);
    }
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'YandexConnectError';
    this.code = code;
  }
}
