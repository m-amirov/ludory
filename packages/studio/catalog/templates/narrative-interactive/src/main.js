import {
  defineGame, defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState,
  createRuntimeHost, createBrowserEnvironment, createBrowserStorage,
  createNarrativeRenderer, createNarrativeRuntimeUpdate,
} from '../assets/ludory-narrative.js';
import { graphData, catalogData, assets, labels, relationFacts } from './story.js';

const root = document.querySelector('#game');
const message = document.querySelector('#status');
const language = document.querySelector('#language');
const save = document.querySelector('#save');
const restart = document.querySelector('#restart');
const title = document.querySelector('#story-title');
const navigation = document.querySelector('#story-controls');

const shell = {
  ru: {
    title: 'Вечер у маяка · Ludory', documentTitle: 'Ludory — интерактивная история',
    navigation: 'Управление историей', game: 'Интерактивная история', language: 'English',
    save: 'Сохранить', restart: 'Начать заново', new: 'История запущена',
    restored: 'Сохранение восстановлено', saved: 'Сохранено',
    corrupted: 'Не удалось восстановить сохранение. Исходная запись не изменена. Чтобы удалить её и начать заново, нажмите «Начать заново».',
    stalled: 'Чтобы продолжить, выберите «Начать заново».',
    unavailable: 'Сохранения недоступны', saveFailed: 'Не удалось сохранить',
  },
  en: {
    title: 'Lighthouse Evening · Ludory', documentTitle: 'Lighthouse Evening · Ludory',
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
  document.title = ui.documentTitle;
  title.textContent = ui.title;
  navigation.setAttribute('aria-label', ui.navigation);
  root.setAttribute('aria-label', ui.game);
  language.textContent = ui.language;
  save.textContent = ui.save;
  restart.textContent = ui.restart;
  message.textContent = ui[currentStatus];
  if (stalledAfterRestore) root.textContent = ui.stalled;
}

function setStatus(status) { currentStatus = status; updateShell(); }

async function launch() {
  // A static same-origin file created by Studio, not a backend or remote API.
  const response = await fetch('./ludory.project.json');
  if (!response.ok) throw new Error('Game manifest is unavailable');
  const game = defineGame(await response.json());
  const graph = defineNarrativeGraph(graphData);
  const catalog = defineNarrativeCatalog(catalogData);
  const environment = createBrowserEnvironment({ root });
  const update = createNarrativeRuntimeUpdate({ graph, catalog });
  const renderer = createNarrativeRenderer({ graph, catalog, now: environment.now,
    canBack: () => update.canGoBack(), assets, labels, relationFacts });
  let storage;
  try { storage = createBrowserStorage({ storage: window.localStorage, namespace: 'ludory-narrative-v1' }); }
  catch { save.disabled = true; currentStatus = 'unavailable'; }
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
  await host.initialize();
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
}

launch().catch(error => { message.textContent = error.message; root.textContent = 'Не удалось запустить историю.'; });
