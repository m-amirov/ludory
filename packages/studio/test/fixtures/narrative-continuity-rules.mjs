// Synthetic game-owned rules for a disposable Studio-created test game only.
// Canon for the fixture: a character may claim to have decoded the map only
// after taking the `decode` action. An intentional mystery does not claim it.
export const initialStory = () => ({ scene: 'gate', knowsMap: false, terminal: null });

export const legalActions = state => {
  if (state.terminal) return [];
  if (state.scene === 'gate') return ['decode', 'skip', 'withhold', 'remember'];
  if (state.scene === 'archive') return ['reveal'];
  if (state.scene === 'flashback') return ['return'];
  return [];
};

export function transition(state, action) {
  if (!legalActions(state).includes(action)) throw new Error(`Illegal action: ${action}`);
  if (state.scene === 'gate') {
    if (action === 'decode') return { scene: 'archive', knowsMap: true, terminal: null };
    if (action === 'skip') return { scene: 'archive', knowsMap: false, terminal: null };
    if (action === 'withhold') return { scene: 'mystery', knowsMap: false, terminal: 'open-ending' };
    if (action === 'remember') return { scene: 'flashback', knowsMap: false, terminal: null };
  }
  if (state.scene === 'flashback') return { scene: 'gate', knowsMap: false, terminal: null };
  return { scene: 'revelation', knowsMap: state.knowsMap, terminal: 'end' };
}

export const lines = Object.freeze({
  gate: 'The sealed map hangs on the door.',
  archive: 'The narrator opens the archive.',
  revelation: 'I decoded the map before I came here.',
  mystery: 'The figure keeps the map a mystery.',
  flashback: 'Years earlier, the door was still sealed.',
});

export function spokenLine(state) { return lines[state.scene]; }
