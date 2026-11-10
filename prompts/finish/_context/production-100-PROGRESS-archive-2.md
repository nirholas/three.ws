# production-100-PROGRESS, archive 2 (2026-09-09 to 2026-10-14)

Older entries moved verbatim out of [production-100-PROGRESS.md](production-100-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [production-100-PROGRESS.md](production-100-PROGRESS.md), never here.

## 2026-09-09 (later pass): 04b, the starved evidence layer got the one fix that did not need the owner

The session above proved the `mixed` fix works and named the blocker: with the Vertex
grounded rung denied, 100% of sources are Wikipedia and **15 of 38 claims saw ZERO
stance-bearing sources**. This pass attacked that starvation, which is the half of the
problem that is fixable from here.

**Re-derived the blocker independently, and it is unchanged.** `/api/web-search` answers
`502 upstream_error`. That is diagnostic on its own: the handler returns `200 {enabled:false}`
when `GOOGLE_CLOUD_PROJECT` is unset, so a 502 means the var IS set and the Vertex call
itself is failing, which matches the dunning denial recorded above. Two free-lane probes of
the live endpoint came back with Wikipedia-only sources, confirming production is still on
the keyless tier.

**Root cause of the starvation, one level down: the Wikipedia rung only ever read each
article's LEAD section** (`exintro=1`, chosen 2026-07-08 to replace an even worse ~150-char
search snippet). A lead says what a page is *about*, so it carries the fact only when the
claim is about the page's subject. For a claim about an ATTRIBUTE it carries nothing. The
live probe of "Napoleon Bonaparte was unusually short" is the clean example: the rung
returned the opening lines of `Napoleon`, `Napoleon III`, `Napoleonic Wars` and
`Cultural depictions of Napoleon`, **not one of which mentions height**, every stance came
back `neutral`, and the verdict was `insufficient` at 0.3 confidence. The height prose was
in those same articles the whole time, further down. The verdict layer was behaving
correctly on evidence that never contained the answer.

**Fixed:** `selectRelevantPassages` in `agents/fact-checker/src/search-sources.js` now reads
each ranked article in full and returns the paragraphs carrying the claim's own vocabulary,
scored by TF-IDF over that article's paragraphs (plain term-coverage ties constantly, and
the tie then resolves to document order, which hands the win to the lead every time).
Citation and See-also sections are skipped: their entries match query terms while asserting
nothing. Measured live, keyless, on the same claim: `Napoleon` now yields
`Appearance and image: In his youth, Bonaparte was consistently described as small and
thin...` and `Cultural depictions of Napoleon` yields its `Napoleon's height` section, in
1.06s for the whole `searchAll` sweep. Claim-relevant sources on that query went 2/5 to 4/5.

Two things this pass did NOT do, deliberately:
- **It did not re-measure accuracy.** No LLM lane exists on this machine now (the keys the
  session above read off the service are unreachable: `gcloud` is back to
  `Reauthentication failed. cannot prompt during non-interactive execution`, and the keyless
  floor is gone, OVH 429s every call and Pollinations now answers ~6 requests then 402s
  `KEY_BUDGET_EXHAUSTED`). So this is a measured **evidence-relevance** improvement, not a
  measured accuracy improvement. Whether it moves the per-class table is unknown until a run
  is possible.
- **It did not touch search RANKING**, which is the other half and is upstream of this
  function. "Great Wall of China single continuous wall" still ranks
  `Great Green Wall (China)` and `Mexico-United States border wall` while never returning
  the `Great Wall of China` article at all. No passage selector can recover from that.

