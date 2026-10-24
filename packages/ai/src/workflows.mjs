import { inspectNativeProject, verifyNativeSource } from './source.mjs';
import { getPipeline } from './pipelines.mjs';
import { planNewRun, commitNewRun, readNativeRun, listNativeRuns, planNativeEvent, commitNativeEvent } from './store.mjs';
import { prepareCodexExecution, checkCodexAvailable, runCodexExecution, hasStudioCreationReceipt } from './executor.mjs';

const OPERATIONS = new Set(['doctor', 'status', 'next', 'start', 'continue', 'checkpoint']);
const READ_ONLY = new Set(['doctor', 'status', 'next']);
const OPTS = {
  doctor: [], status: ['run'], next: ['run'], continue: ['run', 'executor'],
  start: ['pipeline', 'target', 'inScope', 'outOfScope', 'acceptance', 'mutationBoundary'],
  checkpoint: ['run', 'stage', 'artifact', 'outcome'],
};

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || value.includes('\0')) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function list(value, label, required = true) {
  if (value === undefined && !required) return [];
  return text(value, label).split(';').map(item => text(item.trim(), label));
}

function blocked(project, operation, problem) {
  return { engine: 'ludory-ai', project, operation, status: 'BLOCKED', writes: [],
    conflicts: [problem], nativeStatus: 'BLOCKED' };
}

function fromRun(project, operation, current) {
  const nextAction = current.terminal ? { kind: 'STOP_TERMINAL', stage: null, executable: false }
    : current.pendingExecutor
      ? { kind: 'AWAIT_EXECUTOR_RESULT', stage: current.nextStage, executable: false }
    : ['WAITING_FOR_EVIDENCE', 'EXECUTED_UNVERIFIED'].includes(current.status)
      ? { kind: 'AWAIT_EVIDENCE', stage: current.nextStage, executable: false }
      : current.status === 'EXECUTION_FAILED' ? { kind: 'RETRY_EXECUTOR', stage: current.nextStage, executable: false }
      : { kind: 'PERFORM_STAGE', stage: current.nextStage, executable: false };
  return { engine: 'ludory-ai', project, operation, status: 'OK', writes: [], conflicts: [],
    runId: current.run.runId, nextStage: current.nextStage, nativeStatus: current.status,
    nextAction, terminal: current.terminal };
}

/** Plan a native operation without executing any CEOS process. */
export function planWorkflow(projectDir, operation, options = {}) {
  if (!OPERATIONS.has(operation)) throw new Error(`Unknown workflow operation: ${operation}`);
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !OPTS[operation].includes(key) && options[key] !== undefined)) {
    throw new Error('Unknown workflow option');
  }
  const source = inspectNativeProject(projectDir);
  const project = source.project;
  if (operation === 'doctor') {
    return { engine: 'ludory-ai', project, operation, status: 'OK', writes: [],
      conflicts: [], manifestId: source.manifest.id, sourceHead: source.gitHead,
      gitRoot: source.gitRoot, gitClean: source.gitClean, gitTrusted: source.gitTrusted };
  }
  if (operation === 'start') {
    getPipeline(options.pipeline);
    const nativePlan = planNewRun(project, { pipeline: options.pipeline, scope: {
      target: text(options.target, 'target'), inScope: list(options.inScope, 'in-scope'),
      outOfScope: list(options.outOfScope, 'out-of-scope', false),
      acceptanceContract: text(options.acceptance, 'acceptance'),
      mutationBoundary: text(options.mutationBoundary, 'mutation-boundary'),
    } });
    return { engine: 'ludory-ai', project, operation, status: 'READY', writes: nativePlan.writes,
      conflicts: [], runId: nativePlan.run.runId, nextStage: getPipeline(options.pipeline).stages[0].id,
      nativePlan };
  }
  const run = options.run ?? 'latest';
  let current;
  try { current = readNativeRun(project, run); }
  catch (error) {
    if (error.message === 'NATIVE_AMBIGUOUS_ACTIVE_RUNS') {
      const runs = listNativeRuns(project);
      const active = runs.filter(item => !['FAIL', 'BLOCKED', 'ESCALATE', 'PASS'].includes(item.status));
      if (operation === 'status') return { engine: 'ludory-ai', project, operation,
        status: 'OK', nativeStatus: 'MULTIPLE_ACTIVE', writes: [], conflicts: [], runs: active,
        nextAction: { kind: 'SELECT_RUN', executable: false } };
      return { ...blocked(project, operation, `NATIVE_AMBIGUOUS_ACTIVE_RUNS: ${active.map(item => item.runId).join(', ')}`),
        runs: active };
    }
    if (/^NATIVE_/.test(error.message)) return blocked(project, operation, error.message);
    throw error;
  }
  if (READ_ONLY.has(operation)) return fromRun(project, operation, current);
  if (current.terminal) return blocked(project, operation, 'NATIVE_TERMINAL_RUN');
  if (operation === 'continue' && ['WAITING_FOR_EVIDENCE', 'EXECUTED_UNVERIFIED'].includes(current.status)) {
    return blocked(project, operation, 'NATIVE_ACTION_ALREADY_REQUESTED');
  }
  if (operation === 'continue' && options.executor !== undefined && options.executor !== 'codex') {
    return blocked(project, operation, 'NATIVE_EXECUTOR_UNSUPPORTED');
  }
  if (operation === 'continue' && options.executor === 'codex' && !hasStudioCreationReceipt(project)) {
    return blocked(project, operation, 'NATIVE_EXECUTOR_STUDIO_CREATION_REQUIRED: frozen/legacy game');
  }
  let nativePlan;
  try {
    if (operation === 'continue') nativePlan = planNativeEvent(project, current.run.runId, {
      kind: 'ACTION_REQUESTED', stage: current.nextStage,
      ...(options.executor === 'codex' && { executor: 'codex' }),
    });
    else {
      const stage = text(options.stage, 'stage');
      const artifacts = options.artifact === undefined ? [] : list(options.artifact, 'artifact');
      nativePlan = planNativeEvent(project, current.run.runId, {
        kind: 'CHECKPOINT', stage, artifacts, outcome: options.outcome ?? 'CONTINUE',
      });
    }
  } catch (error) {
    if (/^NATIVE_/.test(error.message)) return blocked(project, operation, error.message);
    throw error;
  }
  const executorPlan = operation === 'continue' && options.executor === 'codex'
    ? prepareCodexExecution(project, current.run.scope, current.nextStage, { gitRoot: source.gitRoot }) : null;
  return { engine: 'ludory-ai', project, operation, status: 'READY', writes: nativePlan.writes,
    conflicts: [], runId: current.run.runId, nextStage: current.nextStage, nativePlan,
    ...(executorPlan && { executor: 'codex', mutationScope: executorPlan.sandbox, executorPlan,
      warning: 'Codex workspace-write may edit game files; in-scope paths are instructions, not enforced allowlists.' }) };
}

