import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { defineGame } from '@ludory/core';
import { readLegacyGameSpec, readSourceFile } from './legacy.mjs';

const manifestName = 'ludory.project.json';

export function directoryIdentity(dir) {
  const stat = fs.lstatSync(dir, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Project directory is no longer a real directory');
  return `${stat.dev}:${stat.ino}`;
}

export function isOriginalDirectory(project, identity) {
  try {
    const canonical = fs.realpathSync.native(project);
    const pathMatches = process.platform === 'win32'
      ? canonical.toLowerCase() === project.toLowerCase() : canonical === project;
    return pathMatches && directoryIdentity(project) === identity;
  } catch {
    return false;
  }
}

export function projectRoot(projectDir) {
  const project = path.resolve(projectDir);
  const stat = fs.lstatSync(project);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Project must be an existing, real directory');
  const canonical = fs.realpathSync.native(project);
  if (process.platform === 'win32' ? canonical.toLowerCase() !== project.toLowerCase() : canonical !== project) {
    throw new Error('Project directory must not traverse symbolic links');
  }
  return project;
}

function currentManifest(project) {
  const file = path.join(project, manifestName);
  try {
    fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const source = readSourceFile(project, manifestName);
  let json;
  try { json = JSON.parse(source.text); } catch { throw new Error('Existing Ludory manifest is invalid JSON'); }
  return defineGame(json);
}

function gitSafety(project) {
  // Prevent optional Git cache/index updates during a dry-run preflight.
  const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  function run(...args) {
    const result = spawnSync('git', args, { cwd: project, encoding: 'utf8', timeout: 5000, env: gitEnv });
    // Some sandboxed process wrappers report EPERM alongside a successful Git
    // exit status and valid output. The exit status is authoritative here.
    if (result.status !== 0) {
      throw new Error(`Git required: ${args.join(' ')} failed (${result.stderr?.trim() || result.error?.message || result.status})`);
    }
    return result.stdout.trim();
  }
  if (run('rev-parse', '--is-inside-work-tree') !== 'true') throw new Error('Git required for mature project migration');
  const head = run('rev-parse', '--verify', 'HEAD');
  if (run('status', '--porcelain', '--untracked-files=all')) throw new Error('Dirty Git worktree blocks mature project migration');
  // Git compares through the repository's clean/smudge/CRLF filters. Raw byte
  // comparison to HEAD would incorrectly reject an otherwise clean checkout.
  // Require both files in the index with ordinary (H) flags so skip-worktree
  // and assume-unchanged cannot hide uncommitted source changes from status.
  run('ls-files', '--error-unmatch', '--', 'game-spec.yaml', 'package.json');
  const flags = run('ls-files', '-v', '--', 'game-spec.yaml', 'package.json').split(/\r?\n/);
  if (flags.length !== 2 || !['H game-spec.yaml', 'H package.json'].every(flag => flags.includes(flag))) {
    throw new Error('Source Git index flags are unsafe (skip-worktree/assume-unchanged or untracked)');
  }
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '--', manifestName], {
    cwd: project, encoding: 'utf8', timeout: 5000, env: gitEnv,
  });
  if (ignored.status === 0) throw new Error('Git ignore rules exclude the new Ludory manifest');
  if (ignored.status !== 1) throw new Error('Git ignore rules could not be verified');
  return { head };
}

const planResult = (mode, project, status, manifest, extras = {}) => ({
  mode, project, status, manifest,
  writes: status === 'READY' ? [manifestName] : [],
  conflicts: [], sources: [], ...extras,
});

