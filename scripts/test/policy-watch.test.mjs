import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  POLICY_SOURCES, normalizeMarkdown, snapshotSource,
  comparePolicySnapshots, scanPolicySources,
} from '../policy-watch.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const notes = `---\nmetadata:\n  - name: generator\n    content: Diplodoc 1\n---\n> **Documentation Index:** index revision 123\n# История изменений\n\n<!-- source: ru/_includes/generator-v1.md -->\n- 2025\n  - Октябрь\n    - **27.10**\n        - Старое изменение в другом году.\n- 2026\n  - Октябрь\n    - **27.10**\n        - Изменён интерфейс SDK и требования игры.\n`;
const requirements = `---\nmetadata: stuff\n---\n# Полный список требований\n\n## 1. SDK\nИнициализация SDK обязательна для игры.\n\n## 2. Игра\nНужна корректная пауза и работа окна.\n`;
const moderation = `# Модерация\n\n## Чеклист\nПроверяйте игру и медиа до отправки.\n\n## Актуализация\nТребования иногда меняются.\n`;
const documentById = { 'release-notes': notes, requirements, moderation };
const initial = { schemaVersion: 1, reviewedAt: '2026-11-02', sources: Object.fromEntries(POLICY_SOURCES.map(s => [s.id, snapshotSource(s, documentById[s.id])])) };

function fakeFetchWith(overrides = {}) {
  return async url => {
    const source = POLICY_SOURCES.find(s => s.url === url);
    const body = overrides[source.id] ?? documentById[source.id];
    if (body instanceof Error) throw body;
    if (typeof body === 'function') return body();
    return new Response(body, { status: 200, headers: { 'content-type': 'text/markdown;charset=utf-8' } });
  };
}

test('front matter, documentation index and generator comments do not change policy hashes', () => {
  const changedHeader = notes.replace('Diplodoc 1', 'Diplodoc 999').replace('revision 123', 'revision 999').replace('generator-v1', 'generator-v9');
  assert.equal(normalizeMarkdown(notes), normalizeMarkdown(changedHeader));
  assert.deepEqual(snapshotSource(POLICY_SOURCES[0], notes), snapshotSource(POLICY_SOURCES[0], changedHeader));
});

test('visible HTML-comment literals in fenced and inline code remain sensitive to policy edits', () => {
  const original = `${notes}\n\n\`\`\`js\nconst snippet = "<!-- sdk-v1 -->";\n\`\`\`\nInline \`<!-- sdk-v1 -->\` is visible.`;
  const edited = original.replaceAll('sdk-v1', 'sdk-v2');
  assert.notEqual(snapshotSource(POLICY_SOURCES[0], original).sha256, snapshotSource(POLICY_SOURCES[0], edited).sha256);
});

test('a visible generator-like comment inside a fenced code sample is not removed', () => {
  const original = `${notes}\n\n\`\`\`md\n<!-- source: sample-v1.md -->\n\`\`\``;
  const edited = original.replace('sample-v1', 'sample-v2');
  assert.notEqual(snapshotSource(POLICY_SOURCES[0], original).sha256, snapshotSource(POLICY_SOURCES[0], edited).sha256);
});

test('definition-list metadata comments from Yandex generator are normalized without losing list punctuation', () => {
  const original = `${moderation}\n:   <!-- source: ru/_includes/moderation-v1.md -->`;
  const edited = original.replace('moderation-v1', 'moderation-v2');
  assert.equal(snapshotSource(POLICY_SOURCES[2], original).sha256, snapshotSource(POLICY_SOURCES[2], edited).sha256);
});

test('release notes distinguish identical day-month entries across years', () => {
  const snap = snapshotSource(POLICY_SOURCES[0], notes);
  assert.ok(snap.sections['2025-10-27']);
  assert.ok(snap.sections['2026-10-27']);
  assert.notEqual(snap.sections['2025-10-27'], snap.sections['2026-10-27']);
});

