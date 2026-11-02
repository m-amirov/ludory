# Requirements Watch — Yandex Games (2026-11-02)

## Intent and boundaries

Keep Ludory aware of evolving external game-platform requirements without treating yesterday's policy verification as a permanent certification. The owner authorized a small automatic watch after observing that Yandex's [release notes](https://yandex.ru/dev/games/doc/ru/release-notes) change frequently.

- Watch official Yandex Russian Markdown sources for release notes, game requirements and moderation guidance once per week and on explicit manual dispatch.
- Compare normalized editorial content against a checked-in, human-reviewed baseline; do not rely on unstable HTML chrome, request headers or page metadata.
- Raise or update one actionable GitHub issue when text drifts or a source cannot be verified. Include the affected source, precise scope, owner review steps, and potential Ludory modules.
- Never silently refresh the baseline, generate rule changes, assert platform compliance, alter an existing game, upload to a platform, run live SDK acceptance or grant release/publication authority.
- Offline-startup testing and real-platform acceptance remain out of scope.

## Source choice and approaches

1. Track rendered HTML: simpler at first glance, but layout and bundled scripts create false positives.
2. **Selected:** track Yandex's own `.md` renditions with front matter and documentation-index metadata removed, and persist per-section digests for reviewable changes. GitHub Actions runs the watch and creates an issue; a person decides any rule-pack update.
3. Use a live scraper to rewrite moderation rules: rejected because it turns untrusted, mutable prose into release authority.

Yandex currently exposes Markdown for all three source pages. VK's specified official URLs currently return a "Site Unavailable" placeholder from this environment. Do not pretend that VK is verified; add VK only after a readable official source is established and reviewed.

## Behavior

- A finite, source-pinned manifest maps known URLs to a short list of likely affected modules; user-controlled URLs are not accepted by scheduled CI.
- Fetch HTTPS official Markdown with bounded response bytes and timeouts, no redirect to an unexpected host, content-type/heading validation, and no token/credential forwarding.
- Normalize metadata and line-endings; divide release notes at year/date entries and the other two documents at headings, pin stable SHA-256 digests for sections. Changed/added/removed sections are identified without storing third-party article text in the repository.
- Missing, too small, malformed, unreachable or unexpected official responses are `UNAVAILABLE`, not `UNCHANGED` or proof of new requirements.
- The checked-in baseline advances only through an explicit manual `--record-baseline` command and a reviewed commit. A reviewed revision of `moderation-rules.mjs`, tests and implementation can follow separately; `checkedAt`/`verified` values never auto-update.
- GitHub issue text is advisory, limited in size and safe against Markdown injection from external prose (only pinned document IDs and hashed section identifiers appear). A repository-wide workflow concurrency group and default-branch guard prevent conflicting runs; the bot-owned, marker-tagged issue is reused, not one issue per week. CI lacks write access to game contents and workflows in this feature.

## Acceptance

Fixture-based tests cover unchanged, new/edited/removed sections, injected front matter, metadata-only changes, malformed/oversized/unreachable sources, and release notes dated entries. A dry run never writes baseline or opens an issue. Scheduled CI requires no platform credentials. A successful scan **does not** mean a game can be published.
