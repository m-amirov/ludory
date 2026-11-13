import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';
import { planNarrativePlatformExport, buildNarrativePlatformCandidates,
  verifyNarrativePlatformCandidates } from '../../../studio/src/narrative-platform-export.mjs';
import { inspectYandexArchive, inspectVkArchive } from '@ludory/release';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

const yandexSdk = String.raw`
(() => {
  const mode = globalThis.__f5b3SdkMode;
  const handlers = new Map();
  const state = {
    calls: [], events: [], cloudKey: '__f5b3_yandex_cloud',
    emit(name) { this.events.push(name); for (const fn of handlers.get(name) ?? []) fn(); },
    get cloud() {
      const raw = localStorage.getItem(this.cloudKey);
      if (!raw && mode === 'corrupt-cloud') return {
        'ludory:f5b3-author:v1:f5b3-author:narrative-demo': { formatVersion: 99 },
      };
      return JSON.parse(raw || '{}');
    },
    set cloud(value) { localStorage.setItem(this.cloudKey, JSON.stringify(value)); },
  };
  globalThis.__f5b3Sdk = state;
  const sdk = {
    features: {
      LoadingAPI: { ready() {
        state.calls.push('loading:ready');
        if (mode === 'ready-refused') return Promise.reject(new Error('F5B3_READY_REFUSED'));
      } },
      GameplayAPI: {
        start() { state.calls.push('gameplay:start'); },
        stop() { state.calls.push('gameplay:stop'); },
      },
    },
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
    },
    off(name, fn) { handlers.get(name)?.delete(fn); },
    getPlayer() {
      state.calls.push('player:request');
      return Promise.resolve({
        getData(keys) {
          state.calls.push('player:getData');
          const value = state.cloud;
          return Promise.resolve(Object.fromEntries(keys.filter(key => Object.hasOwn(value, key))
            .map(key => [key, value[key]])));
        },
        setData(value, flush) {
          state.calls.push('player:setData');
          if (mode === 'storage-refused') return Promise.reject(new Error('F5B3_CLOUD_WRITE_REFUSED'));
          state.lastFlush = flush;
          state.cloud = { ...state.cloud, ...value };
          return Promise.resolve();
        },
      });
    },
  };
  globalThis.YaGames = {
    init() {
      state.calls.push('sdk:init');
      if (mode === 'init-refused') return Promise.reject(new Error('F5B3_INIT_REFUSED'));
      return Promise.resolve(sdk);
    },
  };
})();`;

const vkBridge = String.raw`
const mode = globalThis.__f5b3SdkMode;
const listeners = new Set();
const state = {
  calls: [], events: [], cloudKey: '__f5b3_vk_cloud',
  emit(type) {
    this.events.push(type);
    for (const listener of listeners) listener({ detail: { type } });
  },
  get cloud() {
    const raw = localStorage.getItem(this.cloudKey);
    if (!raw && mode === 'corrupt-cloud') return {
      'ludory_11_f5b3_author_v1_f5b3-author_003Anarrative-demo': '{corrupt',
    };
    return JSON.parse(raw || '{}');
  },
  set cloud(value) { localStorage.setItem(this.cloudKey, JSON.stringify(value)); },
};
globalThis.__f5b3Sdk = state;
const bridge = {
  subscribe(listener) {
    if (mode === 'ready-refused') throw new Error('F5B3_ATTACH_REFUSED');
    listeners.add(listener);
  },
  unsubscribe(listener) { listeners.delete(listener); },
  send(method, params) {
    state.calls.push(method);
    if (method === 'VKWebAppInit') {
      if (mode === 'init-refused') return Promise.reject(new Error('F5B3_INIT_REFUSED'));
      return Promise.resolve({ result: true });
    }
    if (method === 'VKWebAppStorageGet') {
      const cloud = state.cloud;
      return Promise.resolve({ keys: params.keys.filter(key => Object.hasOwn(cloud, key))
        .map(key => ({ key, value: cloud[key] })) });
    }
    if (method === 'VKWebAppStorageSet') {
      if (mode === 'storage-refused') return Promise.reject(new Error('F5B3_CLOUD_WRITE_REFUSED'));
      state.cloud = { ...state.cloud, [params.key]: params.value };
      return Promise.resolve({ result: true });
    }
    return Promise.reject(new Error('Unexpected VK method: ' + method));
  },
};
export default bridge;`;

const mime = extension => ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
}[extension] ?? 'application/octet-stream');

function authorHashes(plan, root) {
  return plan.files.map(file => ({ path: file.path,
    sha256: sha(fs.readFileSync(path.join(root, file.path))) }));
}

