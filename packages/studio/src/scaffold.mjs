import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defineGame } from '@ludory/core';
import { loadCatalog } from './catalog.mjs';
import { planInit, directoryIdentity, isOriginalDirectory } from './projects.mjs';

const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const serialize = item => Buffer.from(`${JSON.stringify(item, null, 2)}\n`, 'utf8');

function filesFor(manifest, profile, template) {
  const manifestBytes = serialize(manifest);
  const entries = [['ludory.project.json', manifestBytes]];
  const tracked = { 'ludory.project.json': digest(manifestBytes) };
  for (const filename of template.files) {
    const bytes = template.assets.get(filename).bytes;
    entries.push([filename, bytes]);
    tracked[filename] = digest(bytes);
  }
  const receipt = {
    schemaVersion: 1,
    profile: { id: profile.id, version: profile.version },
    template: { id: template.id, version: template.version },
    catalog: {
      origin: template.origin,
      profileSha256: profile.sourceSha256,
      templateSha256: template.sourceSha256,
    },
    files: tracked,
  };
  entries.push(['ludory.studio.json', serialize(receipt)]);
  return { entries, receipt };
}

function blocked(project, message, definition = null) {
  return {
    mode: 'create', project, status: 'BLOCKED', manifest: definition,
    writes: [], conflicts: [message],
  };
}

/** Construct a read-only, reproducible plan to scaffold a new game. */
export function planCreate(projectDir, options) {
  const { id, title, lang, version = '0.1.0', profile: profileId, template: templateId, targets, catalog } = options;
  const chosenTargets = Array.isArray(targets) ? targets : String(targets).split(',').map(x => x.trim());
  const catalogData = loadCatalog(catalog);
  const profile = catalogData.profiles.get(profileId);
  const template = catalogData.templates.get(templateId);
  if (!profile) return blocked(path.resolve(projectDir), `Unknown game profile: ${profileId}`);
  if (!template) return blocked(path.resolve(projectDir), `Unknown game template: ${templateId}`);
  if (template.profile !== profile.id || !profile.templates.includes(template.id) || template.engine !== profile.engine) {
    return blocked(path.resolve(projectDir), `Incompatible profile/template: ${profileId}/${templateId}`);
  }
  if (chosenTargets.some(x => !profile.targets.includes(x) || !template.targets.includes(x))) {
    return blocked(path.resolve(projectDir), 'Requested targets are not compatible with selected profile/template');
  }
  const manifest = defineGame({
    schemaVersion: 1, id, version, title: { [lang]: title },
    engine: profile.engine, targets: chosenTargets,
  });
  const init = planInit(projectDir, manifest);
  if (init.status !== 'READY') return blocked(init.project, init.conflicts.join('; '), manifest);
  const { entries, receipt } = filesFor(manifest, profile, template);
  const fingerprint = digest(serialize({
    manifest, receipt,
    outputs: entries.map(([name, bytes]) => [name, digest(bytes)]),
  }));
  const result = {
    mode: 'create', project: init.project, status: 'READY', manifest,
    writes: entries.map(([name]) => name), conflicts: [],
    profile: { id: profile.id, version: profile.version },
    template: { id: template.id, version: template.version },
    rootIdentity: init.rootIdentity, fingerprint,
    options: { id, title, lang, version, profile: profileId, template: templateId, targets: chosenTargets, catalog },
  };
  // No template file bytes in JSON/text preview; only the fresh in-process
  // snapshot may be used by apply after comparing a rebuilt plan.
  Object.defineProperty(result, '_snapshot', { value: entries, enumerable: false });
  return result;
}

function ensureDirectories(relative, createdDirectories) {
  const segments = relative.split('/').slice(0, -1);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      fs.mkdirSync(current);
      createdDirectories.push(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!createdDirectories.includes(current)) throw new Error(`Existing output directory conflict: ${current}`);
    }
    const st = fs.lstatSync(current);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`Unsafe output directory: ${current}`);
  }
}

function rollbackCreated(files, directories) {
  const failures = [];
  for (const [name, expectedBytes, ownership] of files.reverse()) {
    try {
      const st = fs.lstatSync(name);
      const actual = st.isFile() && !st.isSymbolicLink() ? fs.readFileSync(name) : null;
      // A write may fail after creating only a prefix of the file. It is
      // still ours if its inode matches the exclusive creation and it has
      // not diverged from the bytes this command was attempting to write.
      if (!actual || st.dev !== ownership.dev || st.ino !== ownership.ino ||
          actual.length > expectedBytes.length || !actual.equals(expectedBytes.subarray(0, actual.length))) {
        failures.push(`modified output retained: ${name}`);
        continue;
      }
      fs.unlinkSync(name);
    } catch (error) { failures.push(`${name}: ${error.message}`); }
  }
  for (const name of directories.reverse()) {
    try { fs.rmdirSync(name); }
    catch (error) { failures.push(`${name}: ${error.message}`); }
  }
  return failures;
}

/** Revalidate source, destination and inode; create only new files. */
export function applyCreatePlan(plan) {
  if (!plan || plan.mode !== 'create' || plan.status !== 'READY') throw new Error('Only a READY create plan can be applied');
  const fresh = planCreate(plan.project, plan.options);
  if (fresh.status !== 'READY') throw new Error(`Stale plan or conflict: ${fresh.conflicts.join('; ')}`);
  if (fresh.fingerprint !== plan.fingerprint || JSON.stringify(fresh.writes) !== JSON.stringify(plan.writes)) {
    throw new Error('Stale plan: catalog or generated files changed');
  }
  if (!plan.rootIdentity || fresh.rootIdentity !== plan.rootIdentity ||
      !isOriginalDirectory(fresh.project, plan.rootIdentity)) {
    throw new Error('Stale plan: project directory identity changed');
  }

  const previousCwd = process.cwd();
  let anchored = false;
  const createdFiles = [];
  const createdDirectories = [];
  try {
    process.chdir(fresh.project);
    anchored = directoryIdentity('.') === plan.rootIdentity;
    if (!anchored) throw new Error('Stale plan: project directory changed during apply');
    for (const [name, bytes] of fresh._snapshot) {
      ensureDirectories(name, createdDirectories);
      const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(name, flags, 0o600);
      // Track immediately, so a short/failed write is also eligible for cleanup.
      const stat = fs.fstatSync(fd);
      createdFiles.push([name, bytes, { dev: stat.dev, ino: stat.ino }]);
      try { fs.writeFileSync(fd, bytes); }
      finally { fs.closeSync(fd); }
    }
    if (!isOriginalDirectory(fresh.project, plan.rootIdentity)) {
      throw new Error('Project directory moved during apply; created files remain anchored to original directory');
    }
    return { ...fresh, status: 'APPLIED', applied: true };
  } catch (error) {
    if (anchored && isOriginalDirectory(fresh.project, plan.rootIdentity)) {
      const problems = rollbackCreated(createdFiles, createdDirectories);
      if (problems.length) throw new Error(`${error.message}; incomplete rollback: ${problems.join('; ')}`, { cause: error });
    }
    throw error;
  } finally {
    process.chdir(previousCwd);
  }
}
