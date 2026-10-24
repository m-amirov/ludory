import { defineGame } from '@ludory/core';
import { inspectProject, planInit, planMigration, applyPlan } from './projects.mjs';
import { listCatalog, showCatalog } from './catalog.mjs';
import { planCreate, applyCreatePlan } from './scaffold.mjs';
import { planProfileApply, planProfileUpdate, profileStatus, applyProfilePlan } from './profile-management.mjs';
import { planWorkflow, executeWorkflow } from './workflows.mjs';

const usage = `Ludory Studio 0.1.0 — safe game-project metadata

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
  ludory workflow doctor --project <game-directory> [--ceos-entry <absolute-ceos-bin>] [--json]
  ludory workflow status --project <game-directory> [--run <run-id|latest>] [--ceos-entry <absolute-ceos-bin>] [--json]
  ludory workflow next --project <game-directory> [--run <run-id|latest>] [--ceos-entry <absolute-ceos-bin>] [--json]
  ludory workflow start --project <game-directory> --pipeline <audit-repair-loop|production-art> --target <text> --in-scope <a;b> --acceptance <text> --mutation-boundary <text> [--out-of-scope <a;b>] [--apply] [--json]
  ludory workflow continue --project <game-directory> [--run <run-id|latest>] [--apply] [--json]
  ludory workflow checkpoint --project <game-directory> --stage <STAGE> [--run <run-id|latest>] [--artifact <path;path>] [--outcome <CONTINUE|PASS|FAIL|BLOCKED|ESCALATE>] [--apply] [--json]
  ludory help

No writes by default. init/migrate --apply only create ludory.project.json;
create --apply only creates new template files, manifest and Studio receipt in an empty directory.
profiles apply/update only manage declarations inside .ludory/profiles; never edit game code or created template files.
workflow delegates CEOS 0.5.40; mutations require --apply and CEOS retains run/evidence ownership.
Migration requires clean Git and supported Starter Kit game-spec.yaml schema 2.
`;

function argumentsFor(command, argv) {
  const common = new Set(['--project', '--json']);
  const workflowCommon = [...common, '--ceos-entry'];
  const allowed = command.startsWith('workflow-')
    ? new Set(command === 'workflow-doctor' ? workflowCommon
      : command === 'workflow-status' || command === 'workflow-next' ? [...workflowCommon, '--run']
        : command === 'workflow-start' ? [...workflowCommon, '--pipeline', '--target', '--in-scope', '--acceptance', '--mutation-boundary', '--out-of-scope', '--apply']
          : command === 'workflow-continue' ? [...workflowCommon, '--run', '--apply']
            : [...workflowCommon, '--run', '--stage', '--artifact', '--outcome', '--apply'])
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
    if (key === '--apply' || key === '--json') {
      flags.set(key, true);
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    flags.set(key, value);
  }
  if (!['profiles-list', 'templates-list', 'profiles-show', 'templates-show'].includes(command) && !flags.get('--project')) {
    throw new Error('--project is required');
  }
  if (command.endsWith('-show') && !flags.get('--name')) throw new Error('--name is required for show');
  if (command === 'profiles-apply' && !flags.get('--name')) throw new Error('--name is required for profiles apply');
  return flags;
}

function workflowOptions(flags) {
  return {
    entry: flags.get('--ceos-entry'), run: flags.get('--run'), pipeline: flags.get('--pipeline'),
    target: flags.get('--target'), inScope: flags.get('--in-scope'), outOfScope: flags.get('--out-of-scope'),
    acceptance: flags.get('--acceptance'), mutationBoundary: flags.get('--mutation-boundary'),
    stage: flags.get('--stage'), artifact: flags.get('--artifact'), outcome: flags.get('--outcome'),
  };
}

function displayWorkflow(result, json, out) {
  if (json) { out(`${JSON.stringify(result, null, 2)}\n`); return; }
  out(`${result.status} · ${result.project}\n`);
  if (result.ceosVersion) out(`  CEOS: ${result.ceosVersion} · ${result.operation}\n`);
  if (result.ceosExitCode !== undefined) out(`  CEOS exit: ${result.ceosExitCode}\n`);
  if (result.ceos?.status) out(`  CEOS status: ${result.ceos.status}\n`);
  if (result.ceos?.action?.kind) out(`  next: ${result.ceos.action.kind}\n`);
  if (result.status === 'READY') out(`  planned: ${JSON.stringify(result.argv)}\n`);
  for (const conflict of result.conflicts ?? []) out(`  blocked: ${conflict}\n`);
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
export function runCli(argv, { out = text => process.stdout.write(text), err = text => process.stderr.write(text) } = {}) {
  try {
    const [command = 'help', ...rest] = argv;
    if (command === 'help' || command === '--help') {
      if (rest.length) throw new Error('help takes no options');
      out(usage);
      return 0;
    }
    if (command === 'workflow') {
      const [operation, ...args] = rest;
      if (!['doctor', 'status', 'next', 'start', 'continue', 'checkpoint'].includes(operation)) {
        throw new Error(`Unknown workflow operation: ${operation || '(missing)'}`);
      }
      const flags = argumentsFor(`workflow-${operation}`, args);
      let plan;
      try { plan = planWorkflow(flags.get('--project'), operation, workflowOptions(flags)); }
      catch (error) {
        if (!/^BLOCKED_CEOS_/.test(error.message)) throw error;
        const result = { mode: `workflow-${operation}`, project: flags.get('--project'),
          status: 'BLOCKED', writes: [], conflicts: [error.message] };
        displayWorkflow(result, flags.has('--json'), out);
        return 2;
      }
      const result = executeWorkflow(plan, { apply: flags.has('--apply') });
      displayWorkflow(result, flags.has('--json'), out);
      if (result.ceosExitCode !== undefined) return result.ceosExitCode;
      return ['BLOCKED', 'CONFLICT'].includes(result.status) ? 2 : result.status === 'ESCALATE' ? 3 : 0;
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
