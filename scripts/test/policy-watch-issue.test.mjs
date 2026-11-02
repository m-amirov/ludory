import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPolicyIssue, planPolicyIssueAction } from '../policy-watch-issue.mjs';

const unchanged = { schemaVersion: 1, kind: 'policy-watch', status: 'CLEAR', baselineReviewedAt: '2026-11-02', sources: [], advisoryOnly: true };
const changed = {
  ...unchanged, status: 'ACTION_REQUIRED',
  sources: [
    { id: 'release-notes', status: 'CHANGED', added: ['2026-11-02'], removed: [], changed: [], structureChanged: false,
      currentSha256: 'a'.repeat(64), previousSha256: 'b'.repeat(64) },
    { id: 'moderation', status: 'UNAVAILABLE', reason: 'SOURCE_FETCH_FAILED' },
  ],
};

test('unchanged scans never create or alter policy review issues', () => {
  assert.equal(renderPolicyIssue(unchanged), null);
  assert.deepEqual(planPolicyIssueAction(unchanged, []), { action: 'none' });
});

test('changed release notes and unavailable moderation page produce actionable advisory text', () => {
  const issue = renderPolicyIssue(changed);
  assert.match(issue.title, /Policy watch/);
  assert.match(issue.body, /2026-11-02/);
  assert.match(issue.body, /release-notes\.md/);
  assert.match(issue.body, /SOURCE_FETCH_FAILED/);
  assert.match(issue.body, /connect-yandex/);
  assert.match(issue.body, /moderation-rules\.mjs/);
  assert.match(issue.body, /не.*публикац/i);
});

test('repeated scans reuse a single open issue without duplicate updates', () => {
  const issue = renderPolicyIssue(changed);
  const old = { number: 42, state: 'open', title: issue.title, body: issue.body, user: { login: 'github-actions[bot]' } };
  assert.deepEqual(planPolicyIssueAction(changed, [old]), { action: 'none' });
  const updated = planPolicyIssueAction({ ...changed, sources: [changed.sources[1]] }, [old]);
  assert.equal(updated.action, 'update');
  assert.equal(updated.issueNumber, 42);
  assert.equal(planPolicyIssueAction(changed, []).action, 'create');
});

test('a similarly titled human issue is never overwritten, and a renamed bot issue is still reused', () => {
  const issue = renderPolicyIssue(changed);
  const unrelated = { number: 10, state: 'open', title: issue.title, body: 'Human discussion', user: { login: 'owner' } };
  assert.equal(planPolicyIssueAction(changed, [unrelated]).action, 'create');
  const renamed = { number: 11, state: 'open', title: 'Renamed by reviewer', body: issue.body, user: { login: 'github-actions[bot]' } };
  assert.deepEqual(planPolicyIssueAction(changed, [unrelated, renamed]), { action: 'none' });
});

test('section preview makes hidden change count explicit', () => {
  const report = { ...changed, sources: [{ ...changed.sources[0], added: ['2026-11-02'], addedTotal: 6 }] };
  assert.match(renderPolicyIssue(report).body, /ещё 5/);
});

test('report fields from untrusted prose cannot inject GitHub issue Markdown or URLs', () => {
  const report = { ...changed, sources: [{ ...changed.sources[0], id: 'release-notes', url: 'https://evil.example',
    added: ['[click](https://evil.example)', '2026-11-02'], affects: ['evil'], previousSha256: 'bad', currentSha256: 'bad', reason: '@everyone' }] };
  const body = renderPolicyIssue(report).body;
  assert.doesNotMatch(body, /evil\.example|@everyone|\[click\]|\bevil\b/);
  assert.match(body, /2026-11-02/);
  assert.match(body, /yandex\.ru/);
});

test('an open pull request with the same title does not count as an issue', () => {
  const issue = renderPolicyIssue(changed);
  assert.equal(planPolicyIssueAction(changed, [{ number: 7, title: issue.title, body: issue.body, pull_request: {} }]).action, 'create');
});
