// Synthetic game entrypoint: browser UI uses exactly the same transitions
// that the source-only Node test replays. No Runtime/browser PASS is claimed.
import { levels, initial, transition } from './level-rules.mjs';

export function playLevel(id, actions) {
  const level = levels[id];
  if (!level) throw new Error('UNKNOWN_LEVEL');
  let state = initial(level);
  for (const action of actions) state = transition(level, state, action);
  return state;
}

if (typeof document !== 'undefined') {
  document.getElementById('play')?.addEventListener('click', () => {
    const state = playLevel('win', ['step', 'step']);
    document.getElementById('score').textContent = state.terminal === 'win' ? 'WIN' : 'UNKNOWN';
  });
}
