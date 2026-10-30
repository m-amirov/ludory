# Studio Component Host Trust — F1a Security Addendum

## Intent

Stop a project-only attacker from forging Studio ownership and overwriting an
author's file by adding project-local history. All automatic component writes
must be authorized by a Studio-owned record outside the game directory.

## Boundaries

- New Studio-created games only. Legacy games and CEOS/Starter Kit remain frozen.
- No OpenAI API, network access, OS administrator privileges or secret credentials.
- Trust guarantees are against **project-only** modification. A process that can
  rewrite the operator's Studio state directory is outside this threat model.
- The default trust root is a per-user host state directory, outside every game.
  A host-set `LUDORY_STUDIO_TRUST_DIR` permits test/managed host configuration;
  a trust root nested inside the game is refused.
- Host records bind an exact project path, directory identity, creation receipt
  hash, game manifest hash and latest managed-component state hash.
- Read-only previews never create or repair a host record. Absent, changed,
  unsafe or inaccessible records fail closed; no automatic bootstrap from game
  files, even when the creation receipt and archives look consistent.
- Initial Studio creation registers exactly the state it generated. Successful
  updates rotate this pin only after publishing verified bytes; failures and
  power loss may leave an incomplete transaction or mismatch, never an implied
  authorization to overwrite.
- Copying to another PC requires an explicit owner-operated `components trust`
  review and acceptance with the displayed exact state SHA-256. Acceptance never
  silently replaces an existing host record and does not claim proof of origin.
- Host record files use exclusive creation, permission restrictions, no-follow
  reads, a canonical format, atomic replacement and durable file/directory sync
  where supported. Host lock contention blocks, not bypasses, trust updates.

## Options considered

1. **Host-owned per-project registry (selected).** A single trusted latest hash
   is enough to prevent forged project-side ownership; no secret distribution.
2. HMAC key stored inside game — rejected, because a project-only attacker can
   forge both the ownership and its key.
3. Git commit/branch as ownership — rejected: user dirtiness is allowed, and
   copying or rewriting project history must not silently grant overwrite rights.

## Acceptance

1. Forged `ludory.components.json` plus an arbitrary valid-looking transaction
   archive cannot claim `src/author.js`, even if original receipts survive.
2. Creation, one update introducing a managed file, and a second update work
   without manual intervention on the original host.
3. Missing/modified/symlinked host record or interrupted host commit blocks
   any new automatic overwrite, while preserving author files and backups.
4. New host can explicitly accept the inspected SHA-256 with an audit summary,
   and never without owner action.
5. All Core/Studio checks and repo suite pass. No `main` merge before PR review.
