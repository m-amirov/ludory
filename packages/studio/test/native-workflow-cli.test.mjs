import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { nativeProject } from '../../ai/test/helpers/project.mjs';

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
