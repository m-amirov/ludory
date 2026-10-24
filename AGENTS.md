# LUDORY engineering rules

## Product boundary

LUDORY is a modular game-development toolkit. `@ludory/core` must remain platform-neutral, without browser globals, host persistence, graphics frameworks, ad SDKs or release authority. Framework adapters belong to Runtime; platform SDK adapters belong to Connect.

## Safety and migration

- Treat CEOS and Starter Kit as separate live sources of truth until the relevant migration passes parity checks.
- Preserve existing projects' code, assets, rights manifests, evidence, historical checkpoints and configurations. A migration must offer a read-only plan and explicit conflict resolution.
- Do not silently rewrite `AGENTS.md`, `game-spec.yaml`, third-party SDK settings or project-owned runtime files.
- Branch-based changes and passing CI are necessary but not sufficient to assert platform compliance or publication readiness.
- No actual publication, moderation submission, destructive migration or protected branch force updates without explicit owner authorization.

## Development

- Use Node.js 22+ ESM, avoid unnecessary runtime dependencies, and write failing behavior tests before new Core behavior.
- Keep packages isolated and expose public interfaces through package `exports`. Prefer small, versioned contracts.
- For Core changes run `npm test`, `npm run check` and `node examples/core-session.mjs`.
- Preserve failing and blocked outcomes; never convert missing browser/device/platform evidence into PASS.
