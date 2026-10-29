import {
  createRuntimeHost, createBrowserEnvironment, createBrowserStorage, createBrowserAudio,
} from '../assets/ludory-runtime.js';

const root = document.getElementById('game');
const score = document.getElementById('score');
const status = document.getElementById('status');
const game = await fetch('./ludory.project.json').then(response => {
  if (!response.ok) throw new Error(`Game manifest HTTP ${response.status}`);
  return response.json();
});

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
  emit({ type: event.pointerType === 'touch' ? 'touch' : 'pointer', action: 'activate', phase: 'down',
    pointer: { id: event.pointerId, x: event.clientX - root.getBoundingClientRect().left,
      y: event.clientY - root.getBoundingClientRect().top } });
});
root.addEventListener('keydown', event => {
  if (event.code === 'Space' || event.code === 'Enter') {
    emit({ type: 'keyboard', action: 'activate', phase: 'down', key: event.key });
  }
});

const renderer = {
  async mount({ root: mountRoot, snapshot }) { mountRoot.dataset.mounted = 'true'; score.textContent = String(snapshot.state.score); },
  resize(viewport) { root.dataset.orientation = viewport.orientation; },
  render(snapshot) { score.textContent = String(snapshot.state.score); },
  async unmount() { delete root.dataset.mounted; },
};

const environment = createBrowserEnvironment({ root });
const storage = createBrowserStorage({ namespace: game.id });
// Tiny built-in WAV beep: no remote audio or SDK/CDN dependency.
const beep = 'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRAAAACAgICAgICAgICAgICAgA==';
const audio = createBrowserAudio({ resolveAsset: id => id === 'beep' ? beep : null });
const host = createRuntimeHost({
  game,
  initialState: { score: 0 },
  update({ inputs, state, setState }) {
    const count = inputs.filter(event => event.action === 'activate' && event.phase === 'down').length;
    if (count) setState({ score: state.score + count });
  },
  renderer, input, environment, storage, audio, saveKey: `${game.id}:runtime-basic`,
});

window.ludoryHost = host; // Local development and browser acceptance fixture only.
window.ludoryAudio = audio;
host.subscribe(event => { status.textContent = event.status; });
await host.initialize();
for (const action of ['start', 'pause', 'resume', 'save', 'restore', 'stop']) {
  document.getElementById(action).addEventListener('click', async () => {
    try { await host[action](); }
    catch (error) { status.textContent = `${error.code ?? 'ERROR'}: ${error.message}`; }
  });
}
document.getElementById('sound').addEventListener('click', async () => {
  try { await audio.play('beep'); }
  catch (error) { status.textContent = error.code ?? 'AUDIO_UNAVAILABLE'; }
});
window.addEventListener('pagehide', () => { void host.destroy().finally(() => audio.destroy()); }, { once: true });
