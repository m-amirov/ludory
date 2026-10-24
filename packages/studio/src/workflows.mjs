import path from 'node:path';
import crypto from 'node:crypto';
import { defineGame } from '@ludory/core';
import { readSourceFile } from './legacy.mjs';
import { projectRoot, directoryIdentity, isOriginalDirectory } from './projects.mjs';
import { resolveCeosEntry, invokeCeos } from './ceos-bridge.mjs';

const READ_ONLY = new Set(['doctor', 'status', 'next']);
const MUTATING = new Set(['start', 'continue', 'checkpoint']);
const PIPELINES = new Set(['audit-repair-loop', 'production-art']);
const OUTCOMES = new Set(['CONTINUE', 'PASS', 'FAIL', 'BLOCKED', 'ESCALATE']);
const OPTION_KEYS = new Set(['entry', 'run', 'pipeline', 'target', 'inScope', 'outOfScope', 'acceptance', 'mutationBoundary', 'stage', 'artifact', 'outcome']);

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || value.includes('\0')) {
    throw new Error(`${label} must be nonempty text (max 8192 characters)`);
  }
  return value;
}

function runId(run) {
  if (run === undefined) return 'latest';
  if (typeof run !== 'string' || run.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(run) || run.includes('..')) {
    throw new Error('Invalid run identifier');
  }
  return run;
}

function artifacts(value) {
  const text = requiredText(value, 'artifact');
  for (const name of text.split(';')) {
    if (!name || path.isAbsolute(name) || name.includes('\\') || name.includes(':') ||
        name.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Invalid artifact: expected project-relative file paths separated by semicolons');
    }
  }
  return text;
}

function invocation(operation, options, project) {
  const tail = ['--project', project, '--json'];
  const run = runId(options.run);
  switch (operation) {
    case 'doctor': return { args: ['doctor', ...tail], mutation: false };
    case 'status': return { args: ['run-status', run, ...tail], mutation: false };
    case 'next': return { args: ['continue', run, '--mode', 'inspect', ...tail], mutation: false };
    case 'start': {
      if (!PIPELINES.has(options.pipeline)) throw new Error('Unsupported pipeline; use audit-repair-loop or production-art');
      const args = ['run', options.pipeline, '--target', requiredText(options.target, 'target'),
        '--in-scope', requiredText(options.inScope, 'in-scope'),
        '--acceptance', requiredText(options.acceptance, 'acceptance'),
        '--mutation-boundary', requiredText(options.mutationBoundary, 'mutation-boundary')];
      if (options.outOfScope !== undefined) args.push('--out-of-scope', requiredText(options.outOfScope, 'out-of-scope'));
      return { args: [...args, ...tail], mutation: true };
    }
    case 'continue': return {
      args: ['continue', run, '--mode', 'guided', ...tail],
      previewArgs: ['continue', run, '--mode', 'inspect', ...tail], mutation: true,
    };
    case 'checkpoint': {
      const stage = requiredText(options.stage, 'stage');
      if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(stage)) throw new Error('Invalid stage identifier');
      const outcome = options.outcome ?? 'CONTINUE';
      if (!OUTCOMES.has(outcome)) throw new Error('Invalid checkpoint outcome');
      const args = ['checkpoint', run, '--stage', stage];
      if (options.artifact !== undefined) args.push('--artifact', artifacts(options.artifact));
      args.push('--outcome', outcome);
      return { args: [...args, ...tail], mutation: true };
    }
    default: throw new Error(`Unknown workflow operation: ${operation}`);
  }
}

/** Pure planning; no CEOS command executes until executeWorkflow. */
export function planWorkflow(projectDir, operation, options = {}) {
  if (!READ_ONLY.has(operation) && !MUTATING.has(operation)) throw new Error(`Unknown workflow operation: ${operation}`);
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !OPTION_KEYS.has(key))) throw new Error('Unknown workflow option');
  const project = projectRoot(projectDir);
  let text, source;
  try { ({ text, source } = readSourceFile(project, 'ludory.project.json')); }
  catch (error) { throw new Error(`Canonical Ludory project manifest cannot be read: ${error.code ?? error.message}`); }
  let manifest;
  try { manifest = defineGame(JSON.parse(text)); }
  catch { throw new Error('Existing Ludory project manifest is invalid'); }
  const ceos = resolveCeosEntry({ entry: options.entry });
  const { args, previewArgs, mutation } = invocation(operation, options, project);
  const rootIdentity = directoryIdentity(project);
  const safeOptions = { ...options };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    project, operation, rootIdentity, manifestSha256: source.sha256,
    entryPath: ceos.entryPath, version: ceos.version, entrySha256: ceos.entrySha256,
    args, previewArgs, safeOptions,
  })).digest('hex');
  return {
    mode: `workflow-${operation}`, project, operation, options: safeOptions,
    status: 'READY', conflicts: [], writes: mutation ? ['CEOS-owned workflow state/evidence (only with --apply)'] : [],
    manifestId: manifest.id, manifestSha256: source.sha256, rootIdentity,
    ceosVersion: ceos.version, ceosEntry: ceos.entryPath, ceosEntrySha256: ceos.entrySha256,
    argv: args, previewArgv: previewArgs ?? null, mutation, fingerprint,
  };
}

function transported(plan, args, applied) {
  const { ceosExitCode, data } = invokeCeos({ entryPath: plan.ceosEntry, project: plan.project, args });
  const status = ceosExitCode === 0 ? applied ? 'APPLIED' : 'OK'
    : ceosExitCode === 2 ? 'BLOCKED' : ceosExitCode === 3 ? 'ESCALATE' : 'FAILED';
  return { ...plan, status, applied: applied && ceosExitCode === 0, ceosExitCode, ceos: data, executedArgv: args };
}

/** Re-plan against the current game/CEOS sources before any dispatch. */
export function executeWorkflow(plan, { apply = false } = {}) {
  if (!plan || plan.status !== 'READY' || !plan.fingerprint ||
      (!READ_ONLY.has(plan.operation) && !MUTATING.has(plan.operation))) throw new Error('Only a READY workflow plan can execute');
  if (apply && !plan.mutation) throw new Error('Read-only workflow commands never accept --apply');
  const fresh = planWorkflow(plan.project, plan.operation, plan.options);
  if (fresh.fingerprint !== plan.fingerprint || !isOriginalDirectory(plan.project, plan.rootIdentity)) {
    throw new Error('Stale workflow plan: project, CEOS entry or arguments changed');
  }
  if (!plan.mutation) return transported(fresh, fresh.argv, false);
  if (!apply && plan.operation === 'continue') {
    const preview = transported(fresh, fresh.previewArgv, false);
    return preview.status === 'OK' ? { ...preview, status: 'READY', applied: false } : preview;
  }
  if (!apply) return fresh;
  return transported(fresh, fresh.argv, true);
}
