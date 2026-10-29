import { defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState } from '@ludory/narrative';

const t = (ru, en) => ({ ru, en });

export function fixture() {
  const catalog = defineNarrativeCatalog({ schemaVersion: 1, interactions: [
    { id: 'camera', type: 'photo', label: t('Сделать фото', 'Take a photo'), options: [
      { id: 'take', label: t('Снять гавань', 'Capture harbor'), assetId: 'harbor', effects: [
        { op: 'album_add', id: 'harbor' }, { op: 'relation_delta', id: 'friend', value: 2 },
      ] },
      { id: 'skip', label: t('Не снимать', 'Skip'), effects: [] },
    ] },
    { id: 'memento', type: 'keepsake', label: t('Выбрать сувенир', 'Choose a keepsake'), options: [
      { id: 'shell', label: t('Ракушка', 'Shell'), effects: [{ op: 'keepsake_add', id: 'shell' }] },
      { id: 'stone', label: t('Камень', 'Stone'), effects: [{ op: 'keepsake_add', id: 'stone' }] },
    ] },
    { id: 'message', type: 'message', label: t('Написать сообщение', 'Compose a message'), variants: [
      { id: 'warm', recipient: 'friend', intent: 'invite', tone: 'warm', attachmentId: 'harbor',
        preview: t('Встречаемся? Я пришлю фото.', 'Meet me? Here is a photo.'),
        reply: t('Конечно, встретимся!', 'Yes, see you!'),
        effects: [{ op: 'memory_add', id: 'promise' }] },
      { id: 'plain', recipient: 'friend', intent: 'invite', tone: 'plain',
        preview: t('Встретимся?', 'Meet?'), reply: t('Да.', 'Sure.'), effects: [] },
      { id: 'care', recipient: 'friend', intent: 'support', tone: 'warm',
        preview: t('Как ты?', 'How are you?'), reply: t('Спасибо.', 'Thanks.'), effects: [] },
    ] },
  ] });
  const graph = defineNarrativeGraph({ schemaVersion: 1, id: 'n2-fixture', startSceneId: 'start', scenes: [
    { id: 'start', beats: [
      { id: 'intro', type: 'dialogue', text: t('<b>Здравствуй</b>', '<b>Hello</b>') },
      { id: 'take_photo', type: 'photo', interactionId: 'camera' },
      { id: 'take_item', type: 'keepsake', interactionId: 'memento' },
      { id: 'send_message', type: 'message', interactionId: 'message' },
      { id: 'echo', type: 'echo', sourceEventId: 'take_photo', when: { album: 'harbor' }, text: t('Он увидел фото.', 'He saw the picture.') },
      { id: 'branch', type: 'choice', choices: [
        { id: 'together', label: t('Остаться', 'Stay'), targetSceneId: 'happy',
          when: { relation: { id: 'friend', gte: 2 } }, effects: [{ op: 'route_lock', id: 'friend' }] },
        { id: 'apart', label: t('Уехать', 'Leave'), targetSceneId: 'solo' },
      ] },
    ] },
    { id: 'happy', beats: [{ id: 'happy_end', type: 'ending', endingId: 'happy', text: t('Вместе!', 'Together!') }] },
    { id: 'solo', beats: [{ id: 'solo_end', type: 'ending', endingId: 'solo', text: t('Один.', 'Alone.') }] },
  ] });
  return { catalog, graph, initialState: { narrative: createNarrativeState(graph) } };
}

export function input(action, type = 'pointer') {
  return { schemaVersion: 1, type, action, phase: 'up', timestamp: 10, source: 'renderer' };
}
