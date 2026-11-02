#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const POLICY_SOURCES = Object.freeze([
  Object.freeze({ id: 'release-notes', url: 'https://yandex.ru/dev/games/doc/ru/release-notes.md', heading: 'История изменений', affects: ['connect-yandex', 'runtime', 'release', 'studio'] }),
  Object.freeze({ id: 'requirements', url: 'https://yandex.ru/dev/games/doc/ru/concepts/requirements.md', heading: 'Полный список требований', affects: ['connect-yandex', 'runtime', 'release', 'studio'] }),
  Object.freeze({ id: 'moderation', url: 'https://yandex.ru/dev/games/doc/ru/concepts/moderation.md', heading: 'Модерация', affects: ['release', 'studio'] }),
]);

const LIMIT_BYTES = 512 * 1024;
const DEFAULT_BASELINE = fileURLToPath(new URL('../docs/policy-watch/yandex-baseline.json', import.meta.url));
const digest = text => createHash('sha256').update(text).digest('hex');

function stripGeneratorComments(markdown) {
  const lines = [];
  let fence;
  for (const line of markdown.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      const kind = marker[1][0];
      if (!fence) fence = { kind, length: marker[1].length };
      else if (fence.kind === kind && marker[1].length >= fence.length) fence = undefined;
    }
    if (!fence && /^(?::\s*)?<!-- (?:source:|endsource:)[^\n]* -->$/.test(line.trim())) {
      if (line.trimStart().startsWith(':')) lines.push(line.slice(0, line.indexOf('<!--')));
      continue;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function normalizeMarkdown(markdown) {
  if (typeof markdown !== 'string') throw new Error('SOURCE_CONTENT_INVALID');
  const stable = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^> \*\*Documentation Index:\*\*[^\n]*\n/gm, '');
  return stripGeneratorComments(stable)
    .split('\n').map(line => line.trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function releaseNoteSections(markdown) {
  const sections = {};
  let year;
  let key;
  let text = [];
  const flush = () => {
    if (key) sections[key] = digest(text.join('\n').trim());
    key = undefined;
    text = [];
  };
  for (const line of markdown.split('\n')) {
    const nextYear = line.match(/^-\s*(20\d{2})(?:\s+\{[^\n]*\})?$/);
    const day = line.match(/^\s+-\s+\*\*(\d{2})\.(\d{2})\*\*/);
    const month = line.match(/^  - [А-ЯЁ][^\n]*$/);
    if (nextYear) { flush(); year = nextYear[1]; continue; }
    if (month) { flush(); continue; }
    if (day && year) {
      flush();
      const id = `${year}-${day[2]}-${day[1]}`;
      if (Object.hasOwn(sections, id)) throw new Error('SOURCE_CONTENT_INVALID');
      key = id;
    }
    if (key) text.push(line);
  }
  flush();
  return sections;
}

function headingSections(markdown) {
  const sections = {};
  const counts = new Map();
  let key;
  let text = [];
  const flush = () => {
    if (key) sections[key] = digest(text.join('\n').trim());
    text = [];
  };
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^#{1,4}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      const hash = digest(heading[1]).slice(0, 12);
      const ordinal = (counts.get(hash) ?? 0) + 1;
      counts.set(hash, ordinal);
      key = `section-${hash}-${ordinal}`;
    }
    if (key) text.push(line);
  }
  flush();
  return sections;
}

export function snapshotSource(source, markdown) {
  const pinned = POLICY_SOURCES.find(item => item.id === source?.id && item.url === source?.url);
  if (!pinned) throw new Error('SOURCE_NOT_PINNED');
  const content = normalizeMarkdown(markdown);
  if (content.length < 70 || !content.split('\n').some(line => line.trim() === `# ${pinned.heading}`)) {
    throw new Error('SOURCE_CONTENT_INVALID');
  }
  const sections = source.id === 'release-notes' ? releaseNoteSections(content) : headingSections(content);
  if (Object.keys(sections).length === 0) throw new Error('SOURCE_CONTENT_INVALID');
  return { sha256: digest(content), sections };
}

function validateBaseline(baseline) {
  if (baseline?.schemaVersion !== 1 || typeof baseline.reviewedAt !== 'string' || !baseline.sources) throw new Error('BASELINE_INVALID');
  const expectedIds = POLICY_SOURCES.map(item => item.id).sort();
  if (JSON.stringify(Object.keys(baseline.sources).sort()) !== JSON.stringify(expectedIds)) throw new Error('BASELINE_INVALID');
  for (const item of POLICY_SOURCES) {
    const source = baseline.sources[item.id];
    if (!source || !/^[a-f0-9]{64}$/.test(source.sha256) || !source.sections || Object.keys(source.sections).length === 0 ||
      !Object.values(source.sections).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
      throw new Error('BASELINE_INVALID');
    }
  }
}

export function comparePolicySnapshots(baseline, current) {
  validateBaseline(baseline);
  const sources = POLICY_SOURCES.map(item => {
    const base = baseline.sources[item.id];
    const now = current[item.id];
    const common = { id: item.id, url: item.url, affects: item.affects };
    if (!now || now.error) return { ...common, status: 'UNAVAILABLE', reason: now?.error ?? 'SOURCE_FETCH_FAILED' };
    if (base.sha256 === now.sha256) return { ...common, status: 'UNCHANGED' };
    const before = Object.keys(base.sections);
    const after = Object.keys(now.sections);
    const added = after.filter(key => !Object.hasOwn(base.sections, key)).sort();
    const removed = before.filter(key => !Object.hasOwn(now.sections, key)).sort();
    const changed = after.filter(key => Object.hasOwn(base.sections, key) && base.sections[key] !== now.sections[key]).sort();
    return {
      ...common, status: 'CHANGED',
      added: added.slice(0, 20), addedTotal: added.length,
      removed: removed.slice(0, 20), removedTotal: removed.length,
      changed: changed.slice(0, 20), changedTotal: changed.length,
      structureChanged: before.length === after.length && before.every(key => base.sections[key] === now.sections[key]),
      previousSha256: base.sha256,
      currentSha256: now.sha256,
    };
  });
  return { schemaVersion: 1, kind: 'policy-watch', status: sources.every(s => s.status === 'UNCHANGED') ? 'CLEAR' : 'ACTION_REQUIRED', baselineReviewedAt: baseline.reviewedAt, sources, advisoryOnly: true, releaseReady: false, publicationAllowed: false };
}

async function fetchSource(source, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(source.url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'text/markdown' },
    });
  } catch { return { error: 'SOURCE_FETCH_FAILED' }; }
  if (!response?.ok) return { error: 'SOURCE_HTTP_FAILED' };
  if (response.url && response.url !== source.url) return { error: 'SOURCE_LOCATION_INVALID' };
  if (!/^text\/(markdown|plain)(?:\s*;|$)/i.test(response.headers?.get('content-type') ?? '')) return { error: 'SOURCE_CONTENT_TYPE_INVALID' };
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > LIMIT_BYTES) return { error: 'SOURCE_TOO_LARGE' };
  let bytes;
  try {
    const chunks = [];
    let size = 0;
    if (!response.body?.getReader) return { error: 'SOURCE_CONTENT_INVALID' };
    const reader = response.body.getReader();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > LIMIT_BYTES) { await reader.cancel().catch(() => {}); return { error: 'SOURCE_TOO_LARGE' }; }
      chunks.push(part.value);
    }
    bytes = Buffer.concat(chunks, size);
  } catch { return { error: 'SOURCE_FETCH_FAILED' }; }
  try {
    return snapshotSource(source, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return { error: 'SOURCE_CONTENT_INVALID' }; }
}

