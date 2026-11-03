# F6a.2 — installed Web Helper license notices

## Intent / scope

Close the F6 P1 gap: `installVendoredDevHelper()` installs the pinned
`browser-helper.cjs`, manifest and 2,217-file runtime tree but omits the
vendored `LICENSE`, `THIRD_PARTY_NOTICES.txt`, and `LICENSES/` notices.
The destination is the isolated DEV profile's `runtime/` directory.
This work neither proves legal compliance nor resolves the distinct
non-reproducible Bun prebuilt/source-provenance P1 finding.

## Approaches

1. **Manifest-pinned file inventory with installer/runtime verification
   (chosen):** keep existing license path fields, add a complete flat list of
   notice files with byte lengths and SHA-256, copy only verified notices,
   and refuse conflicting existing files. Installed discovery checks the
   complete inventory whenever `checkRuntime` is requested.
2. Copy the three manifest-declared paths without hashes: preserves text
   on fresh installs but cannot detect a truncated or tampered installed
   notice, and does not establish the complete `LICENSES/` inventory.
3. Merge notices into the executable bundle: unnecessary binary change,
   harder for users to inspect and incompatible with separate license texts.

## Contract

- The pinned vendored manifest enumerates exact relative notice paths with
  expected `bytes` and `sha256`; each path is a regular file under one of
  `LICENSE`, `THIRD_PARTY_NOTICES.txt`, or `LICENSES/`. File paths are
  normalized, unique and cannot traverse or point outside the runtime.
- `.gitattributes` forces LF checkouts for every pinned notice file, even
  when a Windows Git installation uses `core.autocrlf=true`; regression
  coverage verifies the filtered Git blob hash and size against the manifest.
- `installVendoredDevHelper()` verifies vendored notice contents **before**
  reporting a successful preview or making writes. Preview includes exact
  destination files; no DEV/stable writes on preview.
- On apply, materialize missing notice files under `runtime/` while keeping
  all existing matching files. A conflicting file, symlink, unexpected
  `LICENSES` entry or incomplete write blocks the operation with a distinct
  integrity error; do not overwrite user-controlled content. Perform the
  same final verification before changing the helper config.
- Installed `verifyHelperArtifact(..., checkRuntime:true)` and DEV discovery
  reject missing/mutated notices. Legacy `test-fixture` manifests without
  vendor licenses remain compatible when not pinned to V2.
- No changes to stable Codex Web GPT installation, source game projects,
  vendored binary, node_modules, publishing or Release PASS.

## Acceptance

- Test-first failure on missing installed notices, and on inventory
  mutation or source/destination mismatch; test preview, install, resume,
  idempotence, symlink refusal and stable profile isolation.
- `node --test packages/ai/test/helper-supply.test.mjs`, full `npm test`,
  `npm run check`, and `git diff --check` succeed.
- Documentation distinguishes notice delivery/integrity from legal
  rights and from still-unresolved prebuilt source provenance.
