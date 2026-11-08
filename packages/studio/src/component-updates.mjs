import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defineGame } from '@ludory/core';
import { loadCatalog, isStudioComponentPath, isStudioAuthorPath } from './catalog.mjs';
import { projectRoot, directoryIdentity, isOriginalDirectory } from './projects.mjs';
import { assertComponentTrust, advanceComponentTrust, registerComponentTrust,
  hostTrustDigest, isMissingHostTrust, readComponentRecoveryCheckpoint,
  assertComponentRecoveryCheckpoint, registerComponentRecoveryCheckpoint,
  componentHostRegistryBinding } from './component-trust.mjs';
import { collectComponentGitHistory } from './component-git-history.mjs';
import { openProtectedDirectory } from './windows-directory-pin.mjs';

const stateName = 'ludory.components.json';
const lockName = '.ludory-components.lock';
const stagingPrefix = '.ludory-components-update-';
const backupPrefix = '.ludory-components-backup-';
const transitionName = 'component-transition.json';
const maxManagedFiles = 4096;
const hashPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const result = (project, status, conflicts = [], more = {}) => ({
  mode: 'component-update', project, status, writes: [], conflicts, ...more,
});

function exact(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields`);
  }
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') ||
      value.includes('\0') || value.startsWith('/') || value.split('/').some(part =>
        !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error(`Unsafe managed path: ${String(value)}`);
  }
  if (!isStudioComponentPath(value) || value.split('/').some(part =>
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || /[. ]$/.test(part))) {
    throw new Error(`Protected managed path: ${value}`);
  }
  return value;
}

function secureFile(filename, label, maxSize = 2 * 1024 * 1024) {
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(maxSize)) {
    throw new Error(`Unsafe ${label}: symbolic, hardlinked or oversized file`);
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || !opened.isFile() || opened.nlink !== 1n) {
      throw new Error(`Changed ${label} identity while reading`);
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function checkedFile(project, name, maxSize) {
  const parts = safeRelative(name).split('/');
  checkedParent(project, name);
  return secureFile(path.join(project, ...parts), `managed file ${name}`, maxSize);
}

function checkedParent(project, name) {
  const parts = safeRelative(name).split('/');
  let current = project;
  for (const segment of parts.slice(0, -1)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    const canonical = fs.realpathSync.native(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (process.platform === 'win32' ? canonical.toLowerCase() !== current.toLowerCase() : canonical !== current)) {
      throw new Error(`Unsafe managed directory: ${name}`);
    }
  }
  return path.join(project, ...parts);
}

function checkedNewFile(project, name) {
  const destination = checkedParent(project, name);
  try { fs.lstatSync(destination); throw new Error(`New component collides with existing file: ${name}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/** Author-owned files are mutable, but they must never gain filesystem escape privileges. */
function assertAuthoredFilesSafe(project, authorFiles) {
  if (!authorFiles?.length) return;
  for (const name of authorFiles) {
    if (name.startsWith('assets/')) {
      try { checkedFile(project, name, 25 * 1024 * 1024); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else checkedFile(project, name);
  }
  if (!authorFiles.includes('src/story.js') || !authorFiles.includes('narrative-assets.json')) return;
  const source = checkedFile(project, 'src/story.js');
  let proof;
  try { proof = JSON.parse(checkedFile(project, 'narrative-assets.json').toString('utf8')); }
  catch { throw new Error('Author narrative asset proof is unreadable or invalid'); }
  if (proof.schemaVersion !== 1 || proof.storySha256 !== hash(source) ||
      !proof.assets || typeof proof.assets !== 'object' || Array.isArray(proof.assets)) {
    throw new Error('Author narrative asset proof does not match story bytes');
  }
  for (const item of Object.values(proof.assets)) {
    if (!item || typeof item.path !== 'string' || !/^assets\/[A-Za-z0-9._-]+\.(?:svg|png|webp|jpg|jpeg)$/i.test(item.path) ||
        !hashPattern.test(item.sha256) ||
        hash(secureFile(checkedParent(project, item.path), `authored media ${item.path}`, 25 * 1024 * 1024)) !== item.sha256) {
      throw new Error('Author narrative asset proof has missing, unsafe or mismatched media');
    }
  }
}

function authorIdentityDigest(project, authorFiles) {
  if (!authorFiles?.length) return null;
  return hash(encode(authorFiles.map(name => {
    try { return [name, hash(checkedFile(project, name, name.startsWith('assets/') ? 25 * 1024 * 1024 : undefined))]; }
    catch (error) {
      if (error.code === 'ENOENT' && name.startsWith('assets/')) return [name, null];
      throw error;
    }
  })));
}

function parseState(bytes) {
  let state;
  try { state = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid component state JSON'); }
  exact(state, ['schemaVersion', 'template', 'files', ...(state.schemaVersion === 2 ? ['authorFiles'] : [])], 'component state');
  exact(state.template, ['id', 'version', 'profile', 'origin', 'sourceSha256'], 'component template');
  if (![1, 2].includes(state.schemaVersion) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.template.id) ||
      !versionPattern.test(state.template.version) ||
      state.template.version.match(/^\d+\.\d+\.\d+-([^+]+)/)?.[1].split('.').some(part => /^0\d+$/.test(part)) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.template.profile) ||
      !['builtin', 'local'].includes(state.template.origin) ||
      !hashPattern.test(state.template.sourceSha256) ||
      state.files === null || typeof state.files !== 'object' || Array.isArray(state.files)) {
    throw new Error('Invalid component ownership state');
  }
  const entries = Object.entries(state.files);
  if (!entries.length || entries.length > maxManagedFiles) throw new Error('Invalid managed component file count');
  for (const [name, expected] of entries) {
    safeRelative(name);
    if (!hashPattern.test(expected)) throw new Error(`Invalid managed hash: ${name}`);
  }
  if (state.schemaVersion === 2) {
    if (!Array.isArray(state.authorFiles) || !state.authorFiles.length ||
        state.authorFiles.length + entries.length > maxManagedFiles ||
        new Set(state.authorFiles).size !== state.authorFiles.length) {
      throw new Error('Invalid author-owned component file count');
    }
    for (const name of state.authorFiles) {
      safeRelative(name);
      if (!isStudioAuthorPath(name) || Object.hasOwn(state.files, name)) {
        throw new Error(`Invalid author-owned component path: ${name}`);
      }
    }
  }
  if (!encode(state).equals(bytes)) throw new Error('Component state is not canonical');
  return { state, bytes, sha256: hash(bytes) };
}
function readState(project) {
  return parseState(secureFile(path.join(project, stateName), 'component ownership state'));
}

function originalOwnershipMatches(installed, receipt) {
  const t = installed.state.template;
  if (receipt.template?.id !== t.id || receipt.template?.version !== t.version ||
      receipt.profile?.id !== t.profile || receipt.catalog?.origin !== t.origin ||
      receipt.catalog?.templateSha256 !== t.sourceSha256 ||
      !receipt.files || typeof receipt.files !== 'object' || Array.isArray(receipt.files)) return false;
  const owned = Object.entries(receipt.files).filter(([name]) => isStudioComponentPath(name));
  const authors = new Set(installed.state.authorFiles ?? []);
  if (installed.state.schemaVersion === 2) {
    // An original v1 receipt does not authorize v2 classification by itself:
    // only a modern create receipt or a retained v1→v2 transaction can.
    if (receipt.componentOwnership?.schemaVersion !== 2 ||
        JSON.stringify(receipt.componentOwnership.authorFiles) !== JSON.stringify(installed.state.authorFiles)) return false;
  } else if (receipt.componentOwnership !== undefined) return false;
  return owned.length === Object.keys(installed.state.files).length + authors.size &&
    owned.every(([name, sha256]) => authors.has(name) || installed.state.files[name] === sha256);
}

function assertHistoricalOwnershipStep(a, b) {
  const released = Object.keys(a.files).filter(name => !Object.hasOwn(b.files, name));
  const adoption = a.schemaVersion === 1 && b.schemaVersion === 2 &&
    released.length === b.authorFiles.length &&
    released.every(name => b.authorFiles.includes(name)) &&
    b.authorFiles.every(name => Object.hasOwn(a.files, name));
  const order = versionCompare(b.template.version, a.template.version);
  const authorRegression = a.schemaVersion === 2 &&
    (b.schemaVersion !== 2 || JSON.stringify(a.authorFiles) !== JSON.stringify(b.authorFiles));
  if (authorRegression || (order <= 0 && !(order === 0 && adoption &&
        b.template.sourceSha256 === a.template.sourceSha256 &&
        Object.keys(b.files).every(name => b.files[name] === a.files[name]))) ||
      a.template.id !== b.template.id || a.template.profile !== b.template.profile ||
      a.template.origin !== b.template.origin ||
      released.some(name => !adoption || !isStudioAuthorPath(name))) {
    throw new Error('Component transition attempts ownership regression');
  }
}

// The standalone components manifest is not an ownership grant. It must be
// traceable to the initial creation receipt through real, retained Studio
// transaction archives. This is local tamper evidence, not a digital signature
// against an attacker who can rewrite the *entire* project and all archives.
function verifyOwnershipHistory(project, installed, receipt) {
  if (originalOwnershipMatches(installed, receipt)) return;
  const checkpoint = readComponentRecoveryCheckpoint(project);
  const anchor = checkpoint ? {
    rootIdentity: directoryIdentity(project),
    receiptSha256: hash(secureFile(path.join(project, 'ludory.studio.json'), 'creation receipt')),
    manifestSha256: hash(secureFile(path.join(project, 'ludory.project.json'), 'game manifest')),
  } : null;
  const archives = fs.readdirSync(project).filter(name => name.startsWith(backupPrefix));
  if (archives.length > 128) throw new Error('Too many component provenance archives');
  const steps = new Map();
  for (const name of archives) {
    const archive = path.join(project, name);
    const stat = fs.lstatSync(archive);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe component archive: ${name}`);
    const transitionFile = path.join(archive, transitionName);
    let bytes;
    try { bytes = secureFile(transitionFile, 'component transition'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const proof = JSON.parse(bytes.toString('utf8'));
    exact(proof, ['schemaVersion', 'beforeSha256', 'afterSha256', 'backupSlot'], 'component transition');
    if (proof.schemaVersion !== 1 || !hashPattern.test(proof.beforeSha256) ||
        !hashPattern.test(proof.afterSha256) || !/^(?:backup\/|backup-)[0-9]{1,4}$/.test(proof.backupSlot) ||
        !encode(proof).equals(bytes)) throw new Error('Invalid component transition proof');
    if (!steps.has(proof.afterSha256)) steps.set(proof.afterSha256, []);
    steps.get(proof.afterSha256).push({ archive, proof });
  }
  let current = installed;
  for (let hop = 0; hop <= steps.size; hop++) {
    if (originalOwnershipMatches(current, receipt)) return;
    if (checkpoint?.stateSha256 === current.sha256) {
      assertComponentRecoveryCheckpoint(project, { ...anchor, stateSha256: current.sha256 });
      return;
    }
    const candidates = steps.get(current.sha256) ?? [];
    const valid = [];
    for (const { proof, archive } of candidates) {
      try {
        if (proof.backupSlot.includes('/')) {
          const backupStat = fs.lstatSync(path.join(archive, 'backup'));
          if (!backupStat.isDirectory() || backupStat.isSymbolicLink()) continue;
        }
        const prior = parseState(secureFile(path.join(archive, ...proof.backupSlot.split('/')), 'prior component state'));
        if (prior.sha256 === proof.beforeSha256) valid.push(prior);
      } catch { /* An aborted transaction may not yet have backed up its state. */ }
    }
    if (!valid.length) throw new Error('Component ownership has no verified creation/upgrade provenance');
    const previous = valid[0];
    if (valid.some(item => item.sha256 !== previous.sha256)) throw new Error('Ambiguous component transition provenance');
    assertHistoricalOwnershipStep(previous.state, current.state);
    current = previous;
  }
  throw new Error('Cyclic component ownership provenance');
}

function versionCompare(a, b) {
  const split = version => {
    const withoutBuild = version.split('+')[0];
    const separator = withoutBuild.indexOf('-');
    const base = separator < 0 ? withoutBuild : withoutBuild.slice(0, separator);
    const [major, minor, patch] = base.split('.');
    const prerelease = separator < 0 ? undefined : withoutBuild.slice(separator + 1);
    return { parts: [BigInt(major), BigInt(minor), BigInt(patch)], pre: prerelease?.split('.') ?? [] };
  };
  const left = split(a), right = split(b);
  for (let i = 0; i < 3; i++) if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1;
  if (!left.pre.length || !right.pre.length) return left.pre.length ? -1 : right.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i], r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return BigInt(l) > BigInt(r) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

/** Pure preview. Only files recorded by a new Studio create are updateable. */
export function planComponentUpdate(projectDir, { catalog, adoptAuthorFiles = false,
  acceptStateSha256, acceptProposalSha256 } = {}) {
  const project = projectRoot(projectDir);
  const catalogPath = catalog === undefined ? undefined : path.resolve(catalog);
  const options = { catalog: catalogPath, adoptAuthorFiles, acceptStateSha256, acceptProposalSha256 };
  const projectEntries = fs.readdirSync(project);
  if (projectEntries.includes(lockName) || projectEntries.some(entry => entry.startsWith(stagingPrefix))) {
    return result(project, 'CONFLICT', ['Unfinished component update transaction: inspect lock and retained backups before retry']);
  }
  let installed;
  try { installed = readState(project); }
  catch (error) {
    return result(project, error.code === 'ENOENT' ? 'BLOCKED' : 'CONFLICT', [
      error.code === 'ENOENT' ? 'No explicit Studio component ownership; historical receipts cannot authorize updates' : error.message,
    ]);
  }
  let receipt;
  let receiptSha256;
  try {
    const receiptBytes = secureFile(path.join(project, 'ludory.studio.json'), 'creation receipt');
    receiptSha256 = hostTrustDigest(receiptBytes);
    receipt = JSON.parse(receiptBytes.toString('utf8'));
  }
  catch (error) { return result(project, 'CONFLICT', [`Creation receipt missing or unsafe: ${error.message}`]); }
  const rootIdentity = directoryIdentity(project);
  let pinnedManifestSha256;
  try {
    const manifestBytes = secureFile(path.join(project, 'ludory.project.json'), 'game manifest');
    defineGame(JSON.parse(manifestBytes.toString('utf8')));
    pinnedManifestSha256 = hostTrustDigest(manifestBytes);
  }
  catch (error) { return result(project, 'BLOCKED', [`Game manifest missing or unsafe: ${error.message}`]); }
  try {
    assertComponentTrust(project, { rootIdentity, receiptSha256,
      manifestSha256: pinnedManifestSha256, stateSha256: installed.sha256 });
  } catch (error) {
    return result(project, isMissingHostTrust(error) ? 'BLOCKED' : 'CONFLICT', [error.message]);
  }
  try { verifyOwnershipHistory(project, installed, receipt); }
  catch (error) { return result(project, 'CONFLICT', [`Component provenance invalid: ${error.message}`]); }
  let manifest;
  let manifestSha256;
  try {
    const bytes = secureFile(path.join(project, 'ludory.project.json'), 'game manifest');
    manifest = defineGame(JSON.parse(bytes.toString('utf8')));
    manifestSha256 = hash(bytes);
  } catch (error) { return result(project, 'BLOCKED', [`Game manifest invalid: ${error.message}`]); }
  let template, profile;
  try {
    const loaded = loadCatalog(catalogPath);
    template = loaded.templates.get(installed.state.template.id);
    if (template) profile = loaded.profiles.get(template.profile);
  } catch (error) { return result(project, 'BLOCKED', [error.message]); }
  if (!template || !profile || template.origin !== installed.state.template.origin) {
    return result(project, 'BLOCKED', ['Installed template is unavailable in the selected catalog']);
  }
  if (template.profile !== installed.state.template.profile) {
    return result(project, 'CONFLICT', ['Template profile identity changed; automatic profile switching is forbidden']);
  }
  if (installed.state.schemaVersion === 2 &&
      JSON.stringify(template.authorFiles) !== JSON.stringify(installed.state.authorFiles)) {
    return result(project, 'CONFLICT', ['Author-owned template paths changed; explicit ownership migration required']);
  }
  const needsAdoption = installed.state.schemaVersion === 1 && template.authorFiles.length > 0;
  if (needsAdoption && template.authorFiles.some(name => !Object.hasOwn(installed.state.files, name))) {
    return result(project, 'CONFLICT', ['Legacy component state cannot adopt unowned template paths']);
  }
  const releaseNames = needsAdoption ? template.authorFiles : [];
  const released = new Set(releaseNames);
  const conflicts = [];
  for (const [name, sha256] of Object.entries(installed.state.files)) {
    if (released.has(name)) continue;
    try {
      if (hash(checkedFile(project, name)) !== sha256) conflicts.push(`Managed file modified: ${name}`);
    } catch (error) { conflicts.push(`Managed file unavailable/unsafe: ${name}: ${error.message}`); }
  }
  if (conflicts.length) return result(project, 'CONFLICT', conflicts);
  try { assertAuthoredFilesSafe(project, needsAdoption ? releaseNames : installed.state.authorFiles); }
  catch (error) { return result(project, 'CONFLICT', [error.message]); }
  const authoredPaths = needsAdoption ? releaseNames : (installed.state.authorFiles ?? []);
  let authorDigest;
  try { authorDigest = authorIdentityDigest(project, authoredPaths); }
  catch (error) { return result(project, 'CONFLICT', [error.message]); }
  // The creation receipt is *not* ownership authority: it can only narrow
  // compatibility, never add a managed file or authorize an overwrite.
  try {
    if (receipt.schemaVersion !== 1 || receipt.profile?.id !== profile.id ||
        receipt.template?.id !== template.id || receipt.catalog?.profileSha256 !== profile.sourceSha256) {
      return result(project, 'CONFLICT', ['Original Studio profile contract changed; manual review required']);
    }
  } catch (error) { return result(project, 'CONFLICT', [`Creation receipt missing or unsafe: ${error.message}`]); }
  if (manifest.engine !== template.engine || template.engine !== profile.engine ||
      manifest.targets.some(target => !template.targets.includes(target) || !profile.targets.includes(target))) {
    return result(project, 'BLOCKED', ['Updated template/profile incompatible with game engine or targets']);
  }
  if (receipt.files?.['ludory.project.json'] !== manifestSha256) {
    return result(project, 'CONFLICT', ['Game manifest differs from the original creation contract; manual compatibility review required']);
  }
  const old = installed.state.template;
  const order = versionCompare(template.version, old.version);
  if (order < 0) return result(project, 'CONFLICT', ['Template downgrade is not allowed']);
  const previousNames = Object.keys(installed.state.files);
  const newNames = template.files.filter(name => isStudioComponentPath(name) &&
    !template.authorFiles.includes(name));
  const authorNames = needsAdoption ? releaseNames : (installed.state.authorFiles ?? []);
  if (newNames.length + authorNames.length > maxManagedFiles) {
    return result(project, 'BLOCKED', ['Updated template exceeds combined managed/author file limit']);
  }
  if (previousNames.some(name => !newNames.includes(name) && !released.has(name))) {
    return result(project, 'CONFLICT', ['Template removes managed file paths; manual upgrade required']);
  }
  const nextFiles = Object.create(null);
  for (const name of newNames) {
    nextFiles[name] = template.assets.get(name).sha256;
    if (!Object.hasOwn(installed.state.files, name)) {
      try { checkedNewFile(project, name); }
      catch (error) { conflicts.push(error.message); }
    }
  }
  if (conflicts.length) return result(project, 'CONFLICT', conflicts);
  if (order === 0) {
    if (old.version !== template.version || old.sourceSha256 !== template.sourceSha256 ||
        newNames.length !== previousNames.length - releaseNames.length ||
        previousNames.some(name => !released.has(name) && nextFiles[name] !== installed.state.files[name])) {
      return result(project, 'CONFLICT', ['Template source/assets changed without an increased SemVer version']);
    }
    if (!needsAdoption) return result(project, 'IN_SYNC', [], { template: { id: old.id, version: old.version } });
  }
  const changed = newNames.filter(name => installed.state.files[name] !== nextFiles[name]);
  const writes = [...changed, stateName];
  const proposalSha256 = needsAdoption ? hash(encode({
    oldStateSha256: installed.sha256,
    authorDigest,
    template: { id: template.id, version: template.version, profileSha256: profile.sourceSha256,
      sourceSha256: template.sourceSha256 },
    authorFiles: releaseNames,
    managedOutputs: newNames.map(name => [name, nextFiles[name]]),
    writes,
  })) : undefined;
  if (needsAdoption) {
    if (adoptAuthorFiles &&
        ((acceptStateSha256 === undefined) !== (acceptProposalSha256 === undefined))) {
      return result(project, 'BLOCKED', ['Author adoption requires both state and proposal SHA confirmations']);
    }
    if (!adoptAuthorFiles || acceptStateSha256 === undefined) {
      return result(project, 'NEEDS_USER_ACTION', [], { stateSha256: installed.sha256,
        proposalSha256, authorFiles: [...releaseNames], writes,
        template: { id: template.id, fromVersion: old.version, version: template.version },
        warning: 'Review author paths, managed writes, target version and both SHA values; only authored bytes remain unchanged.' });
    }
    if (acceptStateSha256 !== installed.sha256 || acceptProposalSha256 !== proposalSha256) {
      return result(project, 'BLOCKED', ['Author adoption state or proposal SHA confirmation mismatch']);
    }
  }
  if (projectEntries.filter(name => name.startsWith(backupPrefix)).length >= 128) {
    return result(project, 'BLOCKED', ['Component backup archive limit reached; safe history compaction requires operator review']);
  }

  const next = { schemaVersion: 1,
    template: { id: template.id, version: template.version, profile: template.profile,
      origin: template.origin, sourceSha256: template.sourceSha256 },
    files: nextFiles };
  if (installed.state.schemaVersion === 2 || needsAdoption) {
    next.schemaVersion = 2;
    next.authorFiles = needsAdoption ? releaseNames : installed.state.authorFiles;
  }
  let nextStateBytes;
  try { nextStateBytes = encode(next); parseState(nextStateBytes); }
  catch (error) { return result(project, 'BLOCKED', [`Invalid updated ownership state: ${error.message}`]); }
  const fingerprint = hash(encode({ project, rootIdentity, manifestSha256, oldStateSha256: installed.sha256,
    nextStateSha256: hash(nextStateBytes), changes: changed.map(name => [name, nextFiles[name]]), catalogPath, authorDigest }));
  const plan = result(project, 'READY', [], {
    writes, template: { id: template.id, fromVersion: old.version, version: template.version },
    options, rootIdentity, manifestSha256, receiptSha256, oldStateSha256: installed.sha256, fingerprint, authorDigest, proposalSha256,
  });
  Object.defineProperty(plan, '_snapshot', { value: { changed, nextStateBytes,
    adopted: releaseNames,
    newFiles: new Set(newNames.filter(name => !Object.hasOwn(installed.state.files, name))),
    assets: new Map(changed.map(name => [name, template.assets.get(name).bytes])),
  }, enumerable: false });
  return plan;
}

/** Consent-gated, state-only or template-update adoption; uses the normal anchored component apply. */
export function planAuthorAdoption(projectDir, { catalog, acceptStateSha256, acceptProposalSha256 } = {}) {
  return planComponentUpdate(projectDir, { catalog, adoptAuthorFiles: true, acceptStateSha256, acceptProposalSha256 });
}

export function componentStatus(projectDir, options = {}) {
  return { ...planComponentUpdate(projectDir, options), mode: 'component-status' };
}

/** Explicit, human-reviewed trust transfer. Never an automatic fallback. */
export function previewComponentTrust(projectDir, { catalog } = {}) {
  const project = projectRoot(projectDir);
  const catalogPath = catalog === undefined ? undefined : path.resolve(catalog);
  const output = (status, conflicts = [], more = {}) => ({
    mode: 'component-trust', project, status, writes: [], conflicts, ...more,
  });
  if (fs.readdirSync(project).some(entry => entry === lockName || entry.startsWith(stagingPrefix))) {
    return output('CONFLICT', ['Unfinished component transaction; inspect and recover before transferring trust']);
  }
  let installed, receiptSha256, manifestSha256, authorCandidates, authorDigest, managedPaths;
  try {
    installed = readState(project);
    const receiptBytes = secureFile(path.join(project, 'ludory.studio.json'), 'creation receipt');
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    receiptSha256 = hash(receiptBytes);
    verifyOwnershipHistory(project, installed, receipt);
    // An old v1 state still hashes the original narrative. A versioned,
    // explicitly reviewed catalog may narrow only these declared author paths
    // for a new-host consent preview; it never transfers launcher ownership.
    authorCandidates = installed.state.authorFiles ?? [];
    if (installed.state.schemaVersion === 1) {
      const template = loadCatalog(catalogPath).templates.get(installed.state.template.id);
      if (template?.authorFiles.length && template.origin === installed.state.template.origin &&
          template.profile === installed.state.template.profile &&
          versionCompare(template.version, installed.state.template.version) >= 0 &&
          (template.version !== installed.state.template.version ||
            template.sourceSha256 === installed.state.template.sourceSha256) &&
          Object.keys(installed.state.files).every(name => template.files.includes(name)) &&
          template.authorFiles.every(name => Object.hasOwn(installed.state.files, name))) {
        authorCandidates = template.authorFiles;
      }
    }
    assertAuthoredFilesSafe(project, authorCandidates);
    authorDigest = authorIdentityDigest(project, authorCandidates);
    const released = new Set(authorCandidates);
    managedPaths = Object.keys(installed.state.files).filter(name => !released.has(name)).sort();
    const manifestBytes = secureFile(path.join(project, 'ludory.project.json'), 'game manifest');
    defineGame(JSON.parse(manifestBytes.toString('utf8')));
    manifestSha256 = hash(manifestBytes);
    for (const [name, expected] of Object.entries(installed.state.files)) {
      if (released.has(name)) continue;
      if (hash(checkedFile(project, name)) !== expected) throw new Error(`Managed file modified: ${name}`);
    }
  } catch (error) { return output('CONFLICT', [`Trust inspection failed: ${error.message}`]); }
  const rootIdentity = directoryIdentity(project);
  const expected = { rootIdentity, receiptSha256, manifestSha256, stateSha256: installed.sha256 };
  try {
    assertComponentTrust(project, expected);
    return output('IN_SYNC', [], { ...expected, managedPaths, authorCandidates, authorDigest, catalogPath });
  } catch (error) {
    if (!isMissingHostTrust(error)) return output('CONFLICT', [error.message]);
  }
  return output('NEEDS_USER_ACTION', [], {
    ...expected, managedPaths, authorCandidates, authorDigest, catalogPath,
    warning: 'Review every managed path, proposed author paths and state SHA-256 before accepting ownership on this host. Project files alone are not trusted evidence.',
  });
}

export function acceptComponentTrust(preview, confirmedSha256) {
  if (!preview || preview.mode !== 'component-trust' || preview.status !== 'NEEDS_USER_ACTION') {
    throw new Error('Only an explicitly previewed, untrusted component state may be accepted');
  }
  if (confirmedSha256 !== preview.stateSha256) throw new Error('Trust confirmation SHA-256 does not match preview');
  const fresh = previewComponentTrust(preview.project, { catalog: preview.catalogPath });
  for (const key of ['status', 'rootIdentity', 'receiptSha256', 'manifestSha256', 'stateSha256', 'authorDigest', 'catalogPath']) {
    if (fresh[key] !== preview[key]) throw new Error(`Stale component trust preview: ${key} changed`);
  }
  if (JSON.stringify(fresh.managedPaths) !== JSON.stringify(preview.managedPaths) ||
      JSON.stringify(fresh.authorCandidates) !== JSON.stringify(preview.authorCandidates)) {
    throw new Error('Stale component trust preview: managed or author paths changed');
  }
  registerComponentTrust(preview.project, { rootIdentity: fresh.rootIdentity,
    receiptSha256: fresh.receiptSha256, manifestSha256: fresh.manifestSha256,
    stateSha256: fresh.stateSha256 });
  return { ...fresh, status: 'TRUSTED' };
}

/** Recover missing native transaction archives only from complete, owner-reviewed Git evidence. */
export function previewComponentGitRecovery(projectDir, { fromCommit, toCommit, catalog } = {}) {
  const project = projectRoot(projectDir);
  const catalogPath = catalog === undefined ? undefined : path.resolve(catalog);
  const output = (status, conflicts = [], more = {}) => ({
    mode: 'component-recovery', project, status, writes: [], conflicts, ...more,
  });
  const projectEntries = fs.readdirSync(project);
  if (projectEntries.some(entry => entry === lockName || entry.startsWith(stagingPrefix))) {
    return output('CONFLICT', ['Unfinished component update transaction; recovery is forbidden']);
  }
  // Real native archives must be examined or restored, never ignored by a
  // fallback Git witness. This operation is strictly for *missing* archives.
  if (projectEntries.some(entry => entry.startsWith(backupPrefix))) {
    return output('CONFLICT', ['Native component archive exists; inspect its provenance instead of Git recovery']);
  }
  try {
    if (readComponentRecoveryCheckpoint(project)) {
      return output('CONFLICT', ['Existing component recovery checkpoint cannot be replaced']);
    }
    const installed = readState(project);
    const receiptBytes = secureFile(path.join(project, 'ludory.studio.json'), 'creation receipt');
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    const manifestBytes = secureFile(path.join(project, 'ludory.project.json'), 'game manifest');
    defineGame(JSON.parse(manifestBytes.toString('utf8')));
    const receiptSha256 = hash(receiptBytes), manifestSha256 = hash(manifestBytes);
    const rootIdentity = directoryIdentity(project);
    const expected = { rootIdentity, receiptSha256, manifestSha256, stateSha256: installed.sha256 };
    try {
      assertComponentTrust(project, expected);
      return output('CONFLICT', ['This Studio project already has a host trust pin; recovery cannot re-anchor it']);
    } catch (error) {
      if (!isMissingHostTrust(error)) return output('CONFLICT', [error.message]);
    }
    if (originalOwnershipMatches(installed, receipt)) {
      return output('CONFLICT', ['Installed component already matches its original creation receipt; use components trust']);
    }
    const authorCandidates = installed.state.authorFiles ?? [];
    assertAuthoredFilesSafe(project, authorCandidates);
    const authorDigest = authorIdentityDigest(project, authorCandidates);
    const managedPaths = Object.keys(installed.state.files).sort();
    for (const [name, expectedHash] of Object.entries(installed.state.files)) {
      if (hash(checkedFile(project, name)) !== expectedHash) throw new Error(`Managed file modified: ${name}`);
    }
    const evidence = collectComponentGitHistory(project, { fromCommit, toCommit });
    if (evidence.commits.length < 2) throw new Error('Git recovery has no historical component transition');
    const transitions = [];
    let previous;
    for (const commit of evidence.commits) {
      const state = parseState(commit.files.get(stateName).bytes);
      if (!commit.files.get('ludory.studio.json').bytes.equals(receiptBytes) ||
          !commit.files.get('ludory.project.json').bytes.equals(manifestBytes)) {
        throw new Error(`Committed creation receipt or game manifest changed at ${commit.sha}`);
      }
      for (const [name, expectedHash] of Object.entries(state.state.files)) {
        const gitFile = commit.files.get(name);
        if (!gitFile || hash(gitFile.bytes) !== expectedHash) {
          throw new Error(`Committed managed file hash mismatch at ${commit.sha}: ${name}`);
        }
      }
      if (!previous) {
        if (!originalOwnershipMatches(state, receipt)) {
          throw new Error('Git source state does not match original Studio creation contract');
        }
      } else if (state.sha256 !== previous.state.sha256) {
        assertHistoricalOwnershipStep(previous.state.state, state.state);
        const added = Object.keys(state.state.files).filter(name => !Object.hasOwn(previous.state.state.files, name));
        if (added.length) throw new Error(`Git transition introduces new managed ownership: ${added.join(', ')}`);
        transitions.push({ fromCommit: previous.commit, toCommit: commit.sha,
          fromVersion: previous.state.state.template.version, toVersion: state.state.template.version,
          beforeSha256: previous.state.sha256, afterSha256: state.sha256 });
      }
      previous = { state, commit: commit.sha };
    }
    if (previous.state.sha256 !== installed.sha256 || !previous.state.bytes.equals(installed.bytes)) {
      throw new Error('Git destination component state differs from current project');
    }
    for (const name of managedPaths) {
      if (!previous.state.state.files[name] ||
          !previous.state.bytes || !evidence.commits.at(-1).files.get(name).bytes.equals(checkedFile(project, name))) {
        throw new Error(`Git destination managed file differs from current project: ${name}`);
      }
    }
    if (!transitions.length) throw new Error('Git history contains no verified Studio ownership transition');
    if (catalogPath) {
      const template = loadCatalog(catalogPath).templates.get(installed.state.template.id);
      if (!template || template.profile !== installed.state.template.profile ||
          template.origin !== installed.state.template.origin) {
        throw new Error('Catalog identity differs from recovered component');
      }
    }
    const hostRegistry = componentHostRegistryBinding(project);
    if (!hostRegistry.rootExists) {
      return output('BLOCKED', [
        'Host registry does not exist. Initialize the selected host-registry directory separately, then rerun recovery preview and review its new SHA-256 before accepting.',
      ], { hostRegistryPath: hostRegistry.root,
        nextAction: 'Create hostRegistryPath as a private directory outside the game, then run components recover without --apply for a fresh owner review.' });
    }
    const witness = { schemaVersion: 1, project, repositoryRoot: evidence.repositoryRoot,
      projectPath: evidence.projectPath, fromCommit, toCommit,
      rootIdentity, receiptSha256, manifestSha256, stateSha256: installed.sha256,
      hostRegistry,
      authorDigest, managedPaths, transitions };
    const recoverySha256 = hash(encode(witness));
    return output('NEEDS_USER_ACTION', [], { ...witness, recoverySha256, catalogPath,
      warning: 'Git content continuity is not owner authentication. Review commits, hashes, paths, and this digest; separate components trust is mandatory after recovery.' });
  } catch (error) {
    return output('CONFLICT', [`Git component recovery failed: ${error.message}`]);
  }
}

export function acceptComponentGitRecovery(preview, confirmedRecoverySha256) {
  if (!preview || preview.mode !== 'component-recovery' || preview.status !== 'NEEDS_USER_ACTION') {
    throw new Error('Only an explicitly previewed component recovery may be accepted');
  }
  if (confirmedRecoverySha256 !== preview.recoverySha256) {
    throw new Error('Recovery confirmation SHA-256 does not match preview');
  }
  const fresh = previewComponentGitRecovery(preview.project, {
    fromCommit: preview.fromCommit, toCommit: preview.toCommit, catalog: preview.catalogPath,
  });
  if (fresh.status !== 'NEEDS_USER_ACTION' || fresh.recoverySha256 !== preview.recoverySha256) {
    throw new Error('Stale or conflicting component recovery preview');
  }
  registerComponentRecoveryCheckpoint(fresh.project, {
    rootIdentity: fresh.rootIdentity, receiptSha256: fresh.receiptSha256,
    manifestSha256: fresh.manifestSha256, stateSha256: fresh.stateSha256,
    recoverySha256: fresh.recoverySha256, fromCommit: fresh.fromCommit, toCommit: fresh.toCommit,
  }, fresh.hostRegistry);
  return { ...fresh, status: 'RECOVERED' };
}

function stagedFile(newDirectory, relative, bytes, mode = 0o600) {
  const filename = path.isAbsolute(relative) ? relative : path.join(newDirectory, relative);
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0), mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return filename;
}
function sameInode(stat, expected) {
  return Boolean(expected) && stat.dev === expected.dev && stat.ino === expected.ino;
}

function verifiedBackupBytes(backup, expectedIdentity) {
  const fd = fs.openSync(backup, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || !sameInode(stat, expectedIdentity) || stat.nlink !== 1n) {
      throw new Error(`Changed component backup identity: ${backup}`);
    }
    // The original inode can receive legitimate writes through a preexisting
    // editor handle after it was moved to backup. Preserve those bytes during
    // rollback; ownership hashes will independently block the next update.
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function syncFile(filename) {
  // FlushFileBuffers requires a writable Windows file handle; an O_RDONLY
  // descriptor can fail with EPERM even for an otherwise writable file.
  const access = process.platform === 'win32' ? fs.constants.O_RDWR : fs.constants.O_RDONLY;
  const fd = fs.openSync(filename, access | (fs.constants.O_NOFOLLOW || 0));
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function syncDirectory(fd) {
  // Windows directory handles cannot be fsynced through Node reliably. Keep
  // synchronous file flushes, but retain fail-closed fsync on POSIX hosts.
  if (process.platform !== 'win32') fs.fsyncSync(fd);
}

// On Windows Node does not expose openat or a /proc descriptor path. A
// basename opened relative to a verified CWD stays with the directory inode
// when its visible pathname is swapped between validation and open.
function withPinnedProjectCwd(project, identity, operation) {
  const previous = process.cwd();
  try {
    process.chdir(project);
    if (directoryIdentity('.') !== identity) throw new Error('Project root changed before anchored write');
    const result = operation();
    if (!isOriginalDirectory(project, identity)) throw new Error('Project root changed during anchored write');
    return result;
  } finally { process.chdir(previous); }
}

function heldDirectory(directory, visibleAnchor = directory) {
  if (process.platform === 'win32') {
    const pin = openProtectedDirectory(directory);
    return { fd: null, anchor: visibleAnchor,
      stat: () => ({ dev: pin.dev, ino: pin.ino, isDirectory: () => true }),
      createGuard: basename => pin.createGuard(basename),
      close: () => pin.close() };
  }
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) |
    (fs.constants.O_NOFOLLOW || 0));
  const st = fs.fstatSync(fd);
  if (!st.isDirectory()) { fs.closeSync(fd); throw new Error(`Unsafe transaction directory: ${directory}`); }
  // Node lacks an openat API. Only Linux supplies the descriptor-relative
  // path used by component apply; unsupported POSIX hosts fail closed.
  return { fd, anchor: process.platform === 'linux' ? `/proc/self/fd/${fd}` : visibleAnchor,
    stat: () => fs.fstatSync(fd, { bigint: true }), close: () => fs.closeSync(fd) };
}

function assertManifestUnchanged(project, expectedSha256) {
  if (hash(secureFile(path.join(project, 'ludory.project.json'), 'game manifest')) !== expectedSha256) {
    throw new Error('Game manifest changed during component update');
  }
}

// Operate on a basename relative to a directory inode verified on entry.
// Linux resolves /proc/self/fd/<directory-fd>/name through the held directory
// descriptor, even when an attacker replaces its visible project pathname.
// Windows prevents that directory replacement while it is our CWD, so retain
// the CWD fallback there rather than weakening its existing fail-closed path.
function withAnchoredParent(project, name, rootIdentity, operation) {
  const previous = process.cwd();
  let parentFd = null;
  try {
    process.chdir(project);
    if (directoryIdentity('.') !== rootIdentity) throw new Error('Project root changed during component transaction');
    const parts = name.split('/');
    const basename = parts.pop();
    for (const component of parts) {
      const stat = fs.lstatSync(component, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe component directory: ${name}`);
      process.chdir(component);
      if (directoryIdentity('.') !== `${stat.dev}:${stat.ino}`) throw new Error(`Changed component directory: ${name}`);
    }
    if (process.platform === 'linux') {
      parentFd = fs.openSync('.', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | (fs.constants.O_NOFOLLOW || 0));
      const held = fs.fstatSync(parentFd, { bigint: true });
      const current = fs.lstatSync('.', { bigint: true });
      if (held.dev !== current.dev || held.ino !== current.ino || !held.isDirectory()) {
        throw new Error(`Changed component directory: ${name}`);
      }
    }
    const anchoredName = parentFd === null ? basename : `/proc/self/fd/${parentFd}/${basename}`;
    const output = operation(anchoredName);
    // POSIX flushes directory entries after publication/rollback. Windows
    // cannot expose a reliable directory fsync through Node; file data is
    // still flushed separately and transaction recovery remains mandatory.
    const syncFd = parentFd === null ? fs.openSync('.', fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0)) : parentFd;
    try { syncDirectory(syncFd); }
    finally { if (syncFd !== parentFd) fs.closeSync(syncFd); }
    // The anchored old directory remains safe, but a new link replacing its
    // pathname makes the published game path unsafe and must block success.
    if (name === stateName) {
      if (directoryIdentity(project) !== rootIdentity) throw new Error('Project root moved during state publish');
    } else checkedParent(project, name);
    return output;
  } finally {
    if (parentFd !== null) fs.closeSync(parentFd);
    process.chdir(previous);
  }
}

