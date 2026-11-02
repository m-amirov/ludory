# Requirements Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect Yandex Games documentation drift and file one review issue, while preserving human-controlled moderation rule packs.

**Architecture:** One dependency-free Node 22 script handles parsing, normalization, hashing, fetch admission and comparison. A checked-in baseline is only refreshed deliberately. A scheduled GitHub Actions workflow runs the script and opens/updates one advisory issue with least-privilege permissions.

**Tech Stack:** Node.js 22 ESM, node:test, GitHub Actions, actions/github-script.

**Spec:** `docs/superpowers/specs/2026-11-02-policy-watch-design.md`

## Global Constraints

- No game, SDK, rule-pack or release-readiness mutation by the scheduled job.
- Only three pinned official Yandex `.md` URLs, no automatic VK verification while its official sources are unreadable.
- Fail closed for invalid/oversized/missing responses and preserve reviewed baseline until a separate explicit update.
- No new npm dependencies or real-platform acceptance.

## Review Focus

- Page metadata-only changes must not alert: add a front matter noise test to Task 1.
- HTML placeholder with HTTP 200 must not count as valid docs: add content-type and heading validation test to Task 1.
- A new dated release-note entry must flag drift and name the date: add a year/date test to Task 1.
- Partial remote outage must flag uncertainty, not produce a success: add rejection/error aggregation test to Task 1.
- Repeated weekly drift must not create duplicate issues: add report/issue payload behavior test to Task 2.

---

### Task 1: Pure comparison and bounded source retrieval

**Files:**
- Create: `scripts/policy-watch.mjs`
- Create: `scripts/test/policy-watch.test.mjs`
- Create: `docs/policy-watch/yandex-baseline.json` (explicit baseline recording after verification)

**Interfaces:**
- Produces: `normalizeMarkdown(markdown)`, `snapshotSource(source, markdown)`, `comparePolicySnapshots(baseline, current)`, `scanPolicySources({ fetchImpl, baseline })`; CLI `--report FILE` and `--record-baseline FILE` (manual only).

- [x] **Step 1: Write failing tests** for metadata stability, section drift, duplicate dates across years, malformed/oversized/unavailable responses, pinned URLs and safe report content.
- [x] **Step 2: Verify RED:** `node --test scripts/test/policy-watch.test.mjs` fails because imports/API are missing.
- [x] **Step 3: Implement** bounded fetch, normalized per-section SHA-256 snapshots and drift report.
- [x] **Step 4: Verify GREEN:** same test command has no failures.
- [x] **Step 5: Explicitly generate and review initial baseline** from three readable official `.md` pages. Rerun scan to confirm no drift.
- [x] **Step 6: Commit** source, tests and baseline after full suite verification.

### Task 2: Scheduled advisory review issue

**Files:**
- Create: `.github/workflows/policy-watch.yml`
- Create: `scripts/policy-watch-issue.mjs`
- Create: `scripts/test/policy-watch-issue.test.mjs`
- Modify: `package.json`
- Modify: `packages/release/README.md`

**Interfaces:**
- Consumes: Task 1's JSON report; produces deterministic bounded issue title/body and one open issue updated by GitHub Actions only on changed body.

- [x] **Step 1: Write failing tests** for safe Markdown issue body, changed/unavailable summaries and unchanged/no-op scans.
- [x] **Step 2: Verify RED:** `node --test scripts/test/policy-watch-issue.test.mjs` fails because formatter is missing.
- [x] **Step 3: Implement** formatter and weekly/manual GitHub Action with `issues:write`, `contents:read`, single issue lookup and idempotent update.
- [x] **Step 4: Verify GREEN** via test command and run `npm test`, `npm run check`, `node examples/core-session.mjs` plus a clean local policy-watch dry run.
- [x] **Step 5: Review changed files and commit** without merging or posting external issues from the local environment.
