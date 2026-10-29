import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudio, RuntimeError } from '../src/index.mjs';

function audioFixture({ deny = false } = {}) {
  const instances = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.volume = 1;
      this.loop = false;
      this.muted = false;
      this.paused = true;
      this.plays = 0;
      this.pauses = 0;
      instances.push(this);
    }
    async play() {
      this.plays++;
      if (deny) throw new Error('NotAllowedError');
      this.paused = false;
    }
    pause() { this.pauses++; this.paused = true; }
  }
  return { instances, FakeAudio, audio: createBrowserAudio({
    resolveAsset: name => ({ theme: '/audio/theme.ogg', click: '/audio/click.ogg' })[name],
    AudioClass: FakeAudio,
  }) };
}

test('browser audio uses a game-owned asset resolver and opaque per-play stop handle', async () => {
  const { instances, audio } = audioFixture();
  const h1 = await audio.play('theme', { loop: true, volume: 0.4 });
  const h2 = await audio.play('click');
  assert.equal(instances[0].src, '/audio/theme.ogg');
  assert.equal(instances[0].loop, true);
  assert.equal(instances[0].volume, 0.4);
  assert.equal(instances[1].volume, 1);
  assert.notEqual(h1, h2);
  assert.equal(Object.isFrozen(h1), true);
  audio.stop(h1);
  assert.equal(instances[0].paused, true);
  assert.equal(instances[1].paused, false);
  audio.stop(h1);
  audio.stop(h2);
  assert.equal(instances[1].paused, true);
  audio.destroy();
});

test('mute and master volume adjust active playback without losing per-asset volume', async () => {
  const { instances, audio } = audioFixture();
  const h1 = await audio.play('theme', { volume: 0.5 });
  audio.setMasterVolume(0.4);
  assert.equal(instances[0].volume, 0.2);
  audio.setMuted(true);
  assert.equal(instances[0].muted, true);
  const h2 = await audio.play('click', { volume: 0.25 });
  assert.equal(instances[1].volume, 0.1);
  assert.equal(instances[1].muted, true);
  audio.setMuted(false);
  assert.equal(instances[0].muted, false);
  assert.equal(instances[1].muted, false);
  audio.stop(h1);
  audio.stop(h2);
  audio.destroy();
});

test('pauseAll/resumeAll resumes only tracks active before pause and never restarts stopped handles', async () => {
  const { instances, audio } = audioFixture();
  const h1 = await audio.play('theme');
  const h2 = await audio.play('click');
  instances[1].pause(); // independently paused; host must not resume it
  audio.pauseAll();
  assert.equal(instances[0].paused, true);
  audio.resumeAll();
  await Promise.resolve();
  assert.equal(instances[0].plays, 2);
  assert.equal(instances[1].plays, 1);
  audio.pauseAll();
  audio.stop(h1);
  audio.resumeAll();
  await Promise.resolve();
  assert.equal(instances[0].plays, 2, 'stopped handle stays stopped');
  audio.stop(h2);
  audio.destroy();
});

test('autoplay denial, missing browser audio and unknown asset return AUDIO_UNAVAILABLE', async () => {
  const { audio, instances } = audioFixture({ deny: true });
  await assert.rejects(audio.play('theme'), error => error instanceof RuntimeError &&
    error.code === 'AUDIO_UNAVAILABLE' && error.cause?.message === 'NotAllowedError');
  assert.equal(instances[0].paused, true);
  assert.equal(instances[0].pauses > 0, true);
  audio.destroy();
  await assert.rejects(audio.play('theme'), error => error.code === 'AUDIO_UNAVAILABLE');

  const missing = createBrowserAudio({ resolveAsset: () => '/audio/theme.ogg', AudioClass: null });
  await assert.rejects(missing.play('theme'), error => error.code === 'AUDIO_UNAVAILABLE');
  missing.destroy();
  const other = audioFixture();
  await assert.rejects(other.audio.play('unknown'), error => error.code === 'AUDIO_UNAVAILABLE');
});

test('invalid clip settings are rejected instead of escaping into browser audio objects', async () => {
  const { audio, instances } = audioFixture();
  for (const options of [{ volume: NaN }, { volume: 2 }, { loop: 'yes' },
    { loop: null }, { volume: null }, { autoplay: true }]) {
    await assert.rejects(audio.play('theme', options), TypeError);
  }
  await assert.rejects(audio.play(''), TypeError);
  assert.equal(instances.length, 0);
  assert.throws(() => audio.setMasterVolume(-0.1), TypeError);
  assert.throws(() => audio.setMuted('true'), TypeError);
});

