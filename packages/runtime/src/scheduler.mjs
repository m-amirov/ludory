/**
 * Environment-owned, single-frame variable-timestep scheduler.
 * A canceled callback remains invalid even if its environment delivers it late.
 * @param {{now: () => number, requestFrame: (callback: () => void) => unknown,
 * cancelFrame: (handle: unknown) => void, onFrame: (deltaMs: number) => void,
 * onError: (error: unknown) => void}} options
 */
export function createFrameScheduler({ now, requestFrame, cancelFrame, onFrame, onError }) {
  let running = false;
  let pending = null;
  let lastTime = null;

  function stop() {
    running = false;
    lastTime = null;
    const scheduled = pending;
    pending = null;
    if (scheduled?.handle !== undefined) cancelFrame(scheduled.handle);
  }

  function schedule() {
    if (!running || pending) return;
    const scheduled = { handle: undefined };
    pending = scheduled;
    try {
      const handle = requestFrame(() => {
        if (!running || pending !== scheduled) return;
        pending = null;
        try {
          const timestamp = now();
          if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
            throw new TypeError('Runtime clock must provide finite non-negative milliseconds');
          }
          const deltaMs = lastTime === null ? 0 : Math.min(100, Math.max(0, timestamp - lastTime));
          lastTime = timestamp;
          onFrame(deltaMs);
          if (running) schedule();
        } catch (error) {
          try { stop(); } catch { /* cancellation failure cannot restart gameplay */ }
          onError(error);
        }
      });
      if (pending === scheduled) scheduled.handle = handle;
    } catch (error) {
      pending = null;
      running = false;
      lastTime = null;
      throw error;
    }
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = null;
    schedule();
  }

  return Object.freeze({ start, stop });
}
