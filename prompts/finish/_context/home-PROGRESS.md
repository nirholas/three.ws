# home/: cross-chat handoff log

The only memory between sessions for the three.ws Home campaign. Every agent that finishes an
order appends to it, in the same commit that deletes the order file. Read
[00-CONTEXT.md](home-00-CONTEXT.md) for the campaign's shared facts; this file is history, not
architecture.

**Append, never rewrite.** Someone else's entry is their evidence, not your draft.

---

## Format

One section per finished order, newest at the bottom:

```
## <order number>. <title> (<UTC date>)

**Shipped:** what now exists that did not before, in one paragraph.
**Measured:** the numbers, with how they were read.
**Deviations:** anything in the order file that was wrong, and what it was changed to.
**Left open:** anything not done, who owns it, and why. "Nothing" is a valid answer.
**Commits:** the SHAs.
```

---

## Campaign state

| Order | State | Finished |
|---|---|---|
| 00 CONTEXT | shared facts | n/a |
| 01 connection store | done | 2026-09-03 |
| 02 bridge runtime | done | 2026-09-03 |
| 03 API surface | done | 2026-09-03 |
| 04 agent tools | done | 2026-09-09 |
| 05 connect flow | done | 2026-09-09 |
| 06 3D home scene | done | 2026-09-09 |
| 07 floorplan editor | done | 2026-09-09 |
| 08 voice loop | done | 2026-09-09 |
| 09 Wyoming satellite | done | 2026-09-09 |
| 10 add-on relay | done, publish + deploy owner-gated | 2026-09-09 |
| 11 security | done | 2026-09-09 |
| 12 households and RBAC | done | 2026-09-03 |
| 13 observability | done, Cloud Scheduler job owner-gated | 2026-09-03 |
| 14 reliability and scale | done | 2026-09-09 |
| 15 privacy and retention | done | 2026-09-03 |
| 16 test program | done | 2026-09-09 |
| 17 a11y, i18n, mobile | done, retired (screen-reader transcript not producible here, asserted mechanically) | 2026-09-29 |
| 18 docs and SDK | docs done, npm publish owner-gated | 2026-09-03 |
| 19 plans and entitlements | built and verified, browser journeys green, price owner-gated | 2026-09-09 |
| 20 launch readiness | standing | |
| 21 Matter direct | done, documented negative | 2026-09-03 |

Update the row in the same commit that retires the order. The directory shrinking is the real
ledger; this table is the readable one.

---

## Before the campaign

**2026-09-02.** The investigation and the client library landed ahead of the campaign, in commits
`480d8d7db` and `f54b124df`:

- [`docs/smart-home.md`](../../docs/smart-home.md): the open-source landscape measured from the
  GitHub API, the decision to write zero device code, the reachability constraint, and the
  verification table.
- [`packages/home-bridge/`](../../packages/home-bridge): the client library, 36 tests, verified
  against a real Home Assistant (docker `stable`, demo integration, 122 entities).
- The finding that shapes the whole campaign: Home Assistant's `intent__HassTurnOff` performs an
  **unlock** on a lock, confirmed live with a lock exposed to Assist. The gate exists because of
  it.

Nothing of that is wired into the product. Order 01 is the first order that changes that.

**Older entries:** [home-PROGRESS-archive-1.md](home-PROGRESS-archive-1.md) (2026-09-03 to 2026-09-03), [home-PROGRESS-archive-2.md](home-PROGRESS-archive-2.md) (2026-09-03 to 2026-09-09), [home-PROGRESS-archive-3.md](home-PROGRESS-archive-3.md) (2026-09-09 to 2026-09-09), [home-PROGRESS-archive-4.md](home-PROGRESS-archive-4.md) (2026-09-09 to 2026-09-09), [home-PROGRESS-archive-5.md](home-PROGRESS-archive-5.md) (2026-09-09 to 2026-09-09). They were moved there verbatim on 2026-11-10 to keep every file under the 50,000-character limit; search them too when you need history.

---

## 06. The live 3D home (2026-09-09)

**Shipped:** the order's build was already on disk when this session opened (`src/home/scene-model.js`,
`scene-render.js`, `scene-fallback.js`, `scene.js`, `pages/home-scene.html`, both routes,
`docs/home-scene.md`, a `STRUCTURE.md` row, 27 unit tests and 6 e2e journeys), built by an earlier
session whose entry never landed. This session verified every claim of it against a real Home
Assistant, produced the evidence the order asks for, and closed the three gaps that verification
found:

