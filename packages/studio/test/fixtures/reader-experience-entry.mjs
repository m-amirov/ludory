import { getRouteData } from './reader-experience-scene.mjs';

export function getPresentedRoute(route = 'shore', locale = 'ru') {
  const scene = getRouteData(route, locale);
  return {
    locale,
    visibleHistory: scene.visibleHistory,
    visiblePassages: scene.visiblePassages,
    visibleChoices: scene.visibleChoices,
  };
}

// Source-only harness, not a browser or actual human observation.
export function mountStory(document, route = 'shore', locale = 'ru') {
  const scene = getPresentedRoute(route, locale);
  const stage = document.querySelector('main');
  const nodes = [...scene.visibleHistory, ...scene.visiblePassages, ...scene.visibleChoices]
    .map(value => {
      const element = document.createElement('p');
      element.textContent = value;
      return element;
    });
  stage.replaceChildren(...nodes);
  return scene;
}

// The disposable game's loaded browser entrypoint actually mounts its text.
// This is not a verified real-browser or human-reader observation.
if (typeof document !== 'undefined') mountStory(document);
