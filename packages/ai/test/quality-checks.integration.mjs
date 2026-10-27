import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { qualityGame } from './helpers/quality-game.mjs';
import { applyQualityEnable, planQualityEnable } from '../src/quality-policy.mjs';
import { planQualityCheck, executeQualityCheck } from '../src/quality-checks.mjs';
import { qualityStatus, planQualityEvidence } from '../src/quality-store.mjs';
import { runCli } from '../../studio/src/cli.mjs';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');

function enabled(t) {
  const project = qualityGame(t);
  assert.equal(applyQualityEnable(planQualityEnable(project)).status, 'ENABLED');
  return project;
}

function provisionTools(t, project, { duplicate = false, emitMetrics = true } = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-quality-tools-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  const toolConfig = {};
  for (const name of ['crapper', 'dryer', 'mutator']) {
    const file = path.join(bin, name);
    const output = name === 'crapper' ? '.metrics/crap.edn'
      : name === 'dryer' ? '.metrics/dry.edn' : '.metrics/mutate/game.edn';
    const snapshot = name === 'crapper' ? '{:entries [{:name "main" :crap 1.1}]}'
      : name === 'dryer' ? '{:candidates []}' : '{:forms [{:killed 1 :survived 0}]}';
    const body = `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\n${emitMetrics ?
      `fs.mkdirSync(path.dirname(${JSON.stringify(output)}), { recursive: true });\n` +
      `fs.writeFileSync(${JSON.stringify(output)}, ${JSON.stringify(snapshot)});\n` : ''}
      ${name === 'dryer' && duplicate ?
      'process.stdout.write("DUPLICATE score=0.95\\n");' :
      'process.stdout.write("ok\\n");'}\n`;
    fs.writeFileSync(file, body, { mode: 0o700 });
    fs.chmodSync(file, 0o700);
    toolConfig[name] = { path: file, sha256: sha(body), version: 'test-pinned', timeoutMs: 10_000 };
  }
  const policyFile = path.join(project, '.ludory', 'quality', 'policy.json');
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  policy.tools = toolConfig;
  fs.writeFileSync(policyFile, `${JSON.stringify(policy)}\n`);
  // The behavior test writes a fresh LCOV report after its actual Node test has run.
  fs.writeFileSync(path.join(project, 'src', 'quality.test.mjs'), `
    import test from 'node:test';
    import fs from 'node:fs';
    test('real game test produces coverage', () => {
      fs.mkdirSync('coverage', { recursive: true });
      fs.writeFileSync('coverage/lcov.info', 'TN:\\nSF:src/main.js\\nDA:1,1\\nend_of_record\\n');
    });
  `);
  return toolConfig;
}

