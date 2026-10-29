// Replace with your own RU/EN story. Every reaction is authored, not AI-generated.
const t = (ru, en) => ({ ru, en });
export const assets = { lighthouse: './assets/lighthouse.svg', shoreline: './assets/shoreline.svg' };
export const catalogData = { schemaVersion: 1, interactions: [
  { id: 'camera', type: 'photo', label: t('Сохранить мгновение', 'Keep this moment'), options: [
    { id: 'take', label: t('Сфотографировать огни маяка', 'Photograph the lighthouse lights'), assetId: 'lighthouse',
      effects: [{ op: 'album_add', id: 'lighthouse' }, { op: 'relation_delta', id: 'mira', value: 2 }] },
    { id: 'shore', label: t('Снять берег с ракушками', 'Photograph the shell-strewn shore'), assetId: 'shoreline',
      effects: [{ op: 'album_add', id: 'shoreline' }, { op: 'relation_delta', id: 'mira', value: 1 }] },
    { id: 'skip', label: t('Оставить вечер только в памяти', 'Keep the evening in your memory'),
      effects: [{ op: 'flag_set', id: 'no_photo', value: true }] },
  ] },
  { id: 'souvenir', type: 'keepsake', label: t('Что взять на память?', 'What will you remember?'), options: [
    { id: 'shell', label: t('Белая ракушка', 'A white seashell'),
      effects: [{ op: 'keepsake_add', id: 'shell' }, { op: 'flag_set', id: 'shell_kept', value: true }] },
    { id: 'key', label: t('Старинный медный ключ', 'An old brass key'),
      effects: [{ op: 'keepsake_add', id: 'key' }, { op: 'flag_set', id: 'key_kept', value: true }] },
  ] },
  { id: 'note', type: 'message', label: t('Написать Мире', 'Message Mira'), variants: [
    { id: 'invite-photo', recipient: 'mira', intent: 'invite', tone: 'warm', attachmentId: 'lighthouse',
      preview: t('Смотри, какой сегодня свет. Хочу разделить этот вечер с тобой.', 'Look at these lights. I want to share this evening with you.'),
      reply: t('Я узнала этот свет! Уже выхожу к тебе.', 'I recognize those lights! I am on my way.'),
      effects: [{ op: 'relation_delta', id: 'mira', value: 1 }, { op: 'memory_add', id: 'shared_evening' }] },
    { id: 'invite-shore', recipient: 'mira', intent: 'invite', tone: 'warm', attachmentId: 'shoreline',
      preview: t('Нашла целый берег ракушек. Идём вместе?', 'I found a shore full of seashells. Shall we go together?'),
      reply: t('Какая красота. Я помню эту дорожку — скоро буду.', 'How beautiful. I know that path — I will be there soon.'),
      effects: [{ op: 'relation_delta', id: 'mira', value: 1 }, { op: 'memory_add', id: 'shared_evening' }] },
    { id: 'invite', recipient: 'mira', intent: 'invite', tone: 'warm',
      preview: t('Если ты рядом, встретимся у маяка?', 'If you are nearby, shall we meet at the lighthouse?'),
      reply: t('Да. Встретимся у старой лестницы.', 'Yes. See you by the old stairs.'),
      effects: [{ op: 'flag_set', id: 'invited', value: true }] },
    { id: 'brief', recipient: 'mira', intent: 'invite', tone: 'plain',
      preview: t('Ты ещё у причала?', 'Are you still at the harbor?'),
      reply: t('Пока да. Всё в порядке?', 'For now, yes. Is everything okay?'), effects: [] },
    { id: 'support', recipient: 'mira', intent: 'support', tone: 'warm',
      preview: t('Я помню, что тебе было нелегко. Я рядом.', 'I remember it was hard for you. I am here.'),
      reply: t('Спасибо. Именно это мне сейчас было нужно.', 'Thank you. That is exactly what I needed.'),
      effects: [{ op: 'relation_delta', id: 'mira', value: 1 }, { op: 'memory_add', id: 'kind_words' }] },
  ] },
] };

