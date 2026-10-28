import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';

const skillUrl = new URL('../../../.agents/skills/ludory-level-design/SKILL.md', import.meta.url);
const readSkill = () => fs.readFileSync(skillUrl, 'utf8').replace(/\r\n/g, '\n');

function wireFixtureGame(game, { bogus = false } = {}) {
  const files = [
    ['./fixtures/level-design-rules.mjs', 'src/level-rules.mjs'],
    ['./fixtures/level-design-entry.mjs', 'src/main.mjs'],
  ];
  if (bogus) files.push(
    ['./fixtures/level-design-bogus-solver.mjs', 'src/bogus-solver.mjs'],
    ['./fixtures/level-design-stub-check.mjs', 'tools/check-levels.mjs'],
  );
  for (const [source, output] of files) {
    const target = path.join(game, output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(new URL(source, import.meta.url), target);
  }
  const htmlPath = path.join(game, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const original = '<script defer src="src/main.js"></script>';
  assert.ok(html.includes(original));
  fs.writeFileSync(htmlPath, html.replace(original, '<script type="module" src="src/main.mjs"></script>'));
  // This explicitly modifies only the disposable new Studio test game.
}

function verifyIdentity(content) {
  const front = /^---\nname: ludory-level-design\ndescription: (Use when [^\n]+)\n---\n/.exec(content);
  assert.ok(front, 'discoverable repo-local frontmatter');
  assert.ok(front[1].length < 500);
  assert.match(front[1], /levels|level-based/i);
  assert.match(front[1], /solvab|softlock|progression/i);
  assert.ok(content.length < 16_000);
  assert.doesNotMatch(content, /\bceos\s+(?:context|continue|capability-challenge)\b|\.codex-os\b/i);
}

function verifyBoundary(content) {
  assert.match(content, /new Studio-created games only/i);
  assert.match(content, /approved level system/i);
  assert.match(content, /hasStudioCreationReceipt/);
  assert.match(content, /ludory\.studio\.json/);
  assert.match(content, /marker.*not independent attestation/i);
  assert.match(content, /frozen games.*(?:excluded|out of scope)/i);
  assert.match(content, /Review-only requests must not mutate game sources/i);
  assert.match(content, /separate.*authorization/i);
  assert.match(content, /no level system.*(?:do not invent|out of scope)/i);
  assert.match(content, /untrusted/i);
}

function verifyProof(content) {
  assert.match(content, /current authoritative transition/i);
  assert.match(content, /winning action (?:sequence|witness)/i);
  assert.match(content, /independent(?:ly)? replay/i);
  assert.match(content, /assert(?:ed)? (?:victory|win)/i);
  assert.match(content, /exhaustive.*finite.*(?:reachable|state)/i);
  assert.match(content, /frontier exhausted|checkable invariant/i);
  assert.match(content, /solver.*(?:exit|boolean).*not proof/i);
  assert.match(content, /timeout is not proof of impossibility/i);
  assert.match(content, /valid loss is not a softlock/i);
  assert.match(content, /same wrong rules|mismatched solver/i);
}

function verifyOutput(content) {
  for (const status of [
    'CONFIRMED_DEFECT', 'DESIGN_RISK', 'EVIDENCE_GAP', 'SOURCE_CHECKED',
    'BLOCKED_RUNTIME_EQUIVALENCE', 'NOT_RUN', 'Release PASS',
  ]) assert.ok(content.includes(status), `missing ${status}`);
  assert.match(content, /SHA-256/);
  assert.match(content, /revision|commit/i);
  assert.match(content, /(?:level ID|seed)/i);
  assert.match(content, /(?:solver|validator).*source/i);
  assert.match(content, /(?:sample|bounded).*(?:not|never).*all/i);
  assert.match(content, /player|device/i);
  assert.match(content, /not (?:a )?(?:Runtime|browser).*PASS/i);
}

test('level skill has narrow optional trigger and no legacy executor dependency', () => verifyIdentity(readSkill()));
test('level skill enforces Studio ownership, new-game level system and review-only default', () => verifyBoundary(readSkill()));
test('level skill requires independent winning proof and complete impossibility evidence', () => verifyProof(readSkill()));
test('level skill separates bounded source checks from runtime and Release acceptance', () => verifyOutput(readSkill()));

test('unsafe deletion of proof or authorization wording fails regression guards', () => {
  const content = readSkill();
  verifyBoundary(content);
  verifyProof(content);
  verifyOutput(content);
  assert.throws(() => verifyBoundary(content.replace('marker is not independent attestation', 'marker proves ownership')));
  assert.throws(() => verifyBoundary(content.replace('Review-only requests must not mutate game sources', 'Review-only requests may freely edit game sources')));
  assert.throws(() => verifyProof(content.replace('independent replay', 'solver assertion')));
  assert.throws(() => verifyProof(content.replace('timeout is not proof of impossibility', 'timeout confirms impossibility')));
  assert.throws(() => verifyProof(content.replace('valid loss is not a softlock', 'valid loss is a softlock')));
  assert.throws(() => verifyOutput(content.replaceAll('BLOCKED_RUNTIME_EQUIVALENCE', 'SOURCE_CHECKED')));
});

test('new Studio-created fixture has exact game-owned winning witness, finite impossible proof and legitimate loss', async t => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-level-skill-'));
  t.after(() => fs.rmSync(game, { recursive: true, force: true }));
  const plan = planCreate(game, {
    id: 'level-skill-case', title: 'Level fixture', lang: 'ru',
    version: '0.1.0', profile: 'web-game', template: 'web-basic',
    targets: ['yandex-games', 'vk-games'],
  });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  assert.ok(fs.existsSync(path.join(game, 'ludory.studio.json')));

  const rulesPath = path.join(game, 'src', 'level-rules.mjs');
  const fixturePath = new URL('./fixtures/level-design-rules.mjs', import.meta.url);
  wireFixtureGame(game);
  const rulesDigest = createHash('sha256').update(fs.readFileSync(rulesPath)).digest('hex');
  assert.match(rulesDigest, /^[a-f0-9]{64}$/);
  assert.equal(rulesDigest, createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'));
  // This added game-owned file is newer than the Studio creation receipt;
  // the fixture digest, not the original receipt, identifies its rule bytes.
  const { levels, initial, transition } = await import(pathToFileURL(rulesPath).href);
  assert.match(fs.readFileSync(path.join(game, 'index.html'), 'utf8'), /<script type="module" src="src\/main\.mjs"><\/script>/);
  const { playLevel } = await import(pathToFileURL(path.join(game, 'src', 'main.mjs')).href);

  // The positive witness is hand-derived and replayed against the actual
  // fixture transition function, not against the solver's mirrored model.
  let state = initial(levels.win);
  state = transition(levels.win, state, 'step');
  assert.deepEqual(state, { n: 1, locked: false, terminal: null });
  state = transition(levels.win, state, 'step');
  assert.deepEqual(state, { n: 2, locked: false, terminal: 'win' });
  assert.deepEqual(playLevel('win', ['step', 'step']), state, 'browser entrypoint uses exact game-owned transitions');

  // An alleged winning single step is disproved by the game transition;
  // a fake solver 'impossible' verdict is disproved by the witness above.
  assert.notEqual(transition(levels.win, initial(levels.win), 'step').terminal, 'win');

  const visited = new Set();
  const queue = [initial(levels.blocked)];
  let foundWin = false;
  while (queue.length) {
    const current = queue.shift();
    const key = JSON.stringify(current);
    if (visited.has(key)) continue;
    visited.add(key);
    if (current.terminal === 'win') foundWin = true;
    if (!current.terminal) for (const action of levels.blocked.actions) {
      queue.push(transition(levels.blocked, current, action));
    }
    assert.ok(visited.size <= 8, 'explicit bounded state space');
  }
  assert.equal(foundWin, false);
  assert.equal(queue.length, 0, 'frontier exhausted: valid finite impossibility witness');
  assert.equal(visited.size, 3, 'start, obstacle loss and explicit forfeit loss');
  const validLoss = transition(levels.win, initial(levels.win), 'forfeit');
  assert.equal(validLoss.terminal, 'lose', 'allowed terminal loss is not a softlock');
  const trapped = transition(levels.trap, initial(levels.trap), 'seal');
  const expectedTrapped = Object.freeze({ n: 0, locked: true, terminal: null });
  assert.deepEqual(trapped, expectedTrapped);
  for (const action of levels.trap.actions) {
    assert.deepEqual(transition(levels.trap, { ...trapped }, action), expectedTrapped,
      'reachable nonterminal no-progress state; unintended design must be established separately');
  }
});

test('executable zero-exit stub and mutually consistent wrong solver/preview are not a victory witness', async t => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-level-bogus-'));
  t.after(() => fs.rmSync(game, { recursive: true, force: true }));
  const plan = planCreate(game, {
    id: 'level-bogus-case', title: 'Bogus solver', lang: 'ru',
    version: '0.1.0', profile: 'web-game', template: 'web-basic',
    targets: ['yandex-games', 'vk-games'],
  });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  wireFixtureGame(game, { bogus: true });
  const rulesPath = path.join(game, 'src', 'level-rules.mjs');
  const appPath = path.join(game, 'src', 'main.mjs');
  const bogusPath = path.join(game, 'src', 'bogus-solver.mjs');
  const scriptPath = path.join(game, 'tools', 'check-levels.mjs');
  assert.match(fs.readFileSync(path.join(game, 'index.html'), 'utf8'), /src\/main\.mjs/);
  const { playLevel } = await import(pathToFileURL(appPath).href);
  const { solverTransition, previewTransition } = await import(pathToFileURL(bogusPath).href);
  assert.ok(fs.existsSync(rulesPath));

  const fake = spawnSync(process.execPath, [scriptPath], { cwd: game, encoding: 'utf8', timeout: 5_000 });
  assert.equal(fake.error, undefined, `child execution must be observed: ${fake.error?.message}`);
  assert.equal(fake.status, 0, fake.stderr);
  assert.match(fake.stdout, /100% solvable/i);
  assert.equal(solverTransition(0), 2);
  assert.equal(previewTransition(0), solverTransition(0), 'two wrong models agree');
  assert.deepEqual(playLevel('win', ['step']), { n: 1, locked: false, terminal: null },
    'game entrypoint rejects purported one-step victory');
  assert.deepEqual(playLevel('win', ['step', 'step']), { n: 2, locked: false, terminal: 'win' },
    'real winning witness disproves a false solver UNSAT verdict');
});
