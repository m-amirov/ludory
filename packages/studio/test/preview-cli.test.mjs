import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { newStudioAiProject } from '../../ai/test/helpers/project.mjs';

async function cli(args, signal) {
  let stdout = '', stderr = '';
  const exitCode = await runCli(args, { out: text => { stdout += text; },
    err: text => { stderr += text; }, previewSignal: signal });
  return { exitCode, stdout, stderr, result: stdout.startsWith('{') ? JSON.parse(stdout) : null };
}

test('preview CLI starts a fresh loopback build and shuts down on AbortSignal', async t => {
  const project = newStudioAiProject(t, { git: false });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const created = await cli(['preview', '--project', project, '--port', '0', '--json'], controller.signal);
  assert.equal(created.exitCode, 0, created.stderr);
  assert.equal(created.result.status, 'STARTED');
  assert.equal(created.result.target, 'web');
  assert.equal(created.result.sdkEvidence, 'NOT_RUN');
  assert.match(created.result.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.match(created.result.buildSha256, /^[a-f0-9]{64}$/);
  assert.equal(await (await fetch(`${created.result.url}src/main.js`)).text(), '// Original user code\n');
  assert.equal((await fetch(`${created.result.url}.env`)).status, 404);
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(fetch(created.result.url), /fetch failed|ECONNREFUSED/);
});

test('running preview twice rebuilds changed source and never serves stale bytes', async t => {
  const project = newStudioAiProject(t, { git: false });
  const firstSignal = new AbortController();
  t.after(() => firstSignal.abort());
  const first = await cli(['preview', '--project', project, '--port', '0', '--json'], firstSignal.signal);
  assert.equal(first.exitCode, 0, first.stderr);
  firstSignal.abort();
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'document.title = "updated";\n');
  const secondSignal = new AbortController();
  t.after(() => secondSignal.abort());
  const second = await cli(['preview', '--project', project, '--port', '0', '--json'], secondSignal.signal);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.notEqual(first.result.buildSha256, second.result.buildSha256);
  assert.equal(await (await fetch(`${second.result.url}src/main.js`)).text(), 'document.title = "updated";\n');
});

test('CLI rejects invalid target/port/flags and never opens LAN by default', async t => {
  const project = newStudioAiProject(t, { git: false });
  assert.match((await cli(['help'])).stdout, /ludory preview --project/);
  const invalid = await cli(['preview', '--project', project, '--target', 'other', '--json']);
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.result.status, 'BLOCKED');
  assert.equal(invalid.result.reasonCode, 'PREVIEW_TARGET_INVALID');
  assert.equal((await cli(['preview', '--project', project, '--port', 'abc', '--json'])).exitCode, 1);
  assert.equal((await cli(['preview', '--project', project, '--unsafe'])).exitCode, 1);
  assert.equal((await cli(['preview', '--project', project, '--lan', '--port', 'abc'])).exitCode, 1);
});

test('an undeclared platform target never starts a preview server', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-preview-target-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const plan = planCreate(project, { id: 'single-target', title: 'Target', lang: 'en',
    profile: 'web-game', template: 'web-basic', targets: ['yandex-games'] });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  const result = await cli(['preview', '--project', project, '--target', 'vk', '--json']);
  assert.equal(result.exitCode, 2);
  assert.equal(result.result.status, 'BLOCKED');
  assert.equal(result.result.reasonCode, 'PREVIEW_TARGET_NOT_DECLARED');
});
