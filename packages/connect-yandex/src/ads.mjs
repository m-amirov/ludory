import { YandexConnectError } from './errors.mjs';

function adError(code, message, cause) {
  return new YandexConnectError(code, {
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Explicit callback-verified Yandex ad operations for a running game. */
export function createYandexAds({ sdk, host, lifecycle } = {}) {
  if (!sdk || typeof sdk !== 'object' || Array.isArray(sdk)) {
    throw new TypeError('sdk must be an initialized Yandex SDK object');
  }
  if (!host || typeof host.getStatus !== 'function' ||
      typeof host.pause !== 'function' || typeof host.resume !== 'function') {
    throw new TypeError('host must implement the Runtime lifecycle interface');
  }
  if (!lifecycle || typeof lifecycle.acquireAdPause !== 'function' ||
      typeof lifecycle.getStatus !== 'function' || typeof lifecycle.getAttachmentToken !== 'function') {
    throw new TypeError('lifecycle must support scoped ad pauses');
  }

  let destroyed = false;
  let active = null;

  function start(kind) {
    if (destroyed) return Promise.reject(adError('ADS_FAILED', 'Yandex ads adapter is destroyed'));
    if (active) return Promise.reject(adError('ADS_FAILED', 'Another Yandex ad request is already active'));
    if (lifecycle.getStatus() !== 'ATTACHED') {
      return Promise.reject(adError('ADS_FAILED', 'Yandex lifecycle must be attached before showing an ad'));
    }
    const attachmentToken = lifecycle.getAttachmentToken();
    if (attachmentToken === null) {
      return Promise.reject(adError('ADS_FAILED', 'Yandex lifecycle attachment expired'));
    }

    const api = sdk.adv;
    const method = kind === 'rewarded' ? api?.showRewardedVideo : api?.showFullscreenAdv;
    if (typeof method !== 'function') {
      return Promise.reject(adError('CAPABILITY_UNAVAILABLE', `Yandex ${kind} ad API is unavailable`));
    }

    return new Promise((resolve, reject) => {
      const attempt = {
        settled: false, opened: false, rewardObserved: false, release: null,
        attachmentToken, invoking: true, terminal: null,
      };
      active = attempt;

      const live = () => !destroyed && active === attempt && !attempt.settled;
      const settle = (value, failure, force = false) => {
        if (active !== attempt || attempt.settled || (destroyed && !force)) return;
        attempt.settled = true;
        active = null;
        try { attempt.release?.(); }
        catch (cause) {
          failure ??= adError('ADS_FAILED', 'Failed to release Yandex advertisement pause', cause);
        }
        if (failure) reject(failure);
        else resolve(value);
      };
      const fail = (message, cause) => settle(null, adError('ADS_FAILED', message, cause));
      attempt.cancel = () => settle(null, adError('ADS_FAILED', 'Yandex advertisement cancelled by teardown'), true);
      const sameAttachment = () => lifecycle.getStatus() === 'ATTACHED' &&
        lifecycle.getAttachmentToken() === attempt.attachmentToken;
      const verifyAttachment = () => {
        if (!live()) return false;
        try {
          if (sameAttachment()) return true;
          fail('Yandex lifecycle attachment changed during advertisement');
        } catch (cause) { fail('Yandex lifecycle attachment inspection failed', cause); }
        return false;
      };
      const finishTerminal = () => {
        if (!live() || attempt.invoking || !attempt.terminal) return;
        const terminal = attempt.terminal;
        attempt.terminal = null;
        settle(terminal.value, terminal.failure);
      };
      const callbacks = {
        onOpen() {
          if (!verifyAttachment() || attempt.opened || attempt.terminal) return;
          try {
            const release = lifecycle.acquireAdPause();
            // `host.pause()` can synchronously call into `destroy()` or an
            // SDK terminal callback before acquireAdPause returns a lease.
            if (!live()) { release(); return; }
            if (!sameAttachment()) { release(); fail('Yandex lifecycle changed while acquiring ad pause'); return; }
            attempt.release = release;
            attempt.opened = true;
          } catch (cause) {
            fail('Failed to pause Runtime for Yandex advertisement', cause);
          }
        },
        onClose(wasShown) {
          if (!verifyAttachment() || attempt.terminal) return;
          if (wasShown === false) {
            attempt.terminal = { failure: adError('ADS_NOT_SHOWN', 'Yandex advertisement was not shown') };
          } else if (wasShown !== true || !attempt.opened) {
            attempt.terminal = { failure: adError('ADS_FAILED', 'Yandex advertisement ended without verified opening and display') };
          } else {
            attempt.terminal = {
              value: kind === 'rewarded'
                ? { shown: true, rewarded: attempt.rewardObserved }
                : { shown: true },
            };
          }
          finishTerminal();
        },
        onError(cause) { fail('Yandex advertisement SDK failed', cause); },
      };
      if (kind === 'rewarded') {
        callbacks.onRewarded = () => {
          if (verifyAttachment() && attempt.opened && !attempt.terminal) attempt.rewardObserved = true;
        };
      }

      try {
        const result = method.call(api, { callbacks });
        // SDK contracts return void. If a nonstandard SDK returns a Promise,
        // rejection is still observable; fulfillment is not ad-display proof.
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).then(() => {
            attempt.invoking = false;
            finishTerminal();
          }, cause => fail('Yandex advertisement request failed', cause));
        } else {
          attempt.invoking = false;
          finishTerminal();
        }
      } catch (cause) {
        fail('Yandex advertisement SDK invocation failed', cause);
      }
    });
  }

  function destroy() {
    if (destroyed) return;
    // Block reentrant SDK calls before release can synchronously emit RUNNING.
    destroyed = true;
    active?.cancel();
  }

  return Object.freeze({
    showFullscreen: () => start('fullscreen'),
    showRewarded: () => start('rewarded'),
    destroy,
  });
}
