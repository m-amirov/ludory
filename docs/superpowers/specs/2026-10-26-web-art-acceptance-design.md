# Web art acceptance — design (approved 2026-10-26)

## Intent

Extend Ludory's Codex-only image workflow with an independent GPT-6 Sol (Web)
visual reviewer. The reviewer must see the actual imported image and its
source-bound art brief, scene, characters, location and style. It must not be
the image-generator subagent or a text-only approximation of visual QA.

## Scope and boundaries

- Only newly created Studio games; CEOS, Starter Kit and existing game repos
  remain untouched. Existing image-import handoffs and ledgers stay compatible.
- The primary Codex agent invokes Ludory's preview and explicit apply; Ludory
  cannot impersonate a Codex subagent or invoke the built-in image generator.
- The reviewer route is isolated DEV Web, observed as `gpt-6-sol` with
  `reasoning: high`. No alternate model, paid API, or silent fallback.
- Inputs include an immutable `IMAGE_IMPORTED` original, its exact SHA-256,
  the imported brief, and four distinct typed source references
  (`scene:`, `characters:`, `location:`, `style:`) explicitly reviewed by
  the primary agent. Every source must be text, bounded and hashed.
- For real visual review, send one verified PNG/JPEG/WebP as a base64 `data:`
  URL in `prepared.images: [{ref, imageUrl, detail:'high'}]`. The upstream
  `codex-chatgpt-web` helper understands this envelope, but Ludory must
  require a verified DEV route and submission/attachment evidence from its
  compatibility helper; unverified image delivery blocks positive verdicts.
- The model returns a strictly parsed structured report. Defects have
  `P0`, `P1` or `P2` severity and concise factual evidence. `P0/P1`
  require `REWORK`; `P2` alone does not cause rework. Explicit inability
  to inspect the image, malformed report, mismatched binding or absent
  capabilities gives `BLOCKED`, never `PASS_ART`.
- Record immutable, hash-bound review receipts under Ludory-owned
  `.ludory/ai/runs/<id>/reviews/` only on explicit apply. Preserve the
  original image bytes; no overwrite, deletion or direct product edits.
- At most two suggested rework cycles for the same brief/run; then
  `ESCALATE` to the primary agent instead of endless micro-polish loops.
  The reviewer never regenerates an image automatically.
- `PASS_ART` means **Web-model visual assessment only**, not provenance,
  copyright, human approval, full scene integration, Release PASS or upload.
- Real Codex + authenticated DEV Web observations will be run by the owner
  after GitHub handoff; mocked helpers and CI cannot attest that gate.

## Approaches considered

1. **Chosen: source-bound binary attachment through the DEV helper.**
   The model sees pixels and an auditable brief; a missing capable helper
   fails closed. Requires precise attachment contract and host smoke later.
2. **Manual Codex Web review import.** Faster, but manually declared evidence
   cannot attest that the exact binary was seen; retained as a possible
   recovery route only, not equivalent to `PASS_ART`.
3. **Text-only visual critique.** Rejected: no pixel observation.

## Acceptance criteria

1. Preview does not write or contact Web; apply requires explicit user intent.
2. Wrong model, unavailable route, unattached images, corrupt files,
   changed source/image, symlink traversal or stale run are blocked.
3. Exactly one real immutable imported image is sent; helper's prepared image
   payload decodes byte-for-byte to the imported SHA-256.
4. A verified independent Web response creates a durable receipt with
   model, image hash, source hashes, findings and computed verdict.
5. P0/P1 → REWORK, P2-only → PASS_ART; two prior reworks → ESCALATE.
6. Tests exercise valid route, missing capability, image spoofing,
   malformed reports, stale binding, nonwriting preview, bounded retries
   and existing image/draft regressions on Node 22/24 Windows/Ubuntu CI.

