import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEconomy } from '@ludory/economy';
import { createYandexAds } from '@ludory/connect-yandex';
import { createVkAds } from '@ludory/connect-vk';
import { createEconomyRuntime, definePremiumManifest } from '../src/index.mjs';
import { fixture } from './fixture.mjs';

function setup({ premium = false, ads, now = () => new Date('2026-11-03T23:50:00Z'),
  attemptId = () => 'ad_one', saveMode = 'ok', enabled = true, episodeIds = ['ep01', 'ep02'] } = {}) {
  const f = fixture({ enabled });
  const config = premium ? f.config : defineEconomy({ ...f.config, premium: {} });
  const manifest = premium ? definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: config }) : undefined;
  let persisted = null;
  let saves = 0;
  const storage = {
    async load() { return structuredClone(persisted); },
    async save(next) {
      saves++;
      if (saveMode === 'reject') throw new Error('save refused');
      if (saveMode === 'false') return false;
      persisted = structuredClone(next);
      if (saveMode === 'ambiguous') throw new Error('ack lost');
      return true;
    },
  };
  const runtime = createEconomyRuntime({ config, manifest, graph: premium ? f.graph : undefined,
    storage, ads, utcNow: now, newAttemptId: attemptId, episodeIds });
  return { runtime, config, storage, state: () => persisted, saves: () => saves,
    mode: value => { saveMode = value; } };
}

test('reward-only economy without a premium narrative graph: starter and episode receipts persist exactly once', async () => {
  const f = setup();
  await f.runtime.initialize();
  assert.equal(f.runtime.getView().balance, 0);
  assert.equal((await f.runtime.grantStarter()).applied, true);
  assert.equal((await f.runtime.grantStarter()).applied, false);
  const [a, b] = await Promise.all([f.runtime.grantEpisode('ep01'), f.runtime.grantEpisode('ep01')]);
  assert.deepEqual([a.applied, b.applied], [true, false]);
  assert.equal((await f.runtime.grantEpisode('ep02')).applied, true);
  assert.equal(f.runtime.getView().balance, 26);
  assert.equal(f.state().journal.length, 3);
  const next = createEconomyRuntime({ config: f.config, storage: f.storage, episodeIds: ['ep01', 'ep02'] });
  await next.initialize();
  assert.equal((await next.grantEpisode('ep01')).applied, false);
  assert.equal(next.getView().balance, 26);
});

test('non-authored episode IDs never grant, even if syntactically valid', async () => {
  const f = setup();
  await f.runtime.initialize();
  const saves = f.saves();
  await assert.rejects(f.runtime.grantEpisode('ep_hacked'), /authored|episode/i);
  assert.equal(f.runtime.getView().balance, 0);
  assert.equal(f.saves(), saves);
  const raw = fixture();
  const empty = createEconomyRuntime({ config: defineEconomy({ ...raw.config, premium: {} }), storage: f.storage });
  await empty.initialize();
  await assert.rejects(empty.grantEpisode('ep01'), /authored|episode/i,
    'unconfigured episode IDs are never implicitly accepted');
  assert.throws(() => setup({ episodeIds: ['ep01', 'ep01'] }), /episode|duplicate/i);
});

test('daily grant is UTC-scoped, cannot double-claim or rewind injected UTC clock', async () => {
  let now = new Date('2026-11-03T23:55:00Z');
  const f = setup({ now: () => now });
  await f.runtime.initialize();
  assert.deepEqual(f.runtime.getRewardsView().daily, {
    utcDate: '2026-11-03', lastClaim: null, eligible: true,
  });
  assert.equal((await f.runtime.claimDaily()).applied, true);
  assert.equal(f.runtime.getRewardsView().daily.eligible, false);
  assert.equal((await f.runtime.claimDaily()).applied, false);
  now = new Date('2026-11-04T00:01:00Z');
  assert.equal(f.runtime.getRewardsView().daily.eligible, true);
  assert.equal((await f.runtime.claimDaily()).applied, true);
  now = new Date('2026-11-03T23:59:00Z');
  assert.equal(f.runtime.getRewardsView().daily.eligible, false);
  await assert.rejects(f.runtime.claimDaily(), { code: 'STALE_DAILY_CLAIM' });
  assert.equal(f.runtime.getView().balance, 4);
  assert.equal(f.state().lastDailyClaim, '2026-11-04');
});