async function serveZip(candidate, target, trustedMembers, { sdkMode = 'normal' } = {}) {
  if (!['normal', 'init-refused', 'ready-refused', 'storage-refused', 'corrupt-cloud'].includes(sdkMode)) {
    throw new Error('F5B3_UNSUPPORTED_SDK_MODE');
  }
  const requests = [];
  const server = http.createServer((request, response) => {
    const raw = new URL(request.url, 'http://localhost').pathname;
    const name = raw === '/' ? 'index.html' : raw.slice(1);
    requests.push(name);
    if (!['GET', 'HEAD'].includes(request.method) || name.includes('%') ||
        name.includes('\\') || name.startsWith('.') || name.split('/').includes('..')) {
      response.writeHead(404).end();
      return;
    }
    let bytes;
    const modeBootstrap = `globalThis.__f5b3SdkMode = ${JSON.stringify(sdkMode)};\n`;
    if (target === 'yandex' && name === 'sdk.js') bytes = Buffer.from(modeBootstrap + yandexSdk);
    else if (target === 'vk' && name === 'assets/vk-bridge.js') bytes = Buffer.from(modeBootstrap + vkBridge);
    else {
      bytes = candidate.entries[name];
      if (bytes && sha(bytes) !== trustedMembers.get(name)) {
        response.writeHead(503).end();
        return;
      }
    }
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': mime(path.extname(name)), 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let closed;
  return { url: `http://127.0.0.1:${server.address().port}/`, requests,
    close: () => closed ??= new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())) };
}

/** A genuine author source and two verified archive byte maps, owned only by this fixture. */
export async function createF5b3Fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f5b3-'));
  const servers = [];
  const cleanup = async () => {
    await Promise.all(servers.map(server => server.close()));
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    const author = path.join(root, 'author');
    fs.mkdirSync(author);
    const planned = planCreate(author, { id: 'f5b3-author', version: '1.0.0',
      title: 'Авторский маяк', lang: 'ru', profile: 'narrative-game',
      template: 'narrative-interactive', targets: ['yandex-games', 'vk-games'] });
    if (planned.status !== 'READY') throw new Error('F5B3_SOURCE_CREATE_BLOCKED');
    if (applyCreatePlan(planned).status !== 'APPLIED') throw new Error('F5B3_SOURCE_CREATE_FAILED');
    const story = path.join(author, 'src/story.js');
    const original = fs.readFileSync(story, 'utf8');
    if (!original.includes('Маяк мигнул трижды.')) throw new Error('F5B3_EXPECTED_STORY_NOT_FOUND');
    fs.writeFileSync(story, original.replace('Маяк мигнул трижды.', 'F5B3_AUTHORED_STORY_317'));
    // This synthetic fixture intentionally authors a new story. Keep its local
    // author proof bound to those exact bytes; production proof checks stay strict.
    const authorProofPath = path.join(author, 'narrative-assets.json');
    const authorProof = JSON.parse(fs.readFileSync(authorProofPath, 'utf8'));
    authorProof.storySha256 = sha(fs.readFileSync(story));
    fs.writeFileSync(authorProofPath, `${JSON.stringify(authorProof, null, 2)}\n`);
    const sourcePlan = planNarrativePlatformExport(author);
    if (sourcePlan.status !== 'READY_TO_DERIVE') throw new Error(sourcePlan.reasonCode);
    const beforeAuthorHashes = authorHashes(sourcePlan, author);
    const outputs = Object.fromEntries([
      ['yandexZip', 'yandex.zip'], ['vkZip', 'vk.zip'],
      ['yandexBuildReceipt', 'yandex.json'], ['vkBuildReceipt', 'vk.json'],
      ['exportReceipt', 'pair.json'],
    ].map(([key, name]) => [key, path.join(root, name)]));
    const result = await buildNarrativePlatformCandidates(sourcePlan, outputs);
    if (result.status !== 'CANDIDATES_BUILT_LOCAL') throw new Error(result.reasonCode ?? result.status);
    const verification = await verifyNarrativePlatformCandidates(outputs, sourcePlan);
    if (verification.status !== 'LOCAL_ARCHIVES_VERIFIED') throw new Error(verification.reasonCode);
    const trustedMembers = {};
    const candidates = Object.fromEntries([['yandex', inspectYandexArchive], ['vk', inspectVkArchive]]
      .map(([key, inspect]) => {
        const archive = inspect(outputs[`${key}Zip`]);
        trustedMembers[key] = new Map(archive.files.map(file => [file.path, file.sha256]));
        return [key, {
          archiveSha256: archive.sha256,
          entries: unzipSync(new Uint8Array(fs.readFileSync(outputs[`${key}Zip`]))),
        }];
      }));
    const assertVerified = async () => {
      if ((await verifyNarrativePlatformCandidates(outputs, sourcePlan)).status !== 'LOCAL_ARCHIVES_VERIFIED') {
        throw new Error('F5B3_SOURCE_OR_ARCHIVE_CHANGED');
      }
      for (const [key, candidate] of Object.entries(candidates)) {
        const trusted = trustedMembers[key];
        const names = Object.keys(candidate.entries);
        if (names.length !== trusted.size || names.some(name =>
          !trusted.has(name) || sha(candidate.entries[name]) !== trusted.get(name))) {
          throw new Error('F5B3_ARCHIVE_MEMBER_CHANGED');
        }
      }
    };
    return { root, author, sourcePlan, sourceDigest: sourcePlan.sourceDigest, outputs, candidates,
      verification, beforeAuthorHashes, afterAuthorHashes: authorHashes(sourcePlan, author),
      assertVerified,
      async serve(target, options) {
        if (!Object.hasOwn(candidates, target)) throw new Error('F5B3_INVALID_TARGET');
        await assertVerified();
        const server = await serveZip(candidates[target], target, trustedMembers[target], options);
        servers.push(server);
        return server;
      },
      cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