1. **The body standing in the house is now the visitor's own agent.** It was always the platform
   default, while the walk world, `/play` and the voice satellite all showed the person's real
   avatar. It now reads the same canonical `my agent` record (`src/agents/active-agent.js`),
   swaps live when they switch agents in another tab, and falls back to the platform body for
   somebody with no agent, no avatar, or a private avatar (which publishes no model URL by
   design). Resolved after the first frame, so the house never waits on it.
2. **Disconnecting a home now reaches the screens showing it.** `closeHome` closed the pooled
   bridge and dropped its subscribers silently, and the SSE stream kept heartbeating, so a
   display left open on a disconnected home sat on a green **Live** badge over that house
   indefinitely. Measured: still "Live" and still drawing 5 rooms 180 s after `DELETE /api/home/:id`
   returned 200. `closeEntry` now hands every open stream a final `revoked` status with the
   sentence explaining it, the stream sends that frame and hangs up, and the client stops
   reconnecting on it.
3. **The explanation a disconnect carries no longer gets overwritten.** The stream's own close
   arrives right behind the frame that explains it, and `openStream`'s error handler was
   reporting the intermediate `reconnecting` and then a bare `disconnected`, which blanked the
   pill's title and announced the generic "the connection dropped" instead of the real reason.

**Measured** (all against Home Assistant 2026.9.0 in a container, `docs/home-scene.md`'s own
harness `scripts/measure-home-scene.mjs`, on a 16-core Codespace shared with about ten concurrent
agents, load average 58 to 112 throughout, and a **software rasterizer**, which is the caveat on
every rendering number below):

- **A real light changing in Home Assistant reaches the painted frame in 282 ms median, 404 ms
  worst of six** (best isolated single measurement: 342 ms). The page's own half of that, SSE
  frame to painted frame, is **13.5 ms median**, which matches the 10 to 23 ms the doc already
  claimed.
- **Heap over ten minutes and 150 real device changes: 30.06 MB to 30.63 MB, +0.57 MB**, with
  object, geometry and texture counts identical at every one of the eleven samples. Each sample
  is taken after a forced `HeapProfiler.collectGarbage`, so it is retained memory. Flat.
- **Per-frame work 0.1 ms (desktop) and 0.2 ms (CPU-throttled 4x at 390 px), render 2.5 ms and
  30.4 ms, 96 draw calls, 30 objects, 5 rooms.** The frame RATE could not be honestly measured
  here: headless Chromium on swiftshader under this load reports 3 fps desktop and 2 fps mobile
  while spending 2.5 ms per frame, which is a measurement of the box, not the page. Reported as
  unmeasured rather than dressed up.
- **Cold paint: first contentful paint 204 ms, DOM content loaded 215 ms, navigation to a drawn
  house 3291 ms** through a Vite dev server on that same box. FCP meets the order's 2.5 s budget;
  the drawn-house figure is dev-server plus load and is not a production number.
- **Both routes serve the scene**: `/smart-home/:id` and `/home/:id`, 200 each.
- **All ten states captured as screenshots**, plus a seven-frame sequence of a real light coming
  on at 150 ms intervals, and an eleventh of the agent's own body. Loading, empty, nothing in a
  room, live, stale, disconnected, acting, confirmation pending, no WebGL, error.
- **The guarded confirmation is real**: asked to unlock `lock.front_door`, the page rendered
  "OPENS YOUR HOME / unlock Front Door? / cannot be safely undone remotely" pinned to the door in
  the scene, and Home Assistant still reported that lock `locked` while the question stood.
- **The own-agent body is proven by the network, not by pixels**: with an avatar attached to the
  QA account's agent the page fetched only that GLB and never `/avatars/default.glb`; with the
  avatar detached it fetched the default. Both through the real `/api/agents/me` and
  `PUT /api/agents/:id`.
- **Tests:** `tests/e2e/home-scene.spec.js` **7 passed** (the six that existed, plus a new
  journey for the disconnect fix), `tests/home-scene-model.test.js` 27 passed, and
  `home-runtime`, `api-home-contract`, `api-home`, `home-store`, `home-tenant-health`
  172 passed / 27 skipped. `npm run check:rules` clean on every file touched.

**Deviations from the order file, all verified against the running product:**

- The page's address is `/smart-home/:id`; `/home/:id` is a second route to the same page, not
  the primary one. The order says `/home/:id` throughout.
- "Empty house: connected but zero entities" is harder to reach than the order assumes. Home
  Assistant 2026.9 onboarding creates three default areas and six config entries, so a bare
  instance is neither empty nor unfiled: it renders 10 entities across 4 rooms. Both states were
  produced honestly, by deleting the areas (state 3) and then every config entry (state 2).
