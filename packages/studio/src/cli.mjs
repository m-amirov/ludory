import { defineGame } from '@ludory/core';
import { inspectProject, planInit, planMigration, applyPlan } from './projects.mjs';
import { listCatalog, showCatalog } from './catalog.mjs';
import { planCreate, applyCreatePlan } from './scaffold.mjs';

const usage = `Ludory Studio 0.1.0 — safe game-project metadata

  ludory inspect --project <directory> [--json]
  ludory init --project <empty-directory> --id <slug> --title <name> --lang <locale> --engine <id> --targets <comma-separated> [--version <semver>] [--apply] [--json]
  ludory migrate --project <existing-game> [--apply] [--json]
  ludory profiles list [--catalog <directory>] [--json]
  ludory profiles show --name <id> [--catalog <directory>] [--json]
  ludory templates list [--catalog <directory>] [--json]
  ludory templates show --name <id> [--catalog <directory>] [--json]
  ludory create --project <empty-directory> --id <slug> --title <name> --lang <locale> --profile <id> --template <id> --targets <comma-separated> [--version <semver>] [--catalog <directory>] [--apply] [--json]
  ludory help

No writes by default. init/migrate --apply only create ludory.project.json;
create --apply only creates new template files, manifest and Studio receipt in an empty directory.
Migration requires clean Git and supported Starter Kit game-spec.yaml schema 2.
`;

function argumentsFor(command, argv) {
  const common = new Set(['--project', '--json']);
  const allowed = command === 'init'
    ? new Set([...common, '--id', '--title', '--lang', '--engine', '--targets', '--version', '--apply'])
    : command === 'create'
      ? new Set([...common, '--id', '--title', '--lang', '--profile', '--template', '--targets', '--version', '--catalog', '--apply'])
      : command === 'migrate' ? new Set([...common, '--apply'])
        : command === 'profiles-list' || command === 'templates-list' ? new Set(['--json', '--catalog'])
          : command === 'profiles-show' || command === 'templates-show' ? new Set(['--json', '--catalog', '--name'])
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
  return flags;
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
  for (const item of result.writes) out(`  ${result.status === 'APPLIED' ? 'created' : 'would create'}: ${item}\n`);
  for (const problem of result.conflicts) out(`  blocked: ${problem}\n`);
  if (result.manifest) out(`  id: ${result.manifest.id} · version: ${result.manifest.version}\n`);
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
    if (command === 'profiles' || command === 'templates') {
      const [operation, ...args] = rest;
      if (!['list', 'show'].includes(operation)) throw new Error(`Unknown ${command} operation: ${operation || '(missing)'}`);
      const flags = argumentsFor(`${command}-${operation}`, args);
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
    err(`Ludory: ${error.message}\n`);
    return 1;
  }
}
