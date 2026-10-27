import { defineGame } from '@ludory/core';
import { inspectProject, planInit, planMigration, applyPlan } from './projects.mjs';
import { listCatalog, showCatalog } from './catalog.mjs';
import { planCreate, applyCreatePlan } from './scaffold.mjs';
import { planProfileApply, planProfileUpdate, profileStatus, applyProfilePlan } from './profile-management.mjs';
import { planWorkflow, executeWorkflow, planTaskRoute, discoverDevHost, readNativeRun,
  planDevDraft, executeDevDraft, planDevDraftImport, executeDevDraftImport,
  planNarrativeReview, executeNarrativeReview,
  planImageTask,
  planImageImport, executeImageImport, planArtReview, executeArtReview,
  installVendoredDevHelper } from '@ludory/ai';

const usage = `Ludory Studio 0.1.0 — native game-development workflows

  ludory inspect --project <directory> [--json]
  ludory init --project <empty-directory> --id <slug> --title <name> --lang <locale> --engine <id> --targets <comma-separated> [--version <semver>] [--apply] [--json]
  ludory migrate --project <existing-game> [--apply] [--json]
  ludory profiles list [--catalog <directory>] [--json]
  ludory profiles show --name <id> [--catalog <directory>] [--json]
  ludory profiles apply --project <game-directory> --name <id> [--catalog <directory>] [--apply] [--json]
  ludory profiles update --project <game-directory> [--catalog <directory>] [--apply] [--json]
  ludory profiles status --project <game-directory> [--catalog <directory>] [--json]
  ludory templates list [--catalog <directory>] [--json]
  ludory templates show --name <id> [--catalog <directory>] [--json]
  ludory create --project <empty-directory> --id <slug> --title <name> --lang <locale> --profile <id> --template <id> --targets <comma-separated> [--version <semver>] [--catalog <directory>] [--apply] [--json]
  ludory workflow doctor --project <game-directory> [--json]
  ludory workflow route --project <new-studio-game> --task <mechanics|episode-script|art-concept|image|functional-check> [--json]
  ludory workflow draft --project <new-studio-game> --run <id> --task <episode-script|art-concept> --brief <relative-text> [--source <relative;relative>] [--context-reviewed] [--apply] [--json]
  ludory workflow draft-import --project <new-studio-game> --run <id> --task <episode-script|art-concept> --brief <relative-text> --file <relative-draft> [--apply] [--json]
  ludory workflow narrative-review --project <new-studio-game> [--run <id|latest>] [--apply] [--json]
  ludory workflow image --project <new-studio-game> --run <id> --brief <relative-art-brief> [--apply] [--json]
  ludory workflow image-import --project <new-studio-game> --run <id> --brief <relative-text> --file <relative-image> --handoff-sha256 <sha256> [--apply] [--json]
  ludory workflow art-review --project <new-studio-game> --run <id> --image <imported-original> --source <scene:...;characters:...;location:...;style:...> --context-reviewed [--apply] [--json]
  ludory workflow status --project <game-directory> [--run <run-id|latest>] [--json]
  ludory workflow next --project <game-directory> [--run <run-id|latest>] [--json]
  ludory workflow start --project <game-directory> --pipeline <audit-repair-loop|production-art> --target <text> --in-scope <a;b> --acceptance <text> --mutation-boundary <text> [--out-of-scope <a;b>] [--apply] [--json]
  ludory workflow continue --project <game-directory> [--run <run-id|latest>] [--executor codex] [--apply] [--json]
  ludory workflow cycle --project <new-studio-game> --test <relative.test.js> [--run <run-id|latest>] [--repairs <0|1|2>] [--apply] [--json]
  ludory workflow recover --project <game-directory> [--run <run-id|latest>] [--confirm-no-executor] [--apply] [--json]
  ludory workflow checkpoint --project <game-directory> --stage <STAGE> [--run <run-id|latest>] [--artifact <path;path>] [--outcome <CONTINUE|PASS|FAIL|BLOCKED|ESCALATE>] [--apply] [--json]
  ludory helper install [--apply] [--json]
  ludory help

No writes by default. init/migrate --apply only create ludory.project.json;
create --apply only creates new template files, manifest and Studio receipt in an empty directory.
profiles apply/update only manage declarations inside .ludory/profiles; never edit game code or created template files.
workflow runs natively in Ludory AI; mutations require --apply and historical CEOS state is untouched.
workflow route is read-only: image routing hands the brief to a dedicated Codex image-generator subagent.
workflow draft preview never calls the DEV host; --apply probes only the isolated DEV helper and saves a review-only draft if the actual selected model is attested.
Without a verified DEV host, draft returns a manual handoff packet; draft-import records USER_DECLARED provenance, never HOST_OBSERVED or narrative PASS.
Episode-script drafts are automatically sent to a separate Web DEV narrative review turn after saving. A verified reviewer can ACCEPT or request REWORK, without granting release PASS or modifying scenes. Missing host leaves PENDING_REVIEW.
First, Web DEV drafts a source-aware art concept when authenticated and given adequate scene/style context;
otherwise the primary task model authors the brief in its own session (standalone CLI gives manual handoff).
Then the primary Codex agent delegates to a separate image-generator subagent inheriting its model.
That subagent invokes built-in $imagegen; no separate API key or programmatic image provider is used.
The built-in tool exposes no model or quality selector: request maximum fidelity in the prompt and use
the provider-selected model, whose identity cannot be attested by this CLI.
workflow image --apply returns a source-bound agent handoff only; the CLI cannot call Codex tools.
The primary agent imports the subagent's original with --handoff-sha256 from the generation packet.
image-import stores checked original PNG/JPEG/WebP bytes as USER_DECLARED; neither route grants art, rights or release PASS.
art-review --apply requires independent GPT-6 Sol(Web), source-locked references and an attested visual upload.
P0/P1 requires REWORK, P2 alone does not; after two REWORK receipts the task ESCALATES to the owner.
Artistic PASS_ART is never human, rights, platform or release acceptance. Actual Web host smoke is owner-operated.
Opt-in --executor codex executes a bounded Codex CLI task on --apply for new Studio-created games.
workflow cycle checks Codex-observed Node test execution with at most two repairs; it never automatically advances a stage.
Codex tool telemetry is not independent QA and cannot establish Release PASS.
Codex workspace-write may edit game files; in-scope paths are instructions, not enforced allowlists.
Without --executor, continue --apply still records a manual action request only.
workflow recover previews a failed interrupted result and requires --confirm-no-executor --apply.
Independent release PASS verification is not implemented.
Native development workflow accepts dirty or unversioned projects; Release verification is separate.
The legacy metadata-only migrate command requires clean Git and Starter Kit game-spec.yaml schema 2;
do not run it against frozen existing games. CEOS history import is not planned.
`;

