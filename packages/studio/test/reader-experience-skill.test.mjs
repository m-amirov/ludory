import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';

const skillUrl = new URL('../../../.agents/skills/ludory-reader-experience/SKILL.md', import.meta.url);
const readSkill = () => fs.readFileSync(skillUrl, 'utf8').replace(/\r\n/g, '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Canonical schema v1, exact fixed field order, UTF-8 bytes, LF and one terminal LF.
// PINNED_PACKET_SHA256 is deliberately a literal, not sha(CANONICAL_PACKET).
const CANONICAL_PACKET = '{\n' +
  '  "schemaVersion": 1,\n' +
  '  "locale": "ru",\n' +
  '  "visibleHistory": [\n' +
  '    "Вы остались у маяка после сигнала."\n' +
  '  ],\n' +
  '  "visiblePassages": [\n' +
  '    "Марина спрятала ключ под плащом.",\n' +
  '    "У причала второй раз погас свет."\n' +
  '  ],\n' +
  '  "visibleChoices": [\n' +
  '    "Спросить Марину о ключе",\n' +
  '    "Подойти к лодке"\n' +
  '  ],\n' +
  '  "questions": [\n' +
  '    "Что вам известно о причине отключения света?",\n' +
  '    "Что вы ожидаете после каждого выбора?"\n' +
  '  ]\n' +
  '}\n';
const PINNED_PACKET_SHA256 = '8de717929ba6c25ad64f091aad295b62255f75751de2ebc5b5f25b1f88801229';
const QUESTIONS = [
  'Что вам известно о причине отключения света?',
  'Что вы ожидаете после каждого выбора?',
];
const FIELDS = ['schemaVersion', 'locale', 'visibleHistory', 'visiblePassages', 'visibleChoices', 'questions'];

function encodeVisiblePacket(presented, questions = QUESTIONS) {
  // Test-only fixture encoder, NOT a Ludory public API or a native reader CLI.
  const packet = {
    schemaVersion: 1,
    locale: presented.locale,
    visibleHistory: [...presented.visibleHistory],
    visiblePassages: [...presented.visiblePassages],
    visibleChoices: [...presented.visibleChoices],
    questions: [...questions],
  };
  assert.deepEqual(Object.keys(packet), FIELDS);
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function assertCurrentBinding({ routeKey, locale, presented, sourceBytes, entryBytes, questions = QUESTIONS }, sealed) {
  // Test-only illustration of a fail-closed private ledger check. Not a shipped formatter/validator.
  assert.equal(routeKey, sealed.routeKey, 'mixed route requires new private binding');
  assert.equal(locale, sealed.locale, 'mixed locale requires new private binding');
  assert.equal(presented.locale, locale, 'reader packet locale differs from source selection');
  assert.equal(sha(sourceBytes), sealed.sourceSha256, 'stale scene source requires rebinding');
  assert.equal(sha(entryBytes), sealed.entrySha256, 'stale loaded entrypoint requires rebinding');
  assert.equal(sha(encodeVisiblePacket(presented, questions)), sealed.packetSha256,
    'reader-visible mutation requires new packet SHA-256');
}

function checkTrigger(text) {
  const match = /^---\nname: ludory-reader-experience\ndescription: (Use when [^\n]+)\n---\n/.exec(text);
  assert.ok(match, 'repo-native narrow first-pass trigger');
  assert.ok(match[1].length < 500);
  assert.match(match[1], /explicit/i);
  assert.match(match[1], /first.pass|unprimed|cold.read/i);
  assert.match(match[1], /new.*Studio.*narrative/i);
  assert.match(text, /(?:generic.*(?:script|narrative)|romance.*(?:does not|not an)|do not activate).*\b(?:not|no|does not)\b/i);
  assert.ok(text.length < 17_000);
  assert.doesNotMatch(text, /\bceos\s+(?:context|continue|capability-challenge)\b|\.codex-os\b/i);
}

function checkSafety(text) {
  assert.match(text, /read-only by default/i);
  assert.match(text, /separate (?:explicit )?authorization/i);
  assert.match(text, /ludory\.studio\.json/);
  assert.match(text, /marker is not independent proof/i);
  assert.match(text, /(?:frozen CEOS.*Starter Kit|frozen CEOS\/Starter Kit)/i);
  assert.match(text, /ludory-narrative-review/);
  assert.match(text, /ludory-narrative-continuity/);
  assert.match(text, /(?:no duplicate|do not).*Web.*review/i);
  assert.match(text, /(?:no auto|do not).*\b(?:write|persist|archive)\b/i);
  assert.match(text, /(?:no|do not).*\b(?:recruit|contact|paid)\b/i);
  assert.match(text, /(?:source|game).*\b(?:untrusted|not authority)\b/i);
}

function checkPacket(text) {
  assert.match(text, /schemaVersion.*locale.*visibleHistory.*visiblePassages.*visibleChoices.*questions/s);
  assert.match(text, /UTF-8.*LF.*(?:no BOM|without BOM)/i);
  assert.match(text, /SHA-256.*(?:exact|entire).*packet.*bytes/i);
  assert.match(text, /including questions and history/i);
  assert.match(text, /reader-facing.*(?:only|whitelist)/i);
  assert.match(text, /private provenance ledger/i);
  for (const secret of ['internal route', 'source SHA', 'canon', 'spoiler', 'expected answer']) {
    assert.match(text, new RegExp(secret.replace(' ', '[ -]'), 'i'), `protect ${secret}`);
  }
  assert.match(text, /(?:mixed|stale).*locale|locale.*(?:mixed|stale)/i);
  assert.match(text, /(?:mixed|stale).*route|route.*(?:mixed|stale)/i);
  assert.match(text, /source-only.*episode-script.*entrypoint is.*not required/is,
    'declarative drafts may prepare unsent packets without claiming runnable gameplay');
  assert.match(text, /If claiming.*player-visible.*loaded entrypoint/is,
    'playable-route proof still requires actual loaded game source');
}

function checkEvidence(text) {
  for (const label of [
    'PACKET_PREPARED', 'READER_FIRST_PASS_OBSERVED', 'READER_PROVENANCE_UNVERIFIED',
    'ORDER_CONDITIONED_FEEDBACK', 'NOT_RUN', 'DECLARATIVE_ONLY',
    'BLOCKED_RUNTIME_EQUIVALENCE', 'NOT_APPLICABLE', 'OBSERVED_READER_RESPONSE',
    'COMPREHENSION_RISK', 'EDITORIAL_PREFERENCE', 'INTENTIONAL_CHOICE', 'EVIDENCE_GAP', 'Release PASS',
  ]) assert.ok(text.includes(label), `missing ${label}`);
  assert.match(text, /(?:owner-pasted|pasted owner|pasted notes).*READER_PROVENANCE_UNVERIFIED/is);
  assert.match(text, /(?:Web.*ACCEPT|ACCEPT.*Web).*not.*(?:reader|first.pass|blind)/is);
  assert.match(text, /(?:model.*human|impersonat).*not.*(?:reader|human|first.pass)/is);
  assert.match(text, /(?:consent).*packet SHA-256.*(?:before|sequence)|packet SHA-256.*(?:before|sequence).*consent/is);
  assert.match(text, /(?:second route|route B).*ORDER_CONDITIONED_FEEDBACK/is);
  assert.match(text, /open (?:ending|mystery)/i);
  assert.match(text, /(?:no.*automatic.*rewrite|not.*automatically.*rewrite)/i);
  assert.match(text, /(?:synthetic.*not.*real|synthetic.*not.*human)/i);
}

test('skill trigger is discoverable and explicitly opt-in only for authorized new Studio narratives', () => checkTrigger(readSkill()));
test('skill preserves frozen-game ownership, review, read-only and privacy boundaries', () => checkSafety(readSkill()));
test('skill binds separate reproducible reader-only packets and a private spoiler ledger', () => checkPacket(readSkill()));
test('skill does not launder Web/AI/notes as blind readers or release acceptance', () => checkEvidence(readSkill()));

test('removing safeguards causes negative contract regressions', () => {
  const skill = readSkill();
  assert.throws(() => checkSafety(skill.replace('marker is not independent proof', 'marker establishes proof')));
  assert.throws(() => checkSafety(skill.replace('read-only by default', 'may edit source by default')));
  assert.throws(() => checkPacket(skill.replace('private provenance ledger', 'public ledger')));
  assert.throws(() => checkEvidence(skill.replaceAll('READER_PROVENANCE_UNVERIFIED', 'NOT_RUN')));
  assert.throws(() => checkEvidence(skill.replaceAll('ORDER_CONDITIONED_FEEDBACK', 'READER_FIRST_PASS_OBSERVED')));
  assert.throws(() => checkEvidence(skill.replaceAll('BLOCKED_RUNTIME_EQUIVALENCE', 'SOURCE_CHECKED')));
});

async function createDisposableGame(t) {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-reader-experience-'));
  t.after(() => fs.rmSync(game, { recursive: true, force: true }));
  const plan = planCreate(game, {
    id: 'reader-experience-test', title: 'Synthetic blind-reader fixture', lang: 'ru',
    version: '0.1.0', profile: 'narrative-game', template: 'narrative-basic', targets: ['yandex-games'],
  });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  for (const file of ['reader-experience-scene.mjs', 'reader-experience-entry.mjs']) {
    const dest = path.join(game, 'src', file);
    fs.copyFileSync(new URL(`./fixtures/${file}`, import.meta.url), dest);
  }
  const entryPath = path.join(game, 'src/reader-experience-entry.mjs');
  const htmlPath = path.join(game, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('<script defer src="src/main.js"></script>'));
  fs.writeFileSync(htmlPath, html.replace('<script defer src="src/main.js"></script>',
    '<script type="module" src="src/reader-experience-entry.mjs"></script>'));
  assert.match(fs.readFileSync(entryPath, 'utf8'), /from '\.\/reader-experience-scene\.mjs'/);
  assert.match(fs.readFileSync(entryPath, 'utf8'), /if \(typeof document !== 'undefined'\) mountStory\(document\)/,
    'the loaded browser entrypoint invokes the DOM renderer');
  assert.match(fs.readFileSync(htmlPath, 'utf8'), /src="src\/reader-experience-entry\.mjs"/);
  for (const file of ['scene.mjs', 'entry.mjs']) {
    assert.equal(sha(fs.readFileSync(path.join(game, 'src', `reader-experience-${file}`))),
      sha(fs.readFileSync(new URL(`./fixtures/reader-experience-${file}`, import.meta.url))));
  }
  return game;
}

test('Studio narrative fixture has reproducible canonical player-visible packet, pinned bytes and private data separation', async t => {
  const game = await createDisposableGame(t);
  const { getPresentedRoute, mountStory } = await import(pathToFileURL(path.join(game, 'src/reader-experience-entry.mjs')).href);
  const { getRouteData } = await import(pathToFileURL(path.join(game, 'src/reader-experience-scene.mjs')).href);
  const played = getPresentedRoute('shore', 'ru');
  const doc = {
    querySelector: selector => selector === 'main' ? { replaceChildren(...children) { doc.shown = children; } } : null,
    createElement: tag => ({ tag, textContent: '' }),
    shown: [],
  };
  assert.deepEqual(mountStory(doc), played, 'source-only loaded entrypoint exposes selected player words');
  assert.deepEqual(doc.shown.map(node => node.textContent),
    [...played.visibleHistory, ...played.visiblePassages, ...played.visibleChoices]);

  const readerBytes = encodeVisiblePacket(played);
  assert.deepEqual(readerBytes, Buffer.from(CANONICAL_PACKET, 'utf8'), 'literal canonical bytes pin ordering and Unicode');
  assert.equal(sha(readerBytes), PINNED_PACKET_SHA256, 'digest is independently pinned');
  assert.equal(readerBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, 'no BOM');
  assert.ok(!readerBytes.toString('utf8').includes('\r'), 'LF only');
  assert.deepEqual(Object.keys(JSON.parse(readerBytes.toString('utf8'))), FIELDS);

  const internalRoute = getRouteData('shore', 'ru');
  const privateProvenanceLedger = {
    internalRouteId: internalRoute.internalRouteId,
    hiddenFlag: internalRoute.isTraitor,
    authorCanon: internalRoute.authorCanon,
    gameRevision: 'synthetic-source-only-fixture',
    routeSourceSha256: sha(fs.readFileSync(path.join(game, 'src/reader-experience-scene.mjs'))),
    entrySourceSha256: sha(fs.readFileSync(path.join(game, 'src/reader-experience-entry.mjs'))),
    packetSha256: PINNED_PACKET_SHA256,
    proofBasis: 'DECLARATIVE_ONLY',
    runtimeEquivalence: 'BLOCKED_RUNTIME_EQUIVALENCE',
  };
  assert.equal(privateProvenanceLedger.internalRouteId, 'betrayal-ending');
  assert.equal(privateProvenanceLedger.hiddenFlag, true);
  assert.ok(privateProvenanceLedger.authorCanon.includes('Marina caused'));
  assertCurrentBinding({
    routeKey: 'shore', locale: 'ru', presented: played,
    sourceBytes: fs.readFileSync(path.join(game, 'src/reader-experience-scene.mjs')),
    entryBytes: fs.readFileSync(path.join(game, 'src/reader-experience-entry.mjs')),
  }, {
    routeKey: 'shore', locale: 'ru',
    sourceSha256: privateProvenanceLedger.routeSourceSha256,
    entrySha256: privateProvenanceLedger.entrySourceSha256,
    packetSha256: PINNED_PACKET_SHA256,
  });
  for (const secret of [privateProvenanceLedger.internalRouteId, 'isTraitor', 'Marina caused',
    privateProvenanceLedger.routeSourceSha256, privateProvenanceLedger.entrySourceSha256]) {
    assert.ok(!readerBytes.toString('utf8').includes(secret), `private value leaked: ${secret}`);
  }
});

test('any visible words, choices, history, question or locale mutation invalidates packet identity', async t => {
  const game = await createDisposableGame(t);
  const { getPresentedRoute } = await import(pathToFileURL(path.join(game, 'src/reader-experience-entry.mjs')).href);
  const base = getPresentedRoute('shore', 'ru');
  const currentHash = sha(encodeVisiblePacket(base));
  const sourcePath = path.join(game, 'src/reader-experience-scene.mjs');
  const entryPath = path.join(game, 'src/reader-experience-entry.mjs');
  const sealed = {
    routeKey: 'shore', locale: 'ru',
    sourceSha256: sha(fs.readFileSync(sourcePath)),
    entrySha256: sha(fs.readFileSync(entryPath)), packetSha256: currentHash,
  };
  const verify = (presented, options = {}) => assertCurrentBinding({
    routeKey: options.routeKey ?? 'shore', locale: options.locale ?? 'ru', presented,
    sourceBytes: fs.readFileSync(sourcePath), entryBytes: fs.readFileSync(entryPath),
    questions: options.questions ?? QUESTIONS,
  }, sealed);
  assert.doesNotThrow(() => verify(base));
  const changes = [
    [{ ...base, visiblePassages: ['Свет горел.', ...base.visiblePassages] }, QUESTIONS],
    [{ ...base, visibleChoices: ['Уйти', ...base.visibleChoices] }, QUESTIONS],
    [{ ...base, visibleHistory: ['Вы приехали вчера.'] }, QUESTIONS],
    [base, ['Почему Марина виновата?']],
    [{ ...base, locale: 'en' }, QUESTIONS],
    [getPresentedRoute('library', 'ru'), QUESTIONS],
  ];
  for (const [presented, questions] of changes) {
    assert.notEqual(sha(encodeVisiblePacket(presented, questions)), currentHash);
    assert.throws(() => verify(presented, { locale: presented.locale, questions }),
      'stale/mixed packet cannot pass sealed binding even with plausible prose');
  }
  assert.throws(() => getPresentedRoute('shore', 'en'), /Unsupported route\/locale/);
  assert.throws(() => getPresentedRoute('unknown', 'ru'), /Unsupported route\/locale/);
  const mixedRoute = { ...base, visibleChoices: getPresentedRoute('library', 'ru').visibleChoices };
  assert.notEqual(sha(encodeVisiblePacket(mixedRoute)), currentHash, 'mixed route must not reuse sealed packet hash');
  assert.notEqual(sha(encodeVisiblePacket({ ...base, locale: 'en' })), currentHash, 'mixed locale cannot reuse identity');
  assert.throws(() => verify(base, { routeKey: 'library' }), 'private route binding cannot be borrowed');
  const frozenSourceHash = sha(fs.readFileSync(sourcePath));
  fs.appendFileSync(sourcePath, '\n// synthetic source-revision mutation; no change to reader text\n');
  assert.notEqual(sha(fs.readFileSync(sourcePath)), frozenSourceHash,
    'stale private source identity must be invalidated even if previously serialized reader text is unchanged');
  assert.equal(sha(encodeVisiblePacket(base)), currentHash,
    'a matching packet hash alone must not be used to attest current source revision');
  assert.throws(() => verify(base), 'stale private source digest fails closed even with same exact reader packet bytes');
});

function evaluateSyntheticProvenance(record, expectedHash) {
  // Tests evidence protocol semantics only; cannot authenticate a real reader.
  if (!record) return { packet: 'PACKET_PREPARED', firstPass: 'NOT_RUN' };
  const valid = record.consent === true && record.method === 'observer-captured-first-pass' &&
    record.captureOrigin === 'independently-observed' &&
    record.packetSha256 === expectedHash && record.independentExposure === true &&
    record.readerKind === 'human-observed' && record.authorBriefSeenBeforeAnswers === false &&
    Number.isFinite(record.packetShownAt) && Number.isFinite(record.answersCapturedAt) &&
    Number.isFinite(record.authorContextShownAt) &&
    record.packetShownAt < record.answersCapturedAt &&
    record.answersCapturedAt < record.authorContextShownAt &&
    Array.isArray(record.originalNotes) && record.originalNotes.length > 0;
  if (!valid) return { packet: 'PACKET_PREPARED', firstPass: 'READER_PROVENANCE_UNVERIFIED' };
  if (record.priorRouteExposure) return { packet: 'PACKET_PREPARED', firstPass: 'ORDER_CONDITIONED_FEEDBACK' };
  return { packet: 'PACKET_PREPARED', firstPass: 'READER_FIRST_PASS_OBSERVED' };
}

test('synthetic protocol attestation passes bounded sequence but does NOT represent a real human session', () => {
  const synthetic = {
    consent: true, method: 'observer-captured-first-pass', readerKind: 'human-observed',
    captureOrigin: 'independently-observed',
    packetSha256: PINNED_PACKET_SHA256, independentExposure: true,
    packetShownAt: 100, answersCapturedAt: 120, authorContextShownAt: 200,
    authorBriefSeenBeforeAnswers: false, originalNotes: ['Я не знаю, почему погас свет.'],
    priorRouteExposure: false,
  };
  assert.deepEqual(evaluateSyntheticProvenance(null, PINNED_PACKET_SHA256),
    { packet: 'PACKET_PREPARED', firstPass: 'NOT_RUN' });
  assert.deepEqual(evaluateSyntheticProvenance(synthetic, PINNED_PACKET_SHA256),
    { packet: 'PACKET_PREPARED', firstPass: 'READER_FIRST_PASS_OBSERVED' });
  assert.equal(evaluateSyntheticProvenance({ ...synthetic, packetSha256: 'stale' }, PINNED_PACKET_SHA256).firstPass,
    'READER_PROVENANCE_UNVERIFIED');
  assert.equal(evaluateSyntheticProvenance({ ...synthetic, method: 'owner-pasted-notes' }, PINNED_PACKET_SHA256).firstPass,
    'READER_PROVENANCE_UNVERIFIED');
  assert.equal(evaluateSyntheticProvenance({ ...synthetic, readerKind: 'AI-says-I-am-human' }, PINNED_PACKET_SHA256).firstPass,
    'READER_PROVENANCE_UNVERIFIED');
  assert.equal(evaluateSyntheticProvenance({ ...synthetic, captureOrigin: 'model-simulated-human' }, PINNED_PACKET_SHA256).firstPass,
    'READER_PROVENANCE_UNVERIFIED');
  assert.equal(evaluateSyntheticProvenance({ ...synthetic, authorBriefSeenBeforeAnswers: true }, PINNED_PACKET_SHA256).firstPass,
    'READER_PROVENANCE_UNVERIFIED');
  assert.equal(evaluateSyntheticProvenance({ ...synthetic, authorContextShownAt: 115 }, PINNED_PACKET_SHA256).firstPass,
    'READER_PROVENANCE_UNVERIFIED');
  assert.equal(evaluateSyntheticProvenance({ ...synthetic, priorRouteExposure: true }, PINNED_PACKET_SHA256).firstPass,
    'ORDER_CONDITIONED_FEEDBACK');
  const webEditorial = { source: 'Web DEV', verdict: 'ACCEPT', reviewerSawCanon: true };
  assert.equal(evaluateSyntheticProvenance(webEditorial, PINNED_PACKET_SHA256).firstPass,
    'READER_PROVENANCE_UNVERIFIED');
});
