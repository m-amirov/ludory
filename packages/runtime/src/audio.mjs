import { RuntimeError } from './errors.mjs';

function unavailable(cause) {
  return new RuntimeError('AUDIO_UNAVAILABLE', {
    message: 'Browser audio playback is unavailable',
    ...(cause === undefined ? {} : { cause }),
  });
}

function volume(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a number in [0,1]`);
  }
  return value;
}

function readOptions(options) {
  if (options === undefined) return { loop: false, volume: 1 };
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    throw new TypeError('Audio options must be a plain object');
  }
  const fields = {};
  for (const key of Reflect.ownKeys(options)) {
    if (!['loop', 'volume'].includes(key)) throw new TypeError('Unknown audio option');
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Audio options must contain own data fields');
    }
    fields[key] = descriptor.value;
  }
  const loop = fields.loop ?? false;
  if (typeof loop !== 'boolean') throw new TypeError('Audio loop must be boolean');
  return { loop, volume: volume(fields.volume ?? 1, 'Audio volume') };
}

/** Browser media adapter; game-owned IDs are resolved by the caller, never by SDK. */
export function createBrowserAudio({ resolveAsset, AudioClass = globalThis.Audio } = {}) {
  if (typeof resolveAsset !== 'function') throw new TypeError('Audio asset resolver must be a function');
  const tracks = new Map();
  let muted = false;
  let masterVolume = 1;
  let suspended = false;
  let destroyed = false;

  function stop(handle) {
    const track = tracks.get(handle);
    if (!track) return;
    tracks.delete(handle);
    track.resumeAfterPause = false;
    track.resumePending = false;
    track.wantPlaying = false;
    if (typeof track.element.removeEventListener === 'function') {
      track.element.removeEventListener('ended', track.onEnded);
      track.element.removeEventListener('error', track.onError);
    }
    try { track.element.pause(); } catch { /* avoid losing other handles during cleanup */ }
    try { track.element.currentTime = 0; } catch { /* some media sources are not seekable */ }
  }

  function applyMix() {
    for (const track of tracks.values()) {
      track.element.volume = volume(masterVolume * track.volume, 'Effective volume');
      track.element.muted = muted;
    }
  }

  return Object.freeze({
    setMuted(value) {
      if (typeof value !== 'boolean') throw new TypeError('Audio mute must be boolean');
      muted = value;
      applyMix();
    },
    setMasterVolume(value) {
      masterVolume = volume(value, 'Master volume');
      applyMix();
    },
    async play(asset, options) {
      if (typeof asset !== 'string' || !asset.trim()) throw new TypeError('Audio asset ID must be non-empty');
      const settings = readOptions(options);
      if (destroyed || typeof AudioClass !== 'function') throw unavailable();
      let element;
      try {
        const resolved = resolveAsset(asset);
        if (typeof resolved !== 'string' || !resolved.trim()) throw new Error('Unknown audio asset');
        element = new AudioClass(resolved);
        element.loop = settings.loop;
        element.volume = settings.volume * masterVolume;
        element.muted = muted;
      } catch (error) { throw unavailable(error); }
      const handle = Object.freeze({});
      const track = { element, volume: settings.volume, resumeAfterPause: false,
        resumePending: false, resumeAttempt: 0, wantPlaying: false };
      track.onEnded = () => { if (!settings.loop) stop(handle); };
      track.onError = () => stop(handle);
      if (typeof element.addEventListener === 'function') {
        element.addEventListener('ended', track.onEnded);
        element.addEventListener('error', track.onError);
      }
      tracks.set(handle, track);
      try {
        await element.play();
        if (destroyed || !tracks.has(handle)) {
          stop(handle);
          throw unavailable();
        }
        if (suspended) element.pause();
        else track.wantPlaying = true;
        return handle;
      } catch (error) {
        stop(handle);
        if (error instanceof RuntimeError && error.code === 'AUDIO_UNAVAILABLE') throw error;
        throw unavailable(error);
      }
    },
    stop,
    pauseAll() {
      if (destroyed || suspended) return;
      suspended = true;
      for (const track of tracks.values()) {
        if (track.element.paused !== false && !track.resumePending) continue;
        track.resumeAfterPause = true;
        track.wantPlaying = false;
        try { track.element.pause(); }
        catch { track.resumeAfterPause = false; }
      }
    },
    resumeAll() {
      if (destroyed || !suspended) return;
      suspended = false;
      for (const [handle, track] of tracks) {
        if (!track.resumeAfterPause) continue;
        track.resumeAfterPause = false;
        track.wantPlaying = true;
        track.resumePending = true;
        const attempt = ++track.resumeAttempt;
        const settled = succeeded => {
          if (tracks.get(handle) !== track) return;
          // A superseded play() continuation cannot pause a newer playback.
          if (attempt !== track.resumeAttempt) {
            if (!track.wantPlaying || suspended) {
              try { track.element.pause(); } catch { /* optional audio */ }
            }
            return;
          }
          track.resumePending = false;
          if (!succeeded) track.wantPlaying = false;
          if (!succeeded || destroyed || suspended || !track.wantPlaying) {
            try { track.element.pause(); } catch { /* optional audio */ }
          }
        };
        try { Promise.resolve(track.element.play()).then(() => settled(true), () => settled(false)); }
        catch { settled(false); }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const handle of [...tracks.keys()]) stop(handle);
    },
  });
}