function argumentsFor(command, argv) {
  const common = new Set(['--project', '--json']);
  const workflowCommon = [...common];
  const allowed = command.startsWith('workflow-')
    ? new Set(command === 'workflow-route' ? [...workflowCommon, '--task']
      : command === 'workflow-draft' ? [...workflowCommon, '--run', '--task', '--brief', '--source', '--context-reviewed', '--apply']
      : command === 'workflow-draft-import' ? [...workflowCommon, '--run', '--task', '--brief', '--file', '--apply']
      : command === 'workflow-narrative-review' ? [...workflowCommon, '--run', '--apply']
      : command === 'workflow-image' ? [...workflowCommon, '--run', '--brief', '--apply']
      : command === 'workflow-image-import' ? [...workflowCommon, '--run', '--brief', '--file', '--handoff-sha256', '--apply']
      : command === 'workflow-art-review' ? [...workflowCommon, '--run', '--image', '--source', '--context-reviewed', '--apply']
      : command === 'workflow-doctor' ? workflowCommon
      : command === 'workflow-status' || command === 'workflow-next' ? [...workflowCommon, '--run']
          : command === 'workflow-start' ? [...workflowCommon, '--pipeline', '--target', '--in-scope', '--acceptance', '--mutation-boundary', '--out-of-scope', '--apply']
            : command === 'workflow-continue' ? [...workflowCommon, '--run', '--executor', '--apply']
              : command === 'workflow-cycle' ? [...workflowCommon, '--run', '--test', '--repairs', '--apply']
              : command === 'workflow-recover' ? [...workflowCommon, '--run', '--confirm-no-executor', '--apply']
              : [...workflowCommon, '--run', '--stage', '--artifact', '--outcome', '--apply'])
    : command === 'helper-install' ? new Set(['--apply', '--json'])
    : command === 'init'
    ? new Set([...common, '--id', '--title', '--lang', '--engine', '--targets', '--version', '--apply'])
    : command === 'create'
      ? new Set([...common, '--id', '--title', '--lang', '--profile', '--template', '--targets', '--version', '--catalog', '--apply'])
      : command === 'migrate' ? new Set([...common, '--apply'])
        : command === 'profiles-list' || command === 'templates-list' ? new Set(['--json', '--catalog'])
          : command === 'profiles-show' || command === 'templates-show' ? new Set(['--json', '--catalog', '--name'])
            : command === 'profiles-apply' ? new Set([...common, '--name', '--catalog', '--apply'])
              : command === 'profiles-update' ? new Set([...common, '--catalog', '--apply'])
                : command === 'profiles-status' ? new Set([...common, '--catalog'])
            : common;
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!allowed.has(key)) throw new Error(`Unknown option: ${key}`);
    if (flags.has(key)) throw new Error(`Duplicate option: ${key}`);
    if (key === '--apply' || key === '--json' || key === '--confirm-no-executor' || key === '--context-reviewed') {
      flags.set(key, true);
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    flags.set(key, value);
  }
  if (!['helper-install', 'profiles-list', 'templates-list', 'profiles-show', 'templates-show'].includes(command) && !flags.get('--project')) {
    throw new Error('--project is required');
  }
  if (command.endsWith('-show') && !flags.get('--name')) throw new Error('--name is required for show');
  if (command === 'profiles-apply' && !flags.get('--name')) throw new Error('--name is required for profiles apply');
  return flags;
}

