import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runCli } from '../src/cli.mjs';

function cli(...argv) {
  let stdout = '', stderr = '';
  const code = runCli(argv, { out: text => { stdout += text; }, err: text => { stderr += text; } });
  return { code, stdout, stderr };
}

function game(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-cli-route-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const response = cli('create', '--project', project, '--id', 'task-router-game', '--title', 'Routing',
    '--lang', 'en', '--profile', 'web-game', '--template', 'web-basic',
    '--targets', 'yandex-games', '--apply', '--json');
  assert.equal(response.code, 0, response.stderr);
  return project;
}

function snapshot(project) {
  return fs.readdirSync(project, { recursive: true }).sort().map(relative => {
    const full = path.join(project, relative);
    if (fs.statSync(full).isDirectory()) return `${relative}/`;
    return `${relative}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`;
  });
}

test('workflow route advertises the five approved tasks and does not mutate a fresh Git-free game', t => {
  const project = game(t);
  const before = snapshot(project);
  const expected = ['mechanics', 'episode-script', 'art-concept', 'image', 'functional-check'];
  assert.match(cli('help').stdout, /workflow route --project/);
  for (const taskKind of expected) {
    const response = cli('workflow', 'route', '--project', project, '--task', taskKind, '--json');
    assert.equal(response.code, 0, response.stderr);
    const plan = JSON.parse(response.stdout);
    assert.equal(plan.taskKind, taskKind);
    assert.equal(plan.operation, 'route');
    assert.deepEqual(plan.writes, []);
    assert.equal(plan.nextAction.executable, false);
    if (taskKind === 'image') {
      assert.equal(plan.status, 'NEEDS_AGENT_ACTION');
      assert.equal(plan.selectedRoute, 'codex-imagegen');
    } else if (['episode-script', 'art-concept'].includes(taskKind)) {
      assert.equal(plan.status, 'NEEDS_USER_ACTION');
      assert.equal(plan.selectedRoute, 'manual');
    }
  }
  assert.deepEqual(snapshot(project), before);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  assert.equal(fs.existsSync(path.join(project, '.git')), false);
});

test('workflow route fails closed on unknown flags, tasks and illegal model pins', t => {
  const project = game(t);
  const base = ['workflow', 'route', '--project', project, '--json'];
  for (const args of [
    ['--task', 'mechanics', '--apply'],
    ['--task', 'mechanics', '--model', 'terra'],
    ['--task', 'art-concept', '--executor', 'codex'],
    ['--task', 'arbitrary'],
    ['--task', 'image', '--model', 'unlisted'],
    ['--task', 'image', '--task', 'image'],
    ['--model', 'auto'],
  ]) {
    const response = cli(...base, ...args);
    assert.equal(response.code, 1, JSON.stringify(args));
    assert.equal(JSON.parse(response.stdout).status, 'FAILED');
  }
});

test('workflow route provides built-in ImageGen handoff without selecting an API model', t => {
  const project = game(t);
  const response = cli('workflow', 'route', '--project', project, '--task', 'image', '--json');
  assert.equal(response.code, 0, response.stderr);
  const plan = JSON.parse(response.stdout);
  assert.equal(plan.requestedModel, 'auto');
  assert.equal(plan.status, 'NEEDS_AGENT_ACTION');
  assert.equal(plan.selectedRoute, 'codex-imagegen');
  assert.equal(plan.reasonCode, 'IMAGEGEN_SKILL_HANDOFF');
  assert.equal(plan.modelSelection, 'provider-default');
  assert.equal(plan.modelObserved, null);
  const printed = cli('workflow', 'route', '--project', project, '--task', 'image');
  assert.equal(printed.code, 0);
  assert.match(printed.stdout, /CALL_IMAGEGEN_SKILL/);
  const pinnedText = cli('workflow', 'route', '--project', project, '--task', 'image', '--model', 'terra');
  assert.equal(pinnedText.code, 1);
});

test('workflow route returns a blocker for a frozen game without updating its files', t => {
  const project = game(t);
  fs.unlinkSync(path.join(project, 'ludory.studio.json'));
  const before = snapshot(project);
  const response = cli('workflow', 'route', '--project', project, '--task', 'episode-script', '--json');
  assert.equal(response.code, 2);
  assert.equal(JSON.parse(response.stdout).reasonCode, 'AI_ROUTING_STUDIO_GAME_REQUIRED');
  assert.deepEqual(snapshot(project), before);
});
