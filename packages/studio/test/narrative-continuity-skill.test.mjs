import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';

const skillUrl = new URL('../../../.agents/skills/ludory-narrative-continuity/SKILL.md', import.meta.url);
const readSkill = () => fs.readFileSync(skillUrl, 'utf8').replace(/\r\n/g, '\n');

function checkIdentity(text) {
  const match = /^---\nname: ludory-narrative-continuity\ndescription: (Use when [^\n]+)\n---\n/.exec(text);
  assert.ok(match, 'discoverable repo-native narrative-continuity trigger');
  assert.ok(match[1].length < 500);
  assert.match(match[1], /route|branch/i);
  assert.match(match[1], /narrative|story/i);
  assert.match(match[1], /new.*Studio/i);
  assert.ok(text.length < 16_000);
  assert.doesNotMatch(text, /\bceos\s+(?:context|continue|capability-challenge)\b|\.codex-os\b/i);
}

function checkBoundaries(text) {
  assert.match(text, /optional.*(?:opt-in|explicitly narrative)/i);
  assert.match(text, /new Studio-created narrative game/i);
  assert.match(text, /actual.*game-owned.*(?:route|transition)/i);
  assert.match(text, /ludory\.studio\.json/);
  assert.match(text, /marker is not independent (?:proof|attestation)/i);
  assert.match(text, /(?:frozen.*(?:excluded|out of scope)|frozen games.*read-only reference)/i);
  assert.match(text, /read-only by default/i);
  assert.match(text, /separate.*authorization/i);
  assert.match(text, /scene list.*(?:insufficient|not enough)/i);
  assert.match(text, /untrusted/i);
  assert.match(text, /ludory-narrative-review/);
  assert.match(text, /(?:no duplicate|do not initiate).*Web.*review/i);
  assert.match(text, /(?:no universal|do not invent).*narrative-graph/i);
}

function checkProof(text) {
  assert.match(text, /actual.*(?:loaded|current).*entrypoint/i);
  assert.match(text, /SHA-256/);
  assert.match(text, /current.*(?:revision|commit)/i);
  assert.match(text, /author-approved canon/i);
  assert.match(text, /game-owned.*transition/i);
  assert.match(text, /replay.*(?:legal|concrete).*choices/i);
  assert.match(text, /(?:assert|verify).*reachable state/i);
  assert.match(text, /(?:decoy|unimported).*model/i);
  assert.match(text, /(?:zero-exit|exit 0|zero exit).*not.*proof/i);
  assert.match(text, /(?:shared-wrong|same wrong).*rules/i);
  assert.match(text, /exhaustive.*finite.*state/i);
  assert.match(text, /frontier exhausted|checkable invariant/i);
  assert.match(text, /(?:timeout|cap|cutoff).*not.*(?:proof|impossibility)/i);
}

function checkVerdicts(text) {
  for (const label of [
    'CONFIRMED_DEFECT', 'EDITORIAL_RISK', 'INTENTIONAL_CHOICE', 'EVIDENCE_GAP',
    'SOURCE_CHECKED', 'DECLARATIVE_ONLY', 'BLOCKED_RUNTIME_EQUIVALENCE',
    'NOT_RUN', 'NOT_APPLICABLE', 'Release PASS',
  ]) assert.ok(text.includes(label), `missing ${label}`);
  assert.match(text, /(?:flashback|time skip)/i);
  assert.match(text, /open (?:ending|mystery)/i);
  assert.match(text, /(?:Back|save).*not implemented|(?:Back|save).*not applicable/i);
  assert.match(text, /(?:browser|device|host).*not.*(?:proven|established|PASS)/i);
  assert.match(text, /(?:one route|bounded sample).*(?:not|never).*all/i);
  assert.match(text, /(?:unexamined|untested).*routes/i);
}

test('skill is discoverable and has a narrow narrative trigger', () => checkIdentity(readSkill()));
test('skill preserves authorization, frozen-game, review and native CLI boundaries', () => checkBoundaries(readSkill()));
test('skill demands game-owned execution and complete proof for global claims', () => checkProof(readSkill()));
test('skill keeps editorial, source, runtime and release evidence separate', () => checkVerdicts(readSkill()));

