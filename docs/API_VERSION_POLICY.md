# F6d — workspace interfaces and version policy

The current Ludory workspace version is **`0.1.0`**. This is a pre-1.0
development contract, **not** a frozen `1.0.0` release, a public npm
publication promise, or authorization to publish games.

## Supported entry points within this monorepo

| Consumer | Supported entry point | Boundary |
| --- | --- | --- |
| Codex/operator | `node packages/studio/bin/ludory.mjs help` and its documented CLI commands | The product-facing interface. Project mutations are explicitly planned/applied; publication is separately gated. |
| Automated local dual-target narrative builds | `@ludory/studio/narrative-platform-export` | Five named functions below; accepts trusted new Studio sources only. ZIPs remain local candidates. |
| Trusted candidate QA capture | `@ludory/studio/qa-capture` | Opt-in QA capture with its existing authorization checks. |
| Other Ludory workspace packages | Only subpaths declared in each package's `package.json` `exports` | Exports are importability boundaries. Do not infer supported APIs from relative `src/` paths. |

The dual-target narrative subpath exports
`planNarrativePlatformExport`, `materializeNarrativePlatformSource`,
`materializeNarrativePlatformProjects`, `buildNarrativePlatformCandidates` and
`verifyNarrativePlatformCandidates`. They retain the F5b1/F5b2 trusted
same-source plan, checked input/output paths, digest verification and explicit
`releaseReady:false` / `publicationAllowed:false` guarantees. The package
`@ludory/studio` is **private** and intentionally has no root (`.`) export;
this contract permits internal workspace imports, not independent npm usage.

The root `@ludory/ai` interface likewise excludes low-level Store receipt
writers after F6c. Internal relative imports are implementation details and
must not be used as stable application integration points. Nothing here
authorizes direct migration of existing games or bypass of Studio-origin trust.

## Version invariants

1. The repository root, all 11 package manifests, root and workspace lockfile
   entries use one coherent Ludory version. Dependencies on another
   `@ludory/*` workspace package use **exact** local versions, not loose
   semver ranges; lockfile pins, package names and workspace link targets
   match their manifests.
2. `npm run check:versions` checks these invariants; `npm run check` runs this
   guard automatically. A partial bump or lockfile drift fails the gate.
3. The Studio CLI banner reads the version from `packages/studio/package.json`.
   The optional CLI `init/create --version` flag describes the **game's**
   manifest version, not the installed framework version; its `0.1.0` default
   is independent and should not change merely because Ludory is bumped.
4. During pre-1.0 development, exported workspace contracts can evolve with
   explicitly documented, regression-tested changes. Before *any* future
   `1.0.0` tag, align package versions and lockfile in one reviewed commit,
   rerun the complete exact-HEAD gates, resolve/accept recorded freeze blockers
   and obtain explicit owner sign-off. Do not create a tag as an audit side
   effect. No unverified browser/real-host/platform gate is implicitly PASS.

This policy does not declare semantic-version stability for every internal
source symbol, template, receipt format, or third-party bundled runtime.