function executingSandbox() {
  return { check: () => ({ ok: true, code: 'AVAILABLE' }),
    run: plan => {
      assert.match(plan.requiredCommand, /^node --test \.ludory\/quality\/attempts\/.*\/quality\.test\.mjs$/);
      const file = plan.requiredCommand.slice('node --test '.length);
      const result = spawnSync(process.execPath, ['--test', file], {
        cwd: plan.project, encoding: 'utf8', timeout: 15_000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0, transcriptSha256: sha(result.stdout),
        eventCount: 3, completed: true };
    } };
}

function startedWorkflow(project) {
  let output = '';
  const status = runCli(['workflow', 'start', '--project', project,
    '--pipeline', 'audit-repair-loop', '--target', 'Change behavior', '--in-scope', 'src',
    '--acceptance', 'Tests pass', '--mutation-boundary', 'src', '--apply', '--json'],
  { out: value => { output += value; } });
  assert.equal(status, 0, output);
  return JSON.parse(output).runId;
}

function workflowCli(project, runId, operation, args = [], executor) {
  let output = '', errors = '';
  const code = runCli(['workflow', operation, '--project', project, '--run', runId, ...args, '--json'],
    { executor, out: value => { output += value; }, err: value => { errors += value; } });
  return { code, result: JSON.parse(output), errors };
}

test('unconfigured tools produce an actionable read-only blocker without executing game code', t => {
  const project = enabled(t);
  const plan = planQualityCheck(project, { tier: 'quick' });
  assert.equal(plan.status, 'BLOCKED');
  assert.match(plan.conflicts.join(' '), /crapper|dryer/i);
  assert.equal(fs.existsSync(path.join(project, '.ludory', 'quality', 'attempts')), false);
  assert.equal(executeQualityCheck(plan, { apply: true }).status, 'BLOCKED');
  assert.equal(qualityStatus(project).status, 'NOT_RUN');
});

test('sandbox command actually produces a bounded, source-bound quick receipt', t => {
  const project = enabled(t);
  provisionTools(t, project);
  const plan = planQualityCheck(project, { tier: 'quick' });
  assert.equal(plan.status, 'READY', plan.conflicts?.join(','));
  assert.equal(executeQualityCheck(plan, { apply: false }).status, 'READY');
  assert.equal(fs.existsSync(path.join(project, '.ludory', 'quality', 'attempts')), false);
  const result = executeQualityCheck(plan, { apply: true, executor: executingSandbox() });
  assert.equal(result.status, 'PASS', result.reasonCode);
  assert.equal(qualityStatus(project).status, 'PASS');
  const receipt = planQualityEvidence(project).receipt;
  assert.deepEqual(receipt.checks.map(c => c.name), ['tests', 'crapper', 'dryer']);
  assert.ok(receipt.checks.every(c => c.observed && c.exitCode === 0));
  assert.deepEqual(receipt.checks.find(c => c.name === 'crapper').command.slice(1, 4),
    ['--use-existing-coverage', '--threshold', '9.999999']);
  assert.match(receipt.sourceDigest, /^[a-f0-9]{64}$/);
  assert.match(receipt.reportSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.artifacts.map(a => a.path),
    ['coverage/lcov.info', '.metrics/crap.edn', '.metrics/dry.edn']);
  assert.ok(receipt.artifacts.every(a => a.sha256.length === 64));
});

test('a pinned tool with zero exit but no machine report is BLOCKED, not PASS', t => {
  const project = enabled(t);
  provisionTools(t, project, { emitMetrics: false });
  const result = executeQualityCheck(planQualityCheck(project),
    { apply: true, executor: executingSandbox() });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(qualityStatus(project).status, 'BLOCKED');
});

test('copying and validating machine reports makes evidence tampering visible', t => {
  const project = enabled(t);
  provisionTools(t, project);
  assert.equal(executeQualityCheck(planQualityCheck(project),
    { apply: true, executor: executingSandbox() }).status, 'PASS');
  const receipt = planQualityEvidence(project).receipt;
  const evidenceFile = path.join(project, '.ludory', 'quality', 'runs', receipt.qualityRunId,
    'reports', receipt.artifacts[0].file);
  assert.equal(fs.existsSync(evidenceFile), true);
  fs.appendFileSync(evidenceFile, '\nforged\n');
  assert.equal(qualityStatus(project).reasonCode, 'QUALITY_EVIDENCE_INTEGRITY');
});

test('duplication failure is a real FAIL, and deep checks invoke Mutator', t => {
  const project = enabled(t);
  provisionTools(t, project, { duplicate: true });
  const plan = planQualityCheck(project, { tier: 'deep' });
  const result = executeQualityCheck(plan, { apply: true, executor: executingSandbox() });
  assert.equal(result.status, 'FAIL');
  const receipt = planQualityEvidence(project).receipt;
  assert.deepEqual(receipt.checks.map(c => c.name), ['tests', 'crapper', 'dryer', 'mutator']);
  assert.equal(receipt.checks.find(c => c.name === 'dryer').status, 'FAIL');
});

test('changed tool content and missing Codex command telemetry never attest PASS', t => {
  const project = enabled(t);
  const tools = provisionTools(t, project);
  const plan = planQualityCheck(project, { tier: 'quick' });
  fs.appendFileSync(tools.crapper.path, '\n// replaced\n');
  const declined = executeQualityCheck(plan, { apply: true, executor: executingSandbox() });
  assert.equal(declined.status, 'BLOCKED');
  assert.equal(declined.reasonCode, 'QUALITY_TOOL_CHANGED');
  assert.equal(qualityStatus(project).status, 'NOT_RUN');
  // Re-pin, then use an executor that claims success but never observed the command.
  const policyFile = path.join(project, '.ludory', 'quality', 'policy.json');
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  policy.tools.crapper.sha256 = sha(fs.readFileSync(tools.crapper.path));
  fs.writeFileSync(policyFile, JSON.stringify(policy));
  const next = planQualityCheck(project, { tier: 'quick' });
  const noObservedCommand = { check: () => ({ ok: true }), run: () => ({
    ok: false, code: 'EXECUTOR_CHECKS_FAILED', exitCode: 0, completed: true, eventCount: 1,
    transcriptSha256: 'f'.repeat(64),
  }) };
  const result = executeQualityCheck(next, { apply: true, executor: noObservedCommand });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'QUALITY_EXECUTION_UNVERIFIED');
  assert.notEqual(qualityStatus(project).status, 'PASS');
});

test('enabled mode performs exactly one automatic quick check after changed successful Codex continue', t => {
  const project = enabled(t);
  provisionTools(t, project);
  const runId = startedWorkflow(project);
  let workflowCount = 0, qualityCount = 0;
  const sandbox = executingSandbox();
  const executor = { check: () => ({ ok: true }), run: plan => {
    if (plan.requiredCommand?.includes('/quality.test.mjs')) {
      qualityCount++;
      return sandbox.run(plan);
    }
    workflowCount++;
    fs.appendFileSync(path.join(project, 'src', 'main.js'), '// intended code change\n');
    return { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
      transcriptSha256: 'a'.repeat(64), eventCount: 2, completed: true };
  } };
  const preview = workflowCli(project, runId, 'continue', ['--executor', 'codex'], executor);
  assert.equal(preview.result.status, 'READY');
  assert.equal(workflowCount, 0);
  assert.equal(qualityCount, 0);
  const applied = workflowCli(project, runId, 'continue', ['--executor', 'codex', '--apply'], executor);
  assert.equal(applied.code, 0, applied.errors);
  assert.equal(applied.result.status, 'EXECUTED_UNVERIFIED');
  assert.equal(applied.result.quality.status, 'PASS');
  assert.equal(applied.result.quality.tier, 'quick');
  assert.equal(qualityStatus(project).status, 'PASS');
  assert.equal(workflowCount, 1);
  assert.equal(qualityCount, 1);
});