- "Disconnected: distinct from stale" was reachable in fewer ways than the order implies. A
  stopped house is `unreachable`, which is **stale** by design and correctly so. Taking the
  browser offline does not reach it either: an already-established EventSource keeps delivering,
  so the page is right to say live. Revoking the house token does not reach it within 11 minutes
  either (see below). What reaches it is a revoked connection, which is what the fix above made
  work.
- The order's `--bare-stack` path in the measurement harness expected an overlay heading on any
  bare instance and timed out on one that has default areas. Fixed, along with two other harness
  bugs the run found: object selection now falls back to the room rail (which requires focusing
  the room first, since the rail lists devices for the focused room only), and the disconnected
  capture stopped waiting 300 s for a state a stopped container cannot produce and now revokes
  the connection instead, which is the run's own cleanup step and the only thing that does
  produce it. One command now captures eight of the ten states; the two empty-house states still
  need the second, bare instance.

**Left open, with owners:**

1. **A revoked Home Assistant token is reported as "unreachable" forever, never as "sign in
   again".** Measured: minted a throwaway house token, connected a home with it, revoked it in
   Home Assistant, restarted the house, and watched the pill for **11 minutes 30 seconds**. It
   stayed **Stale** the whole time. The cause is in the runtime, not the page:
   `wireEvents` maps the bridge's own `disconnected` event to `UNREACHABLE` regardless of why,
   and the auth-coded `error` event beside it is only logged. `onConnectFailure` does classify
   `ERR.AUTH` correctly, but it only runs for a fresh `acquire`, not for a reconnect inside a
   live pool entry. The user is told to check their network when what they need is a new token.
   **Owner: order 02.** Not fixed here: it is a reconnect-loop change inside
   `home-assistant-js-websocket`'s own retry, in a file this lane's peers are actively editing,
   and each verification cycle costs 12 minutes.
2. **Frame rate is unmeasured on real hardware.** Everything on this machine is software
   rendered. **Owner: order 16**, which should take it on a real GPU and a real phone.
3. `/api/agents/me` answers 500 on a deployment without `S3_PUBLIC_DOMAIN` (it is set in
   production). The scene degrades correctly to the default body, so this is a note, not a
   blocker.

**Commits:** `ea3345a13` (the agent body, committed by a peer's sweep under an accurate message
they wrote from the diff), plus this one.

---

**Addendum, 2026-09-09, a later session: order 19 re-verified at HEAD, and the price decision turns
out to be narrower than the entry above assumed.**

The order's own retirement clause keeps `313-home-19-plans-entitlements.md` on disk while the price
is outstanding, so this run re-proved the acceptance evidence at `362f5a01e` rather than trusting
the record, and re-derived what the owner is actually being asked.

- **The most important line reproduces.** `tests/home-turn-gate.test.js` against a fresh real Home
  Assistant 2026.9.0 (`plan19c`, its own container): **24 passed, 0 skipped**, live block included.
  Over quota and on a paused home, `lock.lock` (3819ms), `cover.close_cover` (1667ms) and
  `alarm_control_panel.alarm_arm_away` (1664ms) each ran and the device moved, asserted by reading
  the state back out of the house; in the same moment an ordinary action and the unsafe direction
  of a safety domain were both still refused. `tests/home-entitlements.test.js` +
  `tests/home-turn-gate.test.js` together: **73 passed** with `DATABASE_URL` set, matching the 55 +
  18 recorded above.
- **The browser evidence had to be regenerated and now exists again.** `test-results/` is transient
  and a later Playwright run had cleared both PNGs, so the screenshot line of the Definition of Done
  was unbacked at HEAD even though it had once been met. Re-ran the documented command against a
  real API on :8171, a real Vite on :3031 and the live house: **2 passed (33.5s)**.
  `home-plan-quotas.png` shows all seven dimensions with real usage (`Connected homes 1 of 25`), the
  real reset date (`Monthly allowances reset on October 1`), the per-account override rendered as
  "This account has agreed limits" naming the three dimensions it raises, and both commitments under
  "What a limit can never do". `home-plan-paused.png` shows the paused row kept and badged, reading
  "You paused this home to make room for another one.", `Open` disabled, "Make live" offered, and
  `Connected homes` recounted to `0 of 25`. The override is visible in both: a free tier whose
  proposed ceiling is 1 home is running at 25 with no code change.
- **The finding: Pro is already priced, so the owner is not being asked to invent a number.**
  `pages/pricing.html` has sold Pro at **$49/mo, $480/yr** as a fixed marketing figure since before
  this lane existed. The order and the entry above both framed the open question as "the price",
  which overstates it. What is genuinely undecided is (a) the seven limit numbers and (b) whether the
  home lane is inside the existing Pro or sold beside it.