**One real bug caught by an existing test while doing it.** The first cut had the rung wait
on the body fetches unconditionally, so a single hung fetch spent the caller's entire search
budget and returned nothing, discarding intros that had arrived in milliseconds
(`tests/fact-check-degradation.test.js` "keeps evidence from the queries that did answer in
time" went red, correctly). Widening is now best-effort: `searchAll` threads its deadline
down through `searchWeb` into the rung, widening gets what is left minus a 500ms reserve,
and on expiry every source keeps the intro the ranked search already returned. That reserve
is what stops the rung from finishing at the exact moment the caller stops waiting.

Coverage: `tests/fact-check-wikipedia-passages.test.js` (8 cases, pure, no network) pins the
selection, the apparatus-section skip, the heading split, and the fallback floor. All five
fact-check suites pass (80 tests).

Left: unchanged. The published run is still the 2026-08-10 one, and publishing is still
gated on the GCP billing hold (OWNER-ACTIONS row 20). `04b` stays on disk. When the hold
lifts, the finishing command is the same one recorded above, and this change should be
re-measured in that run rather than assumed.

## 2026-09-09 (later pass): 01 ship-readiness, built and gate-green at 90f0a919b; the submit is the owner's

Prod was `880bdcef8` (revision `three-ws-api-00420-ljh`, built 2026-09-08) and `main` had
moved 348 commits past it. Nothing was shippable when this run started: `npm run gate` was
red in the shared tree, and in a clean worktree, which is the only tree that measures the
commit rather than five sessions' uncommitted work, it was red four more times over. Every
one of those was invisible from the shared tree, which is the whole finding of this pass.

**Built and verified at `90f0a919b`** in `/workspaces/.deploy-wt-ship100`:
`npm run gate` exit 0, `npm run build:gcp` exit 0 stamping `dirty: false`, `check:dist` and
`check:pages` clean (816 declared pages), and all three submit gates green (`db:check` says
every migration is applied, `check:gcloudignore` says the context is complete and carries no
secrets across 2424 reachable modules, `audit:deploy` clean). `server/cloudbuild.yaml` pins
`three-ws-build@` and references no `$SHORT_SHA`, so the submit needs no `--substitutions`.

**vitest at the shipped SHA: 29,435 passed, 3 failed, 175 skipped across 2036 files.** All
three failures were `Test timed out in 120000ms` in two forge suites, under load average 30
with 2036 files in flight; both files pass in 19s when run alone. The first run of the same
suite reported 18 failures and every one was the worktree's environment, not the commit,
which is what the prep:worktree work below fixes.

**Playwright: 257 passed, 0 failed, 5 skipped, exit 0** (10.3 min), after one more fix. The
first run reported three failures, all in `home-lifecycle` and `home-plan`. Neither is a
product defect: both are live journeys that need a real Home Assistant and two provisioned
accounts, which only `playwright.home.config.js` sets up, and both had drifted out of the
default config's `testIgnore` list. The general run drove them with no house to reach, so
journey 1 died on `Could not reach http://127.0.0.1:39611` and the plan page found none of
its quota rows. **`npm test` could not pass for anyone while that held.** The config states
the rule in prose right above the list (importing `./home-support.js` is what makes a spec
live), so the list is now read from the spec files instead of being that rule written a
second time: eight live specs, the original six plus the two that drifted. Both still run
under `npm run test:home:e2e`, so nothing loses coverage.

**Eight reds fixed, all of them at HEAD and none of them mine:**

- `audit:motion-tokens` counted the `prefers-reduced-motion` floor as drift. A literal there
  IS the zeroing the ladder exists to preserve; the auditor already knew that and had encoded
  it as a whole-file exemption for `tokens.css`. Generalized, baseline 162 to 158.
- `tests/audit-guards.test.js` and `tests/guard-wiring.test.js` were red because
  `check:windows-widget`, `check:home-matrix` and `i18n:home` ran in the gate chain with no
  registry entry, so `/guards` and `docs/guards.md` both omitted them. All three registered
  with two-sided proofs; `prove-guards` reports PROVEN for each.
- Proof pointers are dot paths and a slash pointer was silently accepted: `set` split it on
  `.`, wrote a junk top-level key, and the proof reported NOT CAUGHT, which reads as a rotted
  guard rather than a typo in its own declaration. `normalizeProof` now refuses one by name.
- `audit:mcp-golden` and `audit:mcp-catalog` had been red since `dc8856f57` rewrote the
  em-dashes out of the studio tool copy: descriptions are part of the published schema.
  Reviewed as copy-only (no parameter added, removed, renamed or retyped) and re-recorded.
- `audit:docs` reported three dead links to `data/announcements.json` in any tree where
  nobody had run `announce:rank`, since the ledger is generated and gitignored. The docs now
  name the command that writes it.
- `check:images` found the render-lab sheet building bare `<img>` tags.

**Two production defects found by verifying rather than by looking:**

- **The localization manifest has been shipping 113 pages short.** `prebuild` wrote
  `public/locales/localized-pages.json` and then ran the translation-annotation pass over
  `public/news/*.html`, so all 113 news pages counted as English-only. Production serves
  `count: 244` today; the built artifact says 357. Fixed by ordering, verified end to end in
  a clean worktree build. Changelog entry written.
- **`res.sendFile` applied the dotfiles deny policy to the whole absolute path**, including
  the segments above `dist/` that no request can influence. Served from a checkout under a
  dot-directory it denied every static file as Forbidden and answered 500 to everything,
  `404.html` included. Latent in production (the container path has no dot segment) and the
  reason every server suite fails from a deploy worktree, since `prep:worktree` names them
  `.deploy-wt*`.

**A deploy worktree can now verify itself, which is the durable part.** `prep:worktree`
stages four more artifacts (`tour-sdk/node_modules`, `walk-sdk/dist`,
`multiplayer/node_modules`, `animation-sources`), all hardlinked, so they cost nothing. The
first matters most: tour-sdk pins esbuild 0.27.7 against the root's 0.28.1 and the committed
`tour.global.js` is 0.27.7 output, so `audit:tour-global` called the bundle stale over a
toolchain version nobody changed and **no fresh worktree could pass the gate at all**. Two
tests also assumed the checkout is the primary worktree at a path named `three.ws`;
`check-tdz-bootstrap` now measures against its own repo root and `setup-git-hooks` asks git
for `--git-common-dir` rather than assuming `<root>/.git/hooks`, which is a file in any
linked worktree.

**Left for the owner (gate 2).** The artifact is built and the tree is clean. From
`/workspaces/.deploy-wt-ship100`:

    gcloud builds submit --config server/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5
    gcloud compute url-maps invalidate-cdn-cache three-ws-lb --path '/*' --project aerial-vehicle-466722-p5

Then `curl -s https://three.ws/api/version` should report `90f0a919b`, `npm run smoke:prod`
should exit 0, `https://three.ws/locales/localized-pages.json` should read 357 rather than
244, and `npm run check:windows-widget:live` should stop reporting that the deployed Adaptive
Card fails the widgets board's expression engine. That last one is live today: every pinned
Windows glance widget draws empty, and the card in this tree expands cleanly.

## 2026-09-09 (third pass): 04b, the blocker re-derived, and two traps measured so the next session does not pay for them

Nothing in this pass changes 04b's status: the `mixed` fix is live, it was measured earlier
today, and publishing is still gated on the GCP billing hold (OWNER-ACTIONS row 20). This
pass re-derived that independently, then spent its time on the two things a fourth session
would otherwise rediscover the slow way.

**Row 20 confirmed, from outside the project.** `/api/web-search` still answers
`502 upstream_error`, which is diagnostic because the handler returns `200 {enabled:false}`
when `GOOGLE_CLOUD_PROJECT` is unset: a 502 means the variable IS set and the Vertex call is
what fails. Two live free-lane checks of `/api/x402/fact-check` corroborate it from the
product side. "The Eiffel Tower is located in Paris, France" returned four Wikipedia pages
(one of them `Eiffel Tower (Paris, Texas)`, another `Eiffel Peak`); "Nvidia reported record
data center revenue in its most recent quarterly earnings report" returned five, among them
`Nintendo Switch` and `Foreign policy of the second Trump administration`, and answered
`insufficient`. Production is still serving the keyless tier.

**Trap 1: probing the keyless LLM floor with a toy prompt lies.** A bare probe says
Pollinations is healthy: ten calls at 6s spacing, ten HTTP 200s, sub-second. Run the actual
pipeline against it and the same rung answers `402 Payment Required` carrying
`the Pollinations legacy text API is being deprecated`, and its edge returns Cloudflare 502
pages for anything with a system message, a `response_format`, a 1024-token ceiling or a
full-size prompt. OVH answered 429 on nine of ten probes. So the floor is not "up" in any
sense a 40-claim run can use, and the previous pass's finding stands. **Probe a lane with
the payload the caller actually sends**, or a dead rung reads as alive. The one in-process
smoke check this pass could take degraded exactly as designed, reporting
`query generation unavailable` and `stance extraction unavailable` rather than fabricating an
all-neutral verdict, which is the contract the 2026-09-02 change added.

**Trap 2: the search RANKING half is not the one-line fix it looks like.** The previous pass
scoped it out and named the example. Measured here across ten concise, LLM-shaped queries
(the shape `generateSearchQueries` actually emits, not the raw claim), the failure is real
and worse than the example suggested: `Great Wall of China single continuous wall` ranks
`Great Green Wall (China)` first and never returns the `Great Wall of China` article at all;
`Napoleon Bonaparte actual height` never returns `Napoleon`; `lightning strikes same place
twice` returns `Lockheed Martin F-35 Lightning II`, `Virtual XI` and `Molly Hatchet`;
`carrots night vision myth origin` returns `Feijoada (Brazilian dish)`, `Heracles` and
`J. R. R. Tolkien`.

The obvious repair is a title-anchor rung: walk the query's leading word-prefixes through
`action=opensearch` and add the article the query names. Measured, it recovers the canonical
article in five of the ten cases, including `tongue map` to the `Tongue map` article that
full-text search never returns. **It also injects junk in four of them**, because a short
prefix resolves to a song, an album or a film: `lightning strikes same` to
`Lightning Strikes (Aceyalone album)`, `carrots night` to `Carrot Rewards`, `humans use` to
`Human sexual activity`, `goldfish memory` to the 2003 film `Goldfish Memory`. Two guards cut
that down: reject a title carrying a parenthetical disambiguator, and require the resolved
title to appear verbatim inside the query. Together they reject three of the four junk
results while keeping all five wins; the film title survives both. That is a workable design
and it is NOT a change to make blind, because with no LLM lane on this machine its effect on
the per-class table cannot be measured, and shipping an unmeasured ranking change on top of
an unmeasured passage change is how a fix becomes a regression nobody can attribute. It
belongs in the same run that re-measures the passage change, once row 20 clears.

**One defect found and fixed while verifying this order's own changelog entry**, unrelated to
the fact-checker but shipping today. Community delivery keys an entry by date + title, and
the posted-set can only suppress an entry sent on an EARLIER tick, so two feed entries
sharing one key were both unposted when a batch was built and the send loop posted both:
the identical announcement, twice, to every subscriber. `data/changelog.json` had six
colliding pairs, three byte-identical, and one of those was added today and still unsent.
Fixed in three layers: `pendingEntries` collapses repeats before the batch is built (new case
in `tests/changelog-push.test.js`), the feed build now refuses a verbatim duplicate instead of
shipping it (proved by making it fail and restoring), and the three verbatim repeats are gone
from the data file. The three pairs that share a key while saying different things were left
alone, because deleting or retitling published copy is a wording call, and the delivery layer
now collapses them either way.

Left: unchanged. `04b` stays on disk, the published run is still the 2026-08-10 one, and the
finishing command when row 20 clears is the one recorded two passes above.

## 2026-09-09 (fourth pass): 01 ship-readiness, built clean at 7a053e6f3 with the first fully green `npm test`; the submit is the owner's

**Prod before this run: `880bdcef8`, revision `three-ws-api-00420-ljh`, `dirty: false`.** Local
`main` was 385 commits ahead. Nothing shipped in this session: the submit is gate 2 and the
owner has not said yes, so this run ends at the rendered command, which is a finished run and
not a blocked one.

**The clean `npm test` this order has owed since 2026-08-08 now exists.** Taken in the deploy
worktree at the exact pinned commit, after the build, exit code 0:

    Test Files  2035 passed | 7 skipped (2042)
         Tests  29496 passed | 175 skipped (29671)
    playwright  256 passed, 1 flaky, 5 skipped (11.0m)

The one flaky was `tests/e2e/coin-buy-trade.spec.js:284` (failed buy-prep copy), which passed
on retry. `npm run gate` also exits 0 at that commit, as do the three deploy gates
(`db:check`, `check:gcloudignore`, `audit:deploy`).

**Four reds had to be fixed to get there, and only one of them was flake.**

- **A lost host realm turned a handled boot failure into a crash** (`8d70251ec`). Two
  unhandled rejections failed every full vitest sweep. In vitest's jsdom environment
  `document.defaultView === globalThis`, so the existing "construct from the element's own
  window" fix is a no-op there: when the environment teardown restores Node's native globals,
  `view.CustomEvent` becomes Node's, and jsdom's `dispatchEvent` rejects it as "not of type
  Event". Thrown from inside `_boot`'s own catch it escaped as an unhandled rejection. The
  same thing happens to a real embedder whose SPA remounts mid-boot. `_emit` now drops an
  event the realm will not accept, and the four other dispatch sites that repeated its four
  lines route through it. Pinned by `tests/src/element-emit-realm.test.js`, verified against a
  negative control (two of its three cases fail without the guard).
- **`prep:worktree` dropped 25 fixtures from every staged tree** (`c7ab8d2d5`). It skipped any
  artifact whose destination existed, which is wrong for a directory git only partly owns:
  `animation-sources` holds tracked `.fbx` beside gitignored `.glb`, so checkout created it
  with the tracked half and the stager left the rest behind. glb-diff and model-diff then
  failed on missing files, which reads as a broken commit rather than an unstaged tree. An
  existing destination is now merged into with `--update=none`, so a tracked file is never
  hardlinked (which would make an edit in the deploy tree rewrite the source tree through the
  shared inode). The placement rule is pure and pinned.
- **The stage-room test raced a broadcast it can never win** (`7a053e6f3`). It asserted
  `room.state.host.caption` the instant the `utterance` message arrived, but `StageRoom`
  broadcasts with `afterNextPatch: false` on purpose, so the caption ALWAYS lands after the
  message. It failed on a loaded box in three consecutive sweeps and passed on every isolated
  re-run, which reads as flake and is a real ordering assumption. Now waits for state to catch
  up, bounded by the deadline already in the test. Green 3/3 in a row.
- **The committed feeds had fallen a changelog entry behind** (`8f6fd6b1d`). Nothing
  regenerates them when an entry lands, so `CHANGELOG.md` and the published JSON and RSS were
  missing the animation-gallery paging entry and the atlas index still advertised 814 pages
  against a 816-page route table. This is also what made the first build stamp itself
  `dirty: true`: `build:info:snapshot` reads the tree before `prebuild` rewrites those files,
  so a tree that is already behind stamps dirty. Regenerated and committed; the shipped build
  reads `dirty: false`.

**The ordering rule that came out of this, worth keeping.** In a deploy worktree, build
BEFORE you test. Nine failures in the first worktree sweep were missing build output
(`avatar-sdk/dist/index.mjs`, and `dist/` for the server-404 and asset-path suites), and
running `npm test` first also dirties the tree through Playwright's dev server, which runs
`prebuild`. Both disappear when `build:gcp` runs first.

**Two peer-caused reds were correctly NOT fixed.** A sweep in the shared tree reported
`tests/changelog-push.test.js` and `tests/multiplayer-server-boot.test.js` failing; the first
was a peer's uncommitted `api/_lib/changelog-push.js` edit landing mid-run (it passes at HEAD),
and only the second was real. HEAD moved four times during this run, which is why the
verification was taken in a pinned worktree rather than the shared tree.

**Pre-ship healthz (unchanged from the start of the run):** 11 ok, 3 degraded, 1 down.
`x402_settle` DOWN (settle 0.0%, 132 rail faults, sponsor under the SOL floor) and `sniper`
degraded (5 of 13 wallets starved, funding master holds 0.0250 SOL against the 0.2834 SOL
needed) are both order 902 and both need owner funds. `rpc_lanes` degraded (all 3 paid lanes
cooling) and `okx_chat_bot` degraded (Vertex dunning denial, order 907) are likewise not this
deploy's.

**Left for the owner, in this order.** gcloud auth on this machine has expired
("Reauthentication failed. cannot prompt during non-interactive execution"), so even a
read-only `gcloud run services describe` fails here; the reauth is interactive and only the
owner can complete it.

    gcloud auth login
    cd /workspaces/.deploy-wt-ship100b && gcloud builds submit --config server/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5
    gcloud compute url-maps invalidate-cdn-cache three-ws-lb --path '/*' --project aerial-vehicle-466722-p5

No `--substitutions` on the submit: `server/cloudbuild.yaml` contains no `$SHORT_SHA` (it tags
through `_IMAGE`), so passing one is rejected. The bare `gcloud builds submit` is correct here
only because `db:check`, `check:gcloudignore` and `audit:deploy` were all run in that worktree
and all exit 0. Then `curl -s https://three.ws/api/version` should report `7a053e6f3` with
`dirty: false` on a revision above `three-ws-api-00420-ljh`, and `npm run smoke:prod` should
exit 0.

**The deploy worktree is deliberately left in place** at `/workspaces/.deploy-wt-ship100b`,
built and verified, because the owner submits from it. Remove it with
`git worktree remove --force /workspaces/.deploy-wt-ship100b` once the deploy lands. Disk is
at 95% (7.2G free) with it there.

## 2026-10-11: order 400 (ring leak scanner RPC burn) closed

Commit `f6dcafb23` on `evolve`. The scanner now holds a lease (`acquireLock`,
`cache.js`), runs under a 200s wall-clock budget, and scans role wallets then
ledger-active wallets then an oldest-checked_at-first rotation slice instead
of the full 2,006-wallet registry every run. Removed from economy-tick's
TARGETS (its own `*/10` Cloud Scheduler job already owns it); `wallets-leak-scan`
got the same lock. New migration `20261011230000_x402_ring_scan_checked_at.sql`
adds the `checked_at` column the rotation needs; pending for the owner via
`npm run db:migrate` at the next deploy.

Also fixed along the way: `accountKeyStrings()` returned a live `PublicKey`
object instead of its base58 string whenever `accountKeys` came back as
`{ pubkey, signer, writable }` (the real shape from `@solana/web3.js`'s own
parsed-transaction response), so every wallet-identity comparison silently
failed on real mainnet data. `classifyWalletDebits` found zero leak/delegation
events on every real transaction and the fee cross-check (`x402_ring_fee_observed`)
never accumulated anything. Both now work on real traffic for the first time.

Local verification against real mainnet data (RPC paid lanes still exhausted
per OWNER-ACTIONS row 24, so all RPC calls hit the free/degraded lanes): a
single run scanned all 2,006 registry wallets in 142s, well under the 200s
budget, with a well-formed `results` array. The DoD's concurrent-second-curl
check could not be exercised locally because this worktree has no Redis
configured (`UPSTASH_REDIS_REST_URL`/`TOKEN` absent from `.env.local`), so
`acquireLock` degrades to its documented always-true no-op locally
(`cache.js` `redisConfigured()`); the second curl started its own real scan
and timed out against curl's own `-m` flag rather than returning a clean
lease-skip. That lease-skip path is covered by the existing unit test in
`tests/x402-ring-leak-scan-run.test.js`, which exercises the same code path
with `acquireLock` mocked to return false. Borrowing production's real
Upstash lock to re-run this locally was rejected: it would hold the real
9-minute lease on the live cron for no verification benefit over that test.

OWNER-ACTIONS row 24 updated with the re-measurement and the ship command
(`npm run db:migrate` then `npm run deploy:gcp:full`). `npm run test:core`
shows the same 6 pre-existing failures as before this change (unrelated:
`mcp-schema.test.js`, `x-content.test.js` queue staleness) plus 3 new passing
tests, no new failures.

## 2026-10-11: order 403 (cron time-budget enforcement) closed

Commit `1ef950e60` on `evolve`. `wrapCron()` in `api/_lib/http.js` now races
every cron handler against a real time budget (`maxDurationMs`, wired from
each of the 14 cron files that already declared `export const maxDuration`,
defaulting to the new `DEFAULT_CRON_MAX_DURATION_MS` constant of 120000ms
for the rest) and answers a clean `503 { reason: 'cron_timeout' }` instead
of hanging until Cloud Run's blind 900s ingress kill, the gap this measured
against `/api/cron/x402-ring-leak-scan` before order 400's own lease/budget
fix landed. A `timedOut` guard stops the handler's own late settlement
(it keeps running in the background; Node has no generic preemption) from
clobbering the timeout heartbeat or touching the already-sent response.
`api/_lib/render-glb.js`'s `renderOnce()` got the same treatment for its
three previously-unbounded Puppeteer stages (`getBrowser` 30s, `setContent`
20s, `screenshot` 15s, the last enforced manually since puppeteer-core
ignores an unrecognized `timeout` key on screenshot options).

Verification: `tests/http-cron-timeout.test.js` (4 new tests) proves the
race, the 503 body, the heartbeat, the ops-alert dedup signature
(`cron:timeout:<name>`), the unaffected-when-inside-budget path, and the
default-budget fallback (verified behaviorally via a `setTimeout` spy
rather than parsing esbuild-minified source, since `120_000` compiles to
`12e4`). The timeout case was shown to hang indefinitely against the
pre-fix `wrapCron` using a path-scoped `git stash push -u` isolating just
`api/_lib/http.js`, then restored and the fix re-applied before committing.
`tests/http-db-unavailable-boundary.test.js` got one added case proving
`wrapCron`'s existing `db_unavailable` degradation (200, not 503, no
`[api] unhandled` log) is unchanged now that a race wraps the handler.
`npx vitest run tests/http-cron-timeout.test.js tests/http-db-unavailable-boundary.test.js`
passes 10/10. A real `http.createServer` hosting `wrapCron` with an 800ms
budget and a never-resolving handler answered `503 cron_timeout` at 0.809s
against a real `curl` round trip (not Cloud Run's 900s, not instantly);
the proof server and its temp script were removed afterward. `npm run
test:core` shows the same pre-existing `x-content.test.js` queue-staleness
failure noted in the 2026-10-11 ring-leak-scan entry above, no new
failures, plus the new passing tests. `npm run check:rules` is clean on
every touched file; `npm run build:pages` rebuilt the changelog clean.

New docs section: "HTTP timeout with no cron context" in
`docs/ops/production-log-triage.md`. OWNER-ACTIONS row 37 names the ship
command (`npm run deploy:gcp:full`, already covered by row 1's general
deploy cadence) and the post-deploy log query to confirm the fix landed.
No owner decision was otherwise needed; this is a pure code fix.

## 2026-10-13: order 400 (R2 outage resilience, agent-doable half) closed

Step 0 re-derivation confirmed the order's premise still held: `ops_alerts`
showed the last `RESOLVED: Object storage (Cloudflare R2)` row at
2026-10-11T06:55:05Z with every hourly tick since then `DOWN` (35+ hours at
measurement time during this run, now 60+ hours), the public `*.r2.dev`
domain answering a Cloudflare-branded 403, and `/cdn/<key>` (`api/cdn-object.js`)
502ing because both of its legs are down simultaneously. Four commits on
`evolve`, one per task:

1. `ee94b259d` doc escalation: `prompts/finish/_context/production-100-OWNER-ACTIONS.md`
   row 36 and `docs/ops/production-log-triage.md`'s `r2-downstream-5xx`
   section both corrected from "flaps... many RESOLVED events minutes
   apart" to the measured 35+ hour unbroken `DOWN` streak, without touching
   row 36's owner classification.
2. `ba53f5086` health-probe retry: `gatherObjectStorageHealth()`
   (`api/_lib/ops/object-storage-health.js`) now retries once after a
   200-500ms backoff before classifying `down`, scoped to absorb a single
   transient blip inside one invocation, not to mask a sustained outage.
   `tests/object-storage-health.test.js` proves a failure-then-success
   classifies ok/degraded and two consecutive failures still classify down.
3. `d152edbfe` frontend fallback: `src/marketplace-detail.js` (detail
   avatar, creator-modal thumb grids) and `src/marketplace-gallery.js`
   (panel media) now probe thumbnail/GLB loads with a detached `Image()`
   or the `<model-viewer>` `error` event and keep the initial-letter
   fallback showing on failure instead of a blank box or stuck spinner.
4. `6c11ef944` `/cdn/` routing: `api/_lib/r2.js` exports
   `cdnUrl()`/`cdnUrlOrNull()` (same-origin `/cdn/<key>` via `encodeR2Key()`,
   never throws). `thumbnailUrl()` now calls `cdnUrlOrNull()` internally,
   which fixed `pump-agent-launches.js` and `marketplace/animations.js` for
   free. Direct call sites switched: `agent-earnings.js`, `agent-economy.js`
   (`avatarThumb`), `marketplace/[action].js`, `persona-store.js`'s
   persisted GLB URL, and `avatars.js`'s `model_url`/`base_model_url`/
   `usdz_url`/`halfbody_url` plus `resolveAvatarUrl()`'s public branch
   (previously tagged `cdn: true` while actually returning a raw r2.dev
   URL; now true to that tag). `drop-store.js`'s `thumbnailUrl` is a
   destructured parameter name fed from forge-job data in its caller, not
   a local URL-construction helper, so it needed no change. A follow-up
   grep sweep (`grep -rn "publicUrl(" api/_lib/*.js api/**/*.js`) found
   ~40 more call sites outside the order's 6 named files/helpers (forge
   pipeline internals, cron jobs, third-party provider integrations,
   print/IRL/IBM/x402/erc8004 handlers); left untouched as a deliberate
   scope boundary rather than an unbounded same-session expansion, several
   of them persisting URLs into DB columns rather than only shaping an API
   response.

