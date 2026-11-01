import {
  createRuntimeHost, createBrowserEnvironment, createBrowserAudio,
  createVkConnector, createVkLifecycle, createVkStorage, createVkAds,
} from '../assets/ludory-vk.js';

const root = document.querySelector('#game');
const score = document.querySelector('#score');
const status = document.querySelector('#status');
const errorLabel = document.querySelector('#error');
const buttons = [...document.querySelectorAll('#controls button')];
const restoreButton = document.querySelector('#restore');
const rewardNotice = document.querySelector('#reward-notice');

const beep = (() => {
  const sampleRate = 8000;
  const frames = 2400;
  const bytes = new Uint8Array(44 + frames);
  const header = new DataView(bytes.buffer);
  const ascii = (offset, value) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
  };
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + frames, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true); header.setUint32(28, sampleRate, true);
  header.setUint16(32, 1, true); header.setUint16(34, 8, true);
  ascii(36, 'data'); header.setUint32(40, frames, true);
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(1, i / 200, (frames - i - 1) / 200);
    bytes[44 + i] = Math.round(128 + 32 * fade * Math.sin(2 * Math.PI * 660 * i / sampleRate));
  }
  let data = '';
  for (const value of bytes) data += String.fromCharCode(value);
  return `data:audio/wav;base64,${btoa(data)}`;
})();

function report(error, action = 'bootstrap') {
  if (action === 'bootstrap') delete status.dataset.sdkReady;
  status.dataset.lastOperation = `${action}:error`;
  status.dataset.errorCode = error?.code ?? 'ERROR';
  errorLabel.textContent = `${error?.code ?? 'ERROR'}: ${error?.message ?? String(error)}`;
}

async function boot() {
  const response = await fetch('./ludory.project.json');
  if (!response.ok) throw new Error(`Game manifest HTTP ${response.status}`);
  const game = await response.json();
  if (game?.targets?.length !== 1 || game.targets[0] !== 'vk-games') {
    throw new Error('VK entrypoint requires a VK-only game manifest');
  }

  // Dynamic import lets the bootstrap error handler report a missing Bridge asset.
  const { default: bridge } = await import('../assets/vk-bridge.js');
  const connector = createVkConnector({ bridgeLoader: async () => bridge });
  const { bridge: connected } = await connector.initialize();
  const audio = createBrowserAudio({ resolveAsset: id => id === 'beep' ? beep : null });
  const storage = createVkStorage({ bridge: connected, namespace: game.id });
  let inputListener = null;
  let enabled = false;
  const input = {
    subscribe(listener) { inputListener = listener; return () => { inputListener = null; }; },
    enable() { enabled = true; },
    disable() { enabled = false; },
    destroy() { enabled = false; inputListener = null; },
  };
  function emit(event) {
    if (enabled && inputListener) {
      inputListener({ schemaVersion: 1, timestamp: performance.now(), source: 'input', ...event });
    }
  }
  root.addEventListener('pointerdown', event => {
    const rect = root.getBoundingClientRect();
    emit({ type: event.pointerType === 'touch' ? 'touch' : 'pointer', action: 'activate', phase: 'down',
      pointer: { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top } });
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
    game, initialState: { score: 0 }, renderer, input,
    environment: createBrowserEnvironment({ root }), audio, storage,
    saveKey: `${game.id}:vk-runtime`,
    update({ inputs, state, setState }) {
      const count = inputs.filter(event => event.phase === 'down' && event.action === 'activate').length;
      if (count) setState({ score: state.score + count });
    },
  });
  const lifecycle = createVkLifecycle({ bridge: connected, host, audio });
  const ads = createVkAds({ bridge: connected, lifecycle });
  if (!lifecycle.attach()) throw lifecycle.getLastError() ?? new Error('VK lifecycle attach failed');
  host.subscribe(event => {
    if (event.type === 'status') {
      status.textContent = event.status;
      status.dataset.host = event.status;
      restoreButton.disabled = event.status !== 'READY';
    }
  });
  await host.initialize();
  const run = async (action, fn) => {
    delete status.dataset.errorCode;
    delete status.dataset.lastOperation;
    errorLabel.textContent = '';
    try { await fn(); status.dataset.lastOperation = `${action}:ok`; }
    catch (error) { report(error, action); }
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
    status.dataset.rewarded = 'false';
    rewardNotice.textContent = 'Rewarded ad: not confirmed';
    const result = await ads.showRewarded();
    status.dataset.rewarded = String(result.rewarded === true);
    if (result.rewarded === true) rewardNotice.textContent = 'Rewarded ad: SDK confirmed (no prize credited)';
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    ads.destroy();
    lifecycle.detach();
    void host.destroy().catch(error => report(error, 'destroy')).finally(() => {
      audio.destroy();
      void connector.destroy();
    });
  });
  buttons.forEach(button => { button.disabled = false; });
  restoreButton.disabled = host.getStatus() !== 'READY';
  status.dataset.sdkReady = 'true';
}

void boot().catch(error => report(error));