- **The gap that finding exposes: `/pricing` says nothing about the home lane.** Zero matches for
  smart home, Home Assistant or connected home on that page, and it is exactly where the quota
  refusal sends people (`upgradePath = '/pricing'` at `api/_lib/home/entitlements.js:596,673`, and
  the plan page's "See plans" button). Today a user refused at the home ceiling lands on a page that
  never mentions homes. Deliberately not fixed here: adding those rows publishes the limit numbers,
  which is the decision this order was never allowed to make. It is the concrete work that lands
  with the approval, and it is one page.

Nothing in the mechanism changed this session; no code was touched. `313-home-19-plans-entitlements.md`
stays on disk, still on the one outstanding owner action.


## 20. Launch readiness, run 4 (2026-09-09)

**Verdict: NO-GO**, on three inputs, one of which is new and is the reason this run was worth
taking: a house whose container has been stopped can keep reading **"Live, updated moments ago"**
on `/smart-home` for at least sixty seconds. Run 3's list is otherwise much shorter than it was.

**Why this run reached verdicts run 3 could not:** the machine was quiet. Run 3 measured load 68
to 124 and marked nine lines explicitly unverified because of it. This run started at load 1.0.
Three of run 3's unreachable checks are now green, and its two open findings that this order owns
are fixed here.

**Closed since run 3:**

- **Finding 3 (the a11y suite could not reach a verdict).** `tests/e2e/home-a11y.spec.js` is
  **15/15**, twice: axe on the 3D house, the flat house and the floorplan editor, the keyboard-only
  walk, the polite and assertive live regions, colour-independence, measured stale contrast, the
  four breakpoints, the 44px floor on a real touch context, Fahrenheit, RTL, untranslated device
  names, reduced motion, and the stray-tap-proof confirmation. The `color-contrast` node on
  `button[aria-current="true"] > .hs-room-meta` that run 3 could not explain does not reproduce; it
  was fixed in `c79ab3ecd` and run 3 was reading a contended machine.
- **Finding 2 (the three alerts had never been fired in a test).** `api/cron/home-health-alert.js`
  had no test anywhere. `tests/cron-home-health-alert.test.js` now drives the real cron: **9/9**. A
  single unconfirmed guarded action pages at critical with a signature that carries the newest
  violation timestamp, so a second incident an hour later cannot be swallowed as a repeat; nine
  dark houses stay silent while fifteen page and then re-escalate on the twelfth tick rather than
  every five minutes; recovery fires once, at info; a leak names its climbing samples and excludes
  the healthy instance; all three fire on one tick with three distinct signatures; and a grant the
  user revoked afterwards reports without paging (`d063a6f86`).
- **Finding 5 (the post-launch watch table was not in the runbook).** Written into
  `docs/ops/home-operations.md`, hour 0/1/6/24/48, each row a command rather than a feeling, plus
  the two notes that matter more than the table: an hour-24 p95 over fewer than twenty timed
  actions is a sample and not a verdict, and a quiet alert channel is not proof the alerts work
  (`d063a6f86`).
- **Order 19's browser gap.** Its two queued journeys had never executed. `home-plan.spec.js` is
  **2/2** against a real house: every quota with its reset date before any is hit, and a paused
  home shown as paused, keeping its row, and swapped back. Order 19's Definition of Done now has
  only the owner's price left on it.
- **Run 3's check 4 (the injection proof).** **121/121, zero skipped**, in 197 s, against a real
  Home Assistant 2026.9.0 (`go20d`), the live database and a real model chain. Run 3 got 120/121
  with the injection check failing on exhausted free rungs. The check cannot pass on an outage:
  `modelAnswered > 0` and `attempted.length > 0` are hard assertions before the physical one, so
  a green here means real model turns really ran against a really poisoned house and the deadbolt
  really stayed locked.

**Measured, safety and correctness:**

- **Confirmation integrity.** The order's raw query returns **2**; the shipped invariant (grant
  backed and scrub marked excluded) returns **0**. Both rows are lawful and this run traced them
  rather than accepting run 3's word: action 122 `grant.create` (confirmed), 123 `lock.unlock`
  allowed by that grant, 125 `grant.revoke` (confirmed), 126 refused. `home_entity_grants` has no
  `revoked_at` column, so revoking hard-deletes the row and a lawful historical action is left
  claiming a grant that no longer exists. That is what `integrity.grantBackedWithoutGrant = 1`
  means, it is documented at `docs/ops/home-operations.md` step 4, nothing pages on it, and
  `tests/home-integrity.test.js` already covers the case. Production's own `integrity.violations`
  is **0** across three samples.