test('deleting evidence and authorization safeguards triggers negative contract tests', () => {
  const text = readSkill();
  assert.throws(() => checkBoundaries(text.replace('marker is not independent proof', 'marker establishes ownership')));
  assert.throws(() => checkBoundaries(text.replace(/read-only by default/gi, 'may edit games by default')));
  assert.throws(() => checkProof(text.replace(/frontier exhausted|checkable invariant/gi, 'search abandoned')));
  assert.throws(() => checkProof(text.replace(/zero-exit is not proof/gi, 'zero-exit proves success')));
  assert.throws(() => checkVerdicts(text.replaceAll('BLOCKED_RUNTIME_EQUIVALENCE', 'SOURCE_CHECKED')));
});

function installNarrativeFixture(game, { decoy = false } = {}) {
  const files = [
    ['narrative-continuity-rules.mjs', 'src/story-rules.mjs'],
    ['narrative-continuity-entry.mjs', 'src/main.mjs'],
  ];
  if (decoy) files.push(
    ['narrative-continuity-decoy.mjs', 'src/decoy-solver.mjs'],
    ['narrative-continuity-fake-check.mjs', 'tools/check-narrative.mjs'],
  );
  for (const [fixtureName, targetName] of files) {
    const target = path.join(game, targetName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(new URL(`./fixtures/${fixtureName}`, import.meta.url), target);
  }
  const htmlPath = path.join(game, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('<script defer src="src/main.js"></script>'));
  fs.writeFileSync(htmlPath, html.replace('<script defer src="src/main.js"></script>',
    '<script type="module" src="src/main.mjs"></script>'));
}

function createIsolatedGame(t, decoy) {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-narrative-skill-'));
  t.after(() => fs.rmSync(game, { recursive: true, force: true }));
  const plan = planCreate(game, {
    id: 'narrative-skill-case', title: 'Narrative fixture', lang: 'ru',
    version: '0.1.0', profile: 'narrative-game', template: 'narrative-basic',
    targets: ['yandex-games', 'vk-games'],
  });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  assert.ok(fs.existsSync(path.join(game, 'ludory.studio.json')));
  installNarrativeFixture(game, { decoy });
  return game;
}

test('Studio game loads exact guarded transitions: factual route versus reachable contradiction', async t => {
  const game = createIsolatedGame(t, false);
  const rulesPath = path.join(game, 'src/story-rules.mjs');
  const entryPath = path.join(game, 'src/main.mjs');
  const expectedHash = createHash('sha256').update(fs.readFileSync(new URL('./fixtures/narrative-continuity-rules.mjs', import.meta.url))).digest('hex');
  const digest = createHash('sha256').update(fs.readFileSync(rulesPath)).digest('hex');
  assert.equal(digest, expectedHash, 'actual game rule bytes bound to pinned source');
  assert.match(digest, /^[a-f0-9]{64}$/);
  const entryDigest = createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex');
  const expectedEntryDigest = createHash('sha256').update(fs.readFileSync(new URL('./fixtures/narrative-continuity-entry.mjs', import.meta.url))).digest('hex');
  assert.equal(entryDigest, expectedEntryDigest, 'loaded entrypoint bytes match the fixture that was staged');
  assert.match(entryDigest, /^[a-f0-9]{64}$/);
  assert.match(fs.readFileSync(path.join(game, 'index.html'), 'utf8'), /<script type="module" src="src\/main\.mjs"><\/script>/);
  assert.match(fs.readFileSync(entryPath, 'utf8'), /from '\.\/story-rules\.mjs'/);
  const { initialStory, transition, spokenLine, legalActions } = await import(pathToFileURL(rulesPath).href);
  const { playRoute, mountStory } = await import(pathToFileURL(entryPath).href);

  let known = transition(initialStory(), 'decode');
  assert.deepEqual(known, { scene: 'archive', knowsMap: true, terminal: null });
  known = transition(known, 'reveal');
  assert.deepEqual(known, { scene: 'revelation', knowsMap: true, terminal: 'end' });
  assert.deepEqual(playRoute(['decode', 'reveal']), { state: known, line: spokenLine(known) });

  let contradiction = transition(initialStory(), 'skip');
  assert.deepEqual(contradiction, { scene: 'archive', knowsMap: false, terminal: null });
  contradiction = transition(contradiction, 'reveal');
  assert.deepEqual(contradiction, { scene: 'revelation', knowsMap: false, terminal: 'end' });
  assert.equal(playRoute(['skip', 'reveal']).state.knowsMap, false);
  assert.match(spokenLine(contradiction), /I decoded the map/i);
  assert.deepEqual(legalActions(contradiction), []);
  assert.throws(() => transition(initialStory(), 'reveal'), /Illegal action/);

  const withheld = playRoute(['withhold']);
  assert.deepEqual(withheld.state, { scene: 'mystery', knowsMap: false, terminal: 'open-ending' });
  assert.doesNotMatch(withheld.line, /I decoded/i, 'intentional withheld information is not a defect');
  const flashback = playRoute(['remember']);
  assert.equal(flashback.state.scene, 'flashback');
  assert.match(flashback.line, /Years earlier/);
  assert.deepEqual(playRoute(['remember', 'return']).state, initialStory(), 'intentional flashback returns to original gate');
  assert.equal('save' in (await import(pathToFileURL(rulesPath).href)), false, 'optional save implementation absent');

  // Source-only DOM harness: the actually loaded entrypoint must connect legal
  // player choices to the same game-owned transition, not only export a helper.
  const stage = { children: [], replaceChildren(...nodes) { this.children = nodes; } };
  const fakeDoc = {
    querySelector(selector) { return selector === 'main' ? stage : null; },
    createElement(tag) {
      return { tag, textContent: '', type: null, handlers: new Map(),
        addEventListener(event, handler) { this.handlers.set(event, handler); } };
    },
  };
  const getMountedState = mountStory(fakeDoc);
  const click = action => {
    const button = stage.children.find(node => node.tag === 'button' && node.textContent === action);
    assert.ok(button, `player action ${action} is rendered`);
    button.handlers.get('click')();
  };
  click('skip');
  click('reveal');
  assert.deepEqual(getMountedState(), contradiction, 'player route uses imported game-owned transition');
  assert.ok(stage.children.some(node => node.tag === 'p' && /I decoded the map/.test(node.textContent)));
});

test('zero-exit check and correlated decoy models cannot establish real game-route truth', async t => {
  const game = createIsolatedGame(t, true);
  const { playRoute } = await import(pathToFileURL(path.join(game, 'src/main.mjs')).href);
  const { solverTransition, previewTransition } = await import(pathToFileURL(path.join(game, 'src/decoy-solver.mjs')).href);
  for (const [actualName, fixtureName] of [
    ['src/decoy-solver.mjs', 'narrative-continuity-decoy.mjs'],
    ['tools/check-narrative.mjs', 'narrative-continuity-fake-check.mjs'],
  ]) {
    const actualDigest = createHash('sha256').update(fs.readFileSync(path.join(game, actualName))).digest('hex');
    const fixtureDigest = createHash('sha256').update(fs.readFileSync(new URL(`./fixtures/${fixtureName}`, import.meta.url))).digest('hex');
    assert.equal(actualDigest, fixtureDigest, `decoy/checker source bytes pinned: ${actualName}`);
  }
  const result = spawnSync(process.execPath, [path.join(game, 'tools/check-narrative.mjs')], {
    cwd: game, encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(result.error, undefined, `observed child result: ${result.error?.message}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /100% narrative routes consistent/i);
  assert.deepEqual(solverTransition('skip'), previewTransition('skip'), 'two incorrect models agree');
  assert.equal(solverTransition('skip').knowsMap, true);
  assert.equal(playRoute(['skip', 'reveal']).state.knowsMap, false, 'actual loaded route disproves solver claim');
});

test('bounded search cutoff cannot masquerade as exhaustive continuity verification', async t => {
  const game = createIsolatedGame(t, false);
  const { initialStory, legalActions, transition } = await import(pathToFileURL(path.join(game, 'src/story-rules.mjs')).href);
  const all = [{ state: initialStory(), trace: [] }];
  const visited = new Set();
  let foundContradiction = false;
  while (all.length) {
    const node = all.shift();
    const key = JSON.stringify(node.state);
    if (visited.has(key)) continue;
    visited.add(key);
    if (node.state.scene === 'revelation' && !node.state.knowsMap) {
      assert.deepEqual(node.trace, ['skip', 'reveal']);
      foundContradiction = true;
    }
    for (const action of legalActions(node.state)) {
      all.push({ state: transition(node.state, action), trace: [...node.trace, action] });
    }
    assert.ok(visited.size <= 12, 'fixture declares a genuinely finite state graph');
  }
  assert.equal(all.length, 0, 'frontier was exhausted');
  assert.equal(visited.size, 7, 'all unique reachable fixture states visited');
  assert.equal(foundContradiction, true);
  const capped = new Set([JSON.stringify(initialStory())]);
  assert.ok(capped.size < visited.size, 'a one-state sample is not comprehensive evidence');
});