function workflowOptions(flags) {
  return {
    run: flags.get('--run'), pipeline: flags.get('--pipeline'),
    target: flags.get('--target'), inScope: flags.get('--in-scope'), outOfScope: flags.get('--out-of-scope'),
    acceptance: flags.get('--acceptance'), mutationBoundary: flags.get('--mutation-boundary'),
    stage: flags.get('--stage'), artifact: flags.get('--artifact'), outcome: flags.get('--outcome'),
    executor: flags.get('--executor'),
    test: flags.get('--test'), repairs: flags.get('--repairs'),
    confirmNoExecutor: flags.has('--confirm-no-executor') ? true : undefined,
  };
}

function displayWorkflow(result, json, out) {
  if (json) { out(`${JSON.stringify(result, null, 2)}\n`); return; }
  out(`${result.status} · ${result.project}\n`);
  if (result.engine) out(`  engine: ${result.engine}\n`);
  if (result.nativeStatus) out(`  native status: ${result.nativeStatus}\n`);
  if (result.executor) out(`  executor: ${result.executor}\n`);
  if (result.taskKind) out(`  task: ${result.taskKind}\n`);
  if (result.preferredRoute) out(`  preferred route: ${result.preferredRoute}\n`);
  if (result.selectedRoute) out(`  selected route: ${result.selectedRoute}\n`);
  if (result.reasonCode) out(`  reason: ${result.reasonCode}\n`);
  if (result.capabilityReasonCode) out(`  capability: ${result.capabilityReasonCode}\n`);
  for (const [producer, reason] of Object.entries(result.capabilityReasons ?? {})) {
    out(`  ${producer} capability: ${reason}\n`);
  }
  if (result.warning) out(`  warning: ${result.warning}\n`);
  if (result.executorCode) out(`  result: ${result.executorCode}\n`);
  if (result.provenance) out(`  provenance: ${result.provenance}\n`);
  if (result.verdict) out(`  art verdict: ${result.verdict}\n`);
  if (result.receiptPath) out(`  receipt: ${result.receiptPath}\n`);
  if (result.narrativeReview?.verdict) out(`  narrative verdict: ${result.narrativeReview.verdict}\n`);
  if (result.review?.verdict) out(`  narrative verdict: ${result.review.verdict}\n`);
  if (result.manualPacket?.skill === '$imagegen') {
    out('  imagegen: delegate to a separate Codex image-generator subagent inheriting the parent model\n');
    out('  subagent: invoke $imagegen using the source-bound packet; stop if delegation or skill is unavailable\n');
    out('  session: CEOS is not required by Ludory; if a mandatory session policy conflicts, stop and report it\n');
    out('  prompt: rerun with --json to access manualPacket.prompt and its brief hash\n');
    out('  after generation: save the original and import with --handoff-sha256 from the packet\n');
  }
  if (result.modelRequested) out(`  requested image model: ${result.modelRequested}\n`);
  if (result.output?.outputPath) out(`  artifact: ${result.output.outputPath}\n`);
  for (const item of result.images ?? []) out(`  image: ${item.outputPath} · ${item.outputSha256}\n`);
  if (result.nextAction?.kind) out(`  next: ${result.nextAction.kind}\n`);
  for (const run of result.runs ?? []) out(`  run: ${run.runId} · ${run.status} · ${run.nextStage ?? 'terminal'}\n`);
  if (result.status === 'READY') for (const item of result.writes ?? []) out(`  planned: ${item}\n`);
  for (const conflict of result.conflicts ?? []) out(`  blocked: ${conflict}\n`);
}

