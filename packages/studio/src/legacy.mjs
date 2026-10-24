import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';
import { defineGame } from '@ludory/core';

const decoder = new TextDecoder('utf-8', { fatal: true });
const maxSourceBytes = 1024 * 1024;

export function readSourceFile(projectDir, relative) {
  const file = path.join(projectDir, relative);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error(`symbolic link is forbidden: ${relative}`);
  if (!stat.isFile() || stat.size > maxSourceBytes) throw new Error(`Unsupported or oversized source file: ${relative}`);
  const bytes = fs.readFileSync(file);
  return {
    text: decoder.decode(bytes),
    source: { path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  };
}

function scalar(raw, label) {
  const text = raw.trim();
  if (!text || /^[&*!>|\[{]/.test(text)) throw new Error(`Unsupported YAML scalar in ${label}`);
  if (text.startsWith('"')) {
    let value;
    try { value = JSON.parse(text); } catch { throw new Error(`Unsupported YAML quoted scalar in ${label}`); }
    if (typeof value !== 'string') throw new Error(`Unsupported YAML scalar in ${label}`);
    return value;
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw new Error(`Unsupported YAML scalar in ${label}`);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  const value = text.replace(/\s+#.*$/, '').trim();
  if (!value || /:\s/.test(value) || /^[&*!>|\[{]/.test(value)) {
    throw new Error(`Unsupported YAML scalar in ${label}`);
  }
  // Unquoted YAML booleans/null/numbers are typed values, not text metadata.
  // Mapping them to string IDs would silently invent a different project.
  if (label !== 'schemaVersion' && /^(?:true|false|null|~|[-+]?(?:\d[\d.eE_+-]*|\.inf|\.nan))$/i.test(value)) {
    throw new Error(`Unsupported YAML non-string scalar in ${label}`);
  }
  return value;
}

function parseProjectSpec(source) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rootVersions = [];
  const projects = [];
  let rootKey = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (/^\s/.test(line)) {
      if (rootKey === 'schemaVersion') throw new Error('Unsupported YAML schemaVersion continuation');
      continue;
    }
    // A restricted root envelope disallows quoted/escaped keys, explicit
    // mapping keys and YAML document markers. Those constructs may redefine
    // project/schemaVersion in a way a line-oriented subset cannot observe.
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/);
    if (!field) throw new Error('Unsupported YAML root key or document syntax');
    rootKey = field[1];
    if (rootKey === 'schemaVersion') rootVersions.push(scalar(field[2] ?? '', 'schemaVersion'));
    if (rootKey === 'project') {
      if (field[2]?.trim() && !field[2].trim().startsWith('#')) {
        throw new Error('Unsupported YAML inline project declaration');
      }
      projects.push(i);
    }
  }
  if (rootVersions.length !== 1 || rootVersions[0] !== '2') throw new Error('Legacy schemaVersion must be exactly 2');
  if (projects.length !== 1) throw new Error('Legacy project section must occur exactly once');

  const fields = new Map();
  const title = new Map();
  let section = null;
  for (const line of lines.slice(projects[0] + 1)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    if (/^\s*\t|^\t/.test(line)) throw new Error('Unsupported project tab indentation');
    if (/^ {2}(?:["'](?:slug|engine|platform|title)["']\s*:|(?:slug|engine|platform|title)\s+:|(?:slug|engine|platform|title):\S)/.test(line)) {
      throw new Error('Ambiguous YAML project key syntax');
    }
    const field = line.match(/^ {2}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (field) {
      section = field[1];
      if (['slug', 'engine', 'platform'].includes(section)) {
        if (fields.has(section)) throw new Error(`Duplicate project field: ${section}`);
        fields.set(section, scalar(field[2], `project.${section}`));
      }
      if (section === 'title') {
        if (fields.has('title') || (field[2].trim() && !field[2].trim().startsWith('#'))) {
          throw new Error('Duplicate or unsupported project.title');
        }
        fields.set('title', true);
      }
      continue;
    }
    if (section === 'title') {
      const locale = line.match(/^ {4}([a-z]{2,3}(?:-[A-Za-z0-9]+)*):\s*(.*)$/);
      if (!locale) throw new Error('Unsupported project.title indentation or locale');
      if (title.has(locale[1])) throw new Error(`Duplicate project.title locale: ${locale[1]}`);
      title.set(locale[1], scalar(locale[2], `project.title.${locale[1]}`));
      continue;
    }
    // Never ignore lines in project metadata: an indented plain scalar,
    // an explicit/escaped key or a merge can change the YAML interpretation.
    throw new Error('Unsupported or ambiguous project YAML syntax');
  }
  if (!fields.get('slug') || !fields.get('engine') || !fields.get('platform') || title.size === 0) {
    throw new Error('Missing project.slug, project.title, project.engine or project.platform');
  }
  return { id: fields.get('slug'), engine: fields.get('engine'), target: fields.get('platform'), title: Object.fromEntries(title) };
}

/** Strict, read-only subset conversion of Starter Kit schema-2 project metadata. */
export function readLegacyGameSpec(projectDir) {
  const project = path.resolve(projectDir);
  const spec = readSourceFile(project, 'game-spec.yaml');
  const pkg = readSourceFile(project, 'package.json');
  const legacy = parseProjectSpec(spec.text);
  let parsed;
  try { parsed = JSON.parse(pkg.text); } catch { throw new Error('Invalid package.json JSON version source'); }
  if (typeof parsed?.version !== 'string') throw new Error('Missing package.json version');
  const manifest = defineGame({
    schemaVersion: 1,
    id: legacy.id,
    version: parsed.version,
    title: legacy.title,
    engine: legacy.engine,
    targets: [legacy.target],
  });
  return { manifest, sources: [spec.source, pkg.source] };
}
