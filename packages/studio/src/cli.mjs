import fs from 'node:fs';
import path from 'node:path';
import { defineGame } from '@ludory/core';
import { checkYandexRelease, checkVkCandidate, planYandexFieldTests, simulateModeration, prepareQaReviewPacket } from '@ludory/release';
import { inspectProject, planInit, planMigration, applyPlan } from './projects.mjs';
import { listCatalog, showCatalog } from './catalog.mjs';
import { planCreate, applyCreatePlan } from './scaffold.mjs';
import { runPreviewCli } from './preview-cli.mjs';
import { planComponentUpdate, planAuthorAdoption, componentStatus, applyComponentPlan,
  previewComponentTrust, acceptComponentTrust,
  previewComponentGitRecovery, acceptComponentGitRecovery } from './component-updates.mjs';
import { inspectWindowsDirectoryPin } from './windows-directory-pin.mjs';
import { planProfileApply, planProfileUpdate, profileStatus, applyProfilePlan } from './profile-management.mjs';
import { planQaWebReview } from './qa-review-contract.mjs';
import { inspectQaJournal } from './qa-review-journal.mjs';
import { executeQaWebReview, restartQaWebReview } from './qa-review.mjs';
import { planQaRepair } from './qa-repair-scope.mjs';
import { beginQaRepair, inspectQaRepair, startQaRepairRound,
  completeQaRepairRound } from './qa-repair-journal.mjs';
import { planWorkflow, executeWorkflow, planTaskRoute, discoverDevHost, readNativeRun,
  planDevDraft, executeDevDraft, planDevDraftImport, executeDevDraftImport,
  planNarrativeReview, executeNarrativeReview,
  planImageTask,
  planImageImport, executeImageImport, planArtReview, executeArtReview,
  planQualityEnable, applyQualityEnable, planQualityCheck, executeQualityCheck,
  qualityStatus, planQualityEvidence, snapshotQualitySource,
  installVendoredDevHelper } from '@ludory/ai';

const studioVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const usage = `Ludory Studio ${studioVersion} — native game-development workflows

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
  ludory preview --project <new-studio-game> [--target <web|yandex|vk>] [--lan] [--port <4173>] [--json]
  ludory components status --project <new-studio-game> [--catalog <directory>] [--json]
  ludory components update --project <new-studio-game> [--catalog <directory>] [--apply] [--json]
  ludory components adopt --project <legacy-narrative> [--catalog <directory>] [--accept-state-sha256 <sha256> --accept-proposal-sha256 <sha256> --apply] [--json]
  ludory components trust --project <transferred-studio-game> [--catalog <directory>] [--accept-state-sha256 <64-hex> --apply] [--json]
  ludory components recover --project <transferred-studio-game> --from-commit <full-40-hex> --to-commit <full-40-hex> [--catalog <directory>] [--accept-recovery-sha256 <64-hex> --apply] [--json]
  ludory components native [--json]
  ludory quality enable --project <new-studio-game> [--apply] [--json]
  ludory quality check --project <new-studio-game> [--tier <quick|deep>] [--apply] [--json]
  ludory quality status --project <new-studio-game> [--json]
  ludory quality evidence --project <new-studio-game> [--run <quality-id|latest>] [--json]
  ludory release check --archive <candidate.zip> --receipt <build-receipt.json> --sdk-evidence <yandex-c5-contract.json> --rights <rights.json> [--json]
  ludory release plan --archive <candidate.zip> --receipt <build-receipt.json> --sdk-evidence <yandex-c5-contract.json> --rights <rights.json> [--field-evidence <self-report.json>] [--json]
  ludory release vk-check --archive <vk-candidate.zip> --receipt <vk-build-receipt.json> [--json]
  ludory qa simulate --target <yandex-games|vk-games> --archive <candidate.zip> --receipt <receipt.json> [--sdk-evidence <json>] [--rights <json>] [--metadata <json> --promo-root <directory>] [--json]
  ludory qa capture --target <yandex-games|vk-games> --archive <candidate.zip> --receipt <receipt.json> --output <new-directory> --trusted [--engine <chromium|firefox|webkit>] [--flow <flow.json>] [--timeout-ms <1000..30000>] [--json]
  ludory qa handoff --target <yandex-games|vk-games> --archive <candidate.zip> --receipt <receipt.json> --metadata <json> --promo-root <directory> --evidence-dir <directory> [--sdk-evidence <json>] [--rights <json>] [--report-sha256 <sha256>] [--json]
  ludory qa review --target <yandex-games|vk-games> --archive <candidate.zip> --receipt <receipt.json> --metadata <json> --promo-root <directory> --evidence-dir <directory> --output <new-directory> [--sdk-evidence <json>] [--rights <json>] [--report-sha256 <sha256>] [--apply] [--json]
  ludory qa review-status --output <existing-directory> [--json]
  ludory qa review-restart --target <yandex-games|vk-games> --archive <candidate.zip> --receipt <receipt.json> --metadata <json> --promo-root <directory> --evidence-dir <directory> --previous <pending-directory> --output <new-directory> [--sdk-evidence <json>] [--rights <json>] [--report-sha256 <sha256>] [--confirm-reviewer-stopped] [--apply] [--json]
  ludory qa repair --project <new-studio-game> --review-output <observed-p3c-journal> --output <new-session-directory> --in-scope <relative;paths> --mutation-boundary <text> [--repair --apply] [--json]
  ludory qa repair-status --output <session-directory> [--json]
  ludory qa repair-next --output <session-directory> [--apply] [--json]
  ludory qa repair-record --output <session-directory> --review-output <fresh-p3c-journal> [--apply] [--json]
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
  ludory workflow recover-storage --project <game-directory> --run <run-id> [--confirm-no-executor] [--apply] [--json]
  ludory workflow checkpoint --project <game-directory> --stage <STAGE> [--run <run-id|latest>] [--artifact <path;path>] [--outcome <CONTINUE|PASS|FAIL|BLOCKED|ESCALATE>] [--apply] [--json]
  ludory helper install [--apply] [--json]
  ludory help

No writes by default. init/migrate --apply only create ludory.project.json;
create --apply only creates new template files, manifest and Studio receipt in an empty directory.
components update previews unless --apply; only explicitly Studio-managed files may change.
Any edited managed file or missing ownership state blocks update; original inodes remain in recoverable project-local backups.
Automatic updates require an independent per-user host trust registry. Transferred projects require inspected, explicit SHA-256 acceptance.
profiles apply/update only manage declarations inside .ludory/profiles; never edit game code or created template files.
Engineering Quality is opt-in and project-scoped; it runs tools only in the Codex sandbox, records bounded local evidence, and never grants Release PASS.
workflow runs natively in Ludory AI; mutations require --apply and historical CEOS state is untouched.
Native AI mutations require a new game created by Studio with matching independent host trust registration.
Copying ludory.studio.json alone cannot authorize a game; STUDIO_ORIGIN blockers mean stop, never auto-enroll.
Transferred, restored or previously existing games remain read-only until a separately approved trust procedure.
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
art-review --apply requires independent GPT-6 Sol Instant(Web) at low reasoning, source-locked references and an attested visual upload.
P0/P1 requires REWORK, P2 alone does not; after two REWORK receipts the task ESCALATES to the owner.
Artistic PASS_ART is never human, rights, platform or release acceptance. Actual Web host smoke is owner-operated.
Opt-in --executor codex executes a bounded Codex CLI task on --apply for new Studio-created games.
workflow cycle checks Codex-observed Node test execution with at most two repairs; it never automatically advances a stage.
Codex tool telemetry is not independent QA and cannot establish Release PASS.
Codex workspace-write may edit game files; in-scope paths are instructions, not enforced allowlists.
Without --executor, continue --apply still records a manual action request only.
workflow recover previews a failed interrupted result and requires --confirm-no-executor --apply.
Release R1 checks local Yandex ZIP/hash, fake-SDK C5 evidence and rights declarations read-only.
Release R2 plans real Yandex field tests; self-reported PASS never becomes verified platform PASS.
PASS_LOCAL and READY_FOR_FIELD_TEST never grant rights clearance, SDK approval or publication authority.
QA simulation examines candidate-bound local evidence only; browser, visual, content and real platform moderation remain NOT_RUN.
The QA report never grants release readiness, a moderation verdict, or permission to publish.
qa review previews five original images without uploads by default. --apply uses a separate, verified Web DEV turn per image;
each upload must have browser-observed creation, processing completion and visible attachment evidence.
An uncertain request stops in PENDING_RECOVERY without auto-retry. review-status reads a local audit, not a live browser attestation.
review-restart requires original inputs, a fresh output directory, explicit stopped-reviewer confirmation and --apply;
the fresh review uploads all five originals again, potentially consuming quota. Neither review authorizes release or publication.
qa repair --repair --apply pins one owner consent to two at-most Codex-agent rounds in a new Studio game.
The repair CLI never edits source or calls Codex/Web; repair-next persists a one-time intent and hands authorized paths to the primary agent.
After each patch the agent must rebuild, recapture and complete a fresh five-image Web review; repair-record stores only local recorded evidence.
An uncertain round remains PENDING_RECOVERY, unauthorized edits ESCALATE, and a local journal never grants independent reviewer or platform PASS.
Native development workflow accepts dirty or unversioned projects; Release verification is separate.
The legacy metadata-only migrate command requires clean Git and Starter Kit game-spec.yaml schema 2;
do not run it against frozen existing games. CEOS history import is not planned.
`;

