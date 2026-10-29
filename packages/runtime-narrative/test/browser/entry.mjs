import { createRuntimeHost, createBrowserEnvironment, createBrowserStorage } from '@ludory/runtime';
import { createNarrativeRenderer, createNarrativeRuntimeUpdate } from '@ludory/runtime-narrative';
import { fixture } from '../fixture.mjs';

const { graph, catalog, initialState } = fixture();
const root = document.querySelector('#game');
const environment = createBrowserEnvironment({ root });
const update = createNarrativeRuntimeUpdate({ graph, catalog });
const renderer = createNarrativeRenderer({ graph, catalog, now: environment.now,
  canBack: () => update.canGoBack(), assets: { harbor: './assets/large-art.svg' } });
const input = { subscribe: () => () => {}, enable() {}, disable() {} };
const storage = createBrowserStorage({ storage: window.localStorage });
const makeHost = () => createRuntimeHost({
  game: { schemaVersion: 1, id: 'n2-browser', version: '1.0.0',
    title: { en: 'N2 browser' }, engine: 'web', targets: ['yandex-games'] },
  initialState, renderer, update, input,
  environment, storage, saveKey: 'n2-browser:save',
});
const host = makeHost();
window.n2Host = host;
window.n2Graph = graph;
window.n2Catalog = catalog;
const status = document.querySelector('#status');
for (const action of ['start', 'pause', 'resume', 'save', 'restore']) {
  document.querySelector(`#${action}`).addEventListener('click', async () => {
    try {
      await host[action]();
      status.textContent = `${action}:ok`;
    } catch (error) { status.textContent = `${action}:${error.code || error.message}`; }
  });
}
await host.initialize();
status.textContent = 'initialized';