function displayHelperSupply(result, json, out) {
  if (json) { out(`${JSON.stringify(result, null, 2)}\n`); return; }
  out(`${result.status} · ${result.profileHome ?? 'DEV profile'}\n`);
  if (result.artifact) out(`  helper: ${result.artifact.file} · ${result.artifact.sha256}\n`);
  if (result.launcher) out(`  launcher: ${result.launcher}\n`);
  for (const file of result.writes ?? []) out(`  ${result.status === 'APPLIED' ? 'written' : 'planned'}: ${file}\n`);
  if (result.warning) out(`  warning: ${result.warning}\n`);
  if (result.reasonCode) out(`  reason: ${result.reasonCode}\n`);
}

async function runDraftCommand(operation, flags, { out, devHost }) {
  const project = flags.get('--project');
  const options = { run: flags.get('--run'), taskKind: flags.get('--task'), brief: flags.get('--brief') };
  let result;
  let usedHost = null;
  const maybeReview = async (draftResult, host) => {
    if (!flags.has('--apply') || options.taskKind !== 'episode-script' ||
        draftResult.status !== 'PENDING_REVIEW') return draftResult;
    const initial = planNarrativeReview(project, { run: draftResult.runId });
    if (initial.status === 'BLOCKED') return { ...draftResult, status: 'BLOCKED',
      reasonCode: initial.reasonCode, narrativeReview: initial, nextAction: initial.nextAction };
    if (!host || typeof host.probe !== 'function' || typeof host.turn !== 'function') {
      return { ...draftResult, reasonCode: 'REVIEW_WEB_DEV_UNAVAILABLE', narrativeReview: initial,
        nextAction: { kind: 'AWAIT_VERIFIED_REVIEWER', executable: false } };
    }
    let capability;
    try { capability = await host.probe(); }
    catch { return { ...draftResult, reasonCode: 'REVIEW_WEB_DEV_UNAVAILABLE', narrativeReview: initial,
      nextAction: { kind: 'AWAIT_VERIFIED_REVIEWER', executable: false } }; }
    const ready = planNarrativeReview(project, { run: draftResult.runId }, { discover: () => capability });
    if (ready.status !== 'READY') return { ...draftResult,
      status: ready.status === 'BLOCKED' ? 'BLOCKED' : draftResult.status,
      reasonCode: ready.reasonCode, narrativeReview: ready, nextAction: ready.nextAction };
    const reviewed = await executeNarrativeReview(ready, { apply: true, host });
    return { ...draftResult, status: reviewed.status, narrativeReview: reviewed.review,
      reviewProvenance: reviewed.provenance, nextAction: reviewed.nextAction };
  };
  try {
    if (operation === 'draft-import') {
      const preview = planDevDraftImport(project, { ...options, file: flags.get('--file') });
      result = executeDevDraftImport(preview, { apply: flags.has('--apply') });
      if (result.status === 'PENDING_REVIEW' && options.taskKind === 'episode-script') {
        const preflight = planNarrativeReview(project, { run: result.runId });
        if (preflight.status === 'BLOCKED') result = await maybeReview(result, null);
        else {
          usedHost = devHost();
          result = await maybeReview(result, usedHost);
        }
      }
    } else {
      const sourceText = flags.get('--source');
      const sources = sourceText === undefined ? [] : sourceText.split(';');
      const context = { ...options, sources, contextReviewed: flags.has('--context-reviewed') };
      const preview = planDevDraft(project, context);
      if (!flags.has('--apply') || preview.status === 'BLOCKED') result = preview;
      else {
        const host = devHost();
        usedHost = host;
        if (!host || typeof host.probe !== 'function') result = preview;
        else {
          const capability = await host.probe();
          const ready = planDevDraft(project, context, { discover: () => capability });
          result = await executeDevDraft(ready, { apply: true, host });
          result = await maybeReview(result, host);
        }
      }
    }
  } finally {
    if (typeof usedHost?.close === 'function') {
      try { await usedHost.close(); } catch { /* Native journal state remains authoritative. */ }
    }
  }
  displayWorkflow(result, flags.has('--json'), out);
  return ['BLOCKED', 'REWORK'].includes(result.status) ||
    (flags.has('--apply') && result.status === 'NEEDS_USER_ACTION') ? 2 : 0;
}

