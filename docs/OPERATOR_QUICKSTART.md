# Ludory operator quickstart — new Studio games

This is a **local development** quickstart, not a release/publishing procedure.
It creates a fresh example outside the Ludory repository, with no CEOS history
import. Existing games, including «Поцелуй на краю света», remain frozen until
separately authorized. Requirements: Node.js 22+, npm and a working browser.

## 1. Install and verify Ludory

From the Ludory repository root:

```sh
npm ci
npm run check
node examples/core-session.mjs
node packages/studio/bin/ludory.mjs help
```

For release-quality evidence run `npm test` as well. `check` validates syntax
and contracts, **not** a real device/SDK or official platform moderation.

## 2. Create a new interactive game

Choose a **new, existing empty** game directory outside any old game checkout.
On Windows PowerShell, for example:

```powershell
$gameDir = Join-Path $env:TEMP ("ludory-demo-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $gameDir | Out-Null

# Read-only preview of the complete intended file list.
node packages/studio/bin/ludory.mjs create --project $gameDir --id demo-novel --title "Demo novel" --lang ru --profile narrative-game --template narrative-interactive --targets yandex-games,vk-games --json

# Explicitly apply only after reviewing the preview.
node packages/studio/bin/ludory.mjs create --project $gameDir --id demo-novel --title "Demo novel" --lang ru --profile narrative-game --template narrative-interactive --targets yandex-games,vk-games --apply --json

node packages/studio/bin/ludory.mjs inspect --project $gameDir --json
node packages/studio/bin/ludory.mjs components status --project $gameDir --json
```

Expected statuses are `CURRENT` for inspection and `IN_SYNC` for the newly
created components. The example includes deterministic photo/keepsake/message
interactions, Back/save/reload, wide desktop layout and portrait-first mobile UI.
The initial profile and asset examples are not rights clearance for new artwork.

## 3. Preview on a browser or private LAN

```powershell
node packages/studio/bin/ludory.mjs preview --project $gameDir --json
# Use --lan only when intentionally sharing this built preview on a trusted private network.
```

The command serves the built public distribution, not the source repository or
the project's trust receipts. Keep the terminal open while viewing; stop the
server when finished. Do **not** open the game by `file://`. Offline startup
and real-phone/browser acceptance are not current framework gates. See
[Studio's preview contract](../packages/studio/README.md) for port/target options.

## 4. Generate independent local platform candidates

For **new independently trusted Studio narrative games**, the implemented
F5b2 builder is currently a **programmatic monorepo API**, not a `ludory export`
CLI. From the Ludory repository root, after creating `$gameDir` above, run
this complete PowerShell example. It creates a **separate** output directory;
all five output filenames must be distinct and absent before the run:

```powershell
$exportDir = Join-Path $env:TEMP ("ludory-candidates-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $exportDir | Out-Null
$env:LUDORY_GAME_DIR = $gameDir
$env:LUDORY_CANDIDATE_DIR = $exportDir
$exportScript = @'
import { join } from 'node:path';
import {
  planNarrativePlatformExport,
  buildNarrativePlatformCandidates,
  verifyNarrativePlatformCandidates,
} from './packages/studio/src/narrative-platform-export.mjs';

const plan = planNarrativePlatformExport(process.env.LUDORY_GAME_DIR);
if (plan.status !== 'READY_TO_DERIVE') throw new Error(plan.reasonCode ?? plan.status);
const dir = process.env.LUDORY_CANDIDATE_DIR;
const paths = {
  yandexZip: join(dir, 'story-yandex.zip'),
  vkZip: join(dir, 'story-vk.zip'),
  yandexBuildReceipt: join(dir, 'story-yandex.build.json'),
  vkBuildReceipt: join(dir, 'story-vk.build.json'),
  exportReceipt: join(dir, 'story-pair.export.json'),
};
const result = await buildNarrativePlatformCandidates(plan, paths);
if (result.status !== 'CANDIDATES_BUILT_LOCAL') throw new Error(result.reasonCode ?? result.status);
const check = verifyNarrativePlatformCandidates(paths, plan);
if (check.status !== 'LOCAL_ARCHIVES_VERIFIED') throw new Error(check.reasonCode ?? check.status);
console.log(JSON.stringify({ sourceDigest: plan.sourceDigest,
  yandexSha256: result.candidates.yandex.sha256,
  vkSha256: result.candidates.vk.sha256, verification: check.status }, null, 2));
'@
node --input-type=module -e $exportScript
```

For a second-run reproducibility comparison, use the **same unmodified**
`$gameDir` and choose a new, empty `$exportDir`; compare both SHA-256 values.
See the [API contract and failure semantics](../packages/studio/README.md#narrative-dual-target-local-candidates-f5b2-programmatic).

These outputs are target-specific local candidates. Example successful receipt
hashes do not certify game content rights, official SDKs, publishing eligibility
or marketplace acceptance. The VK archive can additionally be checked with
`ludory release vk-check --archive ... --receipt ... --json`; its live/moderation
gates remain `NOT_RUN`. Yandex release check additionally requires authentic
candidate-bound SDK and rights inputs; do not manufacture them to get PASS.

## 5. Read the release decision accurately

`releaseReady:false` and `publicationAllowed:false` are **intentional** local
invariants. `PASS_LOCAL`, `LOCAL_ARCHIVES_VERIFIED` and mock-SDK tests are not
permission to upload, publish, run live ads or submit moderation. The current
[F6 audit](audits/2026-11-03-f6-technical-audit.md) lists unresolved technical
freeze gates for the framework itself. No version tag is implied by completing
this quickstart.
