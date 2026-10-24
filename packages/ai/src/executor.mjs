import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_OUTPUT = 2 * 1024 * 1024;
const MAX_DURATION_MS = 10 * 60 * 1000;
export const EMPTY_TRANSCRIPT_SHA256 = sha256('');

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
export function prepareCodexExecution(project, scope, stage,
  { gitRoot = null, requiredCommand = null, repairAttempt = 0 } = {}) {
  if (!project || !stage || !scope?.target || !Array.isArray(scope.inScope)) {
    throw new Error('EXECUTOR_INVALID_SCOPE');
  }
  if (requiredCommand !== null &&
      (typeof requiredCommand !== 'string' || !/^node --test [A-Za-z0-9_.\/-]+\.test\.[cm]?js$/.test(requiredCommand) ||
        requiredCommand.includes('..'))) throw new Error('EXECUTOR_INVALID_CHECK_COMMAND');
  if (!Number.isInteger(repairAttempt) || repairAttempt < 0 || repairAttempt > 2 ||
      (repairAttempt > 0 && !requiredCommand)) throw new Error('EXECUTOR_INVALID_REPAIR_ATTEMPT');
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
    ...(repairAttempt > 0 ? [
      `Repair attempt ${repairAttempt} of 2. The previous attempt produced a failed or missing test check.`,
      'Inspect the existing project files and test failure, then fix the root cause before rerunning the test.',
      'The previous Codex session is not preserved; rely on the current workspace state, not guessed prior output.',
    ] : []),
    ...(requiredCommand ? [`Run this exact test command inside your Codex workspace sandbox: ${requiredCommand}`,
      'The command must complete with exit code 0; do not alter or merely quote the command.'] : []),
    'A successful answer is not independent verification or release PASS.',
  ].join('\n');
  return { project, stage, args, input, sandbox: 'workspace-write',
    ...(requiredCommand && { requiredCommand }) };
}

function resolveInvocation(executable, prefixArgs) {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) {
    return { executable, args: [...prefixArgs] };
  }
  const stat = fs.lstatSync(executable);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    const error = new Error('EXECUTOR_WRAPPER_UNSUPPORTED');
    error.code = 'EXECUTOR_WRAPPER_UNSUPPORTED';
    throw error;
  }
  const wrapper = fs.readFileSync(executable, 'utf8');
  // npm's Windows Node shims pass a fixed JavaScript entrypoint and then %*.
  // Resolve that entrypoint directly instead of invoking cmd.exe, preserving
  // shell:false and keeping all user task text on stdin.
  const match = wrapper.match(/["']%[^"']*dp0%?[\\/]*([^"']+\.m?js)["']/i);
  if (!match) {
    const error = new Error('EXECUTOR_WRAPPER_UNSUPPORTED');
    error.code = 'EXECUTOR_WRAPPER_UNSUPPORTED';
    throw error;
  }
  const script = path.resolve(path.dirname(executable), match[1]);
  const scriptStat = fs.lstatSync(script);
  if (!scriptStat.isFile() || scriptStat.isSymbolicLink()) {
    const error = new Error('EXECUTOR_WRAPPER_UNSUPPORTED');
    error.code = 'EXECUTOR_WRAPPER_UNSUPPORTED';
    throw error;
  }
  return { executable: process.execPath, args: [script, ...prefixArgs] };
}

function invoke(executable, args, plan, spawn, input, timeoutMs = MAX_DURATION_MS, prefixArgs = []) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('EXECUTOR_INVALID_TIMEOUT');
  try {
    const invocation = resolveInvocation(executable, prefixArgs);
    return spawn(invocation.executable, [...invocation.args, ...args], {
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
  if (code === 'EXECUTOR_WRAPPER_UNSUPPORTED' || code === 'EINVAL') return 'EXECUTOR_WRAPPER_UNSUPPORTED';
  if (code === 'ETIMEDOUT') return 'EXECUTOR_TIMEOUT';
  if (code === 'ENOBUFS' || code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'EXECUTOR_OUTPUT_LIMIT';
  if (result?.error || result?.signal) return 'EXECUTOR_SPAWN_FAILED';
  return null;
}

function matchesRequiredCommand(observed, required) {
  if (observed === required) return true;
  if (process.platform !== 'win32' || typeof observed !== 'string') return false;
  const wrapper = observed.match(/^"([^"]+)"\s+-Command\s+'([^']*)'$/i);
  if (!wrapper || !path.win32.isAbsolute(wrapper[1]) ||
      !['pwsh.exe', 'powershell.exe'].includes(path.win32.basename(wrapper[1]).toLowerCase())) return false;
  return wrapper[2] === required;
}

export function checkCodexAvailable(plan, { executable = 'codex', prefixArgs = [], spawn = spawnSync,
  timeoutMs = MAX_DURATION_MS } = {}) {
  const result = invoke(executable, ['--version'], plan, spawn, undefined, timeoutMs, prefixArgs);
  const error = spawnErrorCode(result);
  if (error || result?.status !== 0) return { ok: false, code: error ?? 'EXECUTOR_UNAVAILABLE' };
  return { ok: true, code: 'AVAILABLE' };
}

/** JSONL is untrusted process output; store only a hash and finite metadata. */
export function runCodexExecution(plan, { executable = 'codex', prefixArgs = [], spawn = spawnSync } = {}) {
  const result = invoke(executable, plan.args, plan, spawn, plan.input, MAX_DURATION_MS, prefixArgs);
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
  let observedCheckPassed = false;
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); }
    catch { return { ...receipt, code: 'EXECUTOR_MALFORMED_JSONL' }; }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
      return { ...receipt, code: 'EXECUTOR_MALFORMED_JSONL' };
    }
    receipt.eventCount++;
    if (plan.requiredCommand && receipt.completed && event.type !== 'turn.completed') {
      return { ...receipt, code: 'EXECUTOR_MALFORMED_JSONL' };
    }
    if (event.type === 'turn.completed') receipt.completed = true;
    if (plan.requiredCommand && event.type === 'item.started' &&
        ['command_execution', 'file_change'].includes(event.item?.type)) {
      observedCheckPassed = false;
    }
    if (plan.requiredCommand && event.type === 'item.completed') {
      if (receipt.completed) return { ...receipt, code: 'EXECUTOR_MALFORMED_JSONL' };
      if (event.item?.type === 'command_execution') {
        observedCheckPassed = matchesRequiredCommand(event.item.command, plan.requiredCommand) && event.item.exit_code === 0;
      } else if (event.item?.type === 'file_change') observedCheckPassed = false;
    }
    // Codex can emit recoverable tool/API errors before a later completed turn.
    // Only a terminal turn.failed (or the process/JSONL guards above) fails the
    // execution; a completed turn remains EXECUTED_UNVERIFIED.
    if (event.type === 'turn.failed') failed = true;
  }
  if (failed) return { ...receipt, code: 'EXECUTOR_TURN_FAILED' };
  if (!receipt.completed) return receipt;
  if (plan.requiredCommand && !observedCheckPassed) return { ...receipt, code: 'EXECUTOR_CHECKS_FAILED' };
  return { ...receipt, ok: true, code: 'EXECUTED_UNVERIFIED' };
}