test('disabled or uninitialized grants fail closed', async () => {
  const f = setup();
  await assert.rejects(f.runtime.grantStarter(), /initialized/i);
  await assert.rejects(f.runtime.claimDaily(), /initialized/i);
  await assert.rejects(f.runtime.claimRewarded(), /initialized/i);
  const disabled = setup({ enabled: false });
  await disabled.runtime.initialize();
  await assert.rejects(disabled.runtime.grantStarter(), /disabled/i);
});

test('invalid episode and UTC timestamps are rejected without persisting', async () => {
  const f = setup({ now: () => new Date('invalid') });
  await f.runtime.initialize();
  const before = f.saves();
  await assert.rejects(f.runtime.grantEpisode('../escape'));
  await assert.rejects(f.runtime.claimDaily());
  assert.equal(f.saves(), before);
});

test('failed durable grant does not publish balance; retry reloads and deduplicates ambiguous commit', async () => {
  const f = setup();
  await f.runtime.initialize();
  f.mode('ambiguous');
  await assert.rejects(f.runtime.grantStarter(), /ack lost/);
  assert.equal(f.runtime.getView().ready, false);
  assert.equal(f.runtime.getView().balance, null);
  f.mode('ok');
  assert.equal((await f.runtime.grantStarter()).applied, false);
  assert.equal(f.runtime.getView().balance, 20);
  assert.equal(f.state().journal.length, 1);
});

test('null storage on a subsequent reload fails closed without erasing an established wallet', async () => {
  const f = setup();
  await f.runtime.initialize();
  await f.runtime.grantStarter();
  f.mode('reject');
  await assert.rejects(f.runtime.grantEpisode('ep01'), /save refused/);
  f.mode('ok');
  const before = f.saves();
  f.storage.load = async () => null;
  await assert.rejects(f.runtime.grantEpisode('ep01'), /missing|absent|reset|corrupt/i);
  assert.equal(f.saves(), before);
  assert.equal(f.state().balance, 20);
  assert.equal(f.runtime.getView().ready, false);
});

test('rewarded grant requires strictly verified adapter success and deduplicates simultaneous taps', async () => {
  let calls = 0;
  const f = setup({ ads: { async showRewarded() { calls++; return { shown: true, rewarded: true }; } } });
  await f.runtime.initialize();
  const [a, b] = await Promise.all([f.runtime.claimRewarded(), f.runtime.claimRewarded()]);
  assert.equal(calls, 1);
  assert.equal(a.applied, true);
  assert.deepEqual(b, a);
  assert.equal(f.runtime.getView().balance, 5);
  assert.equal(f.state().journal.length, 1);
});

test('no credit for rejected, cancelled or non-terminal rewarded results', async () => {
  for (const behavior of ['cancel', 'missing', 'throw', 'timeout']) {
    const f = setup({ ads: { showRewarded: async () => {
      if (behavior === 'throw' || behavior === 'timeout') throw new Error(behavior);
      return behavior === 'cancel' ? { shown: false, rewarded: false } : { shown: true };
    } } });
    await f.runtime.initialize();
    const saves = f.saves();
    await assert.rejects(f.runtime.claimRewarded());
    assert.equal(f.runtime.getView().balance, 0);
    assert.equal(f.runtime.getView().pendingReward, false);
    assert.equal(f.saves(), saves);
  }
});

test('ambiguous rewarded save remains pending; recovery reloads without showing another ad or double credit', async () => {
  let calls = 0;
  const f = setup({ ads: { async showRewarded() { calls++; return { shown: true, rewarded: true }; } } });
  await f.runtime.initialize();
  f.mode('ambiguous');
  await assert.rejects(f.runtime.claimRewarded(), /ack lost/);
  assert.equal(f.runtime.getView().ready, false);
  assert.equal(f.runtime.getView().pendingReward, true);
  assert.equal(f.runtime.getView().balance, null);
  f.mode('ok');
  const result = await f.runtime.retryPendingReward();
  assert.equal(result.applied, false);
  assert.equal(f.runtime.getView().pendingReward, false);
  assert.equal(f.runtime.getView().balance, 5);
  assert.equal(calls, 1);
  assert.equal(f.state().journal.length, 1);
});

test('missing wallet during pending rewarded recovery never overwrites the ledger with zero', async () => {
  const f = setup({ ads: { showRewarded: async () => ({ shown: true, rewarded: true }) } });
  await f.runtime.initialize();
  await f.runtime.grantStarter();
  f.mode('ambiguous');
  await assert.rejects(f.runtime.claimRewarded(), /ack lost/);
  const before = f.saves();
  f.mode('ok');
  f.storage.load = async () => null;
  await assert.rejects(f.runtime.retryPendingReward(), /missing|absent|reset|corrupt/i);
  assert.equal(f.saves(), before);
  assert.equal(f.state().balance, 25, 'the original acknowledged balance and pending reward stay untouched');
  assert.equal(f.runtime.getView().pendingReward, true);
});

