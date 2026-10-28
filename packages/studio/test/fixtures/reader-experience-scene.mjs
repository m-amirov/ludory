// Synthetic new-game story fixture: hidden author facts MUST NOT enter the reader packet.
const routes = Object.freeze({
  shore: Object.freeze({
    internalRouteId: 'betrayal-ending',
    isTraitor: true,
    authorCanon: 'Marina caused the outage; the mystery is deliberately left unresolved here.',
    visibleHistory: ['Вы остались у маяка после сигнала.'],
    visiblePassages: ['Марина спрятала ключ под плащом.', 'У причала второй раз погас свет.'],
    visibleChoices: ['Спросить Марину о ключе', 'Подойти к лодке'],
  }),
  library: Object.freeze({
    internalRouteId: 'secret-archive',
    isTraitor: false,
    authorCanon: 'The archivist has the map.',
    visibleHistory: ['Вы открыли дверь архива.'],
    visiblePassages: ['На столе лежала запечатанная карта.'],
    visibleChoices: ['Взять карту', 'Вернуться к маяку'],
  }),
});

export function getRouteData(route, locale) {
  if (locale !== 'ru' || !Object.hasOwn(routes, route)) throw new Error('Unsupported route/locale');
  return routes[route];
}
