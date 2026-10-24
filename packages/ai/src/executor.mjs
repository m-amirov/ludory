import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_OUTPUT = 2 * 1024 * 1024;
const MAX_DURATION_MS = 10 * 60 * 1000;

/** Historical metadata migration does not create this Studio-owned opt-in receipt. */
export function hasStudioCreationReceipt(project) {
  try {
    const filename = path.join(project, 'ludory.studio.json');
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return false;
    const receipt = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return receipt?.schemaVersion === 1 &&
      typeof receipt.profile?.id === 'string' && typeof receipt.template?.id === 'string' &&
      /^[a-f0-9]{64}$/.test(receipt.files?.['ludory.project.json'] ?? '');
  } catch { return false; }
}

/** One bounded Codex subprocess, not a provider broker or a release verifier. */
export function prepareCodexExecution(project, scope, stage, { gitRoot = null } = {}) {
  if (!project || !stage || !scope?.target || !Array.isArray(scope.inScope)) {
    throw new Error('EXECUTOR_INVALID_SCOPE');
  }
  const args = ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write'];
  if (!gitRoot) args.push('--skip-git-repo-check');
  args.push('-');
  const input = [
    'You are executing one user-authorized task in a new Ludory game.',
    `Task: ${scope.target}`,
    `Current stage: ${stage}`,
    `In scope: ${scope.inScope.join(', ')}`,
    `Out of scope: ${(scope.outOfScope ?? []).join(', ') || '(not specified)'}`,
    `Acceptance criteria: ${scope.acceptanceContract}`,
    `Allowed mutation boundary: ${scope.mutationBoundary}`,
    'Do not edit ludory.project.json, ludory.studio.json, .ludory/ai, .git, .ceos-runs or .codex-os.',
    'Keep changes within the named scope. Report what actually changed and which checks ran.',
    'A successful answer is not independent verification or release PASS.',
  ].join('\n');
  return { project, stage, args, input, sandbox: 'workspace-write' };
}

function invoke(executable, args, plan, spawn, input, timeoutMs = MAX_DURATION_MS) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('EXECUTOR_INVALID_TIMEOUT');
  try {
    return spawn(executable, args, {
      cwd: plan.project, input, encoding: 'utf8', shell: false, windowsHide: true,
      timeout: Math.min(timeoutMs, MAX_DURATION_MS), killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT,
    });
  } catch (error) {
    return { status: null, error, stdout: '', stderr: '' };
  }
}

function spawnErrorCode(result) {
  const code = result?.error?.code;
  if (code === 'ENOENT') return 'EXECUTOR_UNAVAILABLE';
  if (code === 'ETIMEDOUT') return 'EXECUTOR_TIMEOUT';
  if (code === 'ENOBUFS' || code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'EXECUTOR_OUTPUT_LIMIT';
  if (result?.error || result?.signal) return 'EXECUTOR_SPAWN_FAILED';
  return null;
}

export function checkCodexAvailable(plan, { executable = 'codex', prefixArgs = [], spawn = spawnSync,
  timeoutMs = MAX_DURATION_MS } = {}) {
  const result = invoke(executable, [...prefixArgs, '--version'], plan, spawn, undefined, timeoutMs);
  const error = spawnErrorCode(result);
  if (error || result?.status !== 0) return { ok: false, code: error ?? 'EXECUTOR_UNAVAILABLE' };
  return { ok: true, code: 'AVAILABLE' };
}

/** JSONL is untrusted process output; store only a hash and finite metadata. */
export function runCodexExecution(plan, { executable = 'codex', prefixArgs = [], spawn = spawnSync } = {}) {
  const result = invoke(executable, [...prefixArgs, ...plan.args], plan, spawn, plan.input);
  const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
  const receipt = {
    ok: false, code: 'EXECUTOR_INCOMPLETE',
    exitCode: Number.isSafeInteger(result?.status) ? result.status : null,
    transcriptSha256: sha256(stdout), eventCount: 0, completed: false,
  };
  const spawnError = spawnErrorCode(result);
  if (spawnError) return { ...receipt, code: spawnError };
  if (Buffer.byteLength(stdout) > MAX_OUTPUT) return { ...receipt, code: 'EXECUTOR_OUTPUT_LIMIT' };
  if (result?.status !== 0) return { ...receipt, code: 'EXECUTOR_NONZERO_EXIT' };

  let failed = false;
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); }
    catch { return { ...receipt, code: 'EXECUTOR_MALFORMED_JSONL' }; }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
      return { ...receipt, code: 'EXECUTOR_MALFORMED_JSONL' };
    }
    receipt.eventCount++;
    if (event.type === 'turn.completed') receipt.completed = true;
    if (event.type === 'turn.failed' || event.type === 'error') failed = true;
  }
  if (failed) return { ...receipt, code: 'EXECUTOR_TURN_FAILED' };
  if (!receipt.completed) return receipt;
  return { ...receipt, ok: true, code: 'EXECUTED_UNVERIFIED' };
}