test('failed rewarded save is retried with the same attempt without a second ad', async () => {
  let calls = 0;
  const f = setup({ ads: { async showRewarded() { calls++; return { shown: true, rewarded: true }; } } });
  await f.runtime.initialize();
  f.mode('reject');
  await assert.rejects(f.runtime.claimRewarded(), /save refused/);
  await assert.rejects(f.runtime.claimRewarded(), /pending/i);
  assert.equal(f.runtime.getRewardsView().pendingReward, true);
  assert.equal(f.runtime.getRewardsView().ready, false);
  assert.equal(calls, 1);
  f.mode('ok');
  assert.equal((await f.runtime.retryPendingReward()).applied, true);
  assert.equal(f.runtime.getView().balance, 5);
  assert.equal(calls, 1);
});

test('invalid attempt ID and unavailable ad adapter cannot award currency', async () => {
  let calls = 0;
  const f = setup({ attemptId: () => '../bad', ads: { showRewarded: async () => { calls++; return { shown: true, rewarded: true }; } } });
  await f.runtime.initialize();
  await assert.rejects(f.runtime.claimRewarded());
  assert.equal(calls, 0);
  const absent = setup();
  await absent.runtime.initialize();
  await assert.rejects(absent.runtime.claimRewarded(), /ads|rewarded/i);
});

test('dispose while ad is showing prevents subsequent grant or save', async () => {
  let finishAd;
  const f = setup({ ads: { showRewarded: () => new Promise(resolve => { finishAd = resolve; }) } });
  await f.runtime.initialize();
  const before = f.saves();
  const claim = f.runtime.claimRewarded();
  await new Promise(resolve => setImmediate(resolve));
  f.runtime.dispose();
  finishAd({ shown: true, rewarded: true });
  await assert.rejects(claim, /disposed/);
  assert.equal(f.saves(), before);
});

test('premium manifest still protects authored choices and reward grants coexist with unlocks', async () => {
  const f = setup({ premium: true });
  await f.runtime.initialize();
  await f.runtime.grantStarter();
  assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'locked');
  await f.runtime.unlockChoice('fork', 'intimate');
  assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'unlocked');
  assert.equal(f.runtime.getView().balance, 8);
});

test('real Yandex ads adapter credits only after onOpen, onRewarded and successful onClose', async () => {
  const sdk = { adv: { showRewardedVideo({ callbacks }) {
    queueMicrotask(() => { callbacks.onOpen(); callbacks.onRewarded(); callbacks.onClose(true); });
  } } };
  const lifecycle = { getStatus: () => 'ATTACHED', getAttachmentToken: () => 'session',
    acquireAdPause: () => () => {} };
  const host = { getStatus: () => 'RUNNING', pause() {}, resume() {} };
  const ads = createYandexAds({ sdk, host, lifecycle });
  try {
    let id = 0;
    const f = setup({ ads, attemptId: () => `ad_${++id}` });
    await f.runtime.initialize();
    assert.equal((await f.runtime.claimRewarded()).applied, true);
    assert.equal(f.runtime.getView().balance, 5);
    sdk.adv.showRewardedVideo = ({ callbacks }) => {
      queueMicrotask(() => { callbacks.onOpen(); callbacks.onClose(true); });
    };
    await assert.rejects(f.runtime.claimRewarded(), /not verified/i);
    assert.equal(f.runtime.getView().balance, 5);
  } finally { ads.destroy(); }
});

test('real VK ads adapter credits only when Bridge confirms rewarded result true', async () => {
  const lifecycle = { getStatus: () => 'ATTACHED', getAttachmentToken: () => 'session',
    acquireAdPause: () => () => {}, subscribeDetach: () => () => {} };
  const bridge = { send: async (method, args) => {
    assert.equal(method, 'VKWebAppShowNativeAds');
    assert.deepEqual(args, { ad_format: 'reward' });
    return { result: true };
  } };
  const ads = createVkAds({ bridge, lifecycle });
  try {
    let id = 0;
    const f = setup({ ads, attemptId: () => `ad_${++id}` });
    await f.runtime.initialize();
    assert.equal((await f.runtime.claimRewarded()).applied, true);
    assert.equal(f.runtime.getView().balance, 5);
    bridge.send = async () => ({ result: false });
    await assert.rejects(f.runtime.claimRewarded());
    assert.equal(f.runtime.getView().balance, 5);
  } finally { ads.destroy(); }
});
