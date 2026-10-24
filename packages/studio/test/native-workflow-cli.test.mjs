import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { nativeProject } from '../../ai/test/helpers/project.mjs';
import { checkCodexAvailable, runCodexExecution } from '../../ai/src/executor.mjs';
import { readNativeRun } from '../../ai/src/store.mjs';

function cli(...args) {
  let stdout = '', stderr = '';
  const status = runCli(args, { out: text => { stdout += text; }, err: text => { stderr += text; } });
  return { status, stdout, stderr };
}

test('CLI workflow doctor uses the native engine with no CEOS installation or project writes', t => {
  const project = nativeProject(t);
  const oldEntry = process.env.LUDORY_CEOS_ENTRY;
  process.env.LUDORY_CEOS_ENTRY = '/definitely/missing/ceos.mjs';
  t.after(() => { if (oldEntry === undefined) delete process.env.LUDORY_CEOS_ENTRY; else process.env.LUDORY_CEOS_ENTRY = oldEntry; });
  const result = cli('workflow', 'doctor', '--project', project, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).engine, 'ludory-ai');
  assert.equal(JSON.parse(result.stdout).status, 'OK');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  assert.doesNotMatch(cli('help').stdout, /--ceos-entry/);
});

test('CLI workflow start/next/continue/checkpoint preserves preview-only defaults', t => {
  const project = nativeProject(t);
  const basic = ['--project', project, '--json'];
  const start = ['workflow', 'start', ...basic, '--pipeline', 'audit-repair-loop', '--target', 'EP3 QA',
    '--in-scope', 'src/main.js', '--acceptance', 'verified', '--mutation-boundary', 'evidence only'];
  assert.equal(JSON.parse(cli(...start).stdout).status, 'READY');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  const applied = cli(...start, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  const runId = JSON.parse(applied.stdout).runId;
  assert.equal(JSON.parse(applied.stdout).status, 'APPLIED');
  const next = cli('workflow', 'next', ...basic, '--run', runId);
  assert.equal(JSON.parse(next.stdout).nextAction.executable, false);
  const continuation = cli('workflow', 'continue', ...basic, '--run', runId);
  assert.equal(JSON.parse(continuation.stdout).status, 'READY');
  assert.equal(JSON.parse(cli('workflow', 'continue', ...basic, '--run', runId, '--apply').stdout).nativeStatus, 'WAITING_FOR_EVIDENCE');
  const checkpoint = cli('workflow', 'checkpoint', ...basic, '--run', runId,
    '--stage', 'EVIDENCE_COLLECTED', '--artifact', 'src/main.js', '--outcome', 'CONTINUE');
  assert.equal(JSON.parse(checkpoint.stdout).status, 'READY');
  const persisted = cli('workflow', 'checkpoint', ...basic, '--run', runId,
    '--stage', 'EVIDENCE_COLLECTED', '--artifact', 'src/main.js', '--outcome', 'CONTINUE', '--apply');
  assert.equal(JSON.parse(persisted.stdout).nextStage, 'AUDITED');
  assert.equal(fs.existsSync(path.join(project, '.ceos-runs')), false);
  assert.equal(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), '// Original user code\n');
});

test('native workflow CLI rejects CEOS adapter flags and returns honest blockers in JSON', t => {
  const project = nativeProject(t);
  const base = ['--project', project, '--json'];
  const oldFlag = cli('workflow', 'doctor', ...base, '--ceos-entry', '/legacy/ceos.mjs');
  assert.equal(oldFlag.status, 1);
  assert.equal(JSON.parse(oldFlag.stdout).status, 'FAILED');
  const readApply = cli('workflow', 'doctor', ...base, '--apply');
  assert.equal(readApply.status, 1);
  const empty = cli('workflow', 'status', ...base);
  assert.equal(empty.status, 2);
  assert.equal(JSON.parse(empty.stdout).status, 'BLOCKED');
  const unsupported = cli('workflow', 'start', ...base, '--pipeline', 'arbitrary',
    '--target', 'X', '--in-scope', 'src', '--acceptance', 'all', '--mutation-boundary', 'none');
  assert.equal(unsupported.status, 1);
  assert.equal(JSON.parse(unsupported.stdout).status, 'FAILED');
});

test('CLI status lists every active run ID instead of leaving latest ambiguous', t => {
  const project = nativeProject(t);
  const common = ['--project', project, '--json'];
  const start = ['workflow', 'start', ...common, '--pipeline', 'audit-repair-loop',
    '--target', 'test', '--in-scope', 'src', '--acceptance', 'evidence',
    '--mutation-boundary', 'own report', '--apply'];
  const a = JSON.parse(cli(...start).stdout).runId;
  const b = JSON.parse(cli(...start).stdout).runId;
  const response = cli('workflow', 'status', ...common);
  assert.equal(response.status, 0);
  const parsed = JSON.parse(response.stdout);
  assert.equal(parsed.nativeStatus, 'MULTIPLE_ACTIVE');
  assert.deepEqual(parsed.runs.map(run => run.runId).sort(), [a, b].sort());
});

