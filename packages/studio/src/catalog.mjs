import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalPhysicalDirectory } from '@ludory/core';

const builtin = fileURLToPath(new URL('../catalog/', import.meta.url));
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const reserved = new Set(['ludory.project.json', 'ludory.studio.json']);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function exactKeys(obj, fields, label) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${label}: object required`);
  for (const key of Object.keys(obj)) if (!fields.includes(key)) throw new Error(`${label}: unknown field ${key}`);
  for (const key of fields) if (!(key in obj)) throw new Error(`${label}: missing field ${key}`);
}

function token(s, label) {
  if (typeof s !== 'string' || !idPattern.test(s)) throw new Error(`${label}: invalid ID`);
  return s;
}

function validVersion(value, label) {
  if (typeof value !== 'string' || !versionPattern.test(value) ||
      value.match(/^\d+\.\d+\.\d+-([^+]+)/)?.[1].split('.').some(part => /^0\d+$/.test(part))) {
    throw new Error(`${label}: invalid SemVer version`);
  }
}

function uniqueIds(items, label) {
  if (!Array.isArray(items) || items.length === 0) throw new Error(`${label}: non-empty array required`);
  const values = items.map(x => token(x, label));
  if (new Set(values).size !== values.length) throw new Error(`${label}: duplicate ID`);
  return values;
}

function realDirectory(dir) {
  const absolute = path.resolve(dir);
  try { return canonicalPhysicalDirectory(absolute); }
  catch { throw new Error(`Catalog directory must be a real directory: ${absolute}`); }
}

function directoriesOnly(dir) {
  return fs.readdirSync(dir).sort();
}

function checkedDirectory(dir) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Catalog subdirectory must not be a symbolic link: ${dir}`);
}

function checkedBytes(filename) {
  const st = fs.lstatSync(filename);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error(`Catalog source must be a regular file, not symbolic link: ${filename}`);
  if (st.size > 2 * 1024 * 1024) throw new Error(`Catalog source is too large: ${filename}`);
  const handle = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!fs.fstatSync(handle).isFile()) throw new Error(`Catalog source is not a regular file: ${filename}`);
    return fs.readFileSync(handle);
  } finally { fs.closeSync(handle); }
}

function jsonSource(filename) {
  const bytes = checkedBytes(filename);
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`Catalog JSON is invalid: ${filename}`); }
  return { data, sha256: digest(bytes) };
}

function safeFileName(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      value.startsWith('/') || value.includes(':') || reserved.has(value.split('/')[0])) {
    throw new Error(`Invalid or reserved template output path: ${value}`);
  }
  const pieces = value.split('/');
  if (pieces.some(x => !x || x === '.' || x === '..' || !/^[A-Za-z0-9._-]+$/.test(x))) {
    throw new Error(`Invalid template output path: ${value}`);
  }
  return value;
}

function readProfile(source, origin) {
  const { data, sha256 } = jsonSource(source);
  exactKeys(data, ['schemaVersion', 'id', 'version', 'description', 'engine', 'targets', 'templates'], source);
  if (data.schemaVersion !== 1) throw new Error(`Unsupported profile schema: ${source}`);
  token(data.id, 'profile'); token(data.engine, 'engine');
  validVersion(data.version, 'profile');
  if (typeof data.description !== 'string' || !data.description.trim()) throw new Error('Profile description required');
  uniqueIds(data.targets, 'profile targets'); uniqueIds(data.templates, 'profile templates');
  return { ...data, origin, sourceSha256: sha256 };
}

/** A build-time author proof binds JS-authored narrative references to exact local image bytes.
 * Studio verifies only JSON/digests: never execute arbitrary template JavaScript during create. */
export function validateNarrativeAuthorProof(assets, { templateId } = {}) {
  const proofFile = assets.get('narrative-assets.json');
  if (!proofFile) {
    if (templateId === 'narrative-interactive') throw new Error('Interactive narrative template requires an asset proof');
    return;
  }
  const story = assets.get('src/story.js');
  if (!story) throw new Error('Narrative asset proof requires src/story.js');
  let proof;
  try { proof = JSON.parse(proofFile.bytes.toString('utf8')); }
  catch { throw new Error('Narrative asset proof is not valid JSON'); }
  exactKeys(proof, ['schemaVersion', 'storySha256', 'assets'], 'narrative asset proof');
  if (proof.schemaVersion !== 1 || proof.storySha256 !== story.sha256) {
    throw new Error('Narrative asset proof: story source hash mismatch; rebuild author proof');
  }
  if (!proof.assets || typeof proof.assets !== 'object' || Array.isArray(proof.assets) ||
      Object.keys(proof.assets).length === 0) throw new Error('Narrative asset proof: images required');
  for (const [id, image] of Object.entries(proof.assets)) {
    token(id, 'narrative asset ID');
    exactKeys(image, ['path', 'sha256'], `narrative image ${id}`);
    const filename = safeFileName(image.path);
    if (!/^assets\/[a-z0-9_-]+\.(?:svg|png|webp|jpg|jpeg)$/.test(filename)) {
      throw new Error(`Narrative image path is unsafe: ${filename}`);
    }
    if (!assets.has(filename) || assets.get(filename).sha256 !== image.sha256) {
      throw new Error(`Narrative asset proof: missing or stale image ${filename}`);
    }
  }
}