async function runNarrativeReviewCommand(flags, { out, devHost }) {
  const project = flags.get('--project');
  const options = { run: flags.get('--run') ?? 'latest' };
  let result = planNarrativeReview(project, options);
  if (flags.has('--apply') && result.status === 'NEEDS_USER_ACTION') {
    const host = devHost();
    try {
      if (host && typeof host.probe === 'function') {
        const capability = await host.probe();
        const ready = planNarrativeReview(project, options, { discover: () => capability });
        result = await executeNarrativeReview(ready, { apply: true, host });
      }
    } finally {
      if (typeof host?.close === 'function') { try { await host.close(); } catch { /* recorded */ } }
    }
  }
  displayWorkflow(result, flags.has('--json'), out);
  return result.status === 'PENDING_RECOVERY' ? 3 :
    ['BLOCKED', 'REWORK'].includes(result.status) ||
    (flags.has('--apply') && result.status === 'NEEDS_USER_ACTION') ? 2 : 0;
}

async function runImageCommand(operation, flags, { out }) {
  const project = flags.get('--project');
  const options = { run: flags.get('--run'), brief: flags.get('--brief') };
  let result;
  if (operation === 'image-import') {
    const plan = await planImageImport(project, { ...options, file: flags.get('--file'),
      handoffSha256: flags.get('--handoff-sha256') });
    result = await executeImageImport(plan, { apply: flags.has('--apply') });
  } else {
    // Agent handoff: --apply never triggers a paid HTTP request or impersonates a tool call.
    result = await planImageTask(project, options);
  }
  displayWorkflow(result, flags.has('--json'), out);
  return result.status === 'BLOCKED' || (flags.has('--apply') && result.status === 'NEEDS_USER_ACTION') ? 2 : 0;
}