- **No home tool exposes `confirmed`.** All five `HOME_TOOL_DEFS` walked recursively: zero
  `confirm*` keys. Walked the whole public MCP catalog too, 61 tools: the only `confirm*` key
  anywhere is `delete_avatar.confirm`, a different lane with no actuator behind it.
- **The home live tier**, 10 files sharing one real house: **305 passed, 5 skipped, 0 failed**.
- **Privacy inventory re-derived from the live schema:** 11 `home_*` tables exist,
  `api/_lib/home/privacy.js` names all **11**, zero uncovered. Every `%state%`/`%entity%`/
  `%attribute%` column across them holds entity ids or scopes, never a value or a reading.

**Measured, the build:**

- **Full vitest, sharded into quarters, all four green: 29,506 passed, 175 skipped, 0 failed,
  every shard exit 0.** Shard 1 first ran at an older HEAD while the live tier was running and
  reported 15 failures; re-run alone at HEAD it is 510 files passed, 0 failed. Every one of the 15
  was load or a peer's in-flight state.
- `npm run gate` exit 0. `npm run check:claude` OK. `npm run audit:docs` clean (1593 files).
  `npm run check:home-matrix` OK. `npm run check:cron-syntax` OK, 117 crons matching CLAUDE.md.
  `npm run db:status`: all applied.
- `npm run check:rules -- --base 2849cafb6 --head HEAD`: clean, 464 changed files.
  `node scripts/check-secrets.mjs` same range: clean, 19,420 tracked, 576 changed.
- `npm run smoke:prod`: 810 of 816 pages live; **all 17 home routes reachable**. The 6 misses are
  other lanes' undeployed pages (`/fade`, `/globe`, three `/docs/*`, `/docs/trader-card-embed`).
- **deploy-preflight subagent: SAFE.** build:gcp 13/13 in CLAUDE.md's order, 32/32 cloudbuild
  configs pin a real SA, check:gcloudignore clean over 16,328 files with all 2,424 runtime imports
  present, 0 pending and 0 drifted migrations, 0 unbacked route dests, purge still synchronous. The
  nine orphaned migration rows run 3 found are still nine and are now explained: five are traceable
  to the commit that deleted the file after it applied, four predate the current migrations path.
  Ledger residue, not a schema gap, and re-adding files to match would re-apply them.

**Measured, production** (revision `three-ws-api-00420-ljh`, commit `880bdcef8`, 356 commits
behind this checkout):

- The `home` subsystem is **`degraded`**, on latency alone, across three samples 50 s apart.
- **p95 our-leg action latency 2013 ms against a 1.5 s SLO**, identical across all three samples
  and within 1 ms of run 3's 2012 ms a day earlier. It is measured over **3 timed actions**, because
  7 of the window's 15 actions were refusals and a refusal never reaches the timing. Reproducible
  across two days on a small sample, so it is a real signal and not yet a 30-day verdict.
- Action success 100%, handshakes 100%, integrity violations 0, leak false, 37/47 homes connected.

**Fixed here, beyond the two findings above:**

