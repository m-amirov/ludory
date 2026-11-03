# F6a.2 Web Helper Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and verify the pinned Web Helper's complete license/notice set in the isolated DEV profile.

**Architecture:** Extend the trusted helper manifest with an explicit per-file SHA-256/size inventory, verify source and installed notices using the existing safe-path and trust helpers, and copy only absent notice files into the DEV runtime. The existing manifest-bound V2 host check becomes the installed integrity gate.

**Tech Stack:** Node.js 22+ ESM, `node:test`, `node:fs`, `node:crypto`.

**Spec:** [F6a.2 design](../specs/2026-11-03-f6a-helper-notices-design.md)

## Global Constraints

- No Docker, network dependency, binary recompilation, stable-profile writes, game migration or platform publishing.
- Only complete pinned notices may be installed; preserve existing conflicting user files, fail closed.
- Existing `test-fixture` compatibility manifests should continue to work.
- No legal/release attestation or `1.0.0` tag from copying notices.

## Review Focus

1. Existing missing notices: fresh apply must add all files.
2. Existing changed notice: reject before user-file overwrite.
3. Existing notice directory symlink: reject, never follow it outside DEV runtime.
4. Interrupted partial install: safely fill verified missing notices and refuse bad existing ones.
5. Missing notice after installation: later helper discovery must reject even though helper/script hashes match.

---

### Task 1: Pin and install the notice inventory

**Files:**
- Modify: `packages/ai/vendor/codex-chatgpt-web/manifest.json`
- Modify: `packages/ai/src/helper-supply.mjs`
- Modify: `packages/ai/test/helper-supply.test.mjs`
- Modify: `packages/ai/test/dev-host.test.mjs`, `.gitattributes` and
  `packages/studio/README.md` for complete trusted fixture and operator contract.

**Interfaces:**
- Consumes: `installVendoredDevHelper`, `verifyHelperArtifact`, `discoverDevHost`, and `manifest.licenses` metadata.
- Produces: `manifest.licenses.files[]` records `{ path, bytes, sha256 }`, a new `DEV_HELPER_NOTICES_INTEGRITY` blocker, and complete verified installed notices.

- [x] **Step 1: Add failing user-observable regressions** for installed license set, preview writes, deletion/tampering after install, conflict and symlink safety, partial install recovery.
- [x] **Step 2: Run** `node --test packages/ai/test/helper-supply.test.mjs` and observe expected failures (not syntax errors).
- [x] **Step 3: Add pinned SHA/size inventory** from existing vendored notice bytes, validate safe manifest entries and exact directory inventory, check source before writes and installed state before activation/discovery.
- [x] **Step 4: Implement minimal copy** of absent files and fail closed on mismatches; do not modify trusted launcher or stable home.
- [x] **Step 5: Run** targeted test; require all PASS. Then full `npm test`, `npm run check` and `git diff --check`.
- [x] **Step 6: Update operator contract**, commit source, manifest, tests and docs only; request independent review before PR.
