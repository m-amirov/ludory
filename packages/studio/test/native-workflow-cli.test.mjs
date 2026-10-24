import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { nativeProject } from '../../ai/test/helpers/project.mjs';
import { checkCodexAvailable, runCodexExecution } from '../../ai/src/executor.mjs';
import { commitNativeEvent, readNativeRun } from '../../ai/src/store.mjs';
import { planWorkflow } from '../../ai/src/workflows.mjs';

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

test('CLI recovery previews, requires confirmation, then records an interrupted attempt', t => {
  const project = nativeProject(t);
  const common = ['--project', project, '--json'];
  fs.writeFileSync(path.join(project, 'ludory.studio.json'), JSON.stringify({
    schemaVersion: 1, profile: { id: 'web-game', version: 1 },
    template: { id: 'web-basic', version: 1 }, files: { 'ludory.project.json': 'f'.repeat(64) },
  }));
  const start = cli('workflow', 'start', ...common, '--pipeline', 'audit-repair-loop',
    '--target', 'recover', '--in-scope', 'src/main.js', '--acceptance', 'verified',
    '--mutation-boundary', 'src/main.js', '--apply');
  const runId = JSON.parse(start.stdout).runId;
  const request = planWorkflowForTest(project, runId);
  commitNativeEvent(request);

  const preview = cli('workflow', 'recover', ...common, '--run', runId);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).nextAction.kind, 'CONFIRM_EXECUTOR_STOPPED');
  assert.equal(readNativeRun(project, runId).events.length, 1);

  const refused = cli('workflow', 'recover', ...common, '--run', runId, '--apply');
  assert.equal(refused.status, 2);
  assert.match(JSON.parse(refused.stdout).conflicts[0], /CONFIRM/);
  const applied = cli('workflow', 'recover', ...common, '--run', runId,
    '--confirm-no-executor', '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).nativeStatus, 'EXECUTION_FAILED');
  assert.equal(readNativeRun(project, runId).events.length, 2);
});

test('CLI cycle previews without writes then retries an observed failing test once', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-cli-cycle-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  assert.equal(cli('create', '--project', project, '--id', 'cycle-test-game', '--title', 'Cycle',
    '--lang', 'en', '--profile', 'web-game', '--template', 'web-basic',
    '--targets', 'vk-games', '--apply', '--json').status, 0);
  const start = cli('workflow', 'start', '--project', project, '--pipeline', 'audit-repair-loop',
    '--target', 'Fix new game code', '--in-scope', 'src', '--acceptance', 'node test succeeds',
    '--mutation-boundary', 'src only', '--apply', '--json');
  const run = JSON.parse(start.stdout).runId;
  let count = 0;
  const executor = { check: () => ({ ok: true }), run: plan => {
    count++;
    assert.match(plan.input, /node --test src\/main\.test\.js/);
    return { ok: count === 2, code: count === 2 ? 'EXECUTED_UNVERIFIED' : 'EXECUTOR_CHECKS_FAILED',
      exitCode: 0, transcriptSha256: 'b'.repeat(64), eventCount: 4, completed: true };
  } };
  const invoke = (...extra) => {
    let stdout = '', stderr = '';
    const code = runCli(['workflow', 'cycle', '--project', project, '--run', run,
      '--test', 'src/main.test.js', '--repairs', '1', '--json', ...extra],
    { executor, out: text => { stdout += text; }, err: text => { stderr += text; } });
    return { code, result: JSON.parse(stdout), stderr };
  };
  assert.equal(invoke().result.status, 'READY');
  assert.equal(readNativeRun(project, run).events.length, 0);
  assert.equal(count, 0);
  const applied = invoke('--apply');
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(applied.result.attempts, 2);
  assert.equal(applied.result.status, 'EXECUTED_UNVERIFIED');
  assert.equal(readNativeRun(project, run).events.length, 4);
  assert.equal(readNativeRun(project, run).nextStage, 'EVIDENCE_COLLECTED');
  assert.equal(cli('workflow', 'cycle', '--project', project, '--run', run,
    '--test', '../unsafe.test.js', '--json').status, 2);
});

test('CLI cycle integrates actual child-process JSONL observations without preserving transcript', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-cycle-subprocess-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  assert.equal(cli('create', '--project', project, '--id', 'process-cycle-game', '--title', 'Cycle',
    '--lang', 'en', '--profile', 'web-game', '--template', 'web-basic',
    '--targets', 'yandex-games', '--apply', '--json').status, 0);
  const start = cli('workflow', 'start', '--project', project, '--pipeline', 'audit-repair-loop',
    '--target', 'Repair title display', '--in-scope', 'src', '--acceptance', 'tested',
    '--mutation-boundary', 'src only', '--apply', '--json');
  const id = JSON.parse(start.stdout).runId;
  const fixture = path.join(project, 'fake-cycle-codex.mjs');
  const countFile = path.join(project, 'attempt-count');
  fs.writeFileSync(fixture, [
    "import fs from 'node:fs';",
    "if (process.argv.includes('--version')) { process.stdout.write('codex mock\\n'); process.exit(0); }",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "if (!prompt.includes('node --test src/main.test.js')) process.exit(4);",
    "const marker = 'attempt-count';",
    "const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) + 1 : 1;",
    "fs.writeFileSync(marker, String(count));",
    "if (count > 1 && !prompt.includes('previous attempt')) process.exit(5);",
    "process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'node --test src/main.test.js',exit_code:count === 2 ? 0 : 1}})+'\\n');",
    "process.stdout.write(JSON.stringify({type:'turn.completed'})+'\\n');",
  ].join('\n'));
  const executor = {
    check: plan => checkCodexAvailable(plan, { executable: process.execPath, prefixArgs: [fixture] }),
    run: plan => runCodexExecution(plan, { executable: process.execPath, prefixArgs: [fixture] }),
  };
  let stdout = '';
  const code = runCli(['workflow', 'cycle', '--project', project, '--run', id,
    '--test', 'src/main.test.js', '--repairs', '1', '--apply', '--json'],
  { executor, out: text => { stdout += text; } });
  assert.equal(code, 0, stdout);
  assert.equal(JSON.parse(stdout).status, 'EXECUTED_UNVERIFIED');
  assert.equal(JSON.parse(stdout).attempts, 2);
  assert.equal(fs.readFileSync(countFile, 'utf8'), '2');
  const current = readNativeRun(project, id);
  assert.deepEqual(current.events.filter(item => item.kind === 'EXECUTION_RESULT')
    .map(item => item.result.code), ['EXECUTOR_CHECKS_FAILED', 'EXECUTED_UNVERIFIED']);
  assert.equal(JSON.stringify(current.events).includes('Repair title display'), false);
  assert.equal(current.nextStage, 'EVIDENCE_COLLECTED');
});

function planWorkflowForTest(project, runId) {
  return planWorkflow(project, 'continue', { run: runId, executor: 'codex' }).nativePlan;
}
