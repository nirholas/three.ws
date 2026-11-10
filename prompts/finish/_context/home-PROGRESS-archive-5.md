# home-PROGRESS, archive 5 (2026-09-09 to 2026-09-09)

Older entries moved verbatim out of [home-PROGRESS.md](home-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [home-PROGRESS.md](home-PROGRESS.md), never here.

## 05. The connect flow: `/smart-home` onboarding, every state, run 2 (2026-09-09)

**Verdict: done.** Run 1 (2026-09-03, above) built the surface and marked itself PARTIAL for one
reason: the order 11 SSRF guard had closed the only route to a real Home Assistant, so the live
half of the acceptance criteria could not be run at all. That is resolved. `api/_lib/home-url-guard.js`
now carries the two-condition seam run 1 asked for (`HOME_ALLOW_LOCAL_INSTANCE=1` AND no
`K_SERVICE`, tested positively so it is off on Cloud Run whatever else is configured), and
`playwright.home.config.js` sets it for the lane. Every item run 1 left open is closed below
against a real house, and no product code needed changing to close them.

**Shipped:** nothing new on the surface. This run is the verification run 1 could not do, plus
five defects fixed in the lane's own evidence harness, each of which was making a green result
mean less than it appeared to.

**Measured, all from run 7 of the tier this session (`npm run test:home:e2e`, connect specs):**
- `tests/e2e/home-connect.spec.js` + `home-connect-live.spec.js` + `home-connect-gallery.spec.js`:
  **39 passed, 0 failed** in 3.2 minutes, against Home Assistant `2026.9.0` in a real container.
- **The real connect:** `HTTP 201`, capabilities measured live as `entityCount 125, areaCount 4,
  floorCount 1, macroCount 2, haVersion 2026.9.0, mcp true, mcpToolCount 29`. `haVersion` is
  asserted equal to what `/api/config` on the house itself returns, not scraped off an entity.
  The whole browser console for the connect was two lines, both `debug: [vite] connecting/connected`.
  Transcript and screenshots: `reports/home-connect-live/`.
- **State 9, live, not rendered:** the container was really stopped mid-test. The card kept its
  entire measured summary (4 rooms, 125 devices, 2 scenes, 2026.9.0, MCP 29 tools), the status
  line read "Not answering right now. It last answered moments ago, and that is the state shown
  below", `data-state` was `degraded`, and the home polled back to `connected` on its own once the
  container returned, with no reconnect and no new token. This is the item run 1 could only assert
  against a two-hour-old timestamp.
- **State 7, live:** a junk token against the real house is classified `auth` on the wire (a 4xx,
  never a 5xx), lands on `data-state="auth_failed"`, refocuses `#hm-token`, names the Long-lived
  access tokens path, keeps the address the user typed, and stores no half-home. Added this run;
  the tier previously proved only that the page maps code `auth` onto state 7, never that a real
  Home Assistant 401 is classified as `auth` at all.
- **All fifteen states photographed at 1440px and 320px** into `reports/home-connect-states/`
  (30 PNGs), each asserted to add **zero horizontal overflow at 320px** and to write nothing to
  the console.
- **Private-host refusal: zero network requests** between submit and the rendered refusal,
  counted on the Playwright request event.
- **Keyboard:** the connect completes from the keyboard against the real house. Tab stops from
  the top of the document to the first field: `Skip to content`, then `What we store, in full`,
  then `hm-label`; then Tab to `hm-url`, Tab to `hm-token`, Enter submits.
- **Token leak, four proofs, all against a real long-lived token:** absent from `localStorage`,
  from `sessionStorage`, from `document.cookie` and from `window.location.href` (read out of the
  page after a real submit); absent from the response body (substring search over the whole body);
  absent from every request URL in the transcript; absent from every console line. Statically:
  `grep -rn "localStorage\|sessionStorage\|document.cookie" src/home/` finds nothing in
  `connect.js` or `manage.js` (the one hit is `scene.js` storing a 2D/3D view preference), and
  `grep -rn "console\." src/home/` finds nothing in either file.
- `npm run audit:web` for `/smart-home`, **authed against production**, desktop and mobile:
  **0 error, 0 warn**, 3 info. Run 1 could only report 6 errors that were all the Codespace's own
  HMR socket; auditing the live site removes that class entirely.
- `npm run audit:docs`: clean, 1590 files. `npm run check:rules`: clean on every file touched.
- Home unit tests, sharded to survive concurrent agents: **655 passed, 0 failed** across 26 files
  (`tests/home-*.test.js` plus `packages/home-bridge`); the live-tier cases skip without a house.

**Five defects fixed, all in the lane's evidence harness rather than the product.** Each one was
letting a run report something other than what it measured:

1. **`tests/e2e/home-global-setup.js`: the documented escape hatch from the registration rate
   limit was itself broken.** `raiseHomeCeiling` iterated a hardcoded `['owner', 'guest']` while
   `HOME_E2E_ROLES` exists precisely so a lane that needs only an owner does not spend one of five
   hourly registrations on a guest. Setting it crashed on `accounts.guest.email`, so the one way
   out of a rate limit was a dead end. Now iterates `ROLES` and skips a role it was not asked to
   provision.
2. **`tests/e2e/home-connect-gallery.spec.js`: the console assertion allowlisted one HTTP status.**
   It muted `Failed to load resource ... 401` by literal string. States 8 and 12 arrived later
   with a 502 and a 402, and both went red over a line Chromium's network stack writes about a
   response the spec itself fulfilled and the page handled correctly. Replaced with a filter that
   asks WHO emitted the line rather than which status it names: HMR, `GL Driver Message` from the
   GPU process, and `Failed to load resource` **scoped to `/api/` by URL**. The same line for a
   stylesheet, a script or a font still fails, which is the half worth keeping.
3. **`tests/e2e/home-connect-stubs.js`: the shared fixture had a ninety-second fuse.**
   `HOME.last_ok_at` was stamped once when the module was imported, and a connected home whose
   last handshake has aged past 90 seconds is state 9. The tier runs for eight minutes, so most of
   it was on the wrong side of that line: `connected` assertions passed or failed purely as a
   function of how long the run had been going and which order the files executed in. The three
   timestamps are now getters, so the fixture means what it says at the moment it is used, and a
   spec that wants a stale house still says so explicitly.
4. **`tests/e2e/home-connect-stubs.js`: state 5 was never actually held.** The gallery holds the
   verifying screen by returning a promise that never settles, and `stub` passed that promise
   straight to `route.fulfill`, which answered the request immediately with an empty 200. The page
   then read no home, asked for the list, got an empty one, and landed on the EMPTY screen. State
   5 existed only for as long as one round trip against a local stub, so the spec passed on a
   quiet machine, failed on a loaded one, and on the runs where it passed it was photographing a
   frame rather than a state. `onConnect` is now awaited, which makes a never-settling promise a
   real hang. `05-verifying-1440.png` is the first honest picture of that screen.
5. **`scripts/home-test-instance.mjs`: one killed harness poisoned its lane for fifteen minutes.**
   `withLock` abandoned a lock only on age, with a 900-second threshold, while every caller of the
   harness kills it on a much shorter timeout (`stopHomeInstance` allows 120 seconds) and a killed
   process never reaches the `finally` that releases. So a timeout left a lock, the next call sat
   in the wait loop until that lock aged out, died on its own caller's timeout, and left a fresh
   one: one kill guaranteed the next several. It presented as `home-test-instance timed out after
   120s` on a `--stop` that takes **7 seconds** when it runs at all, which reads as a hung
   container and is a dead process's leftovers. The lock now records its holder's pid and a waiter
   asks the operating system whether that process still exists. Proven both ways: a planted lock
   owned by a dead pid is reclaimed and the call completes in 11 seconds, and a planted lock owned
   by a live pid is still waited on, by name (`[lock] waiting for pid 418469 to finish with "c05"`).
   `EPERM` counts as held, so another user's process is never evicted. SIGTERM and SIGINT now
   release the lock too; SIGKILL cannot be caught, which is why the pid check is the real fix.

**Deviations from the order file, beyond the ones run 1 already recorded:**
- The order file asks for eleven states and a route at `/home`. Both were already superseded and
  are correct as they stand: the route is `/smart-home` (run 1's deviation 1, `/home` is the
  marketing landing page), and the flow has **fifteen** states, the four beyond the original
  twelve being the pairing host, one deep-linked home, and an id that is not this account's.
- The order's task list (page, controller, i18n, docs, changelog, `STRUCTURE.md`, `data/pages.json`)
  was all completed by run 1 and verified present this run, so nothing there was rebuilt.
  `data/changelog.json` gets no entry from this run: every change here is test-harness only, with
  no user-visible effect, which the CLAUDE.md changelog rule explicitly excludes.

**Operational note for the next lane, not a defect:** `playwright.home.config.js` defaults to
ports 8099 and 3020 and refuses to reuse a server, so two agents running the home lane at once
collide with `http://127.0.0.1:8099/api/version is already used`. That is the config behaving as
its own comment says it should (own the ports or fail loudly). Set `HOME_E2E_API_PORT` and
`HOME_E2E_WEB_PORT`, as this run did (8107 and 3027), rather than killing the peer's server.

**Left open: nothing for this order.**

**Commits:** all five fixes reached `main` inside concurrent agents' `git add -A` sweeps before
they could be staged from here, under commit messages about other work: `f663e9c9a` carries the
harness lock fix, the ROLES fix, the gallery filter, the live-spec filter, the new state 7 test
and the fixture getters, and `af50eb075` carries the `onConnect` await. The content is intact and
verified at HEAD; only the attribution is wrong, and the shared-worktree rule against amending
means it stays that way. This entry and the order-file retirement are the only commit from this
session.


---

## 07 (browser tier closed). Floorplan authoring and layout persistence (2026-09-09)

The 2026-09-03 entry above left exactly one thing open: the six browser journeys in
`tests/e2e/home-floorplan.spec.js` were written and had never executed. They execute now.

**Measured:** `HOME_LIVE=1 HOME_LIVE_NAME=layout07 HOME_E2E_API_PORT=8141 HOME_E2E_WEB_PORT=3071
npm run test:home:e2e -- tests/e2e/home-floorplan.spec.js`: **6 passed**, twice in a row, against
a real Home Assistant 2026.9.0 (4 areas, 1 floor, 92 entities) and the real API and database.
`tests/e2e/home-scene.spec.js`: **6 passed**, so order 06 did not regress. The live unit tier,
`WALLET_ENCRYPTION_KEY=$(openssl rand -hex 32) node --env-file=.env.local
./node_modules/vitest/vitest.mjs run tests/home-layout.test.js`: **31 passed, 0 skipped**.
Journey 9e reports its own number: **zero areas to a saved two-room floorplan with a device filed
into one, 3 to 5 seconds**, against the order's five-minute bar. Its two screenshots land in
`test-results/` (gitignored).

**Running the lane at all.** `npm run test:home:e2e`, not a bare `npx playwright test --config
playwright.home.config.js`: only the npm script loaded `.env.local`, so the documented re-run
command died in global setup on `Missing required env var: DATABASE_URL`. The config now loads
the file itself, so both spellings work; that fix is a peer's, landed mid-session.

**Six defects, found because the journeys finally ran.** Four were real and two were the lane
lying about itself:

1. **The editor had no stylesheet.** `pages/home-scene.html` linked `/home-scene.css` and nothing
   else, but every class the floorplan renders is `hm-plan-*`, which lives in `src/home/home.css`,
   which only the `/smart-home` pages loaded. So the Plan view shipped with no rules at all:
   absolutely positioned rooms fell back to static blocks and stacked down the page. The
   before/after screenshots are unambiguous. Found here by reading the deliverable screenshot the
   order asks for, and independently by a peer measuring touch targets in `home-a11y.spec.js`;
   their fix is the one in the tree.
2. **The conflict panel could not take theirs.** `HomeApiError`'s constructor destructured
   `{ status, pending }` and silently dropped the `current` and `field` every caller passed. So
   `err.current` was always undefined, the panel read "They saved version ?", and **"Take theirs"
   returned early and did nothing**: the only way out of a 409 was to overwrite the other person,
   which is the exact outcome the panel exists to prevent. This is the order's headline promise
   ("never a silent overwrite and never a lost edit") and it was broken in the shipped code.
3. **Switching to 3D threw every time.** `setView` calls `mount3d()` without awaiting it (it
   lazy-imports Three.js), then reached for `state.renderer`, which it had just set to null and
   which mount3d only reassigns after the import resolves: `Cannot read properties of null
   (reading 'setModel')` on every switch to the 3D house with a house already loaded. mount3d
   applies the model itself, so the 2D branch keeps that block and the 3D branch does not.
4. **A room card could not hold its own contents.** A card is drawn to scale, so an ordinary 5.7 m
   room is an 80px box, and a name plus a measurement plus a Remove button do not fit one. The
   size line and the orphan tag now drop out by container query rather than wrapping mid-word.

The two test defects mattered as much, because both made the suite report success it had not
earned. `openPlan` waited only for `#hs-plan`, which exists immediately, so 9b and 9c counted a
loading skeleton, concluded the house had nothing to place, and **skipped every run against a
house with four areas and 78 unfiled devices**. And the tray's File button carries an aria-label
("File <device> into a room"), which is its accessible name and beats the visible text, so
`name: /^File$/` had matched nothing since the i18n pass; 9c and 9e hunted it until they timed
out. A skip-if-empty guard that can also fire for the wrong reason is worse than no guard.

**Two more flakes, fixed at the cause.** Filtering `.hm-plan-room` on `hasText` is a substring
match over the whole card, devices included, so the Bedroom card (which lists "Kitchen Lights")
answered to a filter for "Kitchen"; rooms are matched on their own `.hm-plan-room-name` now.
And 9c filed `loose.first()`, which is as likely to be a YAML-defined entity that can never hold
an area: the product refuses that correctly and by name (the order's state 9), so the journey now
asks Home Assistant which entities are registry-backed first.

**Vite HMR is off for this lane** (`VITE_NO_HMR`). Concurrent agents edit `src/` while a journey
runs, and a connected HMR client reloaded the page under the browser on each of their saves: five
reloads in one run, and 9e died on a navigation that arrived between naming a room and clicking
File. The Codespaces HMR host also 404s here, which was three console errors a page the product
did not cause.

**Deviations from the order file, beyond the 2026-09-03 entry's:** the order says four browser
journeys; there are six (9, 9b, 9c, 9d, 9e, 9f). It asks for four validator rejections; the
validator produces eight designed ones, each naming the field it refused (room cap, unknown
top-level key, unknown room key, non-finite coordinate, coordinate past the origin cap, room
below the minimum size, `rooms` as an array, unusable room id).

**Left open:** nothing in this order. Two things worth someone's time and out of scope here:
`scripts/home-test-instance.mjs --seed --json` reports `floors: 0, areas: 0` for a house it just
gave one floor and four areas (the counter counts only records it created, but the JSON key reads
as a census), and the local API logs `agent_init_failed Missing required env var:
S3_PUBLIC_DOMAIN` on every `/api/agents/me`, which is noise in every home e2e log.

**Commits:** the fixes landed under a concurrent agent's messages while this session was running
(`093990158`, `9d5c14a21`, `dad31271e`, `38eea8d9f`, plus the config's DATABASE_URL loader). The
content is verified at HEAD by the runs above; the shared-worktree rules against amending and
against sweeping other agents' work mean the attribution stays as it is. This entry and the order
file's retirement are this session's only commit.

## 17 (a11y and mobile closed; the 84 locales are not). Accessibility, 87 locales, mobile and PWA (2026-09-09)

**Shipped:** the lane's accessibility gate now actually runs, and it found six real
defects on the way to green. `tests/e2e/home-a11y.spec.js` is 15 tests against a real Home
Assistant 2026.9.0 and passed 15/15 twice consecutively: axe (`wcag2a`/`wcag2aa`/`wcag21aa`) on
the 3D house, the flat house and the floorplan editor, the guarded confirmation card while it
stands, a keyboard-only walk of connect → room → device → act → refuse → Escape, the polite and
assertive live regions, colour-independence, measured stale contrast, four breakpoints, the 44px
touch floor measured on a context that really emulates touch, a Fahrenheit house in a
non-English browser, an RTL locale driven through the committed Arabic catalog, a user's device
name byte-identical in two languages, `prefers-reduced-motion` in both renderers, and a
confirmation that survives three stray taps on a 375px screen. All six public home routes also
clear the site-wide gate in `tests/e2e/a11y-top-pages.spec.js`.

The defects, all of them things a person hits:

1. **The selected room's state line failed WCAG 1.4.3.** `aria-current` lifts the row to
   `--surface-3` under `--text-2xs` dimmed ink, and axe measured it below 4.5:1. It is the row
   the reader is looking at, so it now carries full ink (`public/home-scene.css`, `c79ab3ecd`).
2. **The flat house dropped the keyboard on every state event.** It rebuilt every node on each
   frame from the stream, so a light dimming or a sensor ticking destroyed whatever control had
   focus: tab to Unlock, let the thermostat report, and your Enter goes to the document. Focus
   is carried across the rebuild by identity now, not by node reference (`83b4656de`).
3. **A busy control was `disabled`, which the browser answers by blurring it.** Every action
   taken from the keyboard threw the reader to the top of the document for the length of a round
   trip, and Escape on "unlock the front door?" then had nothing to hand the keyboard back to.
   The working state is `aria-disabled` on both surfaces: reads and looks disabled, refuses the
   press, keeps the focus (`e900f98dd`).
4. **The confirmation's return target was read after the busy render, too late to be useful.**
   Read at the top of `act()` now, with the request itself as the fallback (`e900f98dd`).
5. **The floorplan editor loaded no stylesheet inside the live house.** Its markup is all
   `hm-plan-*`, which lives in the smart-home sheet only the `/smart-home` pages linked, so in
   the Plan view it rendered with browser defaults and absolutely positioned rooms falling back
   to static blocks (`ab246a226`, alongside a peer's `dad31271e`).
6. **The editor's controls measured 21px on a phone.** Its toolbar, tray, File buttons, remove
   button, file menu and name field take the 44px floor now, and the 22px resize corner grows to
   something a fingertip can find. The rooms on the canvas deliberately do not: a room is sized
   in metres by the plan. Its resize handle also moves off `right` onto `inset-inline-end`.

**i18n.** The lane's JS-built copy went through the pipeline: `connect.js`, `manage.js` and
`floorplan.js` now read every reader-facing string from the catalog, taking the home lane from
208 keys to 358 (`dba5cffe5`, `8afc40c1b`). User data is never part of a source string: a room
name, a device name, an address somebody pasted and anything their own Home Assistant returned
are interpolated values, and `npm run i18n:home` refuses any source that interpolates a template
expression. Relative times were lifted into the shared bridge and go through
`Intl.RelativeTimeFormat` rather than three catalog keys with an English `s` appended, which is
the wrong plural in most of these languages (`db9321f95`). `formatWhen` reads the site locale
rather than the browser's. `home_scene.panel_empty` said "Pick a room on the left" and the rooms
are on the right in Arabic, so the English names the list instead and the stale translations
were dropped for retranslation (`2ec8bae32`).

**Two pipeline guards, both of which had already cost a catalog.** An unusable GCP credential
(ADC present but its refresh token revoked) escaped the Vertex token path as an ordinary error
and routed every key into the English fallback; it is a config error now, naming both the
credential's reason and gcloud's. And a 5xx that outlives its whole backoff budget is treated
like a 429 that does. Both were found the hard way in this session: the first wrote 67 empty
strings and English passthrough into `ar.json`, the second walked most of a catalog baking
English one key at a time while heading for exit 0. Covered by a regression test in
`tests/i18n-markup.test.js` and documented in `docs/i18n.md` (`113f365ea`, `23bfd3b52`).

**Measured:** `home-a11y.spec.js` 15/15, twice, ~1.3 to 3.1 minutes a run, lane `a11y17` on
ports 8188/3088. Site-wide axe 45/46; the one failure is `/unstoppable` (one `color-contrast`
node), which is not this lane's page. `npm run check:rules` clean on every file touched,
`npm run audit:docs` clean (1591 files), `npx vitest run tests/i18n-markup.test.js
tests/i18n.test.js tests/i18n-missing-key.test.js` 56/56. Evidence screenshots (18, one per
test, including the RTL house and the two-locale device names) are reproducible with
`HOME_E2E_SCREENSHOTS=1`, added to `playwright.home.config.js` for exactly this.

**Deviations from the order file.** The order asks for the 44px floor at 320/375/768 and the two
breakpoint tests measured it on a desktop browser at a narrow viewport, where all 46 of the
lane's controls "fail" and none is broken: the rules are correctly scoped to
`@media (pointer: coarse)`, and a laptop window dragged narrow has a mouse in it. Both tests
open a context with `hasTouch`/`isMobile` now and assert the context really is coarse before
measuring. The order also asks for a PWA decision; the platform manifest already exists,
`/manifest.webmanifest` is generated into `dist/` and answers 200 in production, and the scene
page links it, so nothing lane-specific was invented. Wake lock was already implemented and is
correct: the live scene alone holds the screen awake, and drops it the moment the document is
hidden.

**Left open.**

1. **No translation backend was reachable, so `npm run i18n:lint` cannot be brought clean.** It
   reports 49,378 problems, of which 30,259 are this lane's 358 keys times 84 locales; the
   remainder predates this order. Two independent lanes are down, and neither is fixable from
   inside a session: Vertex, the committed default and the one the owner's GCP credits pay for,
   fails because this workspace's Application Default Credentials answer `invalid_grant` and
   `gcloud auth print-access-token` demands an interactive reauth; the `threews` proxy, the
   zero-credential fallback, answered `502 upstream_error status 403` and then
   `503 no configured fallback model is available` on every request because its own free-tier
   chain is exhausted. **Owner action: `gcloud auth login` in this workspace, then
   `GOOGLE_CLOUD_PROJECT=aerial-vehicle-466722-p5 npm run i18n:translate`.** It is roughly 500
   requests, five to eight chunks per locale, and it clears the whole repo's backlog, not only
   this lane's. Until it runs, `public/locales/manifest.json` correctly lists English alone and
   no translated locale ships in the switcher.
2. **No screen reader exists in this environment**, so no VoiceOver or NVDA transcript was
   produced and none is claimed. What is proved mechanically instead: the polite region carries
   a light going on with the device named, the assertive region carries the whole confirmation
   question including the word "unlock" and the Escape instruction, and it is cleared the moment
   the question is answered so it cannot be read again in front of the next announcement.
3. **The RTL and never-translate tests publish the Arabic locale to their own page** with a
   routed manifest, because the real manifest gates on catalog completeness and no locale is
   complete. Only that gate is faked; the runtime still reads `?lang=`, sets `lang` and `dir`,
   and swaps the DOM from the committed `public/locales/ar.json`. When item 1 lands, delete the
   `publishLocale` helper and the tests read the real manifest.
4. `/api/agents/me` throws `Missing required env var: S3_PUBLIC_DOMAIN` on the local e2e stack.
   Harmless to this lane (it is the nav's agent widget) and not this order's to fix, but it is
   noise in every home run's server log.

**Commits:** `c79ab3ecd`, `dba5cffe5`, `8afc40c1b`, `db9321f95`, `113f365ea`, `23bfd3b52`,
`1319f26e3`, `83b4656de`, `e900f98dd`, `ab246a226`, `2ec8bae32`, plus this entry.


## 14. Reliability and the scale envelope (2026-09-09)

**Shipped:** the envelope, the ladder, the chaos suite and the Cloud Run decision were built on
2026-09-03 alongside order 02 and re-measured on 2026-09-09, and this session's job was to verify
every line of them against real output before retiring the order. Everything held except the
Cloud Run memory setting, which had reverted for a third time, so the fix for that class of bug
is this session's addition: **the pool now sizes itself from the memory its own container
actually has** rather than trusting an env var that is set in a different system on a different
schedule. `containerMemoryLimitBytes()` reads the cgroup limit (v2, then v1), and
`memoryBackedConnectionCap()` turns it into a cap from the same three measured numbers this lane
already published; `createHomeRuntime` takes the minimum of that and what `HOME_MAX_CONNECTIONS`
asked for, sizes the admission ladder from the result, warns once, and reports it as
`pooledCapNote` in `stats()` and `home.detail.pool.capacityNote` in `/api/healthz`.

**Measured:**

- **The envelope is real and reproduced.** Twelve real Home Assistant containers, run twice six
  days apart at load 206 to 233 and again at 54 to 72. Every load-insensitive number reproduced
  to the kilobyte: heap per connection 245 KB both times, large house 856 then 847 KB, SSE frame
  25,168 then 25,172 bytes, descriptors per connection exactly 1, coalescing exactly 100:1. Raw
  evidence: `data/reports/home/envelope-2026-09-03.json` and `data/reports/home/envelope-2026-09-09.json`, both
  committed and both read this session rather than quoted from the prose.
- **10 homes: 4.0 MB, p95 6.5 ms. 1,000 homes: 49.7 MB at 200 measured connections, p95 31.0 ms.
  100,000: extrapolated and refused as simultaneously live**, with the model stated
  (`P x I / D`) and the honest admission that `D`, the duplicate-socket factor under
  `sessionAffinity=false`, is the one term not measured. No cell in the table says "assumed".
- **Chaos: 7 of 7 pass, twice.** `data/reports/home/chaos-2026-09-09.json` read directly:
  `results.length === 7`, `passed === true` on all seven.
- **Scenario 6 isolation, the two numbers:** the fast house's p95 was **6.80 ms alone and 6.99 ms**
  with a house answering 2,000 times slower connected beside it. A drift of 0.19 ms, taken at
  load average 190, so the noise floor was far above the effect.
- **The ladder is identical across both runs, row for row, all ten rows** (`.ladder.rows`
  compared byte for byte this session). Rung 4 holds where it matters: at the same moment a
  stream is refused (`admitted:false, rung:shed_streams`), an action is admitted. The door beats
  the dashboard.
- **The gate never degrades, proven twice.** `.gate` in both envelopes: 400 guarded actions
  against a real `lock.front_door`, `everWavedThrough: 0`, `violations: []`, rungs
  `degraded_read`, `shed_streams` and `shed` all reached, 226 shed by load and 174 admitted then
  refused by the gate, live call `needs_confirmation`, lock `locked` before and after.
- **CPU throttling does not starve a timer in a held stream**, measured against production over
  23 heartbeat intervals: median drift 1 ms, worst 1.6 s, neither stream cut by the platform.
- **The new clamp:** 8 GiB backs 5,521 connections (600 passes untouched), 4 GiB backs **234**
  (600 is clamped, logged and reported), 2 GiB falls to the floor of 25, no cgroup limit means no
  bound. Eight cases in `tests/home-runtime.test.js` pin it, including that the admission ladder
  is sized from the clamped cap and not the requested one.
- **Tests:** the whole home surface, 29 files, **818 passed / 123 skipped**. Healthz and ops, 9
  files, 170 passed. Full suite in four shards, no failure attributable to this lane.

**Deviations:**

1. **The order says publish the envelope in `docs/home-operations.md`. It is in
   `docs/ops/home-operations.md`,** beside the rest of the lane's runbook, where order 13 put the
   SLOs and the three alerts. Splitting the scale envelope from the alerting runbook to satisfy a
   path would have been worse than the deviation. Left where it is.
2. **The Cloud Run memory setting had reverted a third time, by a route the doc had not
   anticipated.** `GET /api/version` reports the live revision as `three-ws-api-00420-ljh` serving
   commit `880bdcef8`; the 8 GiB pin in `server/cloudbuild.yaml` is commit `a5e522822`, made ten
   hours *after* the commit production is serving, so the pin has never been through a deploy and
   at `880bdcef8` that file still reads `4Gi`. The first two reverts were a deploy overwriting the
   setting; this one is a deploy of a commit made before the fix existed. Pinning it in a fourth
   file would not have stopped it, which is why the runtime now negotiates instead. Recorded in
   the doc under "It reverted a third time".

**Left open:**

- **One owner command, and it is pre-approved config-only work I could not run:**
  `gcloud run services update three-ws-api --region us-central1 --project
  aerial-vehicle-466722-p5 --memory 8Gi`. `gcloud` in this workspace answers
  `Reauthentication failed. cannot prompt during non-interactive execution` on every call, so the
  live memory limit is stated in the doc as what the deploy config asks for, never as a reading
  off the service. The next full deploy of any commit at or after `a5e522822` makes it permanent.
  The clamp makes 4 GiB **safe** in the meantime, not correct: the lane runs at 234 connections an
  instance, which is 1,404 live homes across `minScale=6`, instead of risking an OOM that kills
  the whole API container.
- **`D`, the duplicate-socket factor, is unmeasurable before real traffic** and it is the term
  that decides the fleet ceiling. First thing to measure after launch, per the doc.
- **The 25 KB SSE frame is the lane's most expensive thing** and it is the whole room graph, not
  the socket. The state channel should send a diff. Named in the doc; not this order's scope.

**Note on the order file:** `309-home-14-reliability-scale.md` was retired by the owner's own
sweep of `prompts/finish/` (`_context/00-RETIRED-BY-OWNER.md`) while this session was verifying
it, so its deletion is not in this commit. This session briefly restored 26 order files before
reading that directive, and undid the restore; the sweep completed over the top of it either way.

**Commits:** the build work is in `b730a85a3` and the 2026-09-03 order-02 worktree; the second
fleet run is `1dfb4e69f`; the 8 GiB deploy pin is `a5e522822`; this session's clamp, tests, doc
correction, changelog entry and this entry.

---