export async function collectPolicySnapshots({ fetchImpl = fetch } = {}) {
  const current = {};
  for (const source of POLICY_SOURCES) current[source.id] = await fetchSource(source, fetchImpl);
  return current;
}

export async function scanPolicySources({ baseline, fetchImpl = fetch }) {
  return comparePolicySnapshots(baseline, await collectPolicySnapshots({ fetchImpl }));
}

async function cli(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--baseline', '--report', '--record-baseline'].includes(args[i]) || !args[i + 1] || options[args[i]]) {
      throw new Error('Usage: policy-watch.mjs [--baseline FILE] [--report FILE] [--record-baseline NEW_FILE]');
    }
    options[args[i]] = args[i + 1];
  }
  const current = await collectPolicySnapshots();
  if (options['--record-baseline']) {
    if (Object.values(current).some(source => source.error)) throw new Error('Refusing to record incomplete/unverified policy baseline');
    const baseline = { schemaVersion: 1, reviewedAt: new Date().toISOString().slice(0, 10), sources: current };
    await writeFile(options['--record-baseline'], JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ recorded: options['--record-baseline'], sourceIds: POLICY_SOURCES.map(s => s.id) }) + '\n');
    return;
  }
  const baseline = JSON.parse(await readFile(options['--baseline'] ?? DEFAULT_BASELINE, 'utf8'));
  const report = comparePolicySnapshots(baseline, current);
  const output = JSON.stringify(report, null, 2) + '\n';
  if (options['--report']) await writeFile(options['--report'], output, { flag: 'w' });
  process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch(error => { process.stderr.write(`Policy watch failed: ${error.message}\n`); process.exitCode = 1; });
}
