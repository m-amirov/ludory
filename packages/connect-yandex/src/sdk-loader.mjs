import { YandexConnectError } from './errors.mjs';

function unavailable(cause) {
  return new YandexConnectError('SDK_UNAVAILABLE', { message: 'Yandex Games SDK is unavailable', cause });
}

function loadFailed(cause) {
  return new YandexConnectError('SDK_LOAD_FAILED', { message: 'Yandex Games SDK script could not load', cause });
}

function validateScriptUrl(scriptUrl) {
  if (scriptUrl === '/sdk.js') return;
  if (typeof scriptUrl !== 'string') throw new TypeError('SDK script URL must be a string');
  let parsed;
  try { parsed = new URL(scriptUrl); }
  catch { throw new TypeError('SDK URL must be /sdk.js or an absolute HTTPS URL'); }
  if (parsed.protocol !== 'https:') {
    throw new TypeError('SDK URL must be /sdk.js or an absolute HTTPS URL');
  }
}

/** Load the official SDK; importing this module never reads browser globals. */
export async function loadYandexSdkScript({ documentObject, globalObject, scriptUrl = '/sdk.js', signal } = {}) {
  validateScriptUrl(scriptUrl);
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (signal?.aborted) throw loadFailed(signal.reason);

  let browserGlobal;
  let documentRef;
  let existing;
  try {
    browserGlobal = globalObject === undefined ? globalThis : globalObject;
    existing = browserGlobal?.YaGames;
    if (typeof existing?.init === 'function') return existing;
    documentRef = documentObject === undefined ? globalThis.document : documentObject;
    if (!documentRef || typeof documentRef.createElement !== 'function' ||
        typeof documentRef.head?.appendChild !== 'function') throw unavailable();
  } catch (error) {
    if (error instanceof YandexConnectError) throw error;
    throw unavailable(error);
  }

  return new Promise((resolve, reject) => {
    let script;
    let settled = false;
    const cleanup = remove => {
      // Restricted/partially torn-down DOM nodes can throw from cleanup.
      // Independently attempt every release, then settle the original result.
      try { script?.removeEventListener?.('load', onLoad); } catch { /* best effort */ }
      try { script?.removeEventListener?.('error', onError); } catch { /* best effort */ }
      try { signal?.removeEventListener('abort', onAbort); } catch { /* best effort */ }
      if (remove) {
        try { script?.remove?.(); } catch { /* preserve original SDK load error */ }
      }
    };
    const finish = (error, factory) => {
      if (settled) return;
      settled = true;
      cleanup(Boolean(error));
      if (error) reject(error);
      else resolve(factory);
    };
    const onLoad = () => {
      try {
        const factory = browserGlobal.YaGames;
        if (typeof factory?.init !== 'function') return finish(unavailable());
        finish(null, factory);
      } catch (error) { finish(unavailable(error)); }
    };
    const onError = () => finish(loadFailed());
    const onAbort = () => finish(loadFailed(signal.reason));
    try {
      if (signal?.aborted) return finish(loadFailed(signal.reason));
      script = documentRef.createElement('script');
      script.async = true;
      script.src = scriptUrl;
      script.addEventListener('load', onLoad);
      script.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) return onAbort();
      documentRef.head.appendChild(script);
    } catch (error) { finish(loadFailed(error)); }
  });
}