test('a newly created Ludory game can start a native workflow without Git setup', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-created-game-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const created = cli('create', '--project', project, '--id', 'fresh-web',
    '--title', 'Fresh Web', '--lang', 'en', '--profile', 'web-game',
    '--template', 'web-basic', '--targets', 'yandex-games', '--apply', '--json');
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).status, 'APPLIED');
  assert.equal(fs.existsSync(path.join(project, '.git')), false);
  const doctor = cli('workflow', 'doctor', '--project', project, '--json');
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).sourceHead, null);
  const started = cli('workflow', 'start', '--project', project, '--pipeline', 'audit-repair-loop',
    '--target', 'first-run', '--in-scope', 'src', '--acceptance', 'report verified',
    '--mutation-boundary', 'report only', '--apply', '--json');
  assert.equal(started.status, 0, started.stderr);
  assert.equal(JSON.parse(started.stdout).nativeStatus, 'ACTIVE');
});

test('CLI opt-in runs a real fake Codex process for a new game and never claims PASS', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-executor-new-game-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  assert.equal(cli('create', '--project', project, '--id', 'executor-game', '--title', 'Executor', '--lang', 'en',
    '--profile', 'web-game', '--template', 'web-basic', '--targets', 'vk-games', '--apply', '--json').status, 0);
  const start = cli('workflow', 'start', '--project', project, '--pipeline', 'audit-repair-loop',
    '--target', 'Implement a title change', '--in-scope', 'src/main.js', '--acceptance', 'browser opens',
    '--mutation-boundary', 'src/main.js', '--apply', '--json');
  const runId = JSON.parse(start.stdout).runId;
  const codexFixture = path.join(project, 'fake-codex.mjs');
  fs.writeFileSync(codexFixture, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "if (process.argv.includes('--version')) { process.stdout.write('codex test\\n'); process.exit(0); }",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "if (!prompt.includes('Implement a title change')) process.exit(5);",
    "fs.writeFileSync(path.join(process.cwd(), 'src', 'main.js'), '// task actually executed\\n');",
    "process.stdout.write('{\"type\":\"thread.started\",\"thread_id\":\"test\"}\\n{\"type\":\"turn.completed\"}\\n');",
  ].join('\n'));
  const runner = {
    check: p => checkCodexAvailable(p, { executable: process.execPath, prefixArgs: [codexFixture] }),
    run: p => runCodexExecution(p, { executable: process.execPath, prefixArgs: [codexFixture] }),
  };
  const invoke = (...extra) => {
    let stdout = '', stderr = '';
    const status = runCli(['workflow', 'continue', '--project', project, '--run', runId,
      '--executor', 'codex', '--json', ...extra],
    { out: s => { stdout += s; }, err: s => { stderr += s; }, executor: runner });
    return { status, result: JSON.parse(stdout), stderr };
  };
  const before = invoke();
  assert.equal(before.status, 0);
  assert.equal(before.result.status, 'READY');
  assert.equal(readNativeRun(project, runId).events.length, 0);
  assert.notEqual(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), '// task actually executed\n');
  const applied = invoke('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.result.status, 'EXECUTED_UNVERIFIED');
  assert.equal(applied.result.nextAction.kind, 'AWAIT_EVIDENCE');
  assert.equal(readNativeRun(project, runId).events.length, 2);
  assert.equal(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), '// task actually executed\n');
  assert.equal(JSON.stringify(readNativeRun(project, runId).events).includes('Implement a title change'), false);
});

test('CLI executor refuses frozen projects and flags outside continue', t => {
  const project = nativeProject(t);
  const start = cli('workflow', 'start', '--project', project, '--pipeline', 'audit-repair-loop',
    '--target', 'Protected', '--in-scope', 'src', '--acceptance', 'no writes',
    '--mutation-boundary', 'none', '--apply', '--json');
  const run = JSON.parse(start.stdout).runId;
  const legacy = cli('workflow', 'continue', '--project', project, '--run', run, '--executor', 'codex', '--apply', '--json');
  assert.equal(legacy.status, 2);
  assert.match(JSON.parse(legacy.stdout).conflicts[0], /STUDIO_CREATION_REQUIRED/);
  assert.equal(readNativeRun(project, run).events.length, 0);
  assert.equal(cli('workflow', 'doctor', '--project', project, '--executor', 'codex', '--json').status, 1);
});