test('new, modified and removed dated entries are reported as drift', () => {
  const updated = notes.replace('    - **27.10**\n        - Изменён интерфейс SDK и требования игры.', '    - **28.10**\n        - Новое требование по рекламе.');
  const snapshots = { ...initial.sources, 'release-notes': snapshotSource(POLICY_SOURCES[0], updated) };
  const report = comparePolicySnapshots(initial, snapshots);
  assert.equal(report.status, 'ACTION_REQUIRED');
  assert.equal(report.sources[0].status, 'CHANGED');
  assert.deepEqual(report.sources[0].added, ['2026-10-28']);
  assert.deepEqual(report.sources[0].removed, ['2026-10-27']);
  assert.equal(report.sources[1].status, 'UNCHANGED');
});

test('edited requirement section changes hash even when headings are unchanged', () => {
  const updated = requirements.replace('корректная пауза', 'новая обязательная пауза');
  const report = comparePolicySnapshots(initial, { ...initial.sources, requirements: snapshotSource(POLICY_SOURCES[1], updated) });
  assert.equal(report.sources[1].status, 'CHANGED');
  assert.equal(report.sources[1].changed.length, 1);
  assert.equal(report.sources[1].added.length, 0);
});

test('long section changes report full counts even when preview lists are limited', () => {
  const baseline = structuredClone(initial);
  const current = structuredClone(initial.sources);
  for (let i = 1; i <= 25; i++) current.moderation.sections[`section-${String(i).padStart(12, 'a')}-1`] = 'c'.repeat(64);
  current.moderation.sha256 = 'd'.repeat(64);
  const report = comparePolicySnapshots(baseline, current);
  assert.equal(report.sources[2].added.length, 20);
  assert.equal(report.sources[2].addedTotal, 25);
});

test('an HTML placeholder with HTTP 200 cannot mark unavailable docs as verified', async () => {
  const report = await scanPolicySources({ baseline: initial, fetchImpl: fakeFetchWith({
    moderation: () => new Response('<html>Site Unavailable</html>', { headers: { 'content-type': 'text/html' } }),
  }) });
  assert.equal(report.status, 'ACTION_REQUIRED');
  assert.deepEqual(report.sources.map(s => s.status), ['UNCHANGED', 'UNCHANGED', 'UNAVAILABLE']);
  assert.equal(report.sources[2].reason, 'SOURCE_CONTENT_TYPE_INVALID');
});

test('network outage in one pinned source is review-required, never a silent pass', async () => {
  const report = await scanPolicySources({ baseline: initial, fetchImpl: fakeFetchWith({ moderation: new Error('secret upstream data') }) });
  assert.equal(report.sources[2].status, 'UNAVAILABLE');
  assert.equal(report.sources[2].reason, 'SOURCE_FETCH_FAILED');
  assert.doesNotMatch(JSON.stringify(report), /secret upstream/);
});

test('unexpected location and too large response are rejected', async () => {
  const report = await scanPolicySources({ baseline: initial, fetchImpl: fakeFetchWith({
    requirements: () => ({ ok: true, url: 'https://evil.example/policy.md', headers: new Headers({ 'content-type': 'text/markdown' }), text: async () => requirements }),
    moderation: 'x'.repeat(700_000),
  }) });
  assert.equal(report.sources[1].reason, 'SOURCE_LOCATION_INVALID');
  assert.equal(report.sources[2].reason, 'SOURCE_TOO_LARGE');
});

test('missing expected heading is not accepted even with a markdown content type', async () => {
  const report = await scanPolicySources({ baseline: initial, fetchImpl: fakeFetchWith({
    requirements: '# Unsupported Page\n' + 'abcde '.repeat(80),
  }) });
  assert.equal(report.sources[1].reason, 'SOURCE_CONTENT_INVALID');
});

test('unchanged pinned source content produces a clean deterministic scan', async () => {
  const report = await scanPolicySources({ baseline: initial, fetchImpl: fakeFetchWith() });
  assert.equal(report.status, 'CLEAR');
  assert.deepEqual(report.sources.map(s => s.status), ['UNCHANGED', 'UNCHANGED', 'UNCHANGED']);
  assert.equal(report.sources[0].url, POLICY_SOURCES[0].url);
  assert.equal(sha(normalizeMarkdown(notes)).length, 64);
});
