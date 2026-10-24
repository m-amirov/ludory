# Studio → CEOS Workflow Adapter — Design (2026-10-24)

> **SUPERSEDED / historical reference only.** The owner discontinued the CEOS adapter, froze existing games, and selected native Ludory workflows. This is not an implementation instruction. See `2026-10-24-native-dev-workflows-simplification-design.md`; adapter PR #5 must remain unmerged.

## Intent

Expose existing CEOS workflows through one `ludory workflow` command family while retaining CEOS as the authoritative execution engine during the agreed phased migration. The aim is shorter, reliable user commands for inspecting, starting and resuming bounded runs without discarding CEOS checkpoints, evidence or project rules. This is **integration**, not a claim that Ludory AI has ported CEOS.

## Approaches

1. **Selected: audited external CEOS adapter.** Studio constructs a strict argument vector for the installed CEOS 0.5.40 CLI, runs it with Node (never a shell), and returns both Ludory's operation state and the unmodified CEOS result/status. Existing `.ceos-runs` files remain CEOS-owned. Advantages: short delivery, one CLI surface, no state conversion or duplicate engine; limitations: a valid CEOS installation remains required, and behavioral parity is delegated to that pinned installation.
2. **Deferred: native port of CEOS execution/continuation modules into `@ludory/ai`.** Removes the external CLI after source/evidence/recovery fixtures achieve parity, but combines a much larger independent migration with today's Studio UX step.
3. **Rejected for the initial phase: shell command passthrough (`ludory ceos ...`).** Too easy to invoke destructive CEOS operations without Ludory's read-only/explicit-action boundary, and fragile on Windows due to `.cmd` / stale junction handling.

## Responsibilities and boundary

- **Studio** owns CLI grammar, command authorization, project identity preflight, executable discovery, supported-version check, bounded child-process execution, structured reporting and test coverage.
- **CEOS** exclusively owns workflow semantics, `.ceos-runs`, `.codex-os`, stages, checkpoint/evidence validation, recovery, host capability attestations, and its own verdicts/exit codes.
- **Game files** (`src/`, `public/`, art, audio, saves, runtime), existing project manifests (`ludory.project.json`, `game-spec.yaml`, `AGENTS.md`) and CEOS legacy state are not copied or rewritten by the adapter. A deliberately invoked CEOS mutating command may write its own run/evidence state, subject to CEOS's existing rules.
- The adapter never installs CEOS, accesses the network directly, executes free-form user commands, invokes Codex/Image Gen, or interprets `PASS` as release readiness.

## CLI surface (initial vertical slice)

All commands require `--project <directory>` and accept `--json` plus optional `--ceos-entry <absolute-path-to-bin/ceos.mjs>`.

**Upstream interface evidence:** reviewed `bin/ceos.mjs` and `src/continuation-controller.mjs` from CEOS 0.5.40 at pinned `c8cc13bd3852409be93097ee823e9cd35e512b73`. Its dispatch implements `doctor`, `run-status`, `continue` (`inspect` and `guided`), `run` and `checkpoint` with the stated `--json` option, execution exit-code mapping and named scope arguments. This is static source verification, not a host execution test. If a live 0.5.40 smoke uncovers a disagreement, block that operation rather than guessing at a translation.

| Ludory command | CEOS invocation | Mutation contract |
| --- | --- | --- |
| `workflow doctor` | `ceos doctor --project DIR --json` | Read-only; reports CEOS manifest health separately |
| `workflow status [--run RUN]` | `ceos run-status RUN\|latest --project DIR --json` | Read-only; can report an existing BLOCKED run faithfully |
| `workflow next [--run RUN]` | `ceos continue RUN\|latest --mode inspect --project DIR --json` | Read-only; never calls guided recovery/claim |
| `workflow start --pipeline PIPELINE --target TEXT --in-scope SEMICOLONS --acceptance TEXT --mutation-boundary TEXT [--out-of-scope SEMICOLONS]` | `ceos run PIPELINE` with named scope arguments and `--json` | Preview only by default. Only `--apply` invokes CEOS. Initially only CEOS-supported `audit-repair-loop` and `production-art` pipelines. |
| `workflow continue [--run RUN]` | `ceos continue RUN\|latest --mode guided --project DIR --json` | Preview (`next`) by default; `--apply` invokes guided CEOS continuation. No `auto`, claim/release, or implicit recovery. |
| `workflow checkpoint --run RUN --stage STAGE [--artifact PATHS] [--outcome OUTCOME]` | `ceos checkpoint RUN --stage STAGE [--artifact ...] [--outcome ...] --project DIR --json` | Preview only by default, explicit `--apply` required; no automatic PASS/evidence synthesis. |