Verification: `npx vitest run tests/object-storage-health.test.js` passes
8/8. `npx vitest run tests/r2-public-url-or-null.test.js
tests/cdn-object-storage-failover.test.js tests/r2-public-object-fallback.test.js
tests/r2-key-from-public-url.test.js` passes 28/28. A local full-stack
server against the real production database confirmed
`/api/marketplace/agents?limit=1` now returns `thumbnail_url` and
`avatar_glb_url` both starting with `https://three.ws/cdn/`, not
`*.r2.dev`. A Playwright check against the still-live outage confirmed the
marketplace detail page's avatar fallback renders its initial letter
(visible) and the model-stage label reads "Couldn't load the 3D model."
instead of hanging. `npm run test:core` finished at 46 failed files / 85
failed tests, 2352/35376 passed, matching the pre-existing baseline
(confirmed via a path-scoped `git stash` comparison that the two
investigated failures, `agent-earnings-board.test.js`'s missing
`agent_commerce_invoices` relation and `mcp-studio-asset-links.test.js`'s
`MAX_GLB_BYTES` mismatch, reproduce identically with none of this order's
changes present), no new failures. `npm run check:rules` clean on every
touched file.

No owner decision was needed beyond what OWNER-ACTIONS row 36 already
tracks (enabling R2 in the Cloudflare dashboard); everything in this order
was agent-doable and ships independent of when that happens.

