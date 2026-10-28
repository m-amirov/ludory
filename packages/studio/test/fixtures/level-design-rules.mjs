// Deliberately small game-owned state machine for bounded source-level review.
// This is a test fixture, not a Ludory Runtime, level engine or shipping solver.
export const levels = Object.freeze({
  win: { id: 'win', start: 0, target: 2, blocked: [], actions: ['step', 'forfeit'] },
  blocked: { id: 'blocked', start: 0, target: 2, blocked: [1], actions: ['step', 'forfeit'] },
  trap: { id: 'trap', start: 0, target: 2, blocked: [], actions: ['step', 'seal'] },
});

export function initial(level) {
  return { n: level.start, locked: false, terminal: null };
}

export function transition(level, state, action) {
  if (state.terminal) throw new Error('TERMINAL_STATE');
  if (!level.actions.includes(action)) throw new Error('INVALID_ACTION');
  if (action === 'forfeit') return { ...state, terminal: 'lose' };
  if (action === 'seal') return { ...state, locked: true };
  if (state.locked) return { ...state };
  const next = state.n + 1;
  if (level.blocked.includes(next)) return { ...state, n: next, terminal: 'lose' };
  if (next === level.target) return { ...state, n: next, terminal: 'win' };
  return { ...state, n: next };
}