function argumentsFor(command, argv) {
  const common = new Set(['--project', '--json']);
  const workflowCommon = [...common];
  const allowed = command === 'preview' ? new Set([...common, '--target', '--lan', '--port'])
    : command === 'qa-simulate'
    ? new Set(['--target', '--archive', '--receipt', '--sdk-evidence', '--rights', '--metadata', '--promo-root', '--json'])
    : command === 'qa-capture'
    ? new Set(['--target', '--archive', '--receipt', '--sdk-evidence', '--rights', '--metadata', '--promo-root', '--output', '--trusted', '--engine', '--flow', '--timeout-ms', '--json'])
    : command === 'qa-handoff'
    ? new Set(['--target', '--archive', '--receipt', '--sdk-evidence', '--rights', '--metadata', '--promo-root', '--evidence-dir', '--report-sha256', '--json'])
    : command === 'qa-review' || command === 'qa-review-restart'
    ? new Set(['--target', '--archive', '--receipt', '--sdk-evidence', '--rights', '--metadata', '--promo-root', '--evidence-dir', '--report-sha256', '--output', '--apply', '--json',
      ...(command === 'qa-review-restart' ? ['--previous', '--confirm-reviewer-stopped'] : [])])
    : command === 'qa-review-status'
    ? new Set(['--output', '--json'])
    : command === 'qa-repair'
    ? new Set([...common, '--review-output', '--output', '--in-scope', '--mutation-boundary', '--repair', '--apply'])
    : command === 'qa-repair-record'
    ? new Set(['--output', '--review-output', '--apply', '--json'])
    : command === 'qa-repair-next'
    ? new Set(['--output', '--apply', '--json'])
    : command === 'qa-repair-status'
    ? new Set(['--output', '--json'])
    : command.startsWith('quality-')
    ? new Set(command === 'quality-enable' ? [...common, '--apply']
      : command === 'quality-check' ? [...common, '--tier', '--apply']
        : command === 'quality-evidence' ? [...common, '--run'] : common)
    : command === 'release-vk-check'
    ? new Set(['--archive', '--receipt', '--json'])
    : command === 'release-check' || command === 'release-plan'
    ? new Set(['--archive', '--receipt', '--sdk-evidence', '--rights', '--json',
      ...(command === 'release-plan' ? ['--field-evidence'] : [])])
    : command.startsWith('workflow-')
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
              : command === 'workflow-recover' || command === 'workflow-recover-storage' ? [...workflowCommon, '--run', '--confirm-no-executor', '--apply']
              : [...workflowCommon, '--run', '--stage', '--artifact', '--outcome', '--apply'])
    : command === 'helper-install' ? new Set(['--apply', '--json'])
    : command === 'components-native' ? new Set(['--json'])
    : command === 'init'
    ? new Set([...common, '--id', '--title', '--lang', '--engine', '--targets', '--version', '--apply'])
    : command === 'create'
      ? new Set([...common, '--id', '--title', '--lang', '--profile', '--template', '--targets', '--version', '--catalog', '--apply'])
      : command === 'components-update' ? new Set([...common, '--catalog', '--apply'])
        : command === 'components-adopt' ? new Set([...common, '--catalog', '--apply', '--accept-state-sha256', '--accept-proposal-sha256'])
        : command === 'components-trust' ? new Set([...common, '--catalog', '--apply', '--accept-state-sha256'])
        : command === 'components-recover' ? new Set([...common, '--catalog', '--from-commit', '--to-commit', '--apply', '--accept-recovery-sha256'])
        : command === 'components-status' ? new Set([...common, '--catalog'])
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
    if (key === '--apply' || key === '--json' || key === '--lan' || key === '--trusted' || key === '--repair' || key === '--confirm-no-executor' || key === '--confirm-reviewer-stopped' || key === '--context-reviewed') {
      flags.set(key, true);
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    flags.set(key, value);
  }
  if (!['helper-install', 'components-native', 'profiles-list', 'templates-list', 'profiles-show', 'templates-show', 'release-check', 'release-plan', 'release-vk-check', 'qa-simulate', 'qa-capture', 'qa-handoff', 'qa-review', 'qa-review-status', 'qa-review-restart', 'qa-repair-status', 'qa-repair-next', 'qa-repair-record'].includes(command) && !flags.get('--project')) {
    throw new Error('--project is required');
  }
  if (command === 'release-check' || command === 'release-plan') {
    for (const option of ['--archive', '--receipt', '--sdk-evidence', '--rights']) {
      if (!flags.has(option)) throw new Error(`${option} is required`);
    }
  }
  if (command === 'release-vk-check' && (!flags.has('--archive') || !flags.has('--receipt'))) {
    throw new Error('VK release check requires --archive and --receipt');
  }
  if (command === 'qa-handoff') {
    for (const option of ['--target', '--archive', '--receipt', '--metadata', '--promo-root', '--evidence-dir']) {
      if (!flags.has(option)) throw new Error(`${option} is required for QA review handoff`);
    }
  }
  if (command === 'qa-review' || command === 'qa-review-restart') {
    for (const option of ['--target', '--archive', '--receipt', '--metadata', '--promo-root', '--evidence-dir', '--output',
      ...(command === 'qa-review-restart' ? ['--previous'] : [])]) {
      if (!flags.has(option)) throw new Error(`${option} is required for QA Web review`);
    }
  }
  if (command === 'qa-review-status' && !flags.has('--output')) {
    throw new Error('--output is required for QA Web review status');
  }
  if (command === 'qa-repair') {
    for (const flag of ['--review-output', '--output', '--in-scope', '--mutation-boundary']) {
      if (!flags.has(flag)) throw new Error(`${flag} is required for QA repair authorization`);
    }
    if (flags.has('--apply') && !flags.has('--repair')) {
      throw new Error('--apply for QA repair requires explicit --repair consent');
    }
  }
  if (['qa-repair-status', 'qa-repair-next', 'qa-repair-record'].includes(command)) {
    if (!flags.has('--output')) throw new Error('--output is required for QA repair status/round');
    if (command === 'qa-repair-record' && !flags.has('--review-output')) {
      throw new Error('--review-output is required for a fresh QA repair reinspection');
    }
  }
  if (command === 'qa-capture') {
    for (const option of ['--target', '--archive', '--receipt', '--output', '--trusted']) {
      if (!flags.has(option)) throw new Error(`${option} is required for trusted QA capture`);
    }
  }
  if (command === 'qa-simulate') {
    for (const option of ['--target', '--archive', '--receipt']) {
      if (!flags.has(option)) throw new Error(`${option} is required`);
    }
    if (flags.get('--target') === 'yandex-games') {
      for (const option of ['--sdk-evidence', '--rights']) {
        if (!flags.has(option)) throw new Error(`${option} is required for Yandex QA simulation`);
      }
    }
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
  if (result.quality) {
    out(`  engineering quality: ${result.quality.status} · ${result.quality.tier ?? 'quick'}\n`);
    if (result.quality.reasonCode) out(`  quality reason: ${result.quality.reasonCode}\n`);
    if (result.quality.qualityRunId) out(`  quality evidence: ${result.quality.qualityRunId}\n`);
  }
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
  return result.status === 'ESCALATE' || result.status === 'PENDING_RECOVERY' ? 3
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

function qaReviewSource(flags) {
  return { target: flags.get('--target'), archivePath: flags.get('--archive'),
    receiptPath: flags.get('--receipt'), sdkEvidencePath: flags.get('--sdk-evidence'),
    rightsPath: flags.get('--rights'), metadataPath: flags.get('--metadata'),
    promoRoot: flags.get('--promo-root'), evidenceDir: flags.get('--evidence-dir'),
    reportSha256: flags.get('--report-sha256') };
}

function displayQaReview(result, json, out) {
  if (json) { out(`${JSON.stringify(result, null, 2)}\n`); return; }
  out(`${result.status} · ${result.target ?? 'unknown'} · ${result.candidateSha256 ?? 'unverified'}\n`);
  if (result.reasonCode) out(`  reason: ${result.reasonCode}\n`);
  if (result.outputDir) out(`  local audit: ${result.outputDir}\n`);
  if (result.images) out(`  images: ${result.images.length}\n`);
  if (result.reviewerModel) out(`  reviewer: ${result.reviewerModel} · effort ${result.reviewerEffort}\n`);
  for (const image of result.images ?? []) {
    out(`  ${image.id}: ${image.file ?? '(original path in session)'} · SHA-256 ${image.sha256}`);
    if (image.verdict) out(` · ${image.verdict}`);
    out('\n');
  }
  for (const finding of result.findings ?? []) {
    out(`  finding ${finding.severity} · ${finding.imageId ?? 'image'} · ${finding.category}: ${finding.description}\n`);
  }
  if (result.warning) out(`  warning: ${result.warning}\n`);
  if (result.recordedOnly) out('  journal: LOCAL_RECORD_ONLY · not a fresh browser attestation\n');
  out('  actual moderation: NOT_RUN · release: NOT_READY · publication: NOT_AUTHORIZED\n');
}

function qaReviewExit(result) {
  if (result.status === 'PENDING_RECOVERY') return 3;
  if (result.status === 'BLOCKED') return 2;
  if (result.status === 'ISSUES_FOUND' || result.status === 'RECORDED_ISSUES_FOUND') return 1;
  return ['READY', 'REVIEWED', 'RECORDED_REVIEWED'].includes(result.status) ? 0 : 2;
}

function runQaRepairCli(operation, flags, { out }) {
  const outputDir = path.resolve(flags.get('--output'));
  let result;
  if (operation === 'repair') {
    const plan = planQaRepair({ project: flags.get('--project'),
      reviewOutput: path.resolve(flags.get('--review-output')), outputDir,
      inScope: flags.get('--in-scope'), mutationBoundary: flags.get('--mutation-boundary') });
    result = flags.has('--apply') ? beginQaRepair(plan, { apply: true }) : plan;
  } else if (operation === 'repair-status') result = inspectQaRepair(outputDir);
  else if (operation === 'repair-next') result = startQaRepairRound(outputDir, { apply: flags.has('--apply') });
  else result = completeQaRepairRound(outputDir, { reviewOutput: path.resolve(flags.get('--review-output')),
    apply: flags.has('--apply') });
  if (flags.has('--json')) out(`${JSON.stringify(result, null, 2)}\n`);
  else {
    out(`${result.status} · QA repair · ${result.project ?? 'unverified game'}\n`);
    if (result.reasonCode) out(`  reason: ${result.reasonCode}\n`);
    if (result.outputDir) out(`  journal: ${result.outputDir}\n`);
    if (result.maxRepairs !== undefined) out(`  repairs: ${result.roundsUsed}/2 · remaining ${result.remainingRepairs}\n`);
    if (result.authorization) out(`  allowed files: ${result.authorization.inScope.join('; ')}\n`);
    if (result.nextAction) out(`  next: primary Codex agent must repair and independently reinspect the fresh build\n`);
    if (result.warning) out(`  warning: ${result.warning}\n`);
    out('  independent Web host: NOT_ATTESTED_BY_LOCAL_STATUS · moderation: NOT_RUN · publication: NOT_AUTHORIZED\n');
  }
  return result.status === 'PENDING_RECOVERY' || result.status === 'ESCALATE' ? 3
    : result.status === 'BLOCKED' ? 2 : result.status === 'REWORK' ? 1 : 0;
}

async function runQaReviewCli(operation, flags, { out, devHost }) {
  const outputDir = path.resolve(flags.get('--output'));
  let result;
  if (operation === 'review-status') {
    result = inspectQaJournal(outputDir);
  } else {
    const source = qaReviewSource(flags);
    const apply = flags.has('--apply');
    const hostForApply = () => {
      try { return devHost(); }
      catch { return null; }
    };
    if (operation === 'review') {
      const plan = planQaWebReview(source);
      result = apply && plan.status === 'READY'
        ? await executeQaWebReview(plan, { apply, outputDir, host: hostForApply() })
        : plan;
    } else {
      const options = { previousOutput: path.resolve(flags.get('--previous')), outputDir,
        confirmReviewerStopped: flags.has('--confirm-reviewer-stopped'), apply };
      // Validate owner confirmation and the full original source binding before discovering a host.
      const preview = await restartQaWebReview(source, { ...options, apply: false });
      result = apply && options.confirmReviewerStopped && preview.status === 'PENDING_RECOVERY' &&
        preview.reasonCode === 'QA_REVIEW_RESTART_CONFIRMATION_REQUIRED'
        ? await restartQaWebReview(source, { ...options, host: hostForApply() }) : preview;
    }
  }
  displayQaReview(result, flags.has('--json'), out);
  return qaReviewExit(result);
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
  if (result.mode === 'component-trust') {
    if (result.stateSha256) out(`  component state SHA-256: ${result.stateSha256}\n`);
    for (const filename of result.managedPaths ?? []) out(`  managed path to review: ${filename}\n`);
    for (const filename of result.authorCandidates ?? []) out(`  author path to review: ${filename}\n`);
    if (result.warning) out(`  review required: ${result.warning}\n`);
  }
  if (result.mode === 'component-recovery') {
    if (result.fromCommit) out(`  source Git commit: ${result.fromCommit}\n`);
    if (result.toCommit) out(`  current Git commit: ${result.toCommit}\n`);
    if (result.recoverySha256) out(`  owner recovery SHA-256: ${result.recoverySha256}\n`);
    if (result.hostRegistryPath) out(`  host registry to initialize: ${result.hostRegistryPath}\n`);
    if (result.nextAction) out(`  next action: ${result.nextAction}\n`);
    for (const name of result.managedPaths ?? []) out(`  managed path to review: ${name}\n`);
    for (const transition of result.transitions ?? []) {
      out(`  history: ${transition.fromVersion} → ${transition.toVersion} (${transition.fromCommit} → ${transition.toCommit})\n`);
    }
  }
  if (result.mode !== 'component-trust' && result.status === 'NEEDS_USER_ACTION' && result.stateSha256) {
    out(`  component state SHA-256: ${result.stateSha256}\n`);
    if (result.proposalSha256) out(`  proposed adoption SHA-256: ${result.proposalSha256}\n`);
    for (const name of result.authorFiles ?? []) out(`  author path to review: ${name}\n`);
    if (result.template?.version) out(`  template version: ${result.template.fromVersion} → ${result.template.version}\n`);
    if (result.warning) out(`  review required: ${result.warning}\n`);
  }
  for (const item of result.writes) {
    const action = result.status === 'APPLIED'
      ? result.mode.startsWith('profile-') ? 'applied' : result.mode === 'component-update' ? 'updated' : 'created'
      : ['profile-update', 'component-update'].includes(result.mode) ? 'would update' : 'would create';
    out(`  ${action}: ${item}\n`);
  }
  for (const problem of result.conflicts) out(`  blocked: ${problem}\n`);
  if (result.backupDirectory) out(`  recoverable backup: ${result.backupDirectory}\n`);
  if (result.manifest) out(`  id: ${result.manifest.id} · version: ${result.manifest.version}\n`);
  if (result.profile) out(`  profile: ${result.profile.id} · version: ${result.profile.version}\n`);
}

/** Pure command boundary; inject streams to test status/output without child processes. */
export function runCli(argv, { out = text => process.stdout.write(text), err = text => process.stderr.write(text),
  executor, devHost = discoverDevHost, previewSignal } = {}) {
  try {
    const [command = 'help', ...rest] = argv;
    if (command === 'help' || command === '--help') {
      if (rest.length) throw new Error('help takes no options');
      out(usage);
      return 0;
    }
    if (command === 'preview') {
      const flags = argumentsFor('preview', rest);
      return runPreviewCli(flags, { out, err, signal: previewSignal });
    }
    if (command === 'qa') {
      const [operation, ...args] = rest;
      if (['repair', 'repair-status', 'repair-next', 'repair-record'].includes(operation)) {
        const flags = argumentsFor(`qa-${operation}`, args);
        return runQaRepairCli(operation, flags, { out });
      }
      if (['review', 'review-status', 'review-restart'].includes(operation)) {
        const flags = argumentsFor(`qa-${operation}`, args);
        return runQaReviewCli(operation, flags, { out, devHost }).catch(error => {
          const failure = { schemaVersion: 1, kind: 'qa-web-review', status: 'BLOCKED',
            reasonCode: error.code ?? 'QA_REVIEW_COMMAND_FAILED', warning: error.message,
            browserAttested: false, reviewProvenance: 'NOT_RUN', actualModeration: 'NOT_RUN',
            releaseReady: false, publicationAllowed: false };
          displayQaReview(failure, flags.has('--json'), out);
          return 2;
        });
      }
      if (operation === 'handoff') {
        const flags = argumentsFor('qa-handoff', args);
        const result = prepareQaReviewPacket({
          target: flags.get('--target'), archivePath: flags.get('--archive'),
          receiptPath: flags.get('--receipt'), sdkEvidencePath: flags.get('--sdk-evidence'),
          rightsPath: flags.get('--rights'), metadataPath: flags.get('--metadata'),
          promoRoot: flags.get('--promo-root'), evidenceDir: flags.get('--evidence-dir'),
          reportSha256: flags.get('--report-sha256'),
        });
        if (flags.has('--json')) out(`${JSON.stringify(result, null, 2)}\n`);
        else {
          out(`${result.status} · ${result.target ?? 'unknown'} · ${result.candidateSha256 ?? 'unverified'}\n`);
          if (result.reasonCode) out(`  reason: ${result.reasonCode}\n`);
          out('  review: NOT_RUN · moderation: NOT_RUN · publication: NOT_AUTHORIZED\n');
        }
        return result.status === 'READY_FOR_HANDOFF' ? 0 : result.status === 'BLOCKED' ? 2 : 1;
      }
      if (operation === 'capture') {
        const flags = argumentsFor('qa-capture', args);
        return import('./qa-capture.mjs').then(({ captureTrustedCandidate }) =>
          captureTrustedCandidate({ target: flags.get('--target'), archivePath: flags.get('--archive'),
            receiptPath: flags.get('--receipt'), sdkEvidencePath: flags.get('--sdk-evidence'),
            rightsPath: flags.get('--rights'), metadataPath: flags.get('--metadata'),
            promoRoot: flags.get('--promo-root'), outputDir: flags.get('--output'),
            flowPath: flags.get('--flow'),
            engine: flags.get('--engine') ?? 'chromium', timeoutMs: flags.has('--timeout-ms') ? Number(flags.get('--timeout-ms')) : 10000,
            trusted: flags.has('--trusted') }))
          .then(result => {
            if (flags.has('--json')) out(`${JSON.stringify(result, null, 2)}\n`);
            else out(`${result.status} · ${result.target ?? flags.get('--target')} · ${result.candidateSha256 ?? 'unverified'} · ${result.reasonCode ?? 'startup evidence only'}\n`);
            return result.status === 'STARTUP_OBSERVED' ? 0 : result.status === 'BLOCKED' ? 2 : 1;
          }).catch(error => {
            if (flags.has('--json')) out(`${JSON.stringify({ status: 'BLOCKED', reasonCode: 'QA_CAPTURE_UNAVAILABLE', message: error.message,
              releaseReady: false, publicationAllowed: false, actualModeration: 'NOT_RUN' })}\n`);
            else err(`Ludory QA capture: ${error.message}\n`);
            return 2;
          });
      }
      if (operation !== 'simulate') throw new Error(`Unknown QA operation: ${operation || '(missing)'}`);
      const flags = argumentsFor('qa-simulate', args);
      const report = simulateModeration({
        target: flags.get('--target'), archivePath: flags.get('--archive'),
        receiptPath: flags.get('--receipt'), sdkEvidencePath: flags.get('--sdk-evidence'),
        rightsPath: flags.get('--rights'), metadataPath: flags.get('--metadata'),
        promoRoot: flags.get('--promo-root'),
      });
      if (flags.has('--json')) out(`${JSON.stringify(report, null, 2)}\n`);
      else {
        out(`${report.status} · ${report.target} QA simulation · ${report.candidateSha256 ?? 'unknown SHA'}\n`);
        for (const check of report.checks) {
          out(`  ${check.id}: ${check.status} (${check.reasonCode})\n`);
        }
        out('  release: NOT_READY · moderation: NOT_RUN · publication: NOT_AUTHORIZED\n');
      }
      return report.status === 'BLOCKED' ? 2 : report.status === 'PRECHECK_CLEAR' ? 0 : 1;
    }
    if (command === 'release') {
      const [operation, ...args] = rest;
      if (!['check', 'plan', 'vk-check'].includes(operation)) throw new Error(`Unknown release operation: ${operation || '(missing)'}`);
      const flags = argumentsFor(`release-${operation}`, args);
      const inputs = {
        archivePath: flags.get('--archive'), receiptPath: flags.get('--receipt'),
        sdkEvidencePath: flags.get('--sdk-evidence'), rightsPath: flags.get('--rights'),
      };
      const result = operation === 'vk-check' ? checkVkCandidate(inputs)
        : operation === 'check' ? checkYandexRelease(inputs)
          : planYandexFieldTests({ ...inputs, fieldEvidencePath: flags.get('--field-evidence') });
      if (flags.has('--json')) out(`${JSON.stringify(result, null, 2)}\n`);
      else if (operation === 'vk-check') {
        out(`${result.status} · local VK candidate · ${result.candidateSha256 ?? 'unknown SHA'}\n`);
        for (const gate of result.gates) out(`  ${gate.id}: ${gate.status} (${gate.reasonCode})\n`);
        out('  release: NOT_READY · publication: NOT_AUTHORIZED\n');
      }
      else if (operation === 'check') {
        out(`${result.status} · local Yandex candidate · ${result.candidateSha256 ?? 'unknown SHA'}\n`);
        for (const gate of result.gates) out(`  ${gate.id}: ${gate.status} (${gate.reasonCode})\n`);
        out('  release: NOT_READY · publication: NOT_AUTHORIZED\n');
      } else {
        out(`${result.status} · Yandex field-test preflight · ${result.candidateSha256 ?? 'unknown SHA'}\n`);
        out(`  local: ${result.localStatus}\n`);
        for (const check of result.checks) out(`  ${check.id}: ${check.status} (${check.reasonCode})\n`);
        out(`  field evidence: ${result.fieldEvidenceGate.status} (${result.fieldEvidenceGate.reasonCode})\n`);
        out('  release: NOT_READY · publication: NOT_AUTHORIZED\n');
      }
      return ['PASS_LOCAL', 'READY_FOR_FIELD_TEST'].includes(result.status) ? 0 :
        result.status === 'BLOCKED' ? 2 : 1;
    }
    if (command === 'quality') {
      const [operation, ...args] = rest;
      if (!['enable', 'check', 'status', 'evidence'].includes(operation)) {
        throw new Error(`Unknown quality operation: ${operation || '(missing)'}`);
      }
      const flags = argumentsFor(`quality-${operation}`, args);
      const project = flags.get('--project');
      const result = operation === 'enable'
        ? (() => { const plan = planQualityEnable(project);
          return flags.has('--apply') && plan.status === 'READY' ? applyQualityEnable(plan) : plan; })()
        : operation === 'check'
          ? executeQualityCheck(planQualityCheck(project, { tier: flags.get('--tier') ?? 'quick' }),
            { apply: flags.has('--apply'), executor })
          : operation === 'status' ? qualityStatus(project)
            : planQualityEvidence(project, { run: flags.get('--run') ?? 'latest' });
      displayWorkflow(result, flags.has('--json'), out);
      return result.status === 'BLOCKED' || result.status === 'CONFLICT' || result.status === 'STALE' ? 2
        : result.status === 'FAIL' ? 1 : 0;
    }
    if (command === 'workflow') {
      const [operation, ...args] = rest;
      if (!['doctor', 'route', 'draft', 'draft-import', 'narrative-review', 'image', 'image-import', 'art-review', 'status', 'next', 'start', 'continue', 'cycle', 'checkpoint', 'recover', 'recover-storage'].includes(operation)) {
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
          let pending = false;
          try { pending = flags.has('--apply') &&
            !!readNativeRun(flags.get('--project'), flags.get('--run')).pendingArtReview; }
          catch { /* An absent valid request is an ordinary failure. */ }
          const result = pending ? { engine: 'ludory-ai', operation, status: 'PENDING_RECOVERY',
            project: flags.get('--project'), nativeStatus: 'ART_REVIEW_PENDING',
            reasonCode: 'ART_REVIEW_OUTCOME_UNKNOWN', writes: [], conflicts: [],
            warning: 'The browser may still be reviewing or billing. Verify that the old helper is stopped before workflow recover --confirm-no-executor --apply.',
            nextAction: { kind: 'CONFIRM_REVIEWER_STOPPED', executable: false } }
            : { engine: 'ludory-ai', operation, status: 'FAILED',
              project: flags.get('--project'), writes: [], conflicts: [error.message] };
          if (flags.has('--json') || pending) displayWorkflow(result, flags.has('--json'), out);
          else err(`Ludory: ${error.message}\n`);
          return pending ? 3 : 1;
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
      const qualityCandidate = flags.has('--apply') && plan.status === 'READY' &&
        (operation === 'cycle' || (operation === 'continue' && flags.get('--executor') === 'codex'));
      const qualityPolicy = qualityCandidate ? planQualityEnable(plan.project) : null;
      let qualityAttempted = false;
      if (qualityCandidate) {
        try { fs.lstatSync(path.join(plan.project, '.ludory', 'quality')); qualityAttempted = true; }
        catch (error) { if (error.code !== 'ENOENT') qualityAttempted = true; }
      }
      const autoQuality = qualityCandidate && (qualityPolicy.status === 'IN_SYNC' || qualityAttempted);
      let beforeDigest = null;
      let beforeError = null;
      if (autoQuality) {
        try { beforeDigest = snapshotQualitySource(plan.project).digest; }
        catch (error) { beforeError = error.message; }
      }
      let result = executeWorkflow(plan, { apply: flags.has('--apply'), executor });
      if (autoQuality && result.status === 'EXECUTED_UNVERIFIED') {
        let quality = null;
        try {
          if (qualityPolicy.status !== 'IN_SYNC') quality = { status: 'BLOCKED', tier: 'quick',
            reasonCode: qualityPolicy.conflicts?.[0] ?? 'QUALITY_POLICY_UNTRUSTED' };
          else if (beforeError) quality = { status: 'BLOCKED', tier: 'quick', reasonCode: beforeError };
          else if (snapshotQualitySource(plan.project).digest !== beforeDigest) {
            quality = executeQualityCheck(planQualityCheck(plan.project, { tier: 'quick' }),
              { apply: true, executor });
          }
        } catch (error) {
          quality = { status: 'BLOCKED', tier: 'quick', reasonCode: error.message };
        }
        if (quality) result = { ...result, quality };
      }
      displayWorkflow(result, flags.has('--json'), out);
      if (result.quality?.status === 'BLOCKED' || result.quality?.status === 'STALE') return 2;
      if (result.quality?.status === 'FAIL') return 1;
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
    if (command === 'components') {
      const [operation, ...args] = rest;
      if (!['status', 'update', 'adopt', 'trust', 'recover', 'native'].includes(operation)) {
        throw new Error(`Unknown components operation: ${operation || '(missing)'}`);
      }
      const flags = argumentsFor(`components-${operation}`, args);
      if (operation === 'native') {
        const result = inspectWindowsDirectoryPin();
        if (flags.has('--json')) out(`${JSON.stringify(result, null, 2)}\n`);
        else {
          out(`${result.status} · Windows native directory pin\n`);
          if (result.reasonCode) out(`  reason: ${result.reasonCode}\n`);
          if (result.nextAction) out(`  next: ${result.nextAction}\n`);
        }
        return result.status === 'BLOCKED' ? 2 : 0;
      }
      if (operation === 'trust') {
        if (flags.has('--apply') !== flags.has('--accept-state-sha256')) {
          throw new Error('Trust acceptance requires --accept-state-sha256 <64-hex> and --apply together');
        }
        const preview = previewComponentTrust(flags.get('--project'), { catalog: flags.get('--catalog') });
        const accepted = flags.has('--apply') && preview.status === 'NEEDS_USER_ACTION'
          ? acceptComponentTrust(preview, flags.get('--accept-state-sha256')) : preview;
        display(accepted, flags.has('--json'), out);
        return ['CONFLICT', 'BLOCKED', 'NEEDS_USER_ACTION'].includes(accepted.status) ? 2 : 0;
      }
      if (operation === 'recover') {
        if (!flags.has('--from-commit') || !flags.has('--to-commit')) {
          throw new Error('Recovery requires --from-commit and --to-commit full SHA IDs');
        }
        if (flags.has('--apply') !== flags.has('--accept-recovery-sha256')) {
          throw new Error('Recovery confirmation requires --accept-recovery-sha256 <sha256> and --apply together');
        }
        const preview = previewComponentGitRecovery(flags.get('--project'), {
          fromCommit: flags.get('--from-commit'), toCommit: flags.get('--to-commit'),
          catalog: flags.get('--catalog'),
        });
        let outcome = preview;
        if (flags.has('--apply') && preview.status === 'NEEDS_USER_ACTION') {
          try { outcome = acceptComponentGitRecovery(preview, flags.get('--accept-recovery-sha256')); }
          catch (error) { outcome = { ...preview, status: 'CONFLICT', conflicts: [error.message] }; }
        }
        display(outcome, flags.has('--json'), out);
        return ['CONFLICT', 'BLOCKED', 'NEEDS_USER_ACTION'].includes(outcome.status) ? 2 : 0;
      }
      if (operation === 'adopt' && new Set([
        flags.has('--apply'), flags.has('--accept-state-sha256'), flags.has('--accept-proposal-sha256'),
      ]).size > 1) {
        throw new Error('Author adoption requires both --accept-state-sha256 and --accept-proposal-sha256 with --apply');
      }
      const options = { catalog: flags.get('--catalog') };
      const preview = operation === 'status'
        ? componentStatus(flags.get('--project'), options)
        : operation === 'adopt'
          ? planAuthorAdoption(flags.get('--project'), { ...options,
            acceptStateSha256: flags.get('--accept-state-sha256'),
            acceptProposalSha256: flags.get('--accept-proposal-sha256') })
          : planComponentUpdate(flags.get('--project'), options);
      let result = preview;
      if ((operation === 'update' || operation === 'adopt') && flags.has('--apply') && preview.status === 'READY') {
        try { result = applyComponentPlan(preview); }
        catch (error) {
          result = { ...preview, status: 'BLOCKED', writes: [],
            conflicts: [`Component apply failed; inspect retained .ludory-components-backup-* and transaction lock before recovery: ${error.message}`] };
        }
      }
      display(result, flags.has('--json'), out);
      return ['BLOCKED', 'CONFLICT', 'NEEDS_USER_ACTION'].includes(result.status) ? 2 : 0;
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
    if (['workflow', 'quality', 'components', 'release', 'preview', 'qa'].includes(argv[0]) && argv.includes('--json')) {
      const projectIndex = argv.indexOf('--project');
      const result = { mode: `${argv[0]}-${argv[1] ?? 'unknown'}`, project: projectIndex < 0 ? null : (argv[projectIndex + 1] ?? null),
        status: 'FAILED', writes: [], conflicts: [error.message] };
      displayWorkflow(result, true, out);
      return 1;
    }
    err(`Ludory: ${error.message}\n`);
    return 1;
  }
}
