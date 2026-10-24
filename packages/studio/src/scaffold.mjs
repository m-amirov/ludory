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
  const tracked = Object.create(null);
  tracked['ludory.project.json'] = digest(manifestBytes);
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
    let created = false;
    try {
      // The process CWD is the already validated parent inode. A swapped
      // project-relative ancestor path cannot redirect this mkdir outside.
      fs.mkdirSync(segment);
      created = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!createdDirectories.some(dir => dir.name === current)) throw new Error(`Existing output directory conflict: ${current}`);
    }
    const st = fs.lstatSync(segment, { bigint: true });
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`Unsafe output directory: ${current}`);
    process.chdir(segment);
    if (directoryIdentity('.') !== `${BigInt(st.dev)}:${BigInt(st.ino)}`) {
      throw new Error(`Output directory changed before entering: ${current}`);
    }
    if (created) createdDirectories.push({ name: current, dev: st.dev, ino: st.ino });
    else {
      const expected = createdDirectories.find(dir => dir.name === current);
      if (expected.dev !== st.dev || expected.ino !== st.ino) throw new Error(`Output directory identity changed: ${current}`);
    }
  }
}

function safeOutputParents(name, directories) {
  const segments = name.split('/').slice(0, -1);
  let current = '';
  for (const part of segments) {
    current = current ? `${current}/${part}` : part;
    const expected = directories.find(dir => dir.name === current);
    if (!expected) return false;
    try {
      const st = fs.lstatSync(current, { bigint: true });
      if (!st.isDirectory() || st.isSymbolicLink() || st.dev !== expected.dev || st.ino !== expected.ino) return false;
    } catch { return false; }
  }
  return true;
}

function enterOwnedParent(name, directories, project, rootIdentity) {
  process.chdir(project);
  if (directoryIdentity('.') !== rootIdentity) throw new Error('Rollback root directory identity changed');
  const components = name.split('/');
  const basename = components.pop();
  let relative = '';
  for (const component of components) {
    relative = relative ? `${relative}/${component}` : component;
    const expected = directories.find(dir => dir.name === relative);
    if (!expected) throw new Error(`Rollback directory is not owned: ${relative}`);
    process.chdir(component);
    if (directoryIdentity('.') !== `${BigInt(expected.dev)}:${BigInt(expected.ino)}`) {
      throw new Error(`Rollback directory identity changed: ${relative}`);
    }
  }
  return basename;
}

function rollbackCreated(files, directories, project, rootIdentity) {
  const failures = [];
  for (const { name, bytes, ownership, complete } of files.reverse()) {
    try {
      const basename = enterOwnedParent(name, directories, project, rootIdentity);
      const st = fs.lstatSync(basename, { bigint: true });
      const actual = st.isFile() && !st.isSymbolicLink() ? fs.readFileSync(basename) : null;
      // A failed *partial* write may leave a prefix; completed files require
      // byte-for-byte equality so user edits are never silently discarded.
      if (!actual || st.dev !== ownership.dev || st.ino !== ownership.ino ||
          (complete ? !actual.equals(bytes) : actual.length > bytes.length || !actual.equals(bytes.subarray(0, actual.length)))) {
        failures.push(`modified output retained: ${name}`);
        continue;
      }
      // A second writer can replace the basename after the check above.
      // Move the current entry into a private same-directory quarantine,
      // *then* verify what was actually moved before deleting anything.
      // If a replacement won the race, link it back exclusively and report
      // the incomplete rollback rather than deleting user-owned bytes.
      const quarantine = `.ludory-rollback-${crypto.randomBytes(24).toString('hex')}`;
      fs.renameSync(basename, quarantine);
      const moved = fs.lstatSync(quarantine, { bigint: true });
      const movedBytes = moved.isFile() && !moved.isSymbolicLink() ? fs.readFileSync(quarantine) : null;
      if (!movedBytes || moved.dev !== ownership.dev || moved.ino !== ownership.ino ||
          (complete ? !movedBytes.equals(bytes) : movedBytes.length > bytes.length ||
            !movedBytes.equals(bytes.subarray(0, movedBytes.length)))) {
        try {
          fs.linkSync(quarantine, basename);
          fs.unlinkSync(quarantine);
          failures.push(`concurrent replacement restored: ${name}`);
        } catch (restoreError) {
          failures.push(`concurrent replacement retained at ${quarantine} (${name}): ${restoreError.message}`);
        }
        continue;
      }
      fs.unlinkSync(quarantine);
    } catch (error) { failures.push(`${name}: ${error.message}`); }
  }
  for (const { name, dev, ino } of directories.reverse()) {
    try {
      const basename = enterOwnedParent(name, directories, project, rootIdentity);
      const st = fs.lstatSync(basename, { bigint: true });
      if (!st.isDirectory() || st.isSymbolicLink() || st.dev !== dev || st.ino !== ino) {
        failures.push(`moved directory retained: ${name}`);
        continue;
      }
      fs.rmdirSync(basename);
    } catch (error) { failures.push(`${name}: ${error.message}`); }
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
      // Return to the *validated* project root before every path lookup.
      process.chdir(fresh.project);
      if (directoryIdentity('.') !== plan.rootIdentity) throw new Error('Project directory identity changed during apply');
      ensureDirectories(name, createdDirectories);
      const basename = name.split('/').at(-1);
      // The final basename is opened relative to the checked directory inode.
      // Intermediate symbolic substitutions cannot redirect it elsewhere.
      const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(basename, flags, 0o600);
      // Track immediately, so a short/failed write is also eligible for cleanup.
      const stat = fs.fstatSync(fd, { bigint: true });
      const owned = { name, bytes, ownership: { dev: stat.dev, ino: stat.ino }, complete: false };
      createdFiles.push(owned);
      try {
        fs.writeFileSync(fd, bytes);
        owned.complete = true;
      }
      finally { fs.closeSync(fd); }
      process.chdir(fresh.project);
      if (directoryIdentity('.') !== plan.rootIdentity || !safeOutputParents(name, createdDirectories)) {
        throw new Error('Output directory moved during apply');
      }
    }
    if (!isOriginalDirectory(fresh.project, plan.rootIdentity)) {
      throw new Error('Project directory moved during apply; created files remain anchored to original directory');
    }
    return { ...fresh, status: 'APPLIED', applied: true };
  } catch (error) {
    if (anchored && isOriginalDirectory(fresh.project, plan.rootIdentity)) {
      process.chdir(fresh.project);
      if (directoryIdentity('.') !== plan.rootIdentity) {
        throw new Error(`${error.message}; rollback skipped: project root directory changed`, { cause: error });
      }
      const problems = rollbackCreated(createdFiles, createdDirectories, fresh.project, plan.rootIdentity);
      if (problems.length) throw new Error(`${error.message}; incomplete rollback: ${problems.join('; ')}`, { cause: error });
    }
    throw error;
  } finally {
    process.chdir(previousCwd);
  }
}
