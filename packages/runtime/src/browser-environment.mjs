import { RuntimeError } from './errors.mjs';

/** Browser-only adapter factory; importing this module never touches the DOM. */
export function createBrowserEnvironment({
  root,
  windowObject = globalThis.window,
  cryptoObject = globalThis.crypto,
  utcNow = () => new Date().toISOString(),
} = {}) {
  if (!root || typeof root.getBoundingClientRect !== 'function') throw new TypeError('Browser root must expose getBoundingClientRect');
  if (!windowObject || typeof windowObject.requestAnimationFrame !== 'function' ||
      typeof windowObject.cancelAnimationFrame !== 'function' ||
      typeof windowObject.addEventListener !== 'function' ||
      typeof windowObject.removeEventListener !== 'function' ||
      typeof windowObject.performance?.now !== 'function') {
    throw new TypeError('Browser window must expose frame timing, performance and resize events');
  }
  function getViewport() {
    const { width, height } = root.getBoundingClientRect();
    return { width, height, dpr: windowObject.devicePixelRatio || 1,
      orientation: width > height ? 'landscape' : 'portrait' };
  }
  return Object.freeze({
    root,
    now: () => windowObject.performance.now(),
    utcNow,
    async digestSha256(bytes) {
      if (typeof cryptoObject?.subtle?.digest !== 'function') {
        throw new RuntimeError('DIGEST_UNAVAILABLE', { message: 'Web Crypto SHA-256 is unavailable' });
      }
      const hash = await cryptoObject.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    },
    requestFrame: callback => windowObject.requestAnimationFrame(callback),
    cancelFrame: handle => windowObject.cancelAnimationFrame(handle),
    getViewport,
    observeViewport(listener) {
      const onResize = () => listener(getViewport());
      windowObject.addEventListener('resize', onResize);
      const ResizeObserverClass = windowObject.ResizeObserver;
      const observer = typeof ResizeObserverClass === 'function'
        ? new ResizeObserverClass(onResize) : null;
      try { observer?.observe(root); }
      catch (error) {
        windowObject.removeEventListener('resize', onResize);
        observer?.disconnect();
        throw error;
      }
      return () => { windowObject.removeEventListener('resize', onResize); observer?.disconnect(); };
    },
  });
}
