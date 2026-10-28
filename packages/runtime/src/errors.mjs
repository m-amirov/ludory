const errorCodes = {
  INVALID_RUNTIME_TRANSITION: 'INVALID_RUNTIME_TRANSITION',
  RUNTIME_OPERATION_IN_PROGRESS: 'RUNTIME_OPERATION_IN_PROGRESS',
  INITIALIZE_FAILED: 'INITIALIZE_FAILED',
  INPUT_QUEUE_OVERFLOW: 'INPUT_QUEUE_OVERFLOW',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  DIGEST_UNAVAILABLE: 'DIGEST_UNAVAILABLE',
  SAVE_FAILED: 'SAVE_FAILED',
  RESTORE_FAILED: 'RESTORE_FAILED',
  RESTORE_CORRUPT: 'RESTORE_CORRUPT',
  RESTORE_INCOMPATIBLE: 'RESTORE_INCOMPATIBLE',
  AUDIO_UNAVAILABLE: 'AUDIO_UNAVAILABLE',
};

/** Stable machine-readable Runtime error codes for public Runtime contracts. */
export const RUNTIME_ERROR_CODES = Object.freeze(errorCodes);
const validCodes = new Set(Object.values(RUNTIME_ERROR_CODES));

/**
 * A small versioned error boundary shared by future Runtime operations.
 *
 * @param {keyof typeof RUNTIME_ERROR_CODES} code
 * @param {{cause?: unknown, message?: string}} [options]
 */
export class RuntimeError extends Error {
  constructor(code, options = {}) {
    if (!validCodes.has(code)) throw new TypeError(`Unknown RuntimeError code: ${String(code)}`);
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('RuntimeError options must be an object');
    }
    const message = options.message === undefined ? code : options.message;
    if (typeof message !== 'string' || !message) throw new TypeError('RuntimeError message must be a non-empty string');
    super(message, Object.hasOwn(options, 'cause') ? { cause: options.cause } : undefined);
    this.name = 'RuntimeError';
    this.code = code;
  }
}
