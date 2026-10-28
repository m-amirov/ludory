import { validateRuntimeInputEvent } from './contracts.mjs';
import { RuntimeError } from './errors.mjs';

/**
 * Bounded, event-ordered buffer of detached RuntimeInputEventV1 values.
 * Overflow drops only the new event and reports the stable error code.
 *
 * @param {{limit?: number, onOverflow?: (error: RuntimeError) => void}} [options]
 */
export function createInputQueue({ limit = 256, onOverflow } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
    throw new TypeError('Runtime input queue limit must be an integer from 1 to 256');
  }
  if (onOverflow !== undefined && typeof onOverflow !== 'function') {
    throw new TypeError('Runtime input queue onOverflow must be a function');
  }
  let events = [];

  function push(event) {
    const accepted = validateRuntimeInputEvent(event);
    if (events.length >= limit) {
      onOverflow?.(new RuntimeError('INPUT_QUEUE_OVERFLOW'));
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

  return Object.freeze({ push, drain, clear() { events = []; }, size() { return events.length; } });
}