For preview of mutating operations, return an exact planned CEOS argv/operation with `READY`, not a claim that CEOS has run. Read-only commands may execute automatically. `--apply` on read-only commands and unrecognized flags fail closed. Scope/stage/run identifiers are validated; user-provided text remains a single argv value and is never passed to a shell. Unsupported pipeline/option combinations fail before invocation.

## CEOS discovery, version and transport

1. Prefer explicit absolute `--ceos-entry`; next `LUDORY_CEOS_ENTRY` if set; otherwise discover `<npm root -g>/codex-engineering-os/bin/ceos.mjs` (no download/install). Never invoke a global `ceos.cmd` shim or follow a broken junction silently.
2. Validate a readable real file, sibling package manifest and `VERSION` file; require package name `codex-engineering-os`, matching version and compatibility pin **0.5.40** for initial parity. Report `BLOCKED_CEOS_UNAVAILABLE`, `BLOCKED_CEOS_VERSION` or `BLOCKED_CEOS_ENTRY` with remediation. An explicit entry path does not bypass validation. Future versions get an explicit compatibility/tested-version update.
3. Spawn `process.execPath` with `[absolute-ceos-entry, fixed-command, ...fixed-args]`, `shell:false`, `cwd:canonicalProject`, bounded timeout/output, `windowsHide:true`, no inherited stdio. Inherit the caller's current environment (as native `ceos` does) because Git, Codex and capability checks depend on it; do not invent privileged credentials or print any environment values. The resolved CEOS entry is trusted local code, not an untrusted plugin. Redact/truncate stdout/stderr in errors; do not expose secrets in logs.
4. Decode CEOS `--json` exactly once, retain `ceosExitCode` (0/1/2/3), `ceosVersion` and structured payload. Invalid/truncated JSON or signal/timeouts are failures, never inferred PASS. For business-status `BLOCKED`, keep CEOS status visible and CLI exit code 2 (not success); for tool/parse failure return CLI exit 1. Do not pretend a CEOS inspection error is successful Ludory workflow status.
5. Require a valid existing `ludory.project.json` using the Studio project's established safety checks, and preserve CEOS `.codex-os` and `.ceos-runs` in place. Detect a moved project root before mutating commands; never auto-adopt CEOS or overwrite a CEOS manifest. Ludory's manifest identifies the game/targets, while `.codex-os/project.yml` specifies CEOS's own profile/gates and does **not** share an equivalent game identity field. Do not invent cross-manifest equality: the canonical project filesystem root must match, and CEOS remains authoritative for its manifest's validity (reported through `doctor`).

## Recovery, evidence and user expectations

- `workflow next` prints exactly the next CEOS-authorized action or its blocker; it does **not** autonomously execute the action. `continue --apply` delegates guided recovery planning, not a Codex host action.
- `workflow checkpoint --apply` forwards user-specified artifact references to CEOS, whose original integrity and stage gates remain authoritative. Ludory does not fabricate files/receipts or promote batch PASS into release PASS.
- The bridge does not alter historical run IDs or invent a new run database. The native `@ludory/ai` engine and migration of old runs are subsequent work with fixture/parity gates.
- Existing games without a CEOS installation/configuration receive actionable blockers. They can continue using the current CEOS CLI directly; Ludory setup is never automatic in this slice.

## Required verification

1. Unit and CLI integration tests with a **real temporary fake CEOS entry** that implements the tiny supported JSON protocol. Assert exact argv tokens/cwd, `shell:false`, version pin, no writes for previews, `--apply` exactly once for mutations and status propagation. No reliance on a globally installed CEOS in CI.
2. Tests for missing/broken/mismatched executable, stale or malformed global installation, malicious `--project`/`--run`/`--artifact` arguments, invalid JSON, timeout/output limit, `ceosExitCode:2` BLOCKED, and backward compatibility of all Studio commands.
3. Smoke test against an actual pinned CEOS 0.5.40 checkout where available; otherwise mark this **BLOCKED_HOST_CEOS_INTEGRATION**, not PASS. Do not create or mutate any user's real CEOS run as part of automated acceptance.
4. `npm test`, `npm run check`, `node examples/core-session.mjs`; PR CI Node 22/24 at exact HEAD. No VK/Yandex production/release claim.

## Acceptance and limits

Accept the first slice when `ludory workflow doctor/status/next/start/continue/checkpoint` have a stable, tested CLI; default read-only semantics hold; explicit `--apply` is required for every CEOS mutation; no project-owned file modifications are performed by Ludory; and CEOS output/verdict is passed through without upcasting. Native AI execution parity, platform QA, automatic installer, live Codex orchestration, and legacy-state conversion remain out of scope.