export function executeWorkflow(plan, { apply = false, executor } = {}) {
  if (!plan || !OPERATIONS.has(plan.operation) || !['OK', 'READY', 'BLOCKED'].includes(plan.status)) {
    throw new Error('Invalid native workflow plan');
  }
  if (apply && READ_ONLY.has(plan.operation)) throw new Error('Native read-only workflow does not accept --apply');
  if (plan.status !== 'READY' || !apply) return plan;
  if (plan.operation === 'continue' && plan.executor === 'codex') {
    // The executable's cwd and input must come from the hash-checked run,
    // never from a caller-mutated preview object.
    const run = readNativeRun(plan.project, plan.runId);
    const source = inspectNativeProject(plan.project);
    const expected = prepareCodexExecution(plan.project, run.run.scope, run.nextStage, { gitRoot: source.gitRoot });
    if (plan.nativePlan?.project !== plan.project || plan.nativePlan?.runId !== plan.runId ||
        plan.nativePlan?.event?.kind !== 'ACTION_REQUESTED' ||
        plan.nativePlan?.event?.executor !== 'codex' ||
        plan.nativePlan?.event?.stage !== run.nextStage ||
        plan.nativePlan?.event?.index !== run.events.length + 1 ||
        plan.nativePlan?.event?.prevSha256 !== run.headSha256 ||
        plan.nativePlan?.expectedHeadSha256 !== run.headSha256 ||
        plan.nextStage !== run.nextStage ||
        !hasStudioCreationReceipt(plan.project) ||
        !verifyNativeSource(plan.nativePlan.source).ok ||
        JSON.stringify(expected) !== JSON.stringify(plan.executorPlan)) {
      throw new Error('NATIVE_EXECUTOR_PLAN_TAMPERED_OR_STALE');
    }
    const impl = executor ?? { check: checkCodexAvailable, run: runCodexExecution };
    const available = impl.check(expected);
    if (!available.ok) return { ...blocked(plan.project, 'continue', available.code),
      runId: plan.runId, executor: 'codex' };
    commitNativeEvent(plan.nativePlan); // Publish intent before running the external process.
    let execution;
    try { execution = impl.run(expected); }
    catch { execution = { ok: false, code: 'EXECUTOR_SPAWN_FAILED', exitCode: null,
      transcriptSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      eventCount: 0, completed: false }; }
    const finished = commitNativeEvent(planNativeEvent(plan.project, plan.runId, {
      kind: 'EXECUTION_RESULT', stage: plan.nextStage, result: execution,
    }));
    return { engine: 'ludory-ai', project: plan.project, operation: 'continue', runId: plan.runId,
      status: execution.ok ? 'EXECUTED_UNVERIFIED' : 'FAILED',
      nativeStatus: finished.status, executor: 'codex', executorCode: execution.code,
      exitCode: execution.exitCode, writes: [...plan.writes, 'native execution result receipt'],
      conflicts: execution.ok ? [] : [execution.code],
      nextStage: finished.nextStage,
      nextAction: fromRun(plan.project, plan.operation, finished).nextAction };
  }
  const current = plan.operation === 'start' ? commitNewRun(plan.nativePlan) : commitNativeEvent(plan.nativePlan);
  return { ...plan, nativePlan: undefined, status: 'APPLIED', writes: plan.writes,
    runId: current.run.runId, nextStage: current.nextStage, nativeStatus: current.status,
    nextAction: fromRun(plan.project, plan.operation, current).nextAction };
}
