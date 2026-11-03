# Documentation reconciliation — 2026-11-02

## Scope and source of truth

- Implementation snapshot: `main` at `3c79644203273928e939e816d758804c1ccb2038` (merged [PR #70](https://github.com/m-amirov/ludory/pull/70)).
- Compared the root README, `docs/ROADMAP.md`, Studio/Release package guides, policy-watch guide, CLI help/source, merged Git history, and the four open draft PRs.
- Performed a repository Markdown relative-link scan (excluding vendored dependencies). Historical `docs/superpowers/specs/`, `plans/`, and timestamped evidence are **point-in-time records**, not live implementation promises, and were not rewritten to erase their original status.
- No executable game/framework behavior, policy hashes, external platform credentials, or source of a frozen game were changed by this documentation update.

## Findings and corrections

| Severity | Prior claim or gap | Reconciliation |
| --- | --- | --- |
| High | Root README still said VK pending and Release R2 a candidate | VK V1–V5 and Yandex Release R1–R3 are merged; describe their **local** contracts without implying production SDK acceptance |
| High | Roadmap omitted LAN preview, portrait UI, P3a–P3d, F5b and Requirements Watch | Rebuilt the phase table from merged PRs and named exact scope/evidence |
| High | Root README offered a `migrate --apply` example on a mature game despite the repository freeze | Removed the applied legacy-game example; retained read-only inspection and clarified that future `ludory adopt` is **not implemented** |
| High | Existing-game profile examples offered `--apply` without an explicit freeze boundary | Scoped profile application/updates to owner-authorized, non-frozen Studio games; documented `.ludory/profiles/` writes |
| Medium | F1a component trust/update implementation was obscured by the old PR #10 Draft status | Distinguished merged F1a [PR #46](https://github.com/m-amirov/ludory/pull/46) from the separate unmerged PR #10 |
| Medium | Studio F5b2 guide implied F5b3 browser testing had not occurred | Linked merged F5b1–F5b3 [#67](https://github.com/m-amirov/ludory/pull/67), [#68](https://github.com/m-amirov/ludory/pull/68), [#69](https://github.com/m-amirov/ludory/pull/69) and their paired **mock-SDK** evidence |
| Medium | No live Requirements Watch run evidence in docs | Recorded first hosted [run #1](https://github.com/m-amirov/ludory/actions/runs/41493255297): `SUCCESS/CLEAR`, three `UNCHANGED`, no issue write |
| Medium | An old design required offline startup despite the owner's later decision | Canonical status now says **offline startup is not required**; this does not remove deterministic, no-server gameplay or local save semantics |
| Low | Release README title named only R1 despite later QA contracts | Renamed to cover local Release plus simulated moderation QA |
| Low | Roadmap linked nonexistent `2026-10-28-foundation-acceptance.md` | Replaced the dead link with the checked-in source inventory |
| Low | Roadmap implied every Release report included a moderation field | Distinguished Yandex R1/R2 live/rights/owner gate fields from VK/QA moderation fields |

## What is actually verified, and what is not

1. The F5b flow accepts a trusted, new Studio `narrative-interactive` source, derives independent target ZIPs, and the fixture was exercised in 22 reported mock-SDK browser scenarios. It does not provide a one-click adapter for `kiss-at-the-edge-of-the-world`, generic game content parity, or a signed publication certificate.
2. F1c enforces Studio host-origin trust for native AI mutations. The historical `migrate` CLI is metadata-only and must **not** be applied to frozen games. A future old-game pilot needs a read-only source inventory, new Studio destination and explicit owner approval.
3. Real Yandex/VK SDK sessions, actual moderation, rights clearance, game publication and hardware acceptance are not required for the current owner-approved local scope and have **not** passed. Do not infer any of them from `PASS_LOCAL`, `READY_FOR_FIELD_TEST`, `MOCK_SDK_BROWSER_PASS` or `CLEAR`.
4. The GPT-6 Sol Instant Web model is selected only when the helper actually observes the model with `low` reasoning. The vendored browser helper's text-only path and a historical Web/art result still have independent host-evidence limits.
5. Requirements Watch reports hashes against a reviewed Yandex editorial baseline; changes require human review. VK moderation source verification remains incomplete.

## Remaining work after this documentation pass

- **F6 technical release audit / version-tag decision:** dependency/license/public-contract review and exact release-HEAD acceptance are separate from updating docs. No version tag is authorized or created here.
- **Optional legacy-game pilot:** inventory `kiss-at-the-edge-of-the-world` read-only; obtain authorization for a new Studio EP01–EP02 pilot, then compare routes, saves v4, assets and browser behavior before broader transfer.
- **Draft triage:** [#5](https://github.com/m-amirov/ludory/pull/5) and [#11](https://github.com/m-amirov/ludory/pull/11) are obsolete/superseded; [#10](https://github.com/m-amirov/ludory/pull/10) is independent; [#66](https://github.com/m-amirov/ludory/pull/66) predates the merged F5b path. Do not close them without reviewing any unique unmerged work.
- **Documentation maintenance:** keep current phase assertions in the root README and `docs/ROADMAP.md`; update them when merging a new phase, linking a hosted run or changing the approved milestone scope. Preserve old acceptance reports as dated evidence.

## Local validation on the docs branch

- Relative-link scan: **160** non-vendored Markdown files, **112** local relative links, **0** missing targets.
- `git diff --check`: exit 0; only documentation files changed.
- `npm run check`: exit 0.
- `node examples/core-session.mjs`: exit 0, restored state revision 1.
- `npm test`: first sandboxed attempt failed at seven test files due to denied local `git` subprocess / HTTP listen operations (`EPERM`); it is **not** counted as PASS. Re-run in the permitted host context completed with **1023 pass, 16 skip, 0 fail** (plus Quality integration **18 pass, 0 fail**). This does not prove physical devices or external Web/SDK services.
- GitHub Actions on the final PR **exact HEAD** must be checked independently before merge; no CI result is asserted here.
