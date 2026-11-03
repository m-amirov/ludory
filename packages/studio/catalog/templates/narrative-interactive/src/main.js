import {
  defineGame, defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState,
  createRuntimeHost, createBrowserEnvironment, createBrowserStorage,
  createNarrativeRenderer, createNarrativeRuntimeUpdate,
} from '../assets/ludory-narrative.js';
import { graphData, catalogData, assets, labels, relationFacts } from './story.js';

/** Use only validated game title data; never substitute the template demo's identity. */
export function resolveNarrativeTitle(game, locale) {
  const titles = game.title;
  const fallback = Object.hasOwn(titles, 'ru') ? 'ru' : Object.keys(titles).sort()[0];
  const key = typeof locale === 'string' && Object.hasOwn(titles, locale) ? locale : fallback;
  return `${titles[key]} · Ludory`;
}

/** Author-owned entrypoint: platform hooks are supplied by an explicit derived SDK bootstrap. */
export async function startNarrative({ platform = null } = {}) {
const root = document.querySelector('#game');
const message = document.querySelector('#status');
const language = document.querySelector('#language');
const save = document.querySelector('#save');
const restart = document.querySelector('#restart');
const title = document.querySelector('#story-title');
const navigation = document.querySelector('#story-controls');
const preferredMobileOrientation = document.querySelector('meta[name="ludory-mobile-orientation"]')?.content === 'portrait'
  ? 'portrait' : 'auto';
document.documentElement.dataset.mobilePreference = preferredMobileOrientation;

const shell = {
  ru: {
    navigation: 'Управление историей', game: 'Интерактивная история', language: 'English',
    save: 'Сохранить', restart: 'Начать заново', new: 'История запущена',
    restored: 'Сохранение восстановлено', saved: 'Сохранено',
    corrupted: 'Не удалось восстановить сохранение. Исходная запись не изменена. Чтобы удалить её и начать заново, нажмите «Начать заново».',
    stalled: 'Чтобы продолжить, выберите «Начать заново».',
    unavailable: 'Сохранения недоступны', saveFailed: 'Не удалось сохранить',
  },
  en: {
    navigation: 'Story controls', game: 'Interactive story', language: 'Русский',
    save: 'Save', restart: 'Start over', new: 'Story started',
    restored: 'Save restored', saved: 'Saved',
    corrupted: 'Could not restore your save. The original record was kept. Choose “Start over” to remove it and restart.',
    stalled: 'Choose “Start over” to continue.',
    unavailable: 'Saving is unavailable', saveFailed: 'Could not save',
  },
};
let locale = 'ru';
let currentStatus = 'new';
let stalledAfterRestore = false;

function updateShell() {
  const ui = shell[locale];
  document.documentElement.lang = locale;
  const gameTitle = resolveNarrativeTitle(game, locale);
  document.title = gameTitle;
  title.textContent = gameTitle;
  navigation.setAttribute('aria-label', ui.navigation);
  root.setAttribute('aria-label', ui.game);
  language.textContent = ui.language;
  save.textContent = ui.save;
  restart.textContent = ui.restart;
  message.textContent = ui[currentStatus];
  if (stalledAfterRestore) root.textContent = ui.stalled;
}

function setStatus(status) { currentStatus = status; updateShell(); }

  // A static same-origin file created by Studio, not a backend or remote API.
  const response = await fetch('./ludory.project.json');
  if (!response.ok) throw new Error('Game manifest is unavailable');
  const game = defineGame(await response.json());
  const graph = defineNarrativeGraph(graphData);
  const catalog = defineNarrativeCatalog(catalogData);
  const environment = createBrowserEnvironment({ root });
  const update = createNarrativeRuntimeUpdate({ graph, catalog });
  const renderer = createNarrativeRenderer({ graph, catalog, now: environment.now,
    canBack: () => update.canGoBack(), assets, labels, relationFacts, preferredMobileOrientation });
  let storage;
  let integration;
  if (platform !== null) {
    integration = await platform.prepare(game);
    if (!integration?.storage || typeof integration.attach !== 'function' ||
        typeof integration.ready !== 'function' || typeof integration.dispose !== 'function') {
      throw new TypeError('Narrative platform must provide storage, attach, ready and dispose');
    }
    storage = integration.storage;
  } else {
    try { storage = createBrowserStorage({ storage: window.localStorage, namespace: 'ludory-narrative-v1' }); }
    catch { save.disabled = true; currentStatus = 'unavailable'; }
  }
  const saveKey = `${game.id}:narrative-demo`;
  // Install restart before any restore can FAULT the Runtime host.
  restart.addEventListener('click', async () => {
    try {
      if (storage) await storage.clear(saveKey);
      window.location.reload();
    } catch { setStatus('saveFailed'); }
  });
  const host = createRuntimeHost({ game, initialState: { narrative: createNarrativeState(graph) },
    update, renderer, input: { subscribe: () => () => {}, enable() {}, disable() {} },
    environment, ...(storage ? { storage, saveKey } : {}) });
  if (integration) await integration.attach(host);
  await host.initialize();
  if (integration) await integration.ready(host);
  let restoreFailed = false;
  if (storage) {
    try {
      const record = await storage.load(saveKey);
      if (record !== null) {
        await host.restore();
        currentStatus = 'restored';
      }
    } catch {
      // Do not overwrite unreadable or incompatible saves. Only an explicit restart may clear them.
      save.disabled = true;
      currentStatus = 'corrupted';
      restoreFailed = true;
    }
  }
  try { host.start(); }
  catch (error) {
    if (!restoreFailed) throw error;
    stalledAfterRestore = true;
    save.disabled = true;
  }
  updateShell();
  language.addEventListener('click', () => {
    locale = locale === 'ru' ? 'en' : 'ru';
    renderer.setLocale(locale);
    updateShell();
  });
  save.addEventListener('click', async () => {
    try { await host.save(); setStatus('saved'); }
    catch { setStatus('saveFailed'); }
  });
  if (integration) window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    void host.destroy().finally(() => integration.dispose());
  });
  return host;
}