test('late async resume cannot restart a track after a second host pause', async () => {
  let resolveResume;
  const { instances, FakeAudio } = audioFixture();
  class DelayedAudio extends FakeAudio {
    play() {
      if (this.plays === 1) {
        this.plays++;
        return new Promise(resolve => {
          resolveResume = () => { this.paused = false; resolve(); };
        });
      }
      return super.play();
    }
  }
  const audio = createBrowserAudio({ resolveAsset: () => '/audio/loop.ogg', AudioClass: DelayedAudio });
  await audio.play('theme');
  audio.pauseAll();
  audio.resumeAll();
  audio.pauseAll();
  resolveResume();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(instances[0].paused, true);
  audio.destroy();
});

test('superseded resume fulfillment or rejection cannot silence a newer successful resume', async () => {
  for (const staleOutcome of ['resolve', 'reject']) {
    const pending = [];
    let instance;
    class ControlledAudio {
      constructor() { this.volume = 1; this.muted = false; this.paused = true; this.plays = 0; instance = this; }
      play() {
        this.plays++;
        if (this.plays === 1) { this.paused = false; return Promise.resolve(); }
        return new Promise((resolve, reject) => pending.push({
          resolve: () => { this.paused = false; resolve(); },
          reject,
        }));
      }
      pause() { this.paused = true; }
    }
    const audio = createBrowserAudio({ resolveAsset: () => '/short.ogg', AudioClass: ControlledAudio });
    const handle = await audio.play('click');
    audio.pauseAll();
    audio.resumeAll();
    audio.pauseAll();
    audio.resumeAll();
    assert.equal(pending.length, 2);
    pending[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    if (staleOutcome === 'resolve') pending[0].resolve();
    else pending[0].reject(new Error('AbortError: superseded play'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(instance.paused, false, `stale ${staleOutcome} must not silence newer playback`);
    audio.stop(handle);
    audio.destroy();
  }
});

test('natural media ended event retires one-shot handles and releases media from mixing', async () => {
  const { FakeAudio, instances } = audioFixture();
  class EventAudio extends FakeAudio {
    constructor(src) { super(src); this.listeners = new Map(); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name, callback) {
      if (this.listeners.get(name) === callback) this.listeners.delete(name);
    }
    finish() { this.paused = true; this.listeners.get('ended')?.(); }
  }
  const audio = createBrowserAudio({ resolveAsset: () => '/audio/click.ogg', AudioClass: EventAudio });
  await audio.play('click');
  assert.equal(instances[0].listeners.has('ended'), true);
  instances[0].finish();
  assert.equal(instances[0].listeners.has('ended'), false);
  instances[0].muted = false;
  audio.setMuted(true);
  assert.equal(instances[0].muted, false, 'completed clip is no longer mixed');
  audio.destroy();
});

test('late initial media play cannot restart sound after audio destroy', async () => {
  let finishPlay;
  let element;
  class DelayedAudio {
    constructor() { this.paused = true; element = this; }
    play() {
      return new Promise(resolve => {
        finishPlay = () => { this.paused = false; resolve(); };
      });
    }
    pause() { this.paused = true; }
  }
  const audio = createBrowserAudio({ resolveAsset: () => '/sound.ogg', AudioClass: DelayedAudio });
  const pending = audio.play('theme');
  audio.destroy();
  finishPlay();
  await assert.rejects(pending, error => error.code === 'AUDIO_UNAVAILABLE');
  assert.equal(element.paused, true, 'destroy must silence a late initial play fulfillment');
});

test('late resumed playback remains silent after its handle is stopped or destroyed', async () => {
  for (const ending of ['stop', 'destroy']) {
    let finishResume;
    let element;
    class DelayedResumeAudio {
      constructor() { this.paused = true; this.plays = 0; element = this; }
      play() {
        this.plays++;
        if (this.plays === 1) { this.paused = false; return Promise.resolve(); }
        return new Promise(resolve => {
          finishResume = () => { this.paused = false; resolve(); };
        });
      }
      pause() { this.paused = true; }
    }
    const audio = createBrowserAudio({ resolveAsset: () => '/sound.ogg', AudioClass: DelayedResumeAudio });
    const handle = await audio.play('theme');
    audio.pauseAll();
    audio.resumeAll();
    if (ending === 'stop') audio.stop(handle);
    else audio.destroy();
    finishResume();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(element.paused, true, `${ending} must silence a late resumed play fulfillment`);
    audio.destroy();
  }
});
