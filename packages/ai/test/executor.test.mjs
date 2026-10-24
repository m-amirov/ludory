import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { prepareCodexExecution, checkCodexAvailable, runCodexExecution } from '../src/executor.mjs';

const scope = {
  target: 'Fix scene; do not run `echo hello` or $(whoami)',
  inScope: ['src/main.js'], outOfScope: ['assets/master.png'],
  acceptanceContract: 'new game starts', mutationBoundary: 'edit only src/main.js',
};
const trace = '{"type":"thread.started","thread_id":"thread-1"}\n{"type":"turn.started"}\n{"type":"turn.completed"}\n';

test('Codex runs as one sandboxed argument vector, with prompt only on stdin', () => {
  const plan = prepareCodexExecution('/games/new', scope, 'AUDITED', { gitRoot: null });
  let captured;
  const result = runCodexExecution(plan, { executable: 'codex', spawn(executable, args, options) {
    captured = { executable, args, options };
    return { status: 0, stdout: trace, stderr: '' };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'EXECUTED_UNVERIFIED');
  assert.equal(result.exitCode, 0);
  assert.equal(result.completed, true);
  assert.equal(result.eventCount, 3);
  assert.equal(result.transcriptSha256, crypto.createHash('sha256').update(trace).digest('hex'));
  assert.equal(Object.hasOwn(result, 'stdout'), false);
  assert.equal(captured.executable, 'codex');
  assert.deepEqual(captured.args, ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-']);
  assert.equal(captured.options.cwd, '/games/new');
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.killSignal, 'SIGKILL');
  assert.equal(captured.options.input.includes(scope.target), true);
  assert.equal(captured.args.some(arg => arg.includes(scope.target)), false);
  assert.equal(captured.options.input.includes('assets/master.png'), true);
});

test('timeout forcibly terminates a child which ignores SIGTERM', () => {
  const plan = prepareCodexExecution(process.cwd(), scope, 'AUDITED');
  const start = performance.now();
  const result = checkCodexAvailable(plan, {
    spawn: (_binary, _args, options) => spawnSync(process.execPath,
      ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], options),
    timeoutMs: 300,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EXECUTOR_TIMEOUT');
  assert.ok(performance.now() - start < 4000, 'the direct child must terminate promptly');
});

test('Codex availability probes only --version, without executing a task', () => {
  const plan = prepareCodexExecution('/games/new', scope, 'AUDITED', { gitRoot: '/games' });
  let calls = 0;
  const ok = checkCodexAvailable(plan, { spawn(executable, args, options) {
    calls++;
    assert.deepEqual(args, ['--version']);
    assert.equal(options.shell, false);
    assert.equal(options.cwd, '/games/new');
    return { status: 0, stdout: 'codex 0.9.0\n', stderr: '' };
  } });
  assert.equal(ok.ok, true);
  assert.equal(calls, 1);
  assert.equal(plan.args.includes('--skip-git-repo-check'), false);
});

test('missing Codex binary is a failure, not an executed run', () => {
  const plan = prepareCodexExecution('/games/new', scope, 'AUDITED', { gitRoot: null });
  const missing = { status: null, error: Object.assign(new Error('missing'), { code: 'ENOENT' }), stdout: '', stderr: '' };
  assert.equal(checkCodexAvailable(plan, { spawn: () => missing }).code, 'EXECUTOR_UNAVAILABLE');
  const result = runCodexExecution(plan, { spawn: () => missing });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EXECUTOR_UNAVAILABLE');
});

test('exit zero without turn.completed never claims executed success', () => {
  const plan = prepareCodexExecution('/games/new', scope, 'AUDITED', { gitRoot: null });
  const result = runCodexExecution(plan, { spawn: () => ({ status: 0, stdout: '{"type":"turn.started"}\n', stderr: '' }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EXECUTOR_INCOMPLETE');
});

test('nonzero, malformed, timeout and oversized stdout have distinct failure codes', () => {
  const plan = prepareCodexExecution('/games/new', scope, 'AUDITED', { gitRoot: null });
  const cases = [
    [{ status: 3, stdout: trace, stderr: '' }, 'EXECUTOR_NONZERO_EXIT'],
    [{ status: 0, stdout: '{bad json}\n', stderr: '' }, 'EXECUTOR_MALFORMED_JSONL'],
    [{ status: null, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '' }, 'EXECUTOR_TIMEOUT'],
    [{ status: null, error: Object.assign(new Error('too large'), { code: 'ENOBUFS' }), stdout: '', stderr: '' }, 'EXECUTOR_OUTPUT_LIMIT'],
    [{ status: 0, stdout: '{"type":"turn.failed"}\n{"type":"turn.completed"}\n', stderr: '' }, 'EXECUTOR_TURN_FAILED'],
  ];
  for (const [response, code] of cases) {
    const result = runCodexExecution(plan, { spawn: () => response });
    assert.equal(result.ok, false, code);
    assert.equal(result.code, code);
  }
});