async function runArtReviewCommand(flags, { out, devHost }) {
  const project = flags.get('--project');
  const context = { run: flags.get('--run'), image: flags.get('--image'),
    sources: flags.has('--source') ? flags.get('--source').split(';') : [],
    contextReviewed: flags.has('--context-reviewed') };
  let result = planArtReview(project, context);
  if (flags.has('--apply') && result.status === 'NEEDS_USER_ACTION') {
    const host = devHost();
    if (host?.probe && host?.turn) {
      try {
        const capability = await host.probe();
        const ready = planArtReview(project, context, { discover: () => capability });
        result = await executeArtReview(ready, { apply: true, host });
      } finally {
        if (typeof host.close === 'function') {
          try { await host.close(); } catch { /* Review ledger is authoritative. */ }
        }
      }
    }
  }
  displayWorkflow(result, flags.has('--json'), out);
  return result.status === 'ESCALATE' ? 3
    : result.status === 'BLOCKED' || (flags.has('--apply') && result.status === 'NEEDS_USER_ACTION') ? 2 : 0;
}

function parsedTargets(flags) {
  const targets = flags.get('--targets').split(',').map(s => s.trim());
  if (targets.some(s => !s)) throw new Error('Empty target identifier');
  return targets;
}

function initDefinition(flags) {
  for (const key of ['--id', '--title', '--lang', '--engine', '--targets']) {
    if (!flags.has(key)) throw new Error(`${key} is required for init`);
  }
  return defineGame({
    schemaVersion: 1,
    id: flags.get('--id'),
    version: flags.get('--version') || '0.1.0',
    title: { [flags.get('--lang')]: flags.get('--title') },
    engine: flags.get('--engine'),
    targets: parsedTargets(flags),
  });
}

function createOptions(flags) {
  for (const key of ['--id', '--title', '--lang', '--profile', '--template', '--targets']) {
    if (!flags.has(key)) throw new Error(`${key} is required for create`);
  }
  return {
    id: flags.get('--id'), title: flags.get('--title'), lang: flags.get('--lang'),
    profile: flags.get('--profile'), template: flags.get('--template'),
    version: flags.get('--version') || '0.1.0', targets: parsedTargets(flags),
    catalog: flags.get('--catalog'),
  };
}

