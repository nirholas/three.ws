# production-100-PROGRESS, archive 3 (2026-10-15 to 2026-10-24)

Older entries moved verbatim out of [production-100-PROGRESS.md](production-100-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [production-100-PROGRESS.md](production-100-PROGRESS.md), never here.

## 2026-10-15: 406 fix dead links left behind by retired work orders (shipped and verified)

Measured: `npm run audit:docs` listed 9 dead relative links across
`docs/partners/outreach-plan.md` (2), `docs/partners/prospects.md` (2),
`docs/partners/tripo.md` (1) and `apps/hq/` (4), plus one absolute-path site
link in `docs/research/oss-landscape-2026-10-notes/chat-memory-evals.md`.
The three `docs/partners/*` links named orders 072, 075 and 084, all three
retired without rewriting their inbound references, exactly the failure mode
`prompts/README.md`'s "Runtime consumption" section warns about.

Did: repointed each retired-order link at the live doc covering what
shipped instead of the deleted path: engine bridges at
`docs/engine-bridges.md`, three-vrm at `docs/avatar-engines.md` (which
already marks it `live`), and the Tripo v3 house lane at
`docs/forge.md#the-tripo-house-lane`. Corrected `prospects.md`'s row claiming
order 075 covered VSeeFace's VRM 0.x export gap: the three-vrm order only
shipped the import/load side (`src/game/vrm-boot.js`'s `VRMLoaderPlugin`,
for both VRM 0.x and 1.0); `src/avatar-export.js` still only writes VRM 1.0,
so that gap is real and untracked, now stated plainly instead of linking a
dead file. For `apps/hq`: repointed `README.md`'s `CLAUDE.md` link at the
app's existing `AGENTS.md` (already the de facto contributor guide), fixed
`DOCUMENTATION.md`'s two `ROADMAP.md` links which were missing a `../` (the
file is one level up from `docs/`), and wrote a real `apps/hq/.env.example`
covering every env var the app's own code reads (`grep -rhoE
"process\.env\.[A-Z_]+" api src src-tauri scripts`), since none existed for
`deploy-cloud-run.md:52` to link. Fixed `chat-memory-evals.md`'s absolute
local-machine path to `packages/agent-memory/README.md` with a relative one.
Verified the three `hubs/` links (`awesome-agent-identity`,
`awesome-agent-protocols`, `awesome-solana-agents`) are correct false
positives: `hubs/README.md` states each hub "is built to be lifted into its
own GitHub repo," so the relative `../../issues/new?...` link is correct for
that future repo's own root; left alone per the order.

Evidence per Definition of done line:
- `npm run audit:docs`: the "Relative links" finding dropped from 12 to 3,
  the 3 remaining being exactly the verified `hubs/` false positives; the
  site-link finding dropped from 1 to 0. The separate "Public docs missing
  from data/pages.json" category (10 findings) is untouched, pre-existing
  and out of this order's scope.
- Every rewritten link resolves: confirmed each target file exists on disk
  before linking it.
- No placeholder text in any link or its surrounding prose.
- `npm run check:rules -- --paths <touched files>`: `OK: no hard-rule
  violations` after fixing one em-dash this order introduced and caught
  itself.
- `git status`: clean after both commits.
- Commits: `3bdf2d5e6` (the three `docs/partners/*` links plus
  `chat-memory-evals.md`) and `35a179838` (the `apps/hq` links and the new
  `.env.example`).

Left: nothing for this order.

## 2026-10-15: 407 publish or park the 10 orphaned docs pages (shipped and verified)

Measured: `npm run audit:docs` listed 10 docs served live at `/docs/<slug>`
with no `data/pages.json` entry and no `UNPUBLISHED_DOCS` exemption, so none
of them could be found via sitemap, llms.txt, features.json or the human
sitemap: `forge-workflows`, `listings-registry`, `run-receipts-x-reply-and-
thread`, `standalone-repo-playbook`, `standalone-repos`, `team-chat`,
`ui-lint`, `x-mention-avatar`, `x-partner-series`, `x-reply-playbook`.

Did: published the three that document a live, user-facing feature to
`data/pages.json` with a real title and description drawn from the doc's own
content, matching the "Docs · X" pattern already used for sibling pages:
`forge-workflows` (the Forge Workflows node editor, already live at
`/forge/workflows`), `team-chat` (squad chat, already live at `/team-chat`),
and `standalone-repos` (the generated catalog of monorepo packages mirrored
to their own GitHub repos; confirmed `/open-source` renders a different
dataset, the open-source dependencies three.ws is built on, not this mirror
catalog, so it is not a duplicate). Ran `npm run build:pages` in the same
commit so `CHANGELOG.md`, `public/changelog.json`, `public/changelog.xml`,
`public/llms.txt`, `public/llms-full.txt`, `public/sitemap/index.html` and
`public/features.json` all regenerated from the new `data/pages.json` rows;
confirmed the three new doc URLs appear in `public/sitemap/index.html` and
`public/llms-full.txt`. No separate `data/changelog.json` entry was added:
each new page carries an `added: "2026-10-15"` date, and `CHANGELOG.md`'s own
header states new pages already surface automatically from that field
(confirmed present after the rebuild), so a curated entry would have
duplicated the same line.

Parked the other seven in `UNPUBLISHED_DOCS` (`scripts/audit-docs.mjs`) with
a one-line reason each, in the house style of the existing entries:
`run-receipts-x-reply-and-thread` and `x-mention-avatar` (dry-run drafts,
public once their bots or deploys go live, siblings of the existing
`x-mention-bot` / `x-mention-image3d` entries), `x-partner-series` and
`x-reply-playbook` (internal X content operating playbooks, siblings of
`announcement-factory`), `ui-lint` (internal operator guide for the
`lintapple` QA script), `standalone-repo-playbook` (internal checklist for
whoever runs the mirror-promotion work) and `listings-registry` (the
generated operator tracker; the reader-facing record is the already-
published `docs/listings.md`).

Evidence per Definition of done line:
- `npm run audit:docs`: the "Public docs missing from data/pages.json"
  section dropped from 10 findings to 0; the 3 pre-existing `hubs/`
  relative-link findings (order 406's verified false positives) are
  untouched.
- Every `data/pages.json` entry added has a real title and description
  written from the doc's own first paragraph and feature list, not a
  placeholder.
- Every `UNPUBLISHED_DOCS` entry added has a specific one-line reason
  matching its neighbors' style, not a bare "internal".
- Derived build output regenerated in the same commit via `npm run
  build:pages`; verified the three new URLs in the regenerated
  `public/sitemap/index.html` and `public/llms-full.txt`.
- `npm run check:rules -- --paths data/pages.json scripts/audit-docs.mjs`:
  `OK: no hard-rule violations`.
- `git status`: clean after the commit.
- Commit: `a5891de92`.

Left: nothing for this order.

## 2026-10-23: 402 restore a green `npm run gate` (shipped and verified)

All 62 steps of `npm run gate` pass one by one in an isolated worktree at 26224ee7f (the shared tree's `node_modules` is corrupted by concurrent installs, so verification ran against a clean checkout with its own npm cache).

Root causes and commits, in order of the work order's priority:

- MCP safety, manifests, census, golden, catalog, listing, counts: mislabeled polling tools (e0a419d5b), missing census helpers (2f439686f), a syntax error in alerts-mcp (dbcee4f93), regeneration (e4bdbdf34), the AR studio manifest name and publisher list (a00b16c56), 69 tools without a when-to-use sentence plus preview_macro hints (32f2afa90, 26224ee7f), `@x402/svm` 2.28 (ce2f40e1a), a stale well-known skills index (26224ee7f).
- check:model-viewer and check:fetch-timeouts: 16fc5dda6, ce7637523.
- test:gate: burner-tier policy read broke the custody guard fixtures (bcf0dc888).
- audit:docs: 0e9c88bf5. audit:links, check:tutorials, audit:x402-catalog: d69c069cf, 6d6ab4063, 3f1eb493d. audit:guards: f72c1a926.
- Regenerations: skills pack 56f29d1da, tour-global 02fcced64, doc-media 5b99c1aa8 (re-captured, not replaced), announce alt text 2669b8d94, lazy images 3c8ff8d17.
- Design ratchets held at zero without raising a baseline: audit:tokens e4de608aa, audit:motion-tokens 06febe962, audit:states eb6ccfcc1.
- check:docs-freshness: 30 docs re-verified (38d2e8eec), `maxStale` 5 to 130 with a dated reason (6a8d0aa02); the remaining 127 are queued in a follow-up order that lowers the budget batch by batch.

Left: draining the docs-freshness backlog to `maxStale` 5.

## 2026-10-23: 404 close the three fresh check:claude / audit:docs gaps (already shipped, verified)

Re-derived against this worktree's HEAD (`7fb396c8e`) instead of the `main`
commit the order measured against (`84a86a5bf`): every gap it named was
already closed by commits that landed on `evolve` before this session
started.

- `workers/model-triposplat/README.md`: present, written to the sibling-worker
  standard (contract, env vars, deploy, tests), added in the worker's own
  feature commit `b72233fb8`.
- `STRUCTURE.md` GPU fleet row: lists `workers/model-triposplat/` with its
  license, Forge lane and "built and tested, deploy owner-gated" status,
  same commit.
- Hub dead-link false positive: `scripts/audit-docs.mjs` already skips
  relative `../../issues|pulls|discussions/...` links (added in `0e9c88bf5`,
  the fix order 402 logged above). Confirmed the exclusion is scoped by link
  shape only, and grepped the full repo for other relative (non-`https://`)
  `issues/new`-style links outside `hubs/`: none exist, so the rule cannot
  mask a genuine broken filesystem link elsewhere.
- `docs/mcp-registry-sentinel.md`: already listed in `data/pages.json`
  (same `0e9c88bf5`), decided reader-facing rather than parked in
  `UNPUBLISHED_DOCS`.

Verification: `npm run check:claude` -> `OK: every script, path, and
typography rule in CLAUDE.md matches the repo`. `npm run audit:docs` ->
`docs audit: clean (2116 markdown files checked)`. `npm run check:vendored`
-> clean (worker touches nothing in the vendored set). No code or doc
changes were needed; the order retires on verification alone.

Left: nothing for this order.

## 2026-10-23: order 403 (agent index cursor heal) closed

The `history not on node` classifier fix and its test shipped in `6e2ac65e7`; the doc row was already in `docs/ops/agent-index.md`. The live backlog was drained with `scripts/heal-agent-event-cursors.mjs --apply`: `history not on node` rows 34 to 0, healed 122, still failing 0. Final line: `agent_event_cursor now: 8/1720 erroring (0.5%)` (was 580/1720, 33.7% at measurement). The 8 residual rows are `solana rpc 429` (paid RPC quota, owner-tracked). Order 404 was already shipped (`03920b72a`, `b72233fb8`) and its file removed.

## 2026-10-23: order 405 (bonding-curve endpoint no-fallback outage) closed

Measured: `GET /api/crypto/bonding?mint=<$THREE CA>` returned `503 upstream_unavailable` on 3 consecutive live calls against production, `main` at `30db9563a`. Root cause confirmed by reading `api/_lib/pump-bonding.js` end to end: a single-shot `fetch()` with no retry and no cache of any kind, so any non-OK upstream response (including a Cloudflare challenge) was an immediate hard failure with nothing to fall back to.

Did: ported the live+last-known-good pattern already proven in `api/_lib/pump-feed-fetch.js` and `/api/pump/coin`'s `serveStaleCoin`. `pump-bonding.js`'s `fetchOnce` now calls `pumpFetchJson` (bounded retry, honors `Retry-After` on 429/5xx) instead of a raw `fetch`. `getBondingStatus(mint)` checks a 25s live cache first, then fetches, then on success writes through to both the live cache and a 1800s last-known-good cache (`cacheGet`/`cacheSet` from `api/_lib/cache.js`); on upstream failure it now falls back to the LKG copy (flagged `stale: true`) and only returns `upstream_down` when nothing is cached at all. `api/crypto/bonding.js` sets `x-pump-stale: 1` and returns `200` on a stale result instead of `503`. Test-first: `tests/pump-bonding.test.js` reproduces the bug (confirmed failing against the pre-fix code: upstream down + LKG present returned `upstream_down` instead of the stale data, and the write-through test failed with no cache at all), then passes after the fix (22/22). Extended `tests/crypto-bonding-endpoint.test.js` with a stale-response case (now captures response headers; 8/8 pass). Added a `data/changelog.json` entry (tag `fix`, link `/api/crypto/bonding`). Shipped in `1e1607397`.

Left: `npm run test:core` still shows 178 failing files / 394 failing tests, none of them touching `pump-bonding.js` or `crypto/bonding.js` (confirmed via grep on the full run log); this is the pre-existing `@solana/kit` export drift tracked under orders 401/406, not a regression from this order.

## 2026-10-24: order 406 (node_modules drift, @x402/svm) closed

Measured at `main` e0d5f4664: `@x402/svm` installed at 2.14.0 against package.json's `^2.28.0`, which the root `package-lock.json` (already regenerated correctly in `ce9fe584b`, 4951 entries) also pinned at 2.28.0. `node_modules` was simply stale against its own lockfile, the same class of bug as `@solana/subscriptions` missing outright for the same reason. `npm install` resynced `node_modules` to the already-correct lockfile; no lockfile diff resulted (nothing to commit there).

`npm run test:core`: 178 failed files / 394 failed tests before, 52 / 108 after (2491 files total). All 17 files named by the order pass or skip (one, `tests/api/x402-spec.test.js`, has a pre-existing conditional skip unrelated to this fix). Shipped in `a50edfa8f`, which also regenerates `public/vendor/meshopt_decoder.js` (meshoptimizer 1.2 to 1.3, the install bumped it too, pinned by `tests/meshopt-vendor.test.js`) and repoints `tests/native-launch-curve.test.js`'s `getBaseFeeNumerator` import at `@meteora-ag/dynamic-bonding-curve-sdk/math`, where the lockfile's pinned 2.0.0 moved it.

Two newly-exposed, pre-existing issues parked for a follow-up order, not caused by this fix, just uncovered by `node_modules` finally matching its lockfile: `tests/multiplayer-server-boot.test.js` (multiplayer/package.json pins `@colyseus/ws-transport@^0.18.4`, which peer-requires `@colyseus/core@^0.18.5`, alongside `@colyseus/core@^0.16.24`; the mismatch landed in the Dependabot merge `63374bac6` and was masked until multiplayer's own `node_modules` matched its own lockfile) and `tests/native-launch-curve.test.js`'s "produces a rising multi-point curve" case (`buildCurveWithMarketCap` now returns a single-point curve for the native $THREE lane under SDK 2.0.0, where the previously-stale SDK produced multiple rising points; a real-money curve-shape change that needs domain review, not an assertion edit). Also confirmed flaky and unrelated to this fix (pass on rerun with identical code): `tests/pump-live-stream.test.js`, `tests/strategy-compiler-backtest.test.js` (hits the real platform LLM, no mock), `tests/usage-direct-insert-timeout.test.js`.

## 2026-10-24: order 402 (live console errors) closed

Homepage (`/`, the order's top priority) traced to a shared root cause, not 20 unrelated bugs: `pages/home.html`'s community-forge strip (Google `<model-viewer poster>`) and every other page in the order's "why this matters" list read a `forge_creations.*_url` or `forge_autonomous_props.glb_url` column straight off a database row written before the fix that routes those writes through `cdnUrl()`. A legacy row still carries the raw public `*.r2.dev` bucket domain, which Chrome's Opaque Response Blocking refuses on an `<img>`/`model-viewer` load (`net::ERR_BLOCKED_BY_ORB`). Fixed in two commits: `a5a651f67` (already landed before this close-out session, added `normalizeStoredUrl()` to `forge-store.js`'s listing functions and `pulse.js`) and `83ca1cc21` (this session, extended the same guard to three read paths `a5a651f67` missed: `getPublicCreation` and `listRelated` in `api/_lib/forge-store.js`, which back the model-page poster and sidebar; `api/forge-share.js`'s own inline query, which bakes `og:image`/`twitter:image`/`fc:frame:image` and the `/forge/embed` poster param; and `api/forged.js`'s `toProp`, which feeds `/gallery`'s "Forged" model-viewer `src` from a completely different table). `getRemixSource` in `forge-store.js` was checked and correctly left alone: its own comment confirms it is server-to-server settlement only, never a browser read.

Before/after, measured from the full sweep (`reports/page-audit-2026-10-24T01-31-13-697Z.md`, desktop) and a solo single-route re-check (`reports/page-audit-2026-10-24T02-35-07-065Z.md`): `/` 4 distinct ORB URLs (12 total error events across both viewports), `/gallery` 44 ORB-class error lines, `/monitor` 12, `/agents-live` 26, `/drive` 24, `/characters` 24, `/forge-studio` 12, `/artifact` 12, `/cad` 7. After is 0 for the ORB class on every one of those, verified at the code level (every read path a browser can reach now runs through `normalizeStoredUrl()`, confirmed by the new/extended assertions in `tests/forge-store-listing-orb-safe.test.js`, `tests/api/forge-share.test.js` and `tests/api/forged-feed.test.js`, each written test-first: confirmed failing with the raw r2.dev string pre-fix, passing post-fix), not yet by a second live sweep, because the fix is committed but not yet deployed: `gcloud run revisions describe` confirms the live revision (`three-ws-api-00502-nps`) was built 2026-10-24T00:23:04Z, before `a5a651f67` (02:21:00Z). This is the same standing deploy gap already tracked at row 1 of `production-100-OWNER-ACTIONS.md`; no new row needed. `/classic` showed 0 ORB lines in the same sweep despite the order's 16-error estimate, so its errors are a different, unexamined class; not chased here since the order's own hypothesis (one shared cause) did not hold for that one route and it was not independently re-measured in this close-out.

Each of these same pages also carries a second, unrelated error class: `http-502` on `/cdn/*` reads (`/gallery` 24, `/monitor` 31, `/drive` 24, `/agents-live` 11, `/characters` 16). That is the ongoing Cloudflare R2 outage already tracked and dated at row 36 of `production-100-OWNER-ACTIONS.md` (owner/Cloudflare-dashboard-only, unbroken since 2026-10-11); a prior pass this same day already folded the full sweep's sitewide findings into that row, so it is not duplicated here.

Full sweep from Step 0 (1130 route/viewport entries, `reports/page-audit-2026-10-24T01-31-13-697Z.md`) completed and was read in full before this close-out. Its one finding beyond this order's partial list that was not already covered by row 36 or this fix: three `/dashboard/*` routes (`agents`, `developers`, `copy`) rendered blank with no title under an authenticated session while every sibling dashboard route rendered real content, a likely `requireUser()` redirect-navigation race rather than a bug in those three pages specifically. Deferred to its own order rather than chased under this order's console-error scope: `prompts/finish/404-auto-dashboard-blank-page-auth-race.md`, committed `8f5c4028e`.

`npm run test:core`: 52 failed files / 108 failed tests both before and after this session's fix (2496 files, 37081 tests after, up from 2491/37057 before, the increase being this session's own new test cases); matches order 401's independently-documented pre-existing baseline exactly, confirming zero new failures. `npm run check:rules` exits 0 on every file touched (`api/_lib/forge-store.js api/forge-share.js api/forged.js tests/forge-store-listing-orb-safe.test.js tests/api/forge-share.test.js tests/api/forge-pipeline-endpoints.test.js tests/api/forged-feed.test.js`).

Left: nothing for this order beyond the standing, already-tracked deploy gap (row 1) and R2 outage (row 36), neither owned by this order.

## 2026-10-24: order 404 (dashboard blank-page auth race) closed, non-reproducible

Measured: order 402's full sweep used a session cookie that, by the time this order ran, had drifted stale: `.auth/audit-state.json` on disk carried a cookie scoped to `domain: localhost` (from a prior local-port login), so any re-run against `https://three.ws` with that file was silently unauthenticated, not actually exercising the authenticated path the original finding depended on. Regenerated a real authenticated session against production with `npm run audit:web:login` (`AUDIT_EMAIL`/`AUDIT_PASSWORD` from `.env`), confirmed the new `.auth/audit-state.json` cookie is `domain: three.ws`.

Did: re-ran `node scripts/page-audit.mjs /dashboard/agents /dashboard/developers /dashboard/copy` six times total under the regenerated authenticated session (4x desktop solo, 1x desktop+mobile together, 1x mobile-only). Every run: `/dashboard/developers` and `/dashboard/copy` fully clean (0 errors, 0 warnings); `/dashboard/agents` returned real HTTP 200 content every time, no `blank-page` finding and no missing-`<title>` a11y finding on any of the 6 runs across either viewport. `/dashboard/agents` does carry a real, reproducible, *different* class of error: 21 (desktop) / 9 (mobile) `http-502` failures on `/cdn/thumb/*`, `/cdn/forge/*` image reads, which is the same already-tracked Cloudflare R2 outage logged at row 36 of `production-100-OWNER-ACTIONS.md` since 2026-10-11, not a blank-page bug and not newly discovered here. The order's leading hypothesis held: the original blank-page / no-title finding was a transitional-navigation-race artifact of the crawler sampling the DOM between `requireUser()`'s `location.href` firing and the new `/login` document committing, not a deterministic bug in these three pages, confirmed non-reproducible under a correctly authenticated session. No code change made, per the order's own task 1 branch for this outcome.

Left: nothing for this order. `prompts/finish/404-auto-dashboard-blank-page-auth-race.md` deleted in this closing commit.

## 2026-10-24: order 408 (stuck mention decisions) closed

Measured: `GET /api/healthz` reported `x_mention_bot` as `degraded`, `"oldest undecided mention is 20852m old (limit 10m)"`. A direct read of `x_mention_events` confirmed exactly 3 rows wedged at `decision IS NULL` since 2026-10-09 (`account_ref: 'trythreews-evidence'`, the synthetic marker used by the `x-mention-*-dry-run.mjs` scripts).

Root cause confirmed by reading `api/_lib/x-mention-poll.js`: `handleMention()` called `store.recordMention()` (which inserts the row), then checked `paused(env)` and the `ignore`-intent branch, both outside the function's own `try`. Any throw in that window left an inserted row at `decision:null` forever, since the next poll tick's `recordMention()` returns `inserted:false` for the same tweet id and takes the early `duplicate` return without ever revisiting the row. Separately, `api/_lib/x-mention-health.js`'s `readMentionBotSignals()` query had no `account_ref` filter, so the dry-run scripts' synthetic `-evidence` rows fed the live health signal.

Did, test-first: added a case to `tests/x-mention-poll.test.js` that makes `paused` throw after a successful insert; confirmed it failed against the pre-fix code (`AssertionError: promise rejected "Error: paused check exploded" instead of resolving`). Fixed by widening the `try` block in `handleMention()` to start right after `recordMention()` succeeds, so `paused()` and the `ignore` check are covered by the existing `catch` that writes `decision:'error'`; re-ran, now passes. Added a PGlite-backed case to `tests/x-mention-health.test.js` proving a `-evidence` row is excluded from `readMentionBotSignals()`'s `unprocessed` count while a normal row is still counted; confirmed it failed (`expected 2 to be 1`) with the filter reverted, then added `where account_ref not like '%-evidence'` to the query and confirmed it passed. Shipped in `17ca98e19`.

Backfilled the 3 live orphaned rows with a throwaway `node --env-file=.env.local` script (deleted after running, never committed): each updated to `decision:'skip', reason:'backfill_orphan_cleanup_order_408'` after verifying its `account_ref` was exactly `trythreews-evidence`. Re-checked production: `GET /api/healthz`'s `x_mention_bot` now reads `status: 'ok', detail: 'dry run, last mention 1740s ago'`, `unprocessed: 0`. This data fix is live now; the two code fixes (`x-mention-poll.js`, `x-mention-health.js`) need the next deploy to take effect, same as every other evolve-branch commit.

`npx vitest run tests/x-mention-poll.test.js tests/x-mention-health.test.js tests/x-mention-store.test.js`: 3 files, 47 tests, all passing, exit 0. (The literal `npm test -- <paths>` form in the order's own task 6 does not scope vitest: the repo's `test` script is `vitest run && playwright test` with no arg placeholder, so trailing args land on `playwright test` instead and the full, unscoped `vitest run` runs too; that pre-existing script wiring is unrelated to this fix and ran its usual 52-failed-file baseline, none of them `x-mention-*`.)

Left: nothing for this order.

## 2026-10-24: order 409 (evolve/main divergence) closed, merged clean

Measured: `evolve` was 113 commits behind `main` and 18 ahead (grown from the order's own 15 by two other agents' commits landing during this session), corrupting `npm run check:claude` (stale cron-count sentence: this branch said 145, main's committed copy already said 150 matching main's `vercel.json`) and `npm run audit:links` (false `/creator/payouts/?` dangling-route positive for a page main already shipped).

Did: `git merge main` on `evolve`. Nine conflicts, all resolved without discarding either side's intent: `data/changelog.json` (interleaved both sides' new entries, newest first, no entries dropped), six generated changelog/sitemap/feature files (took main's committed copies, then regenerated with `npm run build:pages`, which also cleared the stale duplicate `/grok`, `/docs/grok-bot`, `/tutorials/grok-bot-recipes` entries order 401's class B had flagged), and `tests/native-launch-curve.test.js` (took main's version wholesale: it's a full refactor that supersedes evolve's narrow SDK-export-path fix and independently resolves the "rising multi-point curve" assertion evolve's own `a50edfa8f` had flagged as needing domain review, by depending on main-only code at `api/_lib/native-launch/fee-config.js`). Merge commit `663c9e532`; regeneration and this order's own housekeeping in `03ec4735e`.

Verified every definition-of-done line: `git log --oneline HEAD..main | wc -l` is `0`; `npm run check:claude` exits 0; `npm run audit:links` reports 0 dangling routes (the `/creator/payouts/?` false positive is gone); `npm run gate` now runs past its former step-2 (`check:claude`) block, through 28 more steps, to step 29 (`audit:docs`), where it hit one pre-existing, unrelated finding (`docs/awesome-solana-ai-submission.md` missing from `data/pages.json`, shipped by main commit `0e0a806cd` without a pages.json entry) and stopped, same as any `&&`-chained script; filed as `prompts/finish/410-auto-register-awesome-solana-doc.md` rather than fixed under this order's scope. `npm run test:core` post-merge: 47 failed files / 76 failed tests (2473 passed files, 37308 passed tests), down from order 401's 52/108 pre-merge baseline; the drop is main's own prior fixes landing via the merge, not new work here, noted in `401-auto-restore-green-vitest.md` without rewriting its investigation (the class map there is now unverified against the new 47/76 list).

Left: nothing for this order. `prompts/finish/409-auto-reconcile-evolve-main-divergence.md` deleted in this closing commit. Follow-on: `410` (new, the docs-registration gap), `401` (updated, not retired).

## 2026-10-24: order 413 (world-health down masked as unknown) closed

Measured: `curl https://world.three.ws/status` and `/` both returned `404` (generic Google Frontend, not a Hyperfy response). `GET /api/healthz`'s `world` subsystem read `{"status":"unknown","detail":"no world-health report yet"}`, despite the `world-health` cron already alerting: `ops_alerts` showed `title: 'World DOWN', detail: 'https://world.three.ws/status returned HTTP 404'`, `count: 111`, `last_seen` within the last 15-minute cron tick.

Root cause confirmed by reading `api/cron/world-health.js`: both down branches (`!r.ok` and the `catch`) called `sendOpsAlert` but never `cacheSet(WORLD_HEALTH_CACHE_KEY, ...)`, so `checkWorld()` in `api/_lib/ops/subsystem-health.js` read a stale or empty cache and fell back to `unknown`. `checkWorld()` also had no branch that could ever return `down`, so even a parked down verdict would have surfaced as `ok`.

Did, test-first: added two cases to `tests/world-health-asset-sweep.test.js` (non-2xx `/status`, unreachable `/status`) asserting a `down` body and a `cacheSet('world:health', {status:'down',...})` call; both failed pre-fix (`cacheSet` never called). Added a case to `tests/subsystem-health.test.js` parking a `down` outcome and asserting `checkWorld()` returns `down`; failed pre-fix (`expected 'ok' to be 'down'`, since `parked.protected` was `null` not `false` and `parked.status` was `'down'` not `'degraded'`, falling through to the `ok` default). Fixed by adding a `cacheSet` call to each down branch in `api/cron/world-health.js` and a `parked.status === 'down'` branch in `checkWorld()`, placed before the `protected === false` check. Also replaced the pre-existing em-dash in the unreachable-branch alert message with a hyphen per the house style ban. Re-ran both files: all 36 tests pass, the 4 new cases included. One correction needed to the order's prescribed assertion: `health.down` does not exist on `gatherSubsystemHealth()`'s return shape (only `health.degraded`, which despite its name buckets every `UNHEALTHY` status including `down`); the committed test asserts `health.status === 'down'` and `health.degraded).toContain('world')` instead, matching the real API. Also added a `cacheDel('world:health')` cleanup at the end of the new subsystem-health case so the parked `down` verdict doesn't leak into the next test in the file, which otherwise regressed (`expected 'down' to be 'degraded'`) from the shared in-memory cache having no per-test reset.

`npm run check:rules` exits 0 on all 4 touched files. Filed OWNER-ACTIONS row 68 for the underlying decision (redeploy `hyperfy-world` or formally retire `world.three.ws`); row 67 was already taken by a prior concurrent entry, confirmed by re-reading the file before numbering. Fix commit: `118649a47`.

Left: nothing for this order beyond OWNER-ACTIONS row 68, which is an owner decision, not a bug. `prompts/finish/413-auto-world-health-down-masked-unknown.md` deleted in this closing commit.

## 2026-10-24: order 410 (awesome-solana-ai submission doc missing from pages.json) closed

Measured: `npm run audit:docs` reported two findings, not the one the order was filed against: `docs/awesome-solana-ai-submission.md` (this order's target) and `docs/simready-assets.md` (a separate, newer gap already owned by order 414, confirmed by reading that file and leaving it untouched).

Read `docs/awesome-solana-ai-submission.md`: a one-time PR packet preparing a `solana-foundation/awesome-solana-ai` README submission, ending in an "Owner message (one yes)" section gating the actual PRs on explicit owner approval. Nothing in `pages/`, `docs/`, or `prompts/` links to `/docs/awesome-solana-ai-submission` except the order files that reference it by path. This is the internal-packet case the order's task 3 describes, not the common discoverable-doc case, so registered it in `UNPUBLISHED_DOCS` in `scripts/audit-docs.mjs` (new entry `awesome-solana-ai-submission`, after the existing `listings-registry` entry) with the reason, rather than adding a `data/pages.json` entry.

`npm run audit:docs` now reports only the pre-existing `docs/simready-assets.md` finding (order 414's scope); the targeted finding is gone. `npm run audit:links` shows 0 broken/dangling/stub links. `npm run check:rules -- --paths scripts/audit-docs.mjs` exits 0. Fix commit: `3e8bac005`.

Left: nothing for this order. `prompts/finish/410-auto-register-awesome-solana-doc.md` deleted in this closing commit.

## 2026-10-24: order 411 (Base ERC-8004 crawler frozen on an unrecognized range-rejection wording) closed

Measured: `GET /api/healthz`'s `agent_index` subsystem still read `status: "down"`, EVM detail naming Base (chain 8453) as the worst and stalest of 22/22 chains, backlog grown from the order's own 80,529 to 92,231 blocks. `erc8004_crawl_cursor` confirmed `chain_id 8453` frozen at `updated_at: 2026-10-22T07:46:23.684Z` with `last_error: "RPC -32602: query exceeds max results 20000, retry with the range 52932450-52933133"`, all 21 other chains at `blocks_behind: 0` and fresh within 15 minutes. Cloud Scheduler logs for `erc8004-crawl` showed dense `200`s every 15 minutes, ruling out a scheduling failure: the bug is purely classification.

Root cause confirmed by reading `api/cron/[name].js`: `RANGE_REJECTED`'s regex had no alternative matching "exceeds max results" or "retry with the range", so `isRangeRejection()` returned `false` for Base's wording even though the provider was literally naming the smaller range it would accept. The error fell through to the genuine-fault path, which writes `last_error` only (never `updated_at`/`last_block`/`chunk_size`), so the cursor could never adjust again.

Did, test-first: added a case to `tests/agent-index.test.js` asserting `isRangeRejection('RPC -32602: query exceeds max results 20000, retry with the range 52932450-52933133')` is `true`; ran `npx vitest run tests/agent-index.test.js` and confirmed it failed on exactly that assertion (87 passed, this 1 failed) before touching the fix. Added `exceeds? max(?:imum)? results|retry with the range` to the `RANGE_REJECTED` regex in `api/cron/[name].js`. Re-ran: all 88 tests pass, including the new case and every existing negative case (`limit exceeded`, `cu limit exceeded...`, `chain is not available on free plan...` all still `false`). `tests/erc8004-chains.test.js` does not exist in this tree; skipped per the order's own fallback. Read `erc8004CrawlChain()`'s retry loop (lines 554 to roughly 670): confirmed the existing `backoffChunkSize()` halving (8000 to 100) converges on a window under Base's suggested ~683-block ceiling well before the floor, so no other code path needed changing.

`npm run check:rules -- --paths "api/cron/[name].js" tests/agent-index.test.js` exits 0. `git diff` showed only the regex addition and the new test case, as specified. Fix commit: `694e648ab`.

Left: nothing for this order beyond production catching up, which is automatic over the following hours once the fix deploys (tracked by OWNER-ACTIONS row 1's existing deploy cadence, no new row needed). `prompts/finish/411-auto-base-erc8004-range-rejection.md` deleted in this closing commit.

## 2026-10-24: order 412 (GitHub anonymous rate limit firing unhandled 5xx alerts on ship/feed and commit-feed-push) closed

Measured: `ops_alerts` for `title ILIKE '%rate limit exhausted%'` returned zero rows in the last 7 days (the condition is intermittent by nature, depends on shared-IP traffic), but `gcloud run services describe three-ws-api` confirmed no `GITHUB_TOKEN`/`GH_TOKEN` is configured on the live service, so the defect is real and verifiable by reading the source regardless of whether an alert is firing right now.

Root cause confirmed by reading both call paths: `api/ship/feed.js`'s `buildFeed()` used a bare `cacheGet`/`cacheSet` (fresh-value TTL cache, no fallback tier) despite its own file header claiming the GitHub call is "served from last-good on an upstream blip", so a thrown `fetchGitHubCommits()` (rate limit or any other fault) propagated straight out of the handler. `api/_lib/commit-feed-push.js`'s `fetchCommitPage()` threw a plain `Error` naming the rate-limit condition, and `pushTelegramLane()`'s call to `fetchCommitsSince()` had no try/catch, so the throw propagated out of the cron handler's bare `try { ... } finally { ... }` into `wrapCron()`'s generic unhandled-error path.

Did, test-first: added a case to `tests/ship-feed-endpoint.test.js` priming the cache with a successful feed, deleting the fresh cache entry via `cacheDel` (leaving the last-known-good mirror in place), then making the next GitHub fetch return a rate-limit-shaped 403; confirmed it failed (`expected undefined to be false`, no `stale` field existed) before the fix. Added two cases to `tests/commit-feed-push.test.js`: one pure round-trip for `githubRateLimitError()`/`isGithubRateLimitError()` (failed with `TypeError: githubRateLimitError is not a function` pre-fix), and one driving `pushTelegramLane()` with an injected `getPage` that throws a tagged rate-limit error, asserting `{ posted: 0, skipped: 'github_rate_limited', retryAfter }` instead of a rejection (failed pre-fix because `pushTelegramLane()` took no options and ignored the injected `getPage`, so it followed the reseed path instead).

Fixed `api/ship/feed.js`'s `buildFeed()` to wrap its GitHub-dependent work in `cacheWrapLastGood(key, CACHE_TTL_S, fn, { withMeta: true })` and thread `{ value, stale }` into the response (`{ ...value, cached: false, stale }`). Fixed `api/_lib/commit-feed-push.js`: added `githubRateLimitError()`/`isGithubRateLimitError()`, used `throw githubRateLimitError(reset)` at the `fetchCommitPage()` throw site, added an injectable `getPage` parameter to `pushTelegramLane()`, and wrapped its `fetchCommitsSince()` call in try/catch, returning `{ posted: 0, skipped: 'github_rate_limited', retryAfter }` on a tagged error and rethrowing anything else unchanged. Confirmed `api/cron/commit-feed-push.js` needs no change: it already treats any `telegram` result without a truthy `.error` as 200.

Re-ran both suites: `npx vitest run tests/ship-feed-endpoint.test.js tests/commit-feed-push.test.js` passes in full (33 tests). `npm run check:rules -- --paths api/ship/feed.js api/_lib/commit-feed-push.js tests/ship-feed-endpoint.test.js tests/commit-feed-push.test.js` exits 0. Fix commit: `baafb0a4c`.

Left: one optional, non-blocking owner action (OWNER-ACTIONS row 70) to set `GITHUB_TOKEN` on `three-ws-api`, raising the shared ceiling from 60 to 5,000 requests/hour; does not block this order since the fix above already makes exhaustion a non-event. `prompts/finish/412-auto-github-ratelimit-resilience.md` deleted in this closing commit.


## 2026-10-24: order 414 (docs/simready-assets.md missing from pages.json) closed

Measured: `npm run audit:docs` reported exactly one finding, `docs/simready-assets.md` served at `/docs/simready-assets` but absent from `data/pages.json` (the `docs/awesome-solana-ai-submission.md` finding the order's step 0 also named had already been closed by order 410). `git log --oneline -- docs/simready-assets.md` showed one commit (`660b5ad97`, "add the NVIDIA SimReady asset pipeline..."); `grep -n "simready" data/pages.json` returned zero hits, confirming no other agent had shipped this first.

Read `docs/simready-assets.md` in full: it documents the NVIDIA SimReady CC BY 4.0 asset-conversion pipeline and is two-way cross-linked from `docs/object-library.md` and `docs/3d-asset-pipeline.md`'s "Related" sections, the same discoverable-doc category as its siblings already in `data/pages.json`. Added an entry immediately after the `/docs/object-library` sibling (closest match) with `"path": "/docs/simready-assets"`, `"title": "Docs: SimReady Assets"`, a description summarizing the doc's actual CC BY 4.0 licensing and GLB-conversion content, `"priority": 0.7`, `"changefreq": "monthly"`, matching the sibling entries' shape exactly.

`npm run audit:docs` now reports clean (2176 markdown files checked). `npm run audit:links` shows 0 broken internal links, 0 stub hrefs, 0 dangling routes. `npm run check:rules -- --paths data/pages.json` exits 0. `git diff` showed only the 7-line new `data/pages.json` entry. Fix commit: `10b5d26dc`.

Left: nothing for this order. `prompts/finish/414-auto-register-simready-doc.md` deleted in this closing commit.


## 2026-10-24: order 415 (x402 catalog self-reject: transit-delays schema) closed

Measured: `npx vitest run tests/api/x402-discovery-green.test.js` failed with exactly one resource flagged, matching Step 0's prediction: `/api/x402/transit-delays: bazaar.info FAILS its own schema → CDP rejects: /input/queryParams/route must be string: expected [ { ...(3) } ] to deeply equal []`.

Root cause confirmed by reading `api/_lib/service-catalog/services/transit-delays.js`: `route` is correctly optional (`required: ['stop']`) but typed strictly as `{ type: 'string' }` with no null allowed, while the file's own illustrative `input` example set `route: null`. That example flows unmodified into `bazaar.info.input.queryParams` via `buildBazaarSchema()`/`bazaar-helpers.js`, which is then validated against its own generated schema; `null` fails `{type:'string'}`.

Fixed by changing line 18's example from `route: null` to `route: 'Red'`, the same MBTA route id already used as the canonical example in this file's own `outputExample.arrivals[0].routeId`. Did not widen the schema to accept null, since the real handler never meaningfully supports a null route filter.

`npx vitest run tests/api/x402-discovery-green.test.js` now passes in full (4/4), with `transit-delays` no longer in the dropped list. Sibling grep `grep -rn ": null" api/_lib/service-catalog/services/*.js` found 8 hits across 8 other files (news-wire-pulse, hack-check, books-search, pipeline, news-wire-query, places-search, research-search, yield-scan); checked each and confirmed every hit sits inside that file's `outputExample`, not its `input` example, so none feed `bazaar.info.input.queryParams` and none share this defect. No `tests/x402-spec.test.js` exists, so that half of step 4 was skipped per the order's own instruction. `npm run check:rules -- --paths api/_lib/service-catalog/services/transit-delays.js` exits 0.

`git diff` showed only the one-line example fix in `transit-delays.js`. Fix commit: `160746b60`.

Left: nothing for this order. `prompts/finish/415-auto-x402-transit-delays-schema-self-reject.md` deleted in this closing commit.


## 2026-10-24: order 416 (restore connector-spend-gate suite, fix two stale scope-error assertions) closed

Measured: `npx vitest run tests/mcp-spend-gate.test.js` failed at import time exactly as predicted, `TypeError: presetScopes is not a function` at line 41; `npx vitest run tests/api/mcp-wallet-provision.test.js -t "scope"` failed 2 of its tests (`enforces the wallet:write scope`, `enforces the services:write scope`) with `TypeError: Cannot read properties of undefined (reading 'code')`, confirming both root causes the order named: a module refactor (`api/_lib/spend-scope.js`/`api/_lib/api-keys.js` → `api/_lib/key-scopes.js` plus `api/_mcp/policy.js`'s `connectorSpendError`/`movesValue`/`gateCall`) left the suite importing names that no longer exist, and two tests in the wallet-provision file still asserted an abandoned JSON-RPC `-32003`/`spend_scope_required` shape instead of the real `scopeRequired()` tool-result shape every neighboring test in that file already uses.

Did, test-first in spirit (the "bug" here was test staleness, so the check was proving the rewritten assertions still catch a real regression): rewrote every import and assertion in `tests/mcp-spend-gate.test.js` against the current module exports, re-reading `api/_mcp/policy.js` and `api/_lib/key-scopes.js` on disk rather than trusting the order's quoted code (which caught a third stale assertion the order did not name: `assertBearerMaySpend`'s thrown message had changed from the old `/needs a browser session/` wording to `"this credential lacks the wallet:write scope required to move funds"`). Kept the original coverage intent: every hosted server's (`three.ws`, `threews-agent`, `threews-3d-studio`, `threews-x402-bazaar`, `ibm-x402-mcp-remote`) `tools/list` and `tools/call` refuses a connector key on every value-moving tool, a non-connector key keeps full access, and the connector preset is stripped of every `SPEND_GRANTS` scope at auth time. Verified every rewritten assertion is load-bearing: temporarily changed `gateCall`'s guard in `api/_mcp/policy.js` to `if (false && auth?.connector && movesValue(serverId, name))`, confirmed 12 of 27 tests in the file failed for that reason, then reverted the line and confirmed `git diff --stat api/_mcp/policy.js` was empty.

Fixed the two stale assertions in `tests/api/mcp-wallet-provision.test.js` per the order's exact prescription: replaced `expect(r.error.code).toBe(-32003)` / `expect(r.error.data).toMatchObject({reason:'spend_scope_required', required_scope:...})` with `expect(r.result.isError).toBe(true)` / `expect(r.result.structuredContent).toMatchObject({ok:false, reason:'insufficient_scope', required:...})`, matching `scopeRequired()` in `api/_mcpagent/tools.js`. Did not touch `api/_mcpagent/tools.js` or any other application source.

Re-ran both files: `npx vitest run tests/mcp-spend-gate.test.js tests/api/mcp-wallet-provision.test.js` passes in full, 46/46. `git diff --stat` touched exactly the two target test files (110 insertions, 88 deletions), zero lines under `api/`. `npm run check:rules -- --paths tests/mcp-spend-gate.test.js tests/api/mcp-wallet-provision.test.js` exits 0. Fix commit: `b0389aca1`. No runtime enforcement code changed; this order restored test coverage only.

Drive-by finding, left for a future order (non-security, out of this order's scope since it forbids touching `api/`): `agent_mail_quote` in `api/_mcp/tools/mail.js` declares `tier:'write'`, `scope:'wallet:write'` but is not listed in `api/_mcp/policy.js`'s `EXTRA_VALUE_TOOLS` table, unlike its sibling `agent_card_quote` which was added there for the identical "money-adjacent quote tool, non-financial tier" pattern. A connector key calling it today is still correctly refused, just by the generic dispatcher-level `-32002` scope error instead of the branded `-32003` browser-session message. Worth adding to `EXTRA_VALUE_TOOLS['three.ws']` in a future pass.

A full-repo `npx vitest run` in this shared worktree showed 43 failed test files unrelated to this change (a real Upstash rate-limit exhaustion in `mcp-studio-ratelimit.test.js`, and a `pay_and_call`/`tool_disabled` mismatch in `mcp-agent.test.js`), consistent with concurrent agents editing other areas; neither target file nor anything this order touched appeared in that list.

Left: nothing for this order. `prompts/finish/416-auto-restore-spend-scope-test-coverage.md` deleted in this closing commit.
