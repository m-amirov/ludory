// This model is deliberately wrong: skipping an action still grants knowledge.
// It is NEVER imported from the actual Studio game's entrypoint.
export const solverTransition = action => ({
  scene: action === 'withhold' ? 'mystery' : 'revelation',
  knowsMap: true,
});
export const previewTransition = action => solverTransition(action);