/** Read-only plan to add a new canonical manifest to an existing mature game. */
export function planMigration(projectDir) {
  const project = projectRoot(projectDir);
  let legacy;
  try { legacy = readLegacyGameSpec(project); }
  catch (error) { return planResult('migrate', project, 'BLOCKED', null, { conflicts: [error.message] }); }
  let current;
  try { current = currentManifest(project); }
  catch (error) { return planResult('migrate', project, 'BLOCKED', legacy.manifest, { sources: legacy.sources, conflicts: [error.message] }); }
  if (current) {
    const matches = isDeepStrictEqual(current, legacy.manifest);
    return planResult('migrate', project, matches ? 'IN_SYNC' : 'CONFLICT', legacy.manifest, {
      sources: legacy.sources, conflicts: matches ? [] : ['Existing Ludory manifest conflicts with legacy metadata'],
    });
  }
  try {
    const git = gitSafety(project);
    return planResult('migrate', project, 'READY', legacy.manifest, {
      sources: legacy.sources, gitHead: git.head, rootIdentity: directoryIdentity(project),
    });
  } catch (error) {
    return planResult('migrate', project, 'BLOCKED', legacy.manifest, { sources: legacy.sources, conflicts: [error.message] });
  }
}

/** Read-only plan to initialize metadata in an existing empty directory. */
export function planInit(projectDir, definition) {
  const project = projectRoot(projectDir);
  const manifest = defineGame(definition);
  if (fs.readdirSync(project).length) {
    return planResult('init', project, 'BLOCKED', manifest, { conflicts: ['New project directory must be empty'] });
  }
  return planResult('init', project, 'READY', manifest, { rootIdentity: directoryIdentity(project) });
}

/** Inspect an adopted game or preview whether its legacy metadata can be adopted. */
export function inspectProject(projectDir) {
  const project = projectRoot(projectDir);
  let current;
  try { current = currentManifest(project); }
  catch (error) {
    return planResult('inspect', project, 'BLOCKED', null, { conflicts: [error.message] });
  }
  if (current) {
    if (fs.existsSync(path.join(project, 'game-spec.yaml'))) {
      const preview = planMigration(project);
      return { ...preview, mode: 'inspect' };
    }
    return planResult('inspect', project, 'CURRENT', current);
  }
  const preview = planMigration(project);
  return { ...preview, mode: 'inspect' };
}

/** Revalidate the source and destination before creating one file exclusively. */
export function applyPlan(plan) {
  if (!plan || !['init', 'migrate'].includes(plan.mode) || plan.status !== 'READY') {
    throw new Error('Only a READY init/migrate plan can be applied');
  }
  const fresh = plan.mode === 'migrate' ? planMigration(plan.project) : planInit(plan.project, plan.manifest);
  if (fresh.status !== 'READY') throw new Error(`Stale plan or conflict: ${fresh.conflicts.join('; ') || fresh.status}`);
  if (!isDeepStrictEqual(fresh.manifest, plan.manifest)) {
    throw new Error('Stale plan: proposed manifest changed');
  }
  if (!plan.rootIdentity || fresh.rootIdentity !== plan.rootIdentity ||
      !isOriginalDirectory(fresh.project, plan.rootIdentity)) {
    throw new Error('Stale plan: project directory identity changed');
  }
  if (plan.mode === 'migrate') {
    if (plan.gitHead !== fresh.gitHead) throw new Error('Stale plan: Git HEAD changed');
    if (JSON.stringify(plan.sources) !== JSON.stringify(fresh.sources)) {
      throw new Error('Stale plan: source bytes changed');
    }
  }
  // Relative writes are anchored to the process CWD directory inode. On both
  // POSIX and Windows, replacing the validated path with a symlink after
  // chdir cannot redirect this write to the symlink target. CLI execution is
  // synchronous; do not call applyPlan concurrently with unrelated chdir use.
  const previousCwd = process.cwd();
  try {
    process.chdir(fresh.project);
    if (directoryIdentity('.') !== plan.rootIdentity) {
      throw new Error('Stale plan: project directory changed during apply');
    }
    fs.writeFileSync(manifestName, `${JSON.stringify(fresh.manifest, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    if (!isOriginalDirectory(fresh.project, plan.rootIdentity)) {
      throw new Error('Project directory moved during apply; manifest remained in the validated directory');
    }
  } finally {
    process.chdir(previousCwd);
  }
  return { ...fresh, status: 'APPLIED', applied: true };
}
