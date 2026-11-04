// Replace with your authored story. Premium is an optional sidecar, not a Narrative Graph v1 field.
const t = (ru, en) => ({ ru, en });
export const catalogData = { schemaVersion: 1, interactions: [] };
export const graphData = { schemaVersion: 1, id: 'evening', startSceneId: 'start', scenes: [
  { id: 'start', beats: [
    { id: 'intro', type: 'dialogue', text: t('На берегу стояли двое. Реши, как провести этот вечер.',
      'Two people stood at the shore. Decide how to spend this evening.') },
    { id: 'fork', type: 'choice', choices: [
      { id: 'chat', label: t('Поговорить по душам', 'Have a heartfelt talk'), targetSceneId: 'bridge',
        effects: [{ op: 'relation_delta', id: 'partner', value: 1 }] },
      { id: 'intimate', label: t('Разделить особенный вечер', 'Share a special evening'), targetSceneId: 'bridge',
        effects: [{ op: 'relation_delta', id: 'partner', value: 2 },
          { op: 'memory_add', id: 'private_night' }, { op: 'flag_set', id: 'tender', value: true }] },
      { id: 'leave', label: t('Побыть наедине с собой', 'Spend the night alone'), targetSceneId: 'solo' },
    ] },
  ] },
  { id: 'bridge', beats: [
    { id: 'bridge_intro', type: 'dialogue', text: t('Звёзды зажглись над берегом.', 'Stars lit the shore.') },
    { id: 'bridge_choice', type: 'choice', choices: [
      { id: 'stay', label: t('Остаться рядом', 'Stay together'), targetSceneId: 'happy',
        when: { relation: { id: 'partner', gte: 1 } }, effects: [{ op: 'route_lock', id: 'partner' }] },
      { id: 'walk', label: t('Отправиться домой', 'Go home'), targetSceneId: 'solo' },
    ] },
  ] },
  { id: 'happy', beats: [{ id: 'happy_end', type: 'ending', endingId: 'good',
    text: t('Они встретили рассвет вместе.', 'They welcomed the dawn together.') }] },
  { id: 'solo', beats: [{ id: 'solo_end', type: 'ending', endingId: 'solo',
    text: t('Утром берег стал тихим.', 'The shore fell quiet in the morning.') }] },
] };

// Keep this witness in sync with the authored graph. Premium content must
// never be the only route to a good ending.
export const freePathEvidence = {
  terminals: [{ endingId: 'good', routeId: 'partner' }],
  traces: [{ endingId: 'good', routeId: 'partner', actions: [
    { type: 'next', beatId: 'intro' },
    { type: 'choose', beatId: 'fork', optionId: 'chat' },
    { type: 'next', beatId: 'bridge_intro' },
    { type: 'choose', beatId: 'bridge_choice', optionId: 'stay' },
  ] }],
};