/** Guarded synchronous multi-file update. The backup survives any failed rollback. */
export function applyComponentPlan(plan) {
  // Linux resolves writes via held /proc directory descriptors; Windows uses
  // native no-delete-share directory handles. Other hosts have neither guard.
  if (!['linux', 'win32'].includes(process.platform)) {
    throw new Error(`Unsupported component apply platform: ${process.platform}`);
  }
  if (!plan || plan.mode !== 'component-update' || plan.status !== 'READY') {
    throw new Error('Only a READY component update plan may be applied');
  }
  const fresh = planComponentUpdate(plan.project, plan.options);
  if (fresh.status !== 'READY' || fresh.fingerprint !== plan.fingerprint ||
      fresh.rootIdentity !== plan.rootIdentity || !isOriginalDirectory(plan.project, plan.rootIdentity)) {
    throw new Error(`Stale component plan or conflict: ${fresh.conflicts.join('; ') || fresh.status}`);
  }

  const project = fresh.project;
  const rootHandle = heldDirectory(project);
  if (`${rootHandle.stat().dev}:${rootHandle.stat().ino}` !== plan.rootIdentity) {
    rootHandle.close();
    throw new Error('Project root identity changed before lock creation');
  }
  const lockPath = path.join(rootHandle.anchor, lockName);
  let lockStat;
  let stage = null;
  const held = [rootHandle];
  let directories = null;
  let stageIdentity = null;
  let rollbackComplete = true;
  let guardIntegrityFailure = false;
  let retainedBackup = null;
  let outcomeError = null;
  const operations = [];
  const guards = [];
  try {
    const guardDirectory = (pin, visibleParent) => {
      if (process.platform !== 'win32') return;
      const basename = `.ludory-components-guard-${crypto.randomBytes(16).toString('hex')}`;
      let guard;
      try { guard = pin.createGuard(basename); }
      catch (error) {
        // A handle-relative create may have succeeded even if its follow-up
        // visible-path verification fails; retain the lock for recovery.
        guardIntegrityFailure = true;
        rollbackComplete = false;
        throw error;
      }
      guards.push({ parent: visibleParent, basename, pin, guard });
    };
    // Native guards are created against the held physical directory inode;
    // they deny DELETE sharing and prevent a temporarily empty parent from
    // becoming a junction, while normal managed child writes remain allowed.
    const createLock = filename => {
      const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT |
        fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      try { const stat = fs.fstatSync(fd, { bigint: true }); fs.fsyncSync(fd); return stat; }
      finally { fs.closeSync(fd); }
    };
    lockStat = process.platform === 'win32'
      ? withPinnedProjectCwd(project, plan.rootIdentity, () => createLock(lockName))
      : createLock(lockPath);
    // Do not mutate project contents before the exclusive lock. The existing
    // ownership state/manifest keep the root nonempty during lock creation.
    guardDirectory(rootHandle, project);
    // Revalidate every game byte after the exclusive transaction lock is held.
    if (!isOriginalDirectory(project, plan.rootIdentity)) throw new Error('Project directory changed before locked apply');
    assertManifestUnchanged(project, plan.manifestSha256);
    const installed = readState(project);
    if (installed.sha256 !== plan.oldStateSha256) throw new Error('Component state changed after preview');
    assertComponentTrust(project, { rootIdentity: plan.rootIdentity,
      receiptSha256: plan.receiptSha256, manifestSha256: plan.manifestSha256,
      stateSha256: plan.oldStateSha256 });
    const changes = fresh._snapshot.changed;
    const adopted = new Set(fresh._snapshot.adopted);
    const authorPaths = installed.state.schemaVersion === 2 ? installed.state.authorFiles : fresh._snapshot.adopted;
    assertAuthoredFilesSafe(project, authorPaths);
    if (authorIdentityDigest(project, authorPaths) !== plan.authorDigest) {
      throw new Error('Author content changed during component transaction');
    }
    for (const name of changes) {
      if (fresh._snapshot.newFiles.has(name)) checkedNewFile(project, name);
      else {
        const expected = installed.state.files[name];
        if (hash(checkedFile(project, name)) !== expected) throw new Error(`Managed file changed after preview: ${name}`);
      }
    }
    // All other managed files must also stay untouched, even if this revision
    // did not change their catalog bytes.
    for (const [name, expected] of Object.entries(installed.state.files)) {
      if (adopted.has(name)) continue;
      if (hash(checkedFile(project, name)) !== expected) throw new Error(`Managed file changed after preview: ${name}`);
    }
    // Root pinning alone does not establish the identity of intermediate
    // managed directories across separate publication operations. Retain a
    // no-FILE_SHARE_DELETE native handle to each existing parent until exit.
    if (process.platform === 'win32') {
      const managedParents = new Set();
      for (const name of [...Object.keys(installed.state.files).filter(name => !adopted.has(name)), ...changes]) {
        const parts = name.split('/').slice(0, -1);
        for (let i = 1; i <= parts.length; i++) managedParents.add(path.join(project, ...parts.slice(0, i)));
      }
      for (const parent of [...managedParents].sort((a, b) => a.length - b.length)) {
        const expected = fs.lstatSync(parent, { bigint: true });
        if (!expected.isDirectory() || expected.isSymbolicLink()) throw new Error(`Unsafe managed parent: ${parent}`);
        const pinned = heldDirectory(parent);
        held.push(pinned);
        if (pinned.stat().dev !== expected.dev || pinned.stat().ino !== expected.ino) {
          throw new Error(`Changed managed parent while pinning: ${parent}`);
        }
        guardDirectory(pinned, parent);
      }
    }
    const staged = [];
    // On Windows a held stage root cannot be renamed, but a held *child*
    // directory can be (observed in native NTFS CI). Store all transaction
    // files directly under that held root, never under swappable children.
    const flatArchive = process.platform === 'win32';
    let directoryPaths;
    let stageSlot;
    // All initial archive writes must be anchored to the original project
    // CWD on Windows. Creating the directory under that CWD and then using
    // its absolute path leaves a post-mkdtemp pathname-swap window.
    const prepareArchive = (anchoredStage, stageWithinCwd) => {
      stage = path.join(project, path.basename(stageWithinCwd));
      stageIdentity = directoryIdentity(stageWithinCwd);
      retainedBackup = stage;
      const stageHandle = heldDirectory(stageWithinCwd, anchoredStage);
      held.push(stageHandle);
      const pinnedStage = stageHandle.stat();
      if (`${pinnedStage.dev}:${pinnedStage.ino}` !== stageIdentity) {
        throw new Error('Component archive identity changed before stage pin');
      }
      guardDirectory(stageHandle, stage);
      // A held project root does not pin the *archive basename*: Linux can
      // rename that archive and replace its name with a symlink at any time.
      // All stage writes must resolve relative to the stage's own open inode.
      const stageWriteRoot = flatArchive ? stageWithinCwd : stageHandle.anchor;
      if (!flatArchive) {
        for (const dirname of ['new', 'backup', 'quarantine']) fs.mkdirSync(path.join(stageWriteRoot, dirname));
      }
      directories = Object.fromEntries(['new', 'backup', 'quarantine'].map(dirname => {
        const handle = flatArchive
          ? heldDirectory(stageWithinCwd, anchoredStage)
          : heldDirectory(path.join(stageWriteRoot, dirname), path.join(anchoredStage, dirname));
        held.push(handle);
        return [dirname, handle];
      }));
      directoryPaths = Object.fromEntries(Object.entries(directories).map(([key, item]) => [key, item.anchor]));
      stageSlot = (kind, index, pinned = false) => flatArchive
        ? path.join(pinned ? stageWithinCwd : anchoredStage, `${kind}-${index}`)
        : path.join(directoryPaths[kind], String(index));
      for (const [i, name] of [...changes, stateName].entries()) {
        const isState = name === stateName;
        const bytes = isState ? fresh._snapshot.nextStateBytes : fresh._snapshot.assets.get(name);
        const newFile = fresh._snapshot.newFiles.has(name);
        const dest = isState ? path.join(project, stateName) : checkedParent(project, name);
        const stat = newFile ? null : fs.lstatSync(dest);
        const stagedName = stagedFile(path.dirname(stageSlot('new', i, true)), path.basename(stageSlot('new', i, true)), bytes,
          stat ? Number(stat.mode & 0o777) : 0o600);
        const stagedStat = fs.lstatSync(stagedName, { bigint: true });
        if (!stagedStat.isFile() || stagedStat.isSymbolicLink() || stagedStat.nlink !== 1n) {
          throw new Error(`Unsafe staged component: ${name}`);
        }
        staged.push({ name, isState, newFile, dest, bytes, staged: stageSlot('new', i),
          stagedIdentity: { dev: stagedStat.dev, ino: stagedStat.ino },
          backup: stageSlot('backup', i), oldExpected: isState ? installed.sha256 : installed.state.files[name] });
      }

      // Record recovery metadata before any game publication, in the same
      // original archive inode as the newly staged asset bytes.
      fs.writeFileSync(path.join(stageWriteRoot, 'backup-index.json'), `${JSON.stringify({
        schemaVersion: 1,
        entries: staged.map((item, index) => ({
          path: item.name,
          backup: item.newFile ? null : flatArchive ? `backup-${index}` : `backup/${index}`,
          previousSha256: item.newFile ? null : item.oldExpected,
        })),
      }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      const stateSlot = staged.findIndex(item => item.isState);
      fs.writeFileSync(path.join(stageWriteRoot, transitionName), encode({
        schemaVersion: 1,
        beforeSha256: installed.sha256,
        afterSha256: hash(fresh._snapshot.nextStateBytes),
        backupSlot: flatArchive ? `backup-${stateSlot}` : `backup/${stateSlot}`,
      }), { flag: 'wx', mode: 0o600 });
      syncFile(path.join(stageWriteRoot, 'backup-index.json'));
      syncFile(path.join(stageWriteRoot, transitionName));
      for (const item of Object.values(directories)) syncDirectory(item.fd);
      syncDirectory(stageHandle.fd);
      syncDirectory(rootHandle.fd);
    };
    // The archive must already have its final name. Windows may reject
    // renaming an archive with held directory handles, even when a managed
    // file's original inode stays open in an editor.
    if (process.platform === 'win32') {
      withPinnedProjectCwd(project, plan.rootIdentity, () => {
        const stageWithinCwd = fs.mkdtempSync(backupPrefix);
        stage = path.join(project, path.basename(stageWithinCwd));
        try { prepareArchive(fs.realpathSync.native(stageWithinCwd), stageWithinCwd); }
        catch (error) {
          // An empty, newly created archive may have been changed to a
          // junction before its first native handle could be acquired.
          // Preserve the transaction lock and do not write through that path.
          guardIntegrityFailure = true;
          throw error;
        }
      });
    } else {
      const anchoredStage = fs.mkdtempSync(path.join(rootHandle.anchor, backupPrefix));
      prepareArchive(anchoredStage, anchoredStage);
    }

    for (const [index, item] of staged.entries()) {
      if (!isOriginalDirectory(project, plan.rootIdentity) || directoryIdentity(stage) !== stageIdentity) {
        throw new Error('Component transaction directory changed during apply');
      }
      for (const [name, handle] of Object.entries(directories)) {
        const disk = fs.lstatSync(flatArchive ? stage : path.join(stage, name), { bigint: true });
        const open = handle.stat();
        if (!disk.isDirectory() || disk.isSymbolicLink() || disk.dev !== open.dev || disk.ino !== open.ino) {
          throw new Error(`Component transaction ${name} directory changed during apply`);
        }
      }
      assertManifestUnchanged(project, plan.manifestSha256);
      withAnchoredParent(project, item.name, plan.rootIdentity, basename => {
        if (item.newFile) {
          try { fs.lstatSync(basename); throw new Error(`New component collision: ${item.name}`); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        } else if (hash(secureFile(basename, `managed component ${item.name}`)) !== item.oldExpected) {
          throw new Error(`Managed file changed during apply: ${item.name}`);
        }
        // Move original bytes to same-filesystem backup before publishing.
        // This path is anchored to the validated parent, not re-resolved
        // through an attacker-swapped project-relative directory.
        const originalStat = item.newFile ? null : fs.lstatSync(basename, { bigint: true });
        if (!item.newFile) fs.renameSync(basename, item.backup);
        const operation = { ...item, exposed: false,
          quarantine: stageSlot('quarantine', index) };
        operations.push(operation);
        if (!item.newFile) {
          const backupStat = fs.lstatSync(item.backup, { bigint: true });
          if (!backupStat.isFile() || backupStat.isSymbolicLink() || backupStat.nlink !== 1n ||
              !sameInode(backupStat, originalStat)) {
            throw new Error(`Component backup inode changed after move: ${item.name}`);
          }
          operation.backupIdentity = { dev: backupStat.dev, ino: backupStat.ino };
          operation.backupMode = Number(backupStat.mode & 0o777n);
          syncDirectory(directories.backup.fd);
          syncFile(item.backup);
        }
        if (!item.newFile && hash(fs.readFileSync(item.backup)) !== item.oldExpected) {
          throw new Error(`Managed file changed during replace: ${item.name}`);
        }
        const stagedStat = fs.lstatSync(item.staged, { bigint: true });
        if (!stagedStat.isFile() || stagedStat.isSymbolicLink() || stagedStat.nlink !== 1n ||
            !sameInode(stagedStat, item.stagedIdentity) || hash(fs.readFileSync(item.staged)) !== hash(item.bytes)) {
          throw new Error(`Changed staged component identity before publish: ${item.name}`);
        }
        fs.linkSync(item.staged, basename);
        const published = fs.lstatSync(basename, { bigint: true });
        operation.publishedIdentity = { dev: published.dev, ino: published.ino };
        operation.exposed = true;
        if (!published.isFile() || published.isSymbolicLink() || !sameInode(published, item.stagedIdentity)) {
          throw new Error(`Changed staged component identity during publish: ${item.name}`);
        }
        syncFile(basename);
      });
      const disk = fs.lstatSync(flatArchive ? stage : path.join(stage, 'new'), { bigint: true });
      const handleStat = directories.new.stat();
      if (!disk.isDirectory() || disk.isSymbolicLink() || disk.dev !== handleStat.dev || disk.ino !== handleStat.ino) {
        throw new Error('Component transaction new directory changed during apply');
      }
    }

    // Original inodes may still be open in another editor. Check for writes
    // after moving them; if a concurrent edit already arrived, roll back.
    // Even after this check we RETAIN backups, because an open descriptor can
    // continue receiving writes at any time. Never unlink an original inode.
    for (const item of operations) {
      if (!item.newFile && hash(fs.readFileSync(item.backup)) !== item.oldExpected) {
        throw new Error(`Concurrent original edit retained in backup: ${item.name}`);
      }
    }
    // Drop our link to each newly published inode only after proving the
    // game still holds that same inode. This lets subsequent updates require
    // nlink=1, while ORIGINAL inodes remain in durable backups.
    for (const item of operations) {
      withAnchoredParent(project, item.name, plan.rootIdentity, basename => {
        const published = fs.lstatSync(basename, { bigint: true });
        if (!published.isFile() || published.isSymbolicLink() ||
            published.dev !== item.publishedIdentity.dev || published.ino !== item.publishedIdentity.ino ||
            hash(fs.readFileSync(basename)) !== hash(item.bytes)) {
          throw new Error(`Published component changed before commit: ${item.name}`);
        }
        fs.unlinkSync(item.staged);
        const soleLink = fs.lstatSync(basename, { bigint: true });
        if (!soleLink.isFile() || soleLink.isSymbolicLink() || soleLink.nlink !== 1n ||
            !sameInode(soleLink, item.publishedIdentity)) {
          throw new Error(`Published component retained an external hardlink: ${item.name}`);
        }
        syncDirectory(directories.new.fd);
      });
    }
    advanceComponentTrust(project, {
      rootIdentity: plan.rootIdentity, receiptSha256: plan.receiptSha256,
      manifestSha256: plan.manifestSha256, stateSha256: plan.oldStateSha256,
    }, hash(fresh._snapshot.nextStateBytes));
    return { ...fresh, status: 'APPLIED', applied: true, backupDirectory: retainedBackup };
  } catch (error) {
    const problems = [];
    for (const op of operations.reverse()) {
      try {
        withAnchoredParent(project, op.name, plan.rootIdentity, basename => {
          if (op.exposed) {
            const st = fs.lstatSync(basename, { bigint: true });
            if (!st.isFile() || st.isSymbolicLink() || st.dev !== op.publishedIdentity.dev || st.ino !== op.publishedIdentity.ino ||
                hash(fs.readFileSync(basename)) !== hash(op.bytes)) {
              throw new Error(`Modified replacement retained: ${op.name}`);
            }
            // Quarantine before checking again: a save that races our first
            // check is preserved, never silently unlinked. The quarantine
            // and original backup remain on disk for owner inspection.
            fs.renameSync(basename, op.quarantine);
            syncDirectory(directories.quarantine.fd);
            const moved = fs.lstatSync(op.quarantine, { bigint: true });
            if (!moved.isFile() || moved.isSymbolicLink() || moved.dev !== op.publishedIdentity.dev || moved.ino !== op.publishedIdentity.ino ||
                hash(fs.readFileSync(op.quarantine)) !== hash(op.bytes)) {
              // Never re-link by the quarantine pathname after detecting a
              // conflict. Even a matching inode check has a race before
              // linkSync; preserve the archived edit and lock for recovery.
              throw new Error(`Modified replacement retained for recovery: ${op.name}`);
            }
          } else if (fs.existsSync(basename)) {
            throw new Error(`Concurrent replacement retained: ${op.name}`);
          }
          if (!op.newFile) {
            // Restore exclusively into a DIFFERENT inode. Keep the original
            // backup forever: a concurrent editor may keep writing through
            // its old handle even after a successful rollback.
            const originalBytes = verifiedBackupBytes(op.backup, op.backupIdentity);
            stagedFile('.', basename, originalBytes, op.backupMode);
          }
        });
      } catch (restoreError) { problems.push(`${op.name}: ${restoreError.message}`); }
    }
    // Guard integrity failure is sticky: if creating a native guard succeeded
    // but its visible verification failed, an untracked guard may remain even
    // when there were no managed operations to roll back. Keep the lock.
    rollbackComplete = problems.length === 0 && !guardIntegrityFailure;
    if (problems.length) {
      outcomeError = new Error(`${error.message}; incomplete component rollback: ${problems.join('; ')}; recover from ${stage}`,
        { cause: error });
      throw outcomeError;
    }
    outcomeError = error;
    throw error;
  } finally {
    try {
      if (rollbackComplete) {
        // Remove by the original native FILE HANDLE, not by a newly resolved
        // path, so an attacker cannot replace the basename before cleanup.
        for (const { parent, basename, pin, guard } of guards.reverse()) {
          const directory = fs.lstatSync(parent, { bigint: true });
          const child = fs.lstatSync(path.join(parent, basename), { bigint: true });
          const pinned = pin.stat();
          if (!directory.isDirectory() || directory.isSymbolicLink() ||
              directory.dev !== pinned.dev || directory.ino !== pinned.ino ||
              !child.isFile() || child.isSymbolicLink() || child.nlink !== 1n ||
              child.dev !== pinned.dev || child.ino !== guard.fileId) {
            throw new Error(`Changed anchored component guard during finalization: ${parent}`);
          }
          guard.remove();
        }
      }
      if (rollbackComplete && lockStat) {
      try {
        // Never delete a moved original inode: an editor may still have its
        // handle open and write AFTER our final hash check. The archive was
        // created under its durable non-active name before publication, so no
        // directory rename can invalidate Windows open handles here.
        if (stage && directoryIdentity(stage) !== stageIdentity) {
          throw new Error('Component backup archive changed before completion');
        }
        const currentLock = fs.lstatSync(lockPath, { bigint: true });
        if (currentLock.dev === lockStat.dev && currentLock.ino === lockStat.ino) {
          fs.unlinkSync(lockPath);
          syncDirectory(rootHandle.fd);
        }
      } catch (finalizationError) {
        // A finalization failure must keep the lock for recovery. If the
        // operation already failed, preserve that causal error rather than
        // allowing cleanup to replace it.
        if (outcomeError) {
          outcomeError.message += `; finalization blocked (lock retained): ${finalizationError.message}`;
        } else throw finalizationError;
      }
      }
    } catch (guardFinalizationError) {
      rollbackComplete = false; // keep lock and original backup for recovery
      if (outcomeError) outcomeError.message += `; anchored guard finalization blocked (lock retained): ${guardFinalizationError.message}`;
      else throw guardFinalizationError;
    } finally {
      for (const { guard } of guards) guard.close();
      for (const handle of held.reverse()) handle.close();
    }
  }
}