function readTemplate(source, origin) {
  const { data, sha256 } = jsonSource(source);
  exactKeys(data, ['schemaVersion', 'id', 'version', 'description', 'profile', 'engine', 'targets', 'files'], source);
  if (data.schemaVersion !== 1) throw new Error(`Unsupported template schema: ${source}`);
  token(data.id, 'template'); token(data.profile, 'profile'); token(data.engine, 'engine');
  validVersion(data.version, 'template');
  if (typeof data.description !== 'string' || !data.description.trim()) throw new Error('Template description required');
  uniqueIds(data.targets, 'template targets');
  if (!Array.isArray(data.files) || !data.files.length) throw new Error(`Template files required: ${source}`);
  const files = data.files.map(safeFileName);
  if (new Set(files).size !== files.length) throw new Error('Template files contain duplicate path');
  if (files.some(filename => files.some(other => other !== filename && other.startsWith(`${filename}/`)))) {
    throw new Error('Template output path conflicts with a nested output directory');
  }
  const assets = new Map();
  for (const filename of files) {
    // Every intermediate directory must be physical, not a link to outside the catalog.
    const segments = filename.split('/');
    let current = path.dirname(source);
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      checkedDirectory(current);
    }
    const bytes = checkedBytes(path.join(path.dirname(source), ...segments));
    assets.set(filename, { bytes, sha256: digest(bytes) });
  }
  validateNarrativeAuthorProof(assets, { templateId: data.id });
  return { ...data, origin, sourceSha256: sha256, assets };
}

function readRoot(root, profiles, templates, origin) {
  const profileDir = path.join(root, 'profiles');
  const templateDir = path.join(root, 'templates');
  checkedDirectory(profileDir); checkedDirectory(templateDir);
  for (const filename of directoriesOnly(profileDir)) {
    if (!/^[a-z0-9-]+\.json$/.test(filename)) throw new Error(`Invalid profile filename: ${filename}`);
    const profile = readProfile(path.join(profileDir, filename), origin);
    if (filename !== `${profile.id}.json`) throw new Error('Profile filename does not match its ID');
    if (profiles.has(profile.id)) throw new Error(`Duplicate/override profile ID: ${profile.id}`);
    profiles.set(profile.id, profile);
  }
  for (const folder of directoriesOnly(templateDir)) {
    token(folder, 'template directory');
    const entry = path.join(templateDir, folder);
    checkedDirectory(entry);
    const template = readTemplate(path.join(entry, 'template.json'), origin);
    if (folder !== template.id) throw new Error('Template directory does not match its ID');
    if (templates.has(template.id)) throw new Error(`Duplicate/override template ID: ${template.id}`);
    templates.set(template.id, template);
  }
}

/** Load all catalog entries without running template code or mutating projects. */
export function loadCatalog(catalogDir) {
  const profiles = new Map();
  const templates = new Map();
  readRoot(realDirectory(builtin), profiles, templates, 'builtin');
  if (catalogDir !== undefined) readRoot(realDirectory(catalogDir), profiles, templates, 'local');
  for (const p of profiles.values()) {
    for (const id of p.templates) {
      const t = templates.get(id);
      if (!t || t.profile !== p.id || t.engine !== p.engine || t.targets.some(x => !p.targets.includes(x))) {
        throw new Error(`Invalid template reference in profile ${p.id}: ${id}`);
      }
    }
  }
  for (const t of templates.values()) {
    if (!profiles.has(t.profile) || !profiles.get(t.profile).templates.includes(t.id)) {
      throw new Error(`Unknown or incompatible profile reference: ${t.profile}`);
    }
  }
  return { profiles, templates };
}

function publicDescriptor(item) {
  const { origin, sourceSha256, assets, ...descriptor } = item;
  return structuredClone(descriptor);
}

/** Return stable JSON-ready descriptors, without file bytes or local source paths. */
export function listCatalog(kind, catalogDir) {
  if (!['profiles', 'templates'].includes(kind)) throw new Error(`Unknown catalog kind: ${kind}`);
  const entries = loadCatalog(catalogDir)[kind];
  return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')).map(publicDescriptor);
}

export function showCatalog(kind, id, catalogDir) {
  if (!['profiles', 'templates'].includes(kind)) throw new Error(`Unknown catalog kind: ${kind}`);
  const found = loadCatalog(catalogDir)[kind].get(token(id, kind));
  if (!found) throw new Error(`Unknown ${kind.slice(0, -1)}: ${id}`);
  return publicDescriptor(found);
}
