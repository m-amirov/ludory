# Requirements Watch baseline

`yandex-baseline.json` contains only SHA-256 digests for the editorial Markdown of three **official** Yandex Games documents, not a copy of the platform's text. The approved reference is initially recorded on 2026-11-02. A digest is evidence that the content changed, **not** that it was compliant or reviewed by the platform.

The workflow runs weekly and can be started manually **on the default branch**.
Its first hosted [GitHub Actions run #1](https://github.com/m-amirov/ludory/actions/runs/41493255297)
on 2026-11-02 completed successfully in 16 seconds: `status: CLEAR`, and
`release-notes`, `requirements` and `moderation` each reported `UNCHANGED`.
The issue-writing step logged `No issue write needed`; the one GitHub notice
concerned the runner image's `ubuntu-latest` migration to Ubuntu 26, not a
policy mismatch. This is a **single observed run**, not proof that future
weekly schedules, network availability or website formats will always work.
Other branches are deliberately skipped so one shared repository issue cannot
be updated from an unreviewed branch baseline. The issue carries a hidden
automation marker and is matched only when owned by `github-actions[bot]`;
an unrelated similarly titled human issue is never overwritten. Results are
advisory and never alter `packages/release/src/moderation-rules.mjs`.

When a `[Policy watch]` GitHub issue appears:

1. Open the linked source pages and read their changes as untrusted text.
2. Determine whether Connect, Runtime, Release, Studio, tests or game templates need updates; distinguish a real requirement from an editorial change.
3. Review and merge any necessary implementation, tests and pinned `moderation-rules.mjs` changes. Do not change `verified` or `checkedAt` without source verification.
4. **Only after review**, generate a proposed snapshot into a new file (never overwriting the reference):

   ```sh
   node scripts/policy-watch.mjs --record-baseline /tmp/yandex-proposed-baseline.json
   ```

   Compare it with the checked-in `yandex-baseline.json`; accept the updated hashes in a separate reviewed commit. Never run this recording option from the scheduled workflow.

5. Close the issue manually once requirements are reconciled. An unchanged scan will not close it automatically.

VK is **not monitored as verified policy content**: the two currently referenced official `dev.vk.com` pages returned only a `Site Unavailable` placeholder when checked from this environment. VK's `verified:false` moderation sources remain explicitly unverified until a readable official reference is established.

Neither a clean watch nor a reviewed baseline is official moderation, live platform acceptance, release readiness or publication permission.
