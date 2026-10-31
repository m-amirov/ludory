export const VK_CONNECT_ERROR_CODES = Object.freeze([
  'BRIDGE_UNAVAILABLE', 'BRIDGE_LOAD_FAILED', 'BRIDGE_INVALID',
  'SDK_INIT_FAILED', 'SDK_TIMEOUT', 'SDK_CANCELLED',
  'LIFECYCLE_FAILED', 'STORAGE_LOAD_FAILED', 'STORAGE_SAVE_FAILED',
  'STORAGE_CLEAR_FAILED', 'STORAGE_CORRUPT',
].reduce((acc, code) => ({ ...acc, [code]: code }), {}));

export class VkConnectError extends Error {
  constructor(code, { cause, message = code } = {}) {
    if (!Object.hasOwn(VK_CONNECT_ERROR_CODES, code)) throw new TypeError('Unknown VK error code');
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'VkConnectError';
    this.code = code;
  }
}