1. **`deploy:gcp` submitted past two of the runbook's own gates.** CLAUDE.md offers
   `npm run deploy:gcp:full` as the whole runbook in one command; it routes through `deploy:gcp`,
   which carried its own copy of the `gcloud builds submit` line gated only by `check:dist`,
   `check:pages` and `db:check`. Step 3 also requires `check:gcloudignore` and `audit:deploy`, and
   `check:gcloudignore` is the gate that exists because an omitted `services/home-relay/src/token.js`
   (this lane's file) shipped revision 00412 answering every request with `ERR_MODULE_NOT_FOUND`.
   Taking the documented shortcut skipped exactly the check that catches that. `deploy:gcp` now
   calls `deploy:gcp:submit` instead of repeating it, so there is one submit definition and the two
   entry points cannot drift (`efe9c3b3a`).
2. **A spent connect budget blocked a disconnect.** `DELETE /api/home/:id` spent `homeConnect`, ten
   in ten minutes, shared with `POST /api/home` and the relay pairing call. That bucket exists
   because the connect body carries a Home Assistant token and is the credential-stuffing surface;
   a revoke carries no token and can stuff nothing. Sharing meant the budget ran out exactly when
   someone had been fumbling a token, and the answer to "disconnect this house" became "too many
   connection changes, wait a moment" for up to ten minutes. Being unable to cut our access to your
   own building inverts this lane's rule that a move toward safety always goes through. Revoking has
   its own bucket now, 30 in 10 minutes, still not local. Found by `home-scene.spec.js` taking a
   real 429 from a real server; that spec is **7/7** after the fix. `tests/home-revoke-limit.test.js`
   pins the split, and the contract suite's limiter mock, which listed buckets by hand and would
   have failed this change as a phantom handler bug, now materialises any bucket a route reaches
   for (`3f97e2078`).

**Blocking findings:**

1. **A stopped house keeps reading "Live, updated moments ago" for at least 60 seconds.** This is
   new and it is the reason for the no-go. `tests/e2e/home-connect-live.spec.js:190` stops the real
   container and expects the card to say it is not answering. It **passes in isolation (2 of 2
   runs) and fails in the full tier (3 of 3 runs)**. The difference is a warm pool: a cold
   `acquire` re-handshakes and fails instantly, a warm one answers the read off the bridge it
   already holds. The spec now polls the product's own documented bound instead of Playwright's
   default 5 s (`#startLiveness` in `packages/home-bridge/src/bridge.js` pings every 10 s with a
   5 s deadline, so 15 s worst case) and **still fails after 60 s of active polling**, with the
   page snapshot showing the card reading "Live, updated moments ago." for a container confirmed
   stopped. Ruled out on the way: the harness really does stop the container (reproduced by hand),
   the published port survives a stop/start, `workers` is 1 so no two specs race, and
   `stopHomeInstance` throws rather than silently skipping. This is the wall-display failure the
   lane names as its worst, solved for revoke in `8956a5095` and open for unreachable.
   **Owner: order 02 (bridge runtime) with order 14 (reliability); not fixable inside a go/no-go.**
2. **`npm run i18n:lint` fails with 49,379 problems**, of which **30,150** are this lane's, counted
   today by namespace: `home_scene` 9,336, `home_connect` 6,216, `home_manage` 5,964,
   `home_floorplan` 5,376, `home_voice` 2,940, `home_plan` 114, `home_join` 108, `home_satellite`
   96. `en.json` carries every namespace, so this is a translation gap and not a source gap.
   **Owner: order 17**, which is open, and the action is the owner's: `gcloud auth login`, then
   `GOOGLE_CLOUD_PROJECT=aerial-vehicle-466722-p5 npm run i18n:translate`.
3. **Two lane orders are still on disk**: `311-home-17-a11y-i18n-mobile.md` and
   `313-home-19-plans-entitlements.md`. Order 20 runs after the campaign is retired, so an open
   order is a no-go input by definition. Both are now down to a single owner action each: the
   translation run for 17, the price for 19.

**Accepted residuals, named rather than hidden:**

- The p95 breach above. Real and reproducible, but three timed actions is not a 30-day verdict and
  the 30-day figure needs the production database, which needs gcloud.
- `npm run check:docs-search` reports the local index stale. **Not this lane's:** rebuilt in a
  throwaway worktree at my own commit it is byte-identical and reports current, so the staleness is
  a peer's uncommitted `docs/ibm.md`, `docs/ops/gcp-production.md`,
  `docs/ops/production-log-triage.md` and untracked `docs/partners/ibm-partner-plus.md`.
- The nine orphaned migration rows. Explained above, disaster-recovery hygiene, outside this
  campaign.
- `/api/agents/me` throwing `Missing required env var: S3_PUBLIC_DOMAIN` in every local e2e server
  log. Order 17 already recorded it; it is the nav's agent widget, not this lane.

**Explicitly unverified, never marked green:** `npm run audit:web` authed against every home route,
the order 14 chaos scenarios, a ten-minute flat-heap session, ten consecutive runs of the lane's
suites (order 16 recorded ten; this run did not repeat them), the rollback walk, the live
`check:cron-drift`, and the 30-day p95. The last four are one environmental cause: **gcloud auth in
this Codespace is dead** (`Reauthentication failed: cannot prompt during non-interactive
execution`), which also blocks the production `DATABASE_URL` and the translation run. The rollback
commands are recorded in this order's report from `docs/ops/gcp-production.md:284` so the owner can
run them without hunting.

**Left open:** the campaign. Re-run this when orders 17 and 19 are retired and blocking finding 1
is closed.
**Commits:** `d063a6f86`, `efe9c3b3a`, `3f97e2078`, `b42d86c51` (the spec change, swept into a
peer's commit), plus this entry.

## 2026-09-10 | order 20 blocking finding 1 | ROOT-CAUSED AND FIXED

The "Live, updated moments ago" over a stopped house is fixed (`a9b725221`). It was not a
timing or a pool-warmth problem in the way run 4 framed it; the warm pool was the condition
that EXPOSED it, not the cause.

**Cause.** `home_connections.status` had exactly two writers, `onConnectSuccess` and
`onConnectFailure` in `api/_lib/home/runtime.js`, and both run only inside the initial
`entry.ready` promise. A warm `acquire()` never re-enters that path: it finds the pooled entry,
awaits an already-resolved `ready`, and returns the bridge. The bridge's liveness ping DID
notice the house was gone and DID emit `disconnected`, and `wireEvents` handled it, but only in
memory (`entry.stale`, `entry.status`) plus a `notify()` to live subscribers. Nothing wrote the
row. `/api/home` and `isDegraded` in `src/home/manage.js` both read the row, so the card kept
reporting `connected` with its old `last_ok_at` and no `last_error_at`, forever.

That is exactly why it passed in isolation and failed in the full tier: a cold pool re-handshakes,
`onConnectFailure` fires, and the row flips in seconds. It was never flaky.

**Fix.** A `persistStatus(entry, status, detail)` helper writes transitions through from the
bridge's own lifecycle events, both directions, skipping a write when the stored status already
matches so a flapping house does not buy a round trip per event. Both drop paths are covered
because the library's own `disconnected` event and the liveness ping's failure are the same
`#emit('disconnected')` (`packages/home-bridge/src/bridge.js:174` and `#startLiveness`).

**Tests.** Three in `tests/home-runtime.test.js`, and the first was confirmed to FAIL with the
fix removed rather than assumed to cover it. The recovery test asserts a NEW write (length + 1)
rather than the last row's status, because asserting only the status passes even with the
recovery path missing: `onConnectSuccess` already stored `connected`.

**Left open:** the campaign, still. This clears blocking finding 1 only. Findings 2 (order 17's
translation) and 3 (orders 17 and 19 open) stand, and order 20 cannot be re-run until they are
retired. The e2e spec has NOT been re-run against a live container from this session.

## 17. Accessibility, 87 locales, mobile and PWA: retired (2026-09-29)

**Shipped:** the last open line of order 17 is closed and the order file is deleted. `npm run
i18n:lint` passes on all 84 catalogs, `public/locales/manifest.json` lists all 85 languages, and
`tests/e2e/home-a11y.spec.js` passes 15/15 with the `publishLocale` manifest mock gone
(`b81fa6d78`): the RTL and never-translate tests now reach Arabic through the real manifest and
the committed `ar.json`, nothing routed. The lint had regressed after `afdf6ea12` made it clean:
`c8f2cde3c` and `5abee605c` added 37 English keys (airdrop checker, contributors, derivatives) and
brought only `es` up to date, so it failed with 3,071 missing keys and the completeness gate cut
the switcher to English alone, which also broke the RTL test. The 37 keys were filled in the
other 83 locales on the NVIDIA lane (`a96e7e591`, `2af205a16`; additive only, 2,590 keys added
in the last commit, 0 changed, 0 removed). Vertex still answers `403` in this workspace; Groq and
the OpenRouter free model were tried as extra lanes and both throttled, so NVIDIA alone did it,
two processes, about 75 minutes.

Three things stood between the order and a green run, each fixed at the root:

1. **The lane could not boot.** Vite's watcher tried to watch the ~250,000 files in the nested
   agent checkouts under `.claude/worktrees/` and died with `ENOSPC: System limit for number of
   file watchers reached`, killing the API proxy mid global setup. It skips them now
   (`577c786c0`), and a server with hot reload off (every e2e run) does not watch at all
   (`f2c8ac2ff`), because the editor's own watcher holds about 430,000 of the 524,288 inotify
   watches on this box. The main Playwright config sets `VITE_NO_HMR` for the server it starts.
2. **Every connect was refused.** Since `433581f82` secret-box binds the database to the key that
   writes into it, and the lane's per-run random `WALLET_ENCRYPTION_KEY` is not that key, so each
   connect died on `SecretBoxKeyMismatchError`. The run now takes the bound key through
   `HOME_E2E_ENC_KEY`, and the global setup compares the one-way fingerprints before anything
   boots and names the command when they differ (`e179f36a7`, documented in
   `tests/e2e/README.md`). The fingerprint of the Cloud Run service's key matches the binding
   (`bound_at 2026-09-16T16:31:20Z`); a random key does not.
3. **Two site-wide axe failures** on pages outside this lane: `/three-launchpad` fact labels at
   4.32:1 (translucent tiles over the `--stroke` grid) and `/prompts` chip counts at 3.29:1
   (`opacity: 0.7`). Both fixed to AA (`7df581bec`), measured with axe before and after.

**Measured** (the recipe, so nobody re-derives it):

    HOME_E2E_ENC_KEY="$(node scripts/read-service-env.mjs '^WALLET_ENCRYPTION_KEY$' --raw)" \
      HOME_LIVE=1 HOME_LIVE_NAME=a11y17 HOME_E2E_API_PORT=8188 HOME_E2E_WEB_PORT=3088 \
      HOME_E2E_SCREENSHOTS=1 npm run test:home:e2e -- tests/e2e/home-a11y.spec.js

- `home-a11y.spec.js`: **15 passed** twice (59.0s, then 1.2m on the final catalog), against Home
  Assistant 2026.9.4. Screenshots of every test, including the Arabic house read through the real
  manifest, are in `test-results/home-a11y-*` on this machine and reproducible with the flag above.
- The whole home lane (`npm run test:home:e2e`, 11 specs, 81 tests): **74 passed, 1 failed, 6
  did not run** in one invocation. The failure is the product's connect limiter (`homeConnect`,
  10 per 10 minutes per user): the page says "too many connection attempts, wait a moment" at the
  first `home-scene` connect, after ten earlier specs had connected on the same account. Re-run on its own after the
  window, `home-scene.spec.js` + `home-whose-fault.spec.js`: **11 passed**. So every one of the 81
  passes; the lane just cannot run end to end in one invocation on one account.
- `tests/e2e/a11y-top-pages.spec.js`: 46/48 before the contrast fix, **48 passed** after, all six
  home routes green both times.
- The rest of `tests/e2e/` under `playwright.config.js` (the 216 non-axe tests): **199 passed, 8
  failed, 5 skipped, 3 did not run.** Baseline at `b81fa6d78^` in a throwaway worktree, same four
  specs: 7 of the 8 fail identically there (`crews-hq` directory console 503, `launch-coin-page`
  x3, `launch-token-flow` x2, `play-photo-mode` webkit with no webkit browser installed). The 8th,
  `crews-hq` "service is unreachable", passed 3 of 3 re-runs at HEAD on its own; it failed only
  under the full concurrent run's load. **No new failures.** It could not have been otherwise
  for that config: `b81fa6d78` touched only `home-a11y.spec.js`, which `playwright.config.js`
  ignores as a live home spec.
- `npm run i18n:lint`: `✓` on all 84 locales at 19,968 keys each, `i18n lint passed.`
- `npx vitest run tests/i18n-markup.test.js tests/i18n.test.js tests/i18n-missing-key.test.js`:
  56/56. `npm run i18n:home`: 353 keys, 0 missing, 0 drifted.
- `npm run check:rules -- --paths <each file>`: clean for every file above.

**Definition of done, line by line:** axe on every home route (tests 1 and 2 plus the six routes
in the site gate); keyboard-only walk (test 3); the 2D fallback operable and in control
(`home-scene` "a browser with no WebGL gets a house it can read and operate"); reduced motion
(test 13); stale contrast measured (test 7); lint clean; entity names untouched in two locales
(test 12); Fahrenheit (test 10); RTL (test 11); four breakpoints (test 8); stray tap (test 14);
e2e with no new failures; check:rules clean. **The one exception, unchanged from the entry above
and never claimed:** no VoiceOver or NVDA exists in this environment, so there is no
screen-reader transcript. What is proved instead, mechanically, is tests 4 and 5: the assertive
region carries the whole confirmation question and clears once it is answered, the polite region
narrates a light going on with the device named.

**Deviations:** none from the order. Two references to the order file were rewritten to name the
campaign and order (`home-00-CONTEXT.md`, `prompts/codex/02-i18n-lint-clean.md`). Two were left
on purpose: `00-RETIRED-BY-OWNER.md` lists the filename as the argument to its own `git show`
recovery command, and the order 20 entry above is history in an append-only file.

**Left open, not this order's:**

1. The home lane trips its own connect limiter when all 11 specs run in one invocation on one
   account. The limiter is correct product behaviour; the fix belongs in the harness (fewer
   reconnects in `home-scene.spec.js`, or a second owner account per lane). Owner: order 16's
   test program.
2. In the Arabic house, raw Home Assistant states such as `off`, `on`, `closed`, `cool` and
   `heat` render in English next to translated ones (`مُشغَّل · 71%`). Visible in the RTL
   screenshot; not asserted by any test yet.
3. `/api/agents/me` still logs `Missing required env var: S3_PUBLIC_DOMAIN` on the local stack.

**Commits:** `a96e7e591` and `2af205a16` (catalogs and manifest), `577c786c0` and `f2c8ac2ff`
(watcher), `e179f36a7` (encryption-key preflight), `7df581bec` (contrast), plus this entry.
