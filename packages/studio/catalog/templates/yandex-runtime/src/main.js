import {
  createRuntimeHost, createBrowserEnvironment, createBrowserAudio,
  createYandexConnector, createYandexLifecycle, createYandexPlayerStorage, createYandexAds,
} from '../assets/ludory-yandex.js';

const root = document.querySelector('#game');
const score = document.querySelector('#score');
const status = document.querySelector('#status');
const errorLabel = document.querySelector('#error');
const buttons = [...document.querySelectorAll('#controls button')];
const beep = (() => {
  // Self-contained, audible 300 ms PCM tone; never requires a remote asset or the platform SDK.
  const sampleRate = 8000;
  const frames = 2400;
  const bytes = new Uint8Array(44 + frames);
  const header = new DataView(bytes.buffer);
  const ascii = (offset, label) => {
    for (let i = 0; i < label.length; i++) bytes[offset + i] = label.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + frames, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate, true);
  header.setUint16(32, 1, true);
  header.setUint16(34, 8, true);
  ascii(36, 'data');
  header.setUint32(40, frames, true);
  for (let i = 0; i < frames; i++) {
    const envelope = Math.min(1, i / 200, (frames - i - 1) / 200);
    bytes[44 + i] = Math.round(128 + 32 * envelope * Math.sin(2 * Math.PI * 660 * i / sampleRate));
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
})();

function report(error, action = 'bootstrap') {
  status.dataset.lastOperation = `${action}:error`;
  status.dataset.errorCode = error?.code ?? 'ERROR';
  errorLabel.textContent = `${error?.code ?? 'ERROR'}: ${error?.message ?? String(error)}`;
}

async function boot() {
  const response = await fetch('./ludory.project.json');
  if (!response.ok) throw new Error(`Game manifest HTTP ${response.status}`);
  const game = await response.json();
  if (game?.targets?.length !== 1 || game.targets[0] !== 'yandex-games') {
    throw new Error('Yandex entrypoint requires a Yandex-only game manifest');
  }

  const connector = createYandexConnector({
    // index.html already loaded /sdk.js; do not insert a second SDK script on failure.
    sdkLoader: async () => {
      if (typeof globalThis.YaGames?.init !== 'function') throw new Error('Yandex SDK is not loaded');
      return globalThis.YaGames;
    },
  });
  const { sdk } = await connector.initialize();
  const audio = createBrowserAudio({ resolveAsset: id => id === 'beep' ? beep : null });
  const storage = createYandexPlayerStorage({ getPlayer: () => sdk.getPlayer(), namespace: game.id });
  let inputListener = null;
  let enabled = false;
  const input = {
    subscribe(listener) { inputListener = listener; return () => { inputListener = null; }; },
    enable() { enabled = true; },
    disable() { enabled = false; },
    destroy() { enabled = false; inputListener = null; },
  };
  function emit(event) {
    if (!enabled || !inputListener) return;
    inputListener({ schemaVersion: 1, timestamp: performance.now(), source: 'input', ...event });
  }
  root.addEventListener('pointerdown', event => {
    const box = root.getBoundingClientRect();
    emit({ type: event.pointerType === 'touch' ? 'touch' : 'pointer', action: 'activate', phase: 'down',
      pointer: { id: event.pointerId, x: event.clientX - box.left, y: event.clientY - box.top } });
  });
  root.addEventListener('keydown', event => {
    if (event.code === 'Enter' || event.code === 'Space') {
      event.preventDefault();
      emit({ type: 'keyboard', action: 'activate', phase: 'down', key: event.key });
    }
  });
  const renderer = {
    async mount({ root: mountRoot, snapshot }) {
      mountRoot.dataset.mounted = 'true';
      score.textContent = String(snapshot.state.score);
    },
    resize(viewport) { root.dataset.orientation = viewport.orientation; },
    render(snapshot) { score.textContent = String(snapshot.state.score); },
    async unmount() { delete root.dataset.mounted; },
  };
  const host = createRuntimeHost({
    game, initialState: { score: 0 }, renderer, input, environment: createBrowserEnvironment({ root }), audio, storage,
    saveKey: `${game.id}:yandex-runtime`,
    update({ inputs, state, setState }) {
      const count = inputs.filter(event => event.phase === 'down' && event.action === 'activate').length;
      if (count) setState({ score: state.score + count });
    },
  });
  const lifecycle = createYandexLifecycle({ sdk, host, audio });
  const ads = createYandexAds({ sdk, host, lifecycle });
  lifecycle.attach();
  host.subscribe(event => {
    if (event.type === 'status') {
      status.textContent = event.status;
      status.dataset.host = event.status;
    }
  });
  await host.initialize();
  if (await lifecycle.markReady() !== true) {
    throw lifecycle.getLastError() ?? new Error('Yandex LoadingAPI.ready failed');
  }
  buttons.forEach(button => { button.disabled = false; });
  const run = async (action, fn) => {
    delete status.dataset.errorCode;
    delete status.dataset.lastOperation;
    errorLabel.textContent = '';
    try {
      await fn();
      status.dataset.lastOperation = `${action}:ok`;
    } catch (error) { report(error, action); }
  };
  document.querySelector('#start').onclick = () => run('start', () => host.start());
  document.querySelector('#pause').onclick = () => run('pause', () => {
    lifecycle.setManualPaused(true);
    host.pause();
  });
  document.querySelector('#resume').onclick = () => run('resume', () => {
    lifecycle.setManualPaused(false);
    host.resume();
  });
  document.querySelector('#save').onclick = () => run('save', () => host.save());
  document.querySelector('#restore').onclick = () => run('restore', () => host.restore());
  document.querySelector('#sound').onclick = () => run('sound', () => audio.play('beep'));
  document.querySelector('#fullscreen-ad').onclick = () => run('fullscreen-ad', () => ads.showFullscreen());
  document.querySelector('#rewarded-ad').onclick = () => run('rewarded-ad', async () => {
    const result = await ads.showRewarded();
    status.dataset.rewarded = String(result.rewarded === true);
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return; // lifecycle already owns BFCache pause/resume.
    ads.destroy();
    lifecycle.detach();
    void host.destroy().catch(error => report(error, 'destroy')).finally(() => {
      audio.destroy();
      void connector.destroy();
    });
  });
}

void boot().catch(error => report(error));