export const graphData = { schemaVersion: 1, id: 'lighthouse-evening', startSceneId: 'shore', scenes: [
  { id: 'shore', beats: [
    { id: 'arrival', type: 'dialogue', text: t('Маяк мигнул трижды. Мира обещала дождаться тебя, но ветер уже стирал следы на песке.',
      'The lighthouse flashed three times. Mira promised to wait, but the wind was already erasing footprints in the sand.') },
    { id: 'take_photo', type: 'photo', interactionId: 'camera' },
    { id: 'choose_item', type: 'keepsake', interactionId: 'souvenir' },
    { id: 'send_note', type: 'message', interactionId: 'note' },
    { id: 'photo_echo', type: 'echo', sourceEventId: 'send_note', when: { memory: 'shared_evening' },
      text: t('Чуть позже Мира заметила снимок в переписке и улыбнулась.', 'Later, Mira saw the photo in your conversation and smiled.') },
    { id: 'album_echo', type: 'echo', sourceEventId: 'take_photo',
      when: { all: [{ any: [{ album: 'lighthouse' }, { album: 'shoreline' }] }, { not: { memory: 'shared_evening' } }] },
      text: t('Снимок остался в альбоме — у этого вечера теперь есть своё тихое место.',
        'The photo stayed in your album — a quiet place to keep this evening.') },
    { id: 'quiet_echo', type: 'echo', sourceEventId: 'take_photo', when: { flag: 'no_photo' },
      text: t('Ты не достала телефон. Этот свет останется только между вами.', 'You did not reach for your phone. This light belongs to memory alone.') },
    { id: 'shell_echo', type: 'echo', sourceEventId: 'choose_item', when: { flag: 'shell_kept' },
      text: t('Ракушка звякнула о пуговицу — напоминание о выборе.', 'The shell tapped against your button — a reminder of your choice.') },
    { id: 'key_echo', type: 'echo', sourceEventId: 'choose_item', when: { flag: 'key_kept' },
      text: t('Тяжесть ключа напомнила: некоторые двери ещё не открыты.', 'The key reminded you that some doors were still unopened.') },
    { id: 'reply_echo', type: 'echo', sourceEventId: 'send_note',
      text: t('Экран погас, но слова Миры ещё звучали в голове.', 'The screen went dark, but Mira’s words stayed with you.') },
    { id: 'commit_route', type: 'choice', choices: [
      { id: 'meet', label: t('Пойти навстречу Мире', 'Go meet Mira'), targetSceneId: 'crossroads',
        when: { relation: { id: 'mira', gte: 2 } }, effects: [{ op: 'route_lock', id: 'mira' }] },
      { id: 'depart', label: t('Встретить рассвет в одиночестве', 'Greet the dawn alone'), targetSceneId: 'crossroads',
        effects: [{ op: 'route_lock', id: 'solo' }] },
    ] },
  ] },
  { id: 'crossroads', beats: [{ id: 'final_choice', type: 'choice', choices: [
    { id: 'together', label: t('Остаться у маяка', 'Stay by the lighthouse'), targetSceneId: 'together', routeId: 'mira' },
    { id: 'alone', label: t('Идти вдоль берега', 'Walk along the shore'), targetSceneId: 'alone', routeId: 'solo' },
  ] }] },
  { id: 'together', beats: [{ id: 'ending_together', type: 'ending', endingId: 'together',
    text: t('Когда Мира появилась из тумана, ты уже знала: это начало чего-то настоящего.',
      'When Mira emerged from the mist, you knew this was the start of something real.') }] },
  { id: 'alone', beats: [{ id: 'ending_alone', type: 'ending', endingId: 'alone',
    text: t('Первые лучи рассвета коснулись воды. Иногда тишина — тоже выбор.',
      'The first light touched the water. Sometimes silence is a choice worth keeping.') }] },
] };

export const labels = {
  intent: { invite: t('Позвать на встречу', 'Invite to meet'), support: t('Поддержать', 'Offer support') },
  tone: { warm: t('Тепло', 'Warmly'), plain: t('Сдержанно', 'Briefly') },
  recipient: { mira: t('Мира', 'Mira') },
  journal: { lighthouse: t('Снимок у маяка', 'Lighthouse photo'), shoreline: t('Берег с ракушками', 'Shell-strewn shore'),
    shell: t('Белая ракушка', 'White seashell'),
    key: t('Медный ключ', 'Brass key'), shared_evening: t('Разделённый вечер', 'A shared evening'),
    kind_words: t('Слова поддержки', 'Words of support') },
};
export const relationFacts = [{ id: 'mira', min: 2,
  text: t('Мира чувствует, что тебе можно доверять.', 'Mira feels she can trust you.') }];
