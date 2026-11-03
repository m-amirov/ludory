import { defineEconomy } from '@ludory/economy';
import { defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState } from '@ludory/narrative';

const t = value => ({ ru: value, en: value });

export function fixture({ enabled = true } = {}) {
  const config = defineEconomy({
    schemaVersion: 1, enabled, gameId: 'premium-demo', configVersion: 1,
    currency: { id: 'crystals', displayName: 'Crystals', icon: '💎' }, maxBalance: 500,
    rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 },
    premium: { private_time: { cost: 12, type: 'scene' } }, products: {},
  });
  const catalog = defineNarrativeCatalog({ schemaVersion: 1, interactions: [{
    id: 'camera', type: 'photo', label: t('Сделать фото'), options: [
      { id: 'snap', label: t('Снять'), assetId: 'harbor', effects: [
        { op: 'album_add', id: 'harbor' }, { op: 'relation_delta', id: 'partner', value: 1 },
      ] },
      { id: 'skip', label: t('Пропустить'), effects: [] },
    ],
  }] });
  const graph = defineNarrativeGraph({ schemaVersion: 1, id: 'premium-fixture', startSceneId: 'start', scenes: [
    { id: 'start', beats: [
      { id: 'intro', type: 'dialogue', text: t('Добро пожаловать') },
      { id: 'photo', type: 'photo', interactionId: 'camera' },
      { id: 'fork', type: 'choice', choices: [
        { id: 'connect', label: t('Поговорить'), targetSceneId: 'bridge' },
        { id: 'intimate', label: t('Особый вечер'), targetSceneId: 'bridge', effects: [
          { op: 'relation_delta', id: 'partner', value: 2 },
          { op: 'flag_set', id: 'tender', value: true },
          { op: 'memory_add', id: 'private_night' },
        ] },
        { id: 'leave', label: t('Уехать'), targetSceneId: 'solo' },
      ] },
    ] },
    { id: 'bridge', beats: [
      { id: 'bridge_intro', type: 'dialogue', text: t('После разговора') },
      { id: 'spark_echo', type: 'echo', sourceEventId: 'photo',
        when: { memory: 'private_night' }, text: t('Он помнил тот вечер') },
      { id: 'bridge_choice', type: 'choice', choices: [
        { id: 'stay', label: t('Остаться'), targetSceneId: 'happy',
          when: { relation: { id: 'partner', gte: 1 } }, effects: [{ op: 'route_lock', id: 'partner' }] },
        { id: 'walk', label: t('Пойти'), targetSceneId: 'solo' },
      ] },
    ] },
    { id: 'happy', beats: [{ id: 'happy_end', type: 'ending', endingId: 'good', text: t('Вместе') }] },
    { id: 'solo', beats: [{ id: 'solo_end', type: 'ending', endingId: 'solo', text: t('Один') }] },
  ] });
  const rawManifest = { schemaVersion: 1, choices: [
    { beatId: 'fork', choiceId: 'intimate', contentId: 'private_time' },
  ] };
  const freeTrace = { endingId: 'good', routeId: 'partner', actions: [
    { type: 'next', beatId: 'intro' },
    { type: 'interact', beatId: 'photo', optionId: 'snap' },
    { type: 'choose', beatId: 'fork', optionId: 'connect' },
    { type: 'next', beatId: 'bridge_intro' },
    { type: 'choose', beatId: 'bridge_choice', optionId: 'stay' },
  ] };
  return { config, catalog, graph, rawManifest, freeTrace, initialNarrative: createNarrativeState(graph) };
}