## 2026-10-13: order 403 (forge nvidia lane cooldown gap) closed

Commit `7fa4b0653` on `evolve`. Step 0 re-derivation found the live
`forge_generation` symptom had already moved on from the order's measured
15/15-failures-on-nvidia window: healthz now read `"no generation has
STARTED in 114m"`, a different (shared-dependency-shaped) symptom, not the
nvidia-specific one the order measured. Per the order's own "Never
blocked" guidance, the underlying code gap is a structural fact
independent of the current failure rate, so the fix proceeded anyway.

`NIM_TRELLIS_COOLDOWN_KEY` is now `export const` in `api/forge.js` (line
178); `api/cron/forge-finalize.js` imports it and the already-exported
`nimCooldownSeconds` from `../forge.js` instead of redeclaring the string.
Added `decideNvidiaStall` (pure, exported, next to `decideFailedSweep`:
defer/resubmit/terminal on ageMinutes vs. the attended budget and hard
TTL, with an `alreadyResubmitted` guard) with its own test-first coverage
in `tests/forge-finalize.test.js` (5 new tests, confirmed failing with
"decideNvidiaStall is not a function" before the function existed, passing
after). Wired one stall-resubmit into the nvidia poll branch for a
still-running/queued/null-status poll past the attended window: under a
new `nvcf:stall-lock:` key (distinct from the existing `nvcf:resub:` lock
so the two paths can never double-fire), it calls `nvidia.textTo3d()` once
and writes both the shared `nvcf:alias:` key (so the next tick and any
live attended poller pick up the new task id transparently) and a
`nvcf:stall-resub:` flag so it never fires twice for the same row. Added
`markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, nimCooldownSeconds())` at
both give-up points for `backend === 'nvidia'`: the `nvcf_expired`
fallthrough (lock held by a prior recovery, or the resubmit itself
throwing) and immediately before the final bare-TTL `markFailed`, scoped
so self-host envelope timeouts (which already call `markLaneUnhealthy`)
are untouched.