test('automatic quality skips disabled, unchanged, and failed workflow executions without changing workflow status', t => {
  const project = qualityGame(t);
  const runId = startedWorkflow(project);
  let count = 0;
  const executor = { check: () => ({ ok: true }), run: () => {
    count++;
    fs.appendFileSync(path.join(project, 'src', 'main.js'), '// modified while disabled\n');
    return { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
      transcriptSha256: 'a'.repeat(64), eventCount: 2, completed: true };
  } };
  const disabled = workflowCli(project, runId, 'continue', ['--executor', 'codex', '--apply'], executor);
  assert.equal(disabled.result.status, 'EXECUTED_UNVERIFIED');
  assert.equal(disabled.result.quality, undefined);
  assert.equal(count, 1);

  assert.equal(applyQualityEnable(planQualityEnable(project)).status, 'ENABLED');
  const unchangedRun = startedWorkflow(project);
  const unchangedExecutor = { check: () => ({ ok: true }), run: () => ({
    ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
    transcriptSha256: 'a'.repeat(64), eventCount: 2, completed: true,
  }) };
  const unchanged = workflowCli(project, unchangedRun, 'continue',
    ['--executor', 'codex', '--apply'], unchangedExecutor);
  assert.equal(unchanged.result.status, 'EXECUTED_UNVERIFIED');
  assert.equal(unchanged.result.quality, undefined);

  const failedRun = startedWorkflow(project);
  const failedExecutor = { check: () => ({ ok: true }), run: () => {
    fs.appendFileSync(path.join(project, 'src', 'main.js'), '// changed during failed run\n');
    return { ok: false, code: 'EXECUTOR_CHECKS_FAILED', exitCode: 1,
      transcriptSha256: 'b'.repeat(64), eventCount: 2, completed: true };
  } };
  const failed = workflowCli(project, failedRun, 'continue',
    ['--executor', 'codex', '--apply'], failedExecutor);
  assert.equal(failed.result.status, 'FAILED');
  assert.equal(failed.result.quality, undefined);
  assert.equal(qualityStatus(project).status, 'NOT_RUN');
});

test('workflow cycle retries remain bounded and trigger only one post-change quick run', t => {
  const project = enabled(t);
  provisionTools(t, project);
  fs.writeFileSync(path.join(project, 'src', 'main.test.js'),
    "import test from 'node:test'; test('cycle marker', () => {});\n");
  const runId = startedWorkflow(project);
  const sandbox = executingSandbox();
  let cycleAttempts = 0, qualityAttempts = 0;
  const executor = { check: () => ({ ok: true }), run: plan => {
    if (plan.requiredCommand?.includes('/quality.test.mjs')) {
      qualityAttempts++;
      return sandbox.run(plan);
    }
    cycleAttempts++;
    if (cycleAttempts === 2) fs.appendFileSync(path.join(project, 'src', 'main.js'), '// repaired\n');
    return { ok: cycleAttempts === 2,
      code: cycleAttempts === 2 ? 'EXECUTED_UNVERIFIED' : 'EXECUTOR_CHECKS_FAILED',
      exitCode: cycleAttempts === 2 ? 0 : 1,
      transcriptSha256: 'c'.repeat(64), eventCount: 2, completed: true };
  } };
  const result = workflowCli(project, runId, 'cycle',
    ['--test', 'src/main.test.js', '--repairs', '1', '--apply'], executor);
  assert.equal(result.code, 0, result.errors);
  assert.equal(result.result.status, 'EXECUTED_UNVERIFIED');
  assert.equal(result.result.attempts, 2);
  assert.equal(result.result.quality.status, 'PASS');
  assert.equal(cycleAttempts, 2);
  assert.equal(qualityAttempts, 1);
});

test('an auto quality blocker is surfaced as a nonzero CLI exit without rewriting the native workflow result', t => {
  const project = enabled(t);
  const runId = startedWorkflow(project);
  const executor = { check: () => ({ ok: true }), run: () => {
    fs.appendFileSync(path.join(project, 'src', 'main.js'), '// code changed\n');
    return { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
      transcriptSha256: 'd'.repeat(64), eventCount: 2, completed: true };
  } };
  const response = workflowCli(project, runId, 'continue',
    ['--executor', 'codex', '--apply'], executor);
  assert.equal(response.code, 2);
  assert.equal(response.result.status, 'EXECUTED_UNVERIFIED');
  assert.equal(response.result.quality.status, 'BLOCKED');
  assert.match(response.result.quality.reasonCode, /QUALITY_TOOL_MISSING/);
});