function display(result, json, out) {
  if (json) {
    out(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.status === 'OK' && result.kind) {
    const items = result[result.kind];
    if (items) {
      out(`${result.kind}:\n`);
      for (const item of items) out(`  ${item.id} (${item.version}) — ${item.description}\n`);
    } else {
      const item = result[result.kind.slice(0, -1)];
      out(`${result.kind}: ${item.id} (${item.version})\n`);
      out(`  ${item.description}\n`);
    }
    return;
  }
  out(`${result.status} · ${result.project}\n`);
  for (const item of result.writes) {
    const action = result.status === 'APPLIED'
      ? result.mode.startsWith('profile-') ? 'applied' : 'created'
      : result.mode === 'profile-update' ? 'would update' : 'would create';
    out(`  ${action}: ${item}\n`);
  }
  for (const problem of result.conflicts) out(`  blocked: ${problem}\n`);
  if (result.manifest) out(`  id: ${result.manifest.id} · version: ${result.manifest.version}\n`);
  if (result.profile) out(`  profile: ${result.profile.id} · version: ${result.profile.version}\n`);
}

/** Pure command boundary; inject streams to test status/output without child processes. */
export function runCli(argv, { out = text => process.stdout.write(text), err = text => process.stderr.write(text),
  executor, devHost = discoverDevHost } = {}) {
  try {
    const [command = 'help', ...rest] = argv;
    if (command === 'help' || command === '--help') {
      if (rest.length) throw new Error('help takes no options');
      out(usage);
      return 0;
    }
    if (command === 'workflow') {
      const [operation, ...args] = rest;
      if (!['doctor', 'route', 'draft', 'draft-import', 'narrative-review', 'image', 'image-import', 'art-review', 'status', 'next', 'start', 'continue', 'cycle', 'checkpoint', 'recover'].includes(operation)) {
        throw new Error(`Unknown workflow operation: ${operation || '(missing)'}`);
      }
      const flags = argumentsFor(`workflow-${operation}`, args);
      if (operation === 'draft' || operation === 'draft-import') {
        return runDraftCommand(operation, flags, { out, devHost }).catch(error => {
          let pending = false;
          try { const state = readNativeRun(flags.get('--project'), flags.get('--run'));
            pending = flags.has('--apply') && (state.pendingExecutor === 'web-dev' ||
              !!state.pendingNarrativeReview); }
          catch { /* Unavailable run is an ordinary failure, not verified uncertainty. */ }
          const result = pending ? {
            engine: 'ludory-ai', operation, status: 'PENDING_RECOVERY',
            project: flags.get('--project'), nativeStatus: 'WAITING_FOR_EVIDENCE',
            reasonCode: 'DEV_EXECUTION_OUTCOME_UNKNOWN', writes: [], conflicts: [],
            warning: 'A DEV generation or narrative review may still be running. Stop/verify the old helper before workflow recover --confirm-no-executor --apply.',
            nextAction: { kind: 'CONFIRM_EXECUTOR_STOPPED', executable: false },
          } : { operation, status: 'FAILED', project: flags.get('--project'),
            writes: [], conflicts: [error.message] };
          if (flags.has('--json') || pending) displayWorkflow(result, flags.has('--json'), out);
          else err(`Ludory: ${error.message}\n`);
          return pending ? 3 : 1;
        });
      }
      if (operation === 'narrative-review') {
        return runNarrativeReviewCommand(flags, { out, devHost }).catch(error => {
          let pending = false;
          try { pending = !!readNativeRun(flags.get('--project'), flags.get('--run')).pendingNarrativeReview; }
          catch { /* No verified review request. */ }
          const result = { engine: 'ludory-ai', operation, project: flags.get('--project'),
            status: pending ? 'PENDING_RECOVERY' : 'FAILED', writes: [],
            reasonCode: pending ? 'REVIEW_OUTCOME_UNKNOWN' : 'REVIEW_FAILED',
            conflicts: pending ? [] : [error.message],
            nextAction: { kind: pending ? 'CONFIRM_REVIEWER_STOPPED' : 'STOP', executable: false } };
          displayWorkflow(result, flags.has('--json'), out);
          return pending ? 3 : 1;
        });
      }
      if (operation === 'image' || operation === 'image-import') {
        return runImageCommand(operation, flags, { out }).catch(error => {
          let pending = false;
          try { pending = operation === 'image' && flags.has('--apply') &&
            readNativeRun(flags.get('--project'), flags.get('--run')).pendingExecutor === 'image-gen'; }
          catch { /* No pending run can be inferred from absent metadata. */ }
          const result = pending ? { engine: 'ludory-ai', operation, status: 'PENDING_RECOVERY',
            project: flags.get('--project'), nativeStatus: 'WAITING_FOR_EVIDENCE',
            reasonCode: 'IMAGE_EXECUTION_OUTCOME_UNKNOWN', writes: [], conflicts: [],
            warning: 'A historical image host request may still be running. Confirm the host is stopped before workflow recover --confirm-no-executor --apply.',
            nextAction: { kind: 'CONFIRM_EXECUTOR_STOPPED', executable: false },
          } : { operation, status: 'FAILED', project: flags.get('--project'),
            writes: [], conflicts: [error.message] };
          if (flags.has('--json') || pending) displayWorkflow(result, flags.has('--json'), out);
          else err(`Ludory: ${error.message}\n`);
          return pending ? 3 : 1;
        });
      }
      if (operation === 'art-review') {
        return runArtReviewCommand(flags, { out, devHost }).catch(error => {
          const result = { engine: 'ludory-ai', operation, status: 'FAILED',
            project: flags.get('--project'), writes: [], conflicts: [error.message] };
          if (flags.has('--json')) displayWorkflow(result, true, out);
          else err(`Ludory: ${error.message}\n`);
          return 1;
        });
      }
      if (operation === 'route') {
        const plan = planTaskRoute(flags.get('--project'), {
          taskKind: flags.get('--task'),
        });
        displayWorkflow(plan, flags.has('--json'), out);
        return plan.status === 'BLOCKED' ? 2 : 0;
      }
      const plan = planWorkflow(flags.get('--project'), operation, workflowOptions(flags));
      const result = executeWorkflow(plan, { apply: flags.has('--apply'), executor });
      displayWorkflow(result, flags.has('--json'), out);
      return ['BLOCKED', 'CONFLICT'].includes(result.status) ? 2 : result.status === 'ESCALATE' ? 3
        : ['FAILED', 'FAILED_CHECKS'].includes(result.status) ? 1 : 0;
    }
    if (command === 'helper') {
      const [operation, ...args] = rest;
      if (operation !== 'install') throw new Error(`Unknown helper operation: ${operation || '(missing)'}`);
      const flags = argumentsFor('helper-install', args);
      try {
        const result = installVendoredDevHelper({ apply: flags.has('--apply') });
        displayHelperSupply(result, flags.has('--json'), out);
        return 0;
      } catch (error) {
        const result = { status: 'BLOCKED', reasonCode: error.code ?? 'DEV_HELPER_INSTALL_FAILED',
          writes: [], conflicts: [error.message] };
        displayHelperSupply(result, flags.has('--json'), out);
        return 2;
      }
    }
    if (command === 'profiles' || command === 'templates') {
      const [operation, ...args] = rest;
      const operations = command === 'profiles' ? ['list', 'show', 'apply', 'update', 'status'] : ['list', 'show'];
      if (!operations.includes(operation)) throw new Error(`Unknown ${command} operation: ${operation || '(missing)'}`);
      const flags = argumentsFor(`${command}-${operation}`, args);
      if (command === 'profiles' && ['apply', 'update', 'status'].includes(operation)) {
        const project = flags.get('--project');
        const catalog = flags.get('--catalog');
        const preview = operation === 'apply' ? planProfileApply(project, { name: flags.get('--name'), catalog })
          : operation === 'update' ? planProfileUpdate(project, { catalog }) : profileStatus(project, { catalog });
        const result = flags.get('--apply') && preview.status === 'READY' ? applyProfilePlan(preview) : preview;
        display(result, flags.has('--json'), out);
        return ['BLOCKED', 'CONFLICT'].includes(result.status) ? 2 : 0;
      }
      const item = operation === 'show' ? showCatalog(command, flags.get('--name'), flags.get('--catalog')) : null;
      const data = operation === 'list' ? listCatalog(command, flags.get('--catalog')) : null;
      const result = item ? { status: 'OK', kind: command, [command.slice(0, -1)]: item }
        : { status: 'OK', kind: command, [command]: data };
      display(result, flags.has('--json'), out);
      return 0;
    }
    if (!['init', 'inspect', 'migrate', 'create'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const flags = argumentsFor(command, rest);
    const project = flags.get('--project');
    const preview = command === 'init' ? planInit(project, initDefinition(flags))
      : command === 'migrate' ? planMigration(project)
        : command === 'create' ? planCreate(project, createOptions(flags)) : inspectProject(project);
    const result = flags.get('--apply') && preview.status === 'READY'
      ? command === 'create' ? applyCreatePlan(preview) : applyPlan(preview) : preview;
    display(result, flags.has('--json'), out);
    return ['BLOCKED', 'CONFLICT'].includes(result.status) ? 2 : 0;
  } catch (error) {
    if (argv[0] === 'workflow' && argv.includes('--json')) {
      const projectIndex = argv.indexOf('--project');
      const result = { mode: `workflow-${argv[1] ?? 'unknown'}`, project: projectIndex < 0 ? null : (argv[projectIndex + 1] ?? null),
        status: 'FAILED', writes: [], conflicts: [error.message] };
      displayWorkflow(result, true, out);
      return 1;
    }
    err(`Ludory: ${error.message}\n`);
    return 1;
  }
}
