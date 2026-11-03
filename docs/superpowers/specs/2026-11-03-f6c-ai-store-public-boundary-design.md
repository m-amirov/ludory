# F6c AI Store public boundary design

## Intent

Resolve the audit finding that `@ludory/ai` publicly re-exports low-level Store writers which do **not** verify Studio host origin. Current high-level workflow and host entrypoints enforce Studio origin; raw `store.mjs` writers are intentionally usable by framework internals and isolated storage fixtures for a valid project with no Studio registration.

## Constraints

- Preserve the internal storage API, file layout, hash-chain semantics, and existing foreign-project Store tests.
- Preserve Studio/AI high-level host trust checks and read-only diagnostics.
- Avoid claiming cryptographic authenticity or protection from code with direct filesystem/repository access.
- No game migrations, new dependencies, Docker, live SDK approval, release or version tag.

## Approaches

1. **Selected: tighten the package root and document privilege.** Stop exporting `planNewRun`, `commitNewRun`, `planNativeEvent`, `commitNativeEvent` from `@ludory/ai` root; retain relative internal imports from `./store.mjs`. Keep safe read functions public, and test root/subpath import boundaries. This makes the official package contract truthful without altering dozens of Store test fixtures.
2. Gate every low-level Store writer on Studio origin. Stronger policy, but breaks existing intentional foreign-project Store semantics and would require broad fixture and recovery redesign.
3. Document exported writers as privileged without narrowing exports. No behavior change, but leaves an easy-to-misuse package root surface.

## Acceptance

- `@ludory/ai` root no longer exposes those four Store planning/commit functions.
- High-level `planWorkflow`/`executeWorkflow` remain available, and safe `readNativeRun`/`listNativeRuns` remain available.
- Package subpath `@ludory/ai/src/store.mjs` is still blocked by package exports; internal relative imports continue to pass their existing tests.
- `README.md` and F6 audit state that direct storage primitives are privileged, not Studio-host-trusted; no existing low-level journal is relabeled as trusted.
- Targeted, full Node suite, Quality and checks pass before PR; Ubuntu Node 22/24 and browser CI verify the exact remote HEAD before merge.
