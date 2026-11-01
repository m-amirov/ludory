import { ReleaseInputError } from './errors.mjs';

const YANDEX_POLICY = 'https://yandex.ru/dev/games/doc/ru/concepts/requirements';
const VK_POLICY = 'https://dev.vk.com/ru/games/settings/moderation';

const rule = (id, domain, evidenceMode, policyRef = null, severity = 'P1') =>
  Object.freeze({ id, domain, severity, required: true, evidenceMode, policyRef });

function pack(target, policyRef, sources, localSdkRule) {
  return Object.freeze({
    schemaVersion: 1, target, revision: '2026-11-01-p3a',
    sources: Object.freeze(sources.map(source => Object.freeze({ ...source }))),
    rules: Object.freeze([
      rule('archive', 'technical', 'LOCAL_ARCHIVE'),
      rule('build-receipt', 'technical', 'LOCAL_ARCHIVE'),
      rule(localSdkRule, 'technical', 'LOCAL_SDK_CONTRACT'),
      rule('media-declarations', 'rights', 'USER_DECLARED'),
      rule('listing-metadata', 'metadata', 'USER_DECLARED', policyRef),
      rule('promo-integrity', 'metadata', 'LOCAL_MEDIA', policyRef),
      rule('browser-observation', 'technical', 'BROWSER', policyRef),
      rule('visual-ux', 'visual', 'INDEPENDENT_REVIEW', policyRef),
      rule('content-review', 'content', 'INDEPENDENT_REVIEW', policyRef),
      rule('promo-review', 'content', 'INDEPENDENT_REVIEW', policyRef),
      rule('platform-policy', 'policy', 'OFFICIAL_PLATFORM', policyRef),
    ]),
  });
}

const PACKS = Object.freeze({
  'yandex-games': pack('yandex-games', YANDEX_POLICY, [
    { url: YANDEX_POLICY, checkedAt: '2026-11-01', verified: true },
    { url: 'https://yandex.ru/dev/games/doc/ru/concepts/moderation', checkedAt: '2026-11-01', verified: true },
  ], 'sdk-contract'),
  'vk-games': pack('vk-games', VK_POLICY, [
    { url: VK_POLICY, checkedAt: '2026-11-01', verified: false },
    { url: 'https://dev.vk.com/ru/mini-apps-rules', checkedAt: '2026-11-01', verified: false },
  ], 'bridge-contract'),
});

/** Pinned advisory criteria, never an official platform moderation decision. */
export function getModerationRulePack(target) {
  if (target !== 'yandex-games' && target !== 'vk-games') {
    throw new ReleaseInputError('QA_TARGET_INVALID', 'Unknown QA moderation target');
  }
  return PACKS[target];
}
