# Ludory LAN Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start a fresh, isolated static build of a trusted new Studio game on localhost or an explicitly selected private LAN address.

**Architecture:** Studio snapshots only approved game distribution bytes into a new ephemeral build directory, hashes those bytes, then serves that directory through a strict read-only HTTP handler. A small CLI integration starts the service asynchronously and leaves `runCli`'s existing synchronous commands intact.

**Tech Stack:** Node.js 22+ ESM (`node:http`, `node:fs`, `node:os`, `node:crypto`), existing Studio trust and templates, `node:test`; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-01-ludory-pre-f5-qa-lan-portrait-design.md` §3, §6.

## Global Constraints

- Default `127.0.0.1`; `--lan` only selects an observed private IPv4 interface, without router/firewall changes or public binding.
- Build from *current* source on every invocation; errors stop the preview, never serve stale bytes.
- Serve only validated distribution paths from a new disposable staging directory; never project root, hidden files, credentials or source maps.
- Read-only `--project` plan must not mutate the project; new game requires `verifyStudioOrigin` and safe root identity; frozen projects remain blocked.
- No SDK fake is misrepresented as live provider approval; no build/preview status alters Release gates.
- Separate feature PR from fresh `main` in `.worktrees/`; keep changes small; merge only after exact-HEAD CI and owner approval.

## Review Focus

1. Encoded/multi-decoded traversal and Windows device/path quirks: handler never serves bytes outside build root (Task 2).
2. A valid URL that points at symlink or directory: handler rejects, no listing or arbitrary read (Task 2).
3. Source file changes during snapshot: build fails with `PREVIEW_SOURCE_CHANGED`, not mixed bytes (Task 1).
4. Host with multiple adapters, no private IPv4, or used port: deterministic selection/error, no public exposure (Task 2).
5. `src` import and newly authored asset not in the distribution list: explicit build blocker rather than silently missing at runtime (Task 1).

---

### Task 1: Fresh and bounded build snapshot

**Files:**
- Create: `packages/studio/src/preview-build.mjs`
- Test: `packages/studio/test/preview-build.test.mjs`
- Modify: `packages/studio/package.json` only if needed for public module exports (prefer internal direct import)

**Interfaces:**
- Produces `planPreviewBuild(projectDir, { target = 'web' } = {}) -> { status:'READY'|'BLOCKED',project,target,sourceDigest,files,rootIdentity,reasonCode? }` (no writes).
- Produces `buildPreview(plan, { tempRoot = os.tmpdir() } = {}) -> { status:'BUILT'|'BLOCKED',root,buildSha256,files,cleanup(),reasonCode? }`; no source writes, `cleanup` affects only owned temp output.

- [ ] **Step 1: Write failing tests** for trusted Studio fixture: `planPreviewBuild` has no side effects; source edit changes digest/output; inserted symlink, unreferenced import, missing art, revoked origin and mid-read source mutation return `BLOCKED`; no outside file included.
- [ ] **Step 2: Run** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/preview-build.test.mjs` → expected FAIL for missing API.
- [ ] **Step 3: Implement** the two exported functions, using existing origin/physical-path validation and read-verified regular file copying. Stage `index.html`, `ludory.project.json`, admitted HTML/ESM dependencies and referenced assets using a bounded media allowlist; no dotpaths, symlinks, `.map`, `.env`, `.git`, `.ludory`, or unlisted source trees. Hash sorted relative paths + byte content; create a new temp directory with exclusive ownership.
- [ ] **Step 4: Rerun** the targeted test → PASS, including stable hash for identical snapshots and a changed hash after edit.
- [ ] **Step 5: Commit** only `preview-build.mjs` and tests (plus necessary manifest) as `feat(studio): stage fresh verified preview bytes`.

### Task 2: Private-only HTTP server and lifecycle

**Files:**
- Create: `packages/studio/src/preview-server.mjs`
- Test: `packages/studio/test/preview-server.test.mjs`

**Interfaces:**
- Consumes Task 1 `root` and `buildSha256`.
- Produces `selectPreviewAddress({ lan = false, interfaces = os.networkInterfaces() } = {}) -> string` (`127.0.0.1` or private IPv4, otherwise throw `PREVIEW_PRIVATE_INTERFACE_UNAVAILABLE`).
- Produces `startPreviewServer({ root, lan = false, port = 4173, interfaces, buildSha256 } = {}) -> Promise<{ url,address,port,buildSha256,close():Promise<void> }>`.

- [ ] **Step 1: Write failing tests** that request `/`, a real asset and `HEAD`; reject percent-encoded traversal, double encoding, backslash, NUL, dotfiles, directory, symlink escape and missing file; assert no directory listing; verify localhost default and explicit private IPv4 selection, absent LAN, duplicate port, and clean close.
- [ ] **Step 2: Run** `node --test packages/studio/test/preview-server.test.mjs` → FAIL for missing API.
- [ ] **Step 3: Implement** a private-address selector and strict static router with decoded-once canonical segments, realpath/lstat root containment and bounded response sizes. Bind **specific** private address, never `0.0.0.0`; return clear `PREVIEW_PORT_IN_USE`/`PREVIEW_PRIVATE_INTERFACE_UNAVAILABLE`. Use a small fixed MIME map, `nosniff`, no directory listing, and no path-based fallback outside allowed `index.html`.
- [ ] **Step 4: Rerun** targeted test → PASS; additionally run test with an intentionally public interface stub and confirm no server starts.
- [ ] **Step 5: Commit** as `feat(studio): serve preview on explicit private interface`.

### Task 3: Studio CLI, operator docs and end-to-end smoke

**Files:**
- Create: `packages/studio/src/preview-cli.mjs`, `packages/studio/test/preview-cli.test.mjs`
- Modify: `packages/studio/src/cli.mjs`, `packages/studio/README.md`, `package.json`
- Test: `packages/runtime-narrative/test/browser/studio-n3-smoke.mjs` (add a preview-served smoke, not the existing fixture's permissive fixture server)

**Interfaces:**
- Consumes Tasks 1–2.
- Exports `runPreviewCli(flags, { out, err } = {}) -> Promise<number>` and wires `ludory preview --project <path> [--target web|yandex|vk] [--lan] [--port 4173] [--json]` into `runCli`; existing commands retain their return contract.

- [ ] **Step 1: Write failing tests** for `help`, parsing/error status, no implicit LAN binding, a freshly changed Studio sample's served response, same digest reported and no leftover listener after shutdown. Check an invalid target or a target not declared in the project is rejected; verify platform SDK status is never labeled live.
- [ ] **Step 2: Run** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/preview-cli.test.mjs` → FAIL for unsupported command.
- [ ] **Step 3: Implement** CLI adapter; call build before listen; print build SHA and loopback/LAN URL plus optional QR when available, warn about same-Wi-Fi/firewall, document restart-to-rebuild. SIGINT/SIGTERM only close this server and clean this owned staging directory. Add new syntax checks to root `npm run check` script.
- [ ] **Step 4: Run** targeted CLI tests and `node packages/runtime-narrative/test/browser/studio-n3-smoke.mjs` (with Playwright dependencies), asserting actual staged bytes and mobile/desktop navigation; record missing browser as `BLOCKED`, not PASS.
- [ ] **Step 5: Run** `npm test`, `npm run check`, `node examples/core-session.mjs`; commit as `feat(studio): expose safe fresh LAN preview`.
- [ ] **Step 6: Open isolated P1 PR**, request independent review, inspect exact-head CI, ask owner approval before merge. Do not merge from this plan alone.