Verification: `npx vitest run tests/forge-finalize.test.js` passes 15/15
(10 pre-existing `decideFailedSweep`/`decodeWorkerEnvelope` tests plus 5
new `decideNvidiaStall` tests). A direct dynamic import of
`api/cron/forge-finalize.js` confirmed the new `../forge.js` import
introduces no circular-import failure (module loads clean, both new and
existing exports present). `npm run check:rules -- --paths api/forge.js
api/cron/forge-finalize.js tests/forge-finalize.test.js` exits 0.

No owner decision was needed; this is a pure code fix with no deploy step
in its own definition of done. The live healthz number will not change
until the next deploy carries this commit (deploys are owner-gated).

## 2026-10-14: order 404 (evolve/main divergence, 140-file merge) closed

Step 0 re-derivation at start of session measured `main` 376 commits ahead /
`evolve` 134 ahead (grown from the order's 2026-10-11 snapshot of 358). Did
the merge as one operation, resolved all batches, fixed the live production
bug it unblocked, and corrected the two downstream orders it named. Seven
commits:

1. `57ff3c669` the merge itself (`git merge --no-commit --no-ff main`, then
   one commit, not a sweep). Batch A (17 `worker_security.py` vendored
   copies, generated JSON/JS files) resolved mechanically and reverified
   with `npm run check:vendored` (0 drift). Batch B (clean adds on one side)
   taken as diffed. Batch C (`x-mention-store.js`, `gateway/adapters/x.js`,
   `x-search.js`, `sentiment-scout.js`, `x402-ring-leak-scan.js`,
   `webhook-dispatch.js`) hand-combined per the order's own analysis: both
   sides' improvements preserved, not blind-picked. Batch D
   (`auth.js`, `api-keys.js`, `rate-limit.js`, `idempotency.js`,
   `spend-scope.js`, `x402-paid-endpoint.js`, `policy.js`) read hunk by
   hunk; all were orthogonal (different functions/concerns on each side), so
   all combined with no file left reverted to one side and no follow-up
   needed for this batch.
2. `7ba9f9749` fixed the live `x-mention-reply.js` `chainFor()` bug (row 34):
   it now builds its chain from `llm.js`'s own `providerChain()` plus
   `loadOwnerGrokKey`/`agentDefaultModel`/`MODEL_CATALOG` instead of the
   tool-calling gateway's `resolveAgentBrain`/`modelChain` shape, which has
   no `buildBody`. `RUN_LLM_TESTS=1 npx vitest run tests/x-mention-reply.llm.test.js`:
   16/16 `source: 'model'`, no `TypeError`.
3. `15c7d0a84` fixed the two genuinely new post-merge regressions (found by
   diffing a pre-merge detached-worktree baseline run against the post-merge
   full suite, not by assuming): `open-source-credits.json` missing two
   entries `main` added dependencies for, and 242 `node_modules` entries
   stale against an already-correct lockfile (`npm install --package-lock-only`
   used mid-merge resync's metadata but not the tree; a plain `npm install`
   fixed it with no lockfile diff).
4. `e22e51bc5` restored `SPEND_BROWSER_URL` in `api/_lib/spend-scope.js`,
   dangling since a shared-history refactor removed it before `evolve` ever
   branched; `scripts/lib/skill-md-facts.mjs` (evolve-only) depended on it
   and `npm run build:skills-pack` was throwing.
5. `6b491c5da` fixed `pages/grok.html`'s 5 stray `"three-ws"` connector
   labels to the consistent `"three-ws-grok"` slug `slugForEndpoint()`
   actually produces (pre-existing bug the merge's full-suite run surfaced,
   not merge-caused).
6. `a7e169bc8` regenerated `data/open-source-credits.json` (see commit 3).
7. `2919be276` corrected order 060's and `production-100-OWNER-ACTIONS.md`'s
   2026-10-11 claim that `d77b89178` (an earlier, separate evolve/main
   merge) had already fixed the `chainFor()` bug; it had not (checked out
   that merge's own parent and confirmed `chainFor()` still imported
   `resolveAgentBrain`/`modelChain` there). The real fix is commit 2 above.
   Order 061 needed no correction, its status was already accurate.

A second, pre-existing architecture gap surfaced during close-out (not
caused by this merge, left by the earlier `d77b89178` merge on 2026-10-11):
`api/_mcp-studio/receipts.js`'s `openRun`/`closeRun` run-receipt system is
wired into nothing outside its own test, because `main`'s `finishMesh`/
`finishRig` refactor that wired it into `forge_free`/`text_to_avatar`/
`mesh_forge`/`rig_mesh`/`forge_avatar` was never combined with evolve's
idempotency-key `job-tools.js` architecture. Filed as its own order,
[405-wire-run-receipts-into-forge-tools.md](../405-wire-run-receipts-into-forge-tools.md),
rather than guessed at here; order 404's own batch C guidance is to combine
with full confidence or not at all, and this combine needs real design work
across 5 handlers.

Definition of done, verified: `git rev-list --left-right --count main...HEAD`
→ `0  332` (evolve now a descendant of main). `check:vendored` 0 drift.
`RUN_LLM_TESTS=1 npx vitest run tests/webhook-dispatch*.test.js
tests/x402-ring-leak-scan-run.test.js tests/x-mention-reply.llm.test.js`:
30/30 passed. Full `npm test`: 43 failed files / 77 failed tests, but a
pre-merge baseline run (temporary detached worktree at the pre-merge SHA)
showed 44 failed files / 83 failed tests before any of this session's fixes;
diffing the two sorted FAIL lists (`comm -13`) shows zero files failing now
that did not already fail before the merge. `check:rules --base 7ba9f9749
--head HEAD` across all 237 changed files: 0 violations. `git status --short`
clean except 4 files (`public/changelog-recent.json`, `public/changelog.json`,
`public/features.json`, `public/sitemap/index.html`) regenerated by a
concurrent agent's `build:pages` run mid-session, not touched by this order.

## 2026-10-14: 405 wire run receipts into forge tools (shipped and verified)

Measured: `grep -rn "openRun\|closeRun" api/` outside `receipts.js` and its own
test returned nothing; every one of the five job-starting tools
(`forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`)
generated for real users with no signed receipt. `tests/run-receipt.test.js`
had two `it.skip`'d tests in `describe('studio wiring')`.

Did: added `finishMesh`/`finishRig` shared tails in `tools.js` layered on top
of the existing idempotency-key flow (`jobOpts`, `ctx.onJob`, `newTicket`),
and wired `openRun`/`closeRun` into all five handlers on every return path
(success, refused, timeout-with-handle, timeout-no-handle, error).
`collectJob`'s `done`/`failed` branches now call `completeRun` to seal a
receipt a later `check_job`/`get_job` collection resolves. Fixed a load-bearing
prerequisite: `gpt-forge-client.js`'s `directPrompt` had no fallback-reason
reporting, so it could not feed `briefStage({fallback})`; repointed it at
`forge-client.js`'s `isUsableDirectorRewrite`/`finishDirectorReply` instead of
a duplicate, reason-less local copy (`tests/forge-director-rewrite.test.js`
already pinned the two clients should share this function; it now does, and
that pre-existing test went from failing to 14/14 passing). Un-skipped both
studio-wiring tests and added receipt coverage for `forge_free`,
`text_to_avatar`, `mesh_forge`, and `rig_mesh` (verified from the delivered
file). Task 3 (one `get_job`/`check_job` core) was already satisfied by the
existing architecture: `job-tools.js`'s `get_job` directly calls the same
`collectJob` exported from `tools.js`, confirmed by re-reading the import and
call site. Verified `forge_avatar`/`mesh_forge` live against a local server
(port 3107): receipts attached inline and degraded to unsigned/unstored (fail
open) with `DATABASE_URL` unset, exactly as designed, confirmed from the
server's own warn logs. Shipped at `d80e9d01c`.

Evidence per Definition of done line:
- `grep -rn "openRun\|closeRun" api/`: real call sites now inside
  `tools.js`'s five handlers and `finishMesh`/`finishRig`, not just
  `receipts.js`/its test.
- `npx vitest run tests/run-receipt.test.js`: 27/27 passed, no `it.skip` left
  in `describe('studio wiring')`.
- Live `forge_avatar`/`mesh_forge` calls against `server/index.mjs` on
  `:3107` returned a `structuredContent.receipt` block inline.
- `npm run test:core` full run showed many failures, but a path-scoped
  git-stash A/B (changes stashed vs. applied) against the same 25 test files
  that reference `tools.js`/`gpt-forge-client.js`/`dispatch.js`/`jobs.js`/
  `job-tools.js`/`receipts.js` showed baseline 9 failed files / 15 failed
  tests / 2 skipped, and with this order's changes 7 failed files / 13 failed
  tests / 0 skipped: zero new failures, only the two previously-skipped tests
  fixed. `tests/api/gpt-forge-clone.test.js`'s one remaining failure
  (`finishDirectorReply`/`directorRewriteProblem` not re-exported) was
  confirmed identical with and without this order's diff; pre-existing and
  out of scope.

Left: nothing for this order. `refine_model` (the sixth entry in
`JOB_STARTERS`) was scoped out: the order names exactly five handlers, and
`refine_model` is a distinct follow-up if the owner wants receipts on it too.
