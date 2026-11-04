import {
  defineGame, defineEconomy, defineNarrativeGraph, defineNarrativeCatalog,
  createNarrativeState, definePremiumManifest, verifyFreeNarrativePaths,
  createEconomyRuntime, createEconomyPanel, createNarrativeRenderer,
  createNarrativeRuntimeUpdate, createRuntimeHost,
  createBrowserEnvironment, createBrowserStorage,
} from '../assets/ludory-economy.js';
import { graphData, catalogData, freePathEvidence } from './story.js';
import { restoreNarrativeSession } from './restore.js';

async function loadJson(filename) {
  const result = await fetch(filename);
  if (!result.ok) throw new TypeError(`Required author configuration unavailable: ${filename}`);
  return result.json();
}

/**
 * New-game example only. Disabled config never initializes cloud/ads/payments.
 * Enabling economy requires an explicit platform target and real SDK-backed ports:
 * {storage, narrativeStorage, ads?, purchases?}. No local monetary fallback.
 */
export async function startEconomyNarrative({ economyPorts = null, target = null,
  storeEnabled = false, activeSkus = [] } = {}) {
  const root = document.querySelector('#game');
  const status = document.querySelector('#status');
  const title = document.querySelector('#story-title');
  const economyRoot = document.querySelector('#economy-panel');
  const save = document.querySelector('#save');
  const restart = document.querySelector('#restart');
  const game = defineGame(await loadJson('./ludory.project.json'));
  const config = defineEconomy({ ...await loadJson('./config/economy.json'), gameId: game.id });
  const graph = defineNarrativeGraph(graphData);
  const catalog = defineNarrativeCatalog(catalogData);
  title.textContent = game.title.ru ?? Object.values(game.title)[0];
  document.title = title.textContent;
  const premium = definePremiumManifest(await loadJson('./config/premium.json'), { graph, economyConfig: config });
  verifyFreeNarrativePaths({ graph, catalog, manifest: premium, ...freePathEvidence });

  let wallet = null;
  let storyStorage = null;
  if (config.enabled) {
    if (target !== 'yandex-games' && target !== 'vk-games' || !game.targets.includes(target)) {
      throw new TypeError('Enabled economy requires an explicit compatible platform target');
    }
    if (!economyPorts?.storage || typeof economyPorts.storage.load !== 'function' ||
        typeof economyPorts.storage.save !== 'function' ||
        typeof economyPorts.narrativeStorage?.load !== 'function' ||
        typeof economyPorts.narrativeStorage?.save !== 'function') {
      throw new TypeError('Enabled economy requires platform cloud wallet and narrative storage; no local fallback');
    }
    if (economyPorts.storage.purchaseCloud !== (target === 'yandex-games')) {
      throw new TypeError('Wrong or unsupported platform economy cloud adapter');
    }
    if (target === 'vk-games' && (economyPorts.purchases || storeEnabled || activeSkus.length)) {
      throw new TypeError('VK IAP is not implemented in Ludory');
    }
    if (storeEnabled && (target !== 'yandex-games' || !economyPorts.purchases || !activeSkus.length)) {
      throw new TypeError('Enabled Yandex store requires verified purchases and an active SKU allowlist');
    }
    storyStorage = economyPorts.narrativeStorage;
    wallet = createEconomyRuntime({ config, graph, manifest: premium,
      storage: economyPorts.storage, ads: economyPorts.ads, purchases: economyPorts.purchases,
      activeSkus });
    await wallet.initialize();
    // Never enable premium spending until unconsumed Yandex payments are reconciled.
    if (economyPorts.purchases) await wallet.restorePurchases();
  } else {
    try { storyStorage = createBrowserStorage({ storage: window.localStorage, namespace: 'ludory-economy-demo-story' }); }
    catch { save.disabled = true; }
  }

  const environment = createBrowserEnvironment({ root });
  const update = createNarrativeRuntimeUpdate({ graph, catalog,
    ...(wallet ? { authorizeChoice: wallet.authorizeChoice } : {}) });
  const renderer = createNarrativeRenderer({ graph, catalog,
    ...(wallet ? { premiumChoices: wallet } : {}), preferredMobileOrientation: 'portrait',
    canBack: () => update.canGoBack(), now: environment.now });
  const saveKey = `${game.id}:economy-narrative`;
  restart.addEventListener('click', async () => {
    if (typeof storyStorage?.clear !== 'function') return;
    try {
      // This erases ONLY the narrative record, never the independent wallet.
      await storyStorage.clear(saveKey);
      window.location.reload();
    } catch { status.textContent = 'Не удалось удалить сохранение. Попробуйте позднее.'; }
  });
  const host = createRuntimeHost({ game, renderer, update,
    initialState: { narrative: createNarrativeState(graph) },
    input: { subscribe: () => () => {}, enable() {}, disable() {} }, environment,
    ...(storyStorage ? { storage: storyStorage, saveKey } : {}) });
  await host.initialize();
  const restoreStatus = await restoreNarrativeSession({ host, storage: storyStorage, saveKey });
  if (restoreStatus === 'BLOCKED') {
    save.disabled = true;
    restart.hidden = typeof storyStorage?.clear !== 'function';
    status.textContent = restart.hidden
      ? 'Сохранение повреждено или несовместимо. Облачное хранилище недоступно для безопасного сброса.'
      : 'Не удалось восстановить сохранение. Оно не изменено. Нажмите «Начать заново» для сброса истории.';
  } else {
    restart.hidden = true;
  }
  const panel = wallet && restoreStatus !== 'BLOCKED' ? createEconomyPanel({ root: economyRoot, wallet, target,
    storeEnabled, locale: 'ru' }) : null;
  panel?.render();
  host.subscribe(() => panel?.render());
  save.addEventListener('click', async () => {
    try { await host.save(); status.textContent = 'История сохранена'; }
    catch { status.textContent = 'Сохранение истории недоступно'; }
  });
  let destroyed = false;
  async function dispose() {
    if (destroyed) return;
    destroyed = true;
    panel?.dispose(); wallet?.dispose();
    await host.destroy();
  }
  window.addEventListener('pagehide', event => { if (!event.persisted) void dispose(); });
  if (restoreStatus !== 'BLOCKED') {
    status.textContent = wallet ? 'Экономика подключена к облачному кошельку' : 'Демонстрация без монетизации';
  }
  return Object.freeze({ host, wallet, panel, dispose });
}
