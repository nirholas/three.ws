# Audit and fix /play multiplayer resilience and every economy loop (price truth, payouts, double-spend) before the 2026-11-06 meetup

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/252-plan-play-meetup3-net-economy-audit.md`.

**Priority:** P0, live defect, security, or broken money rail (score 88 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

Deadline: the meetup is 2026-11-06. After that date, re-scope this order to the next scheduled event or close it as moot.

The meetup puts strangers into one shared world at the same moment (`public/event.json`, id `three-community-meetup-3`, 2026-11-06 16:00Z) and then asks them to earn, spend and compete in it. Two failure classes hurt most: networking that silently desyncs or looks single-player after a failed handshake, and economy loops that pay wrong, show a price the server does not charge, or double-charge on a fast double click. Both were audited for the August event; the surface has since gained parties, the signature wall, the quest line and new stations, and no record shows a re-run. The game server is a single hard instance (`three-ws-multiplayer`, max-instances 1), so a regression in reconnect, fan-out or per-player DOM churn has a hard capacity ceiling.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Net: `src/game/community-net.js` (reconnect with backoff, `MAX_RECONNECT_ATTEMPTS` 14, manual `retry()`, holder-gate refusal is terminal), `src/game/voice-chat.js`, `src/game/friends-panel.js`, `src/game/world-persist.js`, `multiplayer/src/rooms/WalkRoom.js`. Tests include `tests/multiplayer-server-boot.test.js` and `tests/walkroom-activity.test.js`.
- Economy: `src/game/play-activities.js`, `play-systems.js`, `economy-ui.js`, `agent-commerce.js`, `boutique-purchase.js`, `wheel-station.js`, `spin-wheel-ui.js`, `combat-system.js`, `quests-ui.js`, `cosmetics-*.js`; server authority in `multiplayer/src/{shop,items,cosmetics-catalog,spin-wheel,economy}.js`; published truth at `/play/economy` and `/play/solver` (`api/play/economy.js` imports the same modules, so a mismatch means one side drifted).
- Event pieces to include: `multiplayer/src/event-window.js` (quest gate), `api/play/event-leaderboard.js`, `api/internal/event-score.js`.
- Scripts: `scripts/drive-event-e2e.mjs`, `scripts/play-mobile-repro.mjs`; the game server capacity figures are in `docs/event-readiness/LIVE-OPS.md` (1 instance, concurrency 1000, 4 CPU, 8Gi as of August).
- No current-build results are recorded.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "MAX_RECONNECT_ATTEMPTS\|retry(" src/game/community-net.js | head
npx vitest run tests/multiplayer-server-boot.test.js tests/walkroom-activity.test.js 2>&1 | tail -8
curl -s https://three.ws/api/play/economy | head -c 800
sed -n 1,60p scripts/drive-event-e2e.mjs
gcloud run services describe three-ws-multiplayer --region us-central1 --project aerial-vehicle-466722-p5 --format='value(spec.template.spec.containerConcurrency,spec.template.metadata.annotations)'
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Two-client consistency harness. Add `scripts/play-net-audit.mjs` (Playwright, two or more headless contexts joining the canonical $THREE world from `docs/event-readiness/README.md`): exchange chat, emotes and movement; assert the other client sees them within a bounded time; force a disconnect (offline toggle for 10 s) and assert automatic reconnect, correct resync with no ghost or duplicated self; background the tab for 2 minutes and assert recovery; assert a handshake failure surfaces a designed error with a retry button rather than an empty world. Exit non-zero on any failure. Keep it in `scripts/` and document it in `docs/event-readiness/README.md`.
2. Scale behaviour. Extend the harness with a `--clients N` mode (start at 25, go as high as the machine allows, record the number) against the local multiplayer server per `multiplayer/README.md`. Capture server CPU and per-tick time, client frame time with N peers, and look for O(n squared) update patterns and per-player DOM label churn; fix what the numbers expose. State the server capacity assumption tested so the runbook can pre-scale (the multiplayer service stays at max-instances 1).
3. Chat hygiene and voice. Verify long messages wrap, link text cannot inject HTML (test with markup payloads), the chat log is bounded in memory, spam is throttled (cooldown test), voice path works end to end (permission prompt, mute state visible to peers, teardown on leave, `AudioContext` closed on a denied mic). If voice is broken and unfixable today, hide its entry point instead of shipping a dead button.
4. Economy loops with a real signed-in QA session (QA login per the self-unblock playbook): gather, sell, bank, die and confirm the bank protected it, spin the wheel, complete a quest, buy and equip a cosmetic. For each: correct payout, HUD balance updates without refresh, persistence across reload.
5. Price and odds truth. Add `tests/play-economy-truth.test.js` that cross-checks a sample of in-game prices and the wheel paytable against `api/play/economy.js` output and the server modules it imports; run it, and fix whichever side is stale for every mismatch found.
6. Double-spend and races. Add tests that fire concurrent buy, sell and spin requests at the authoritative handlers and assert balances never go negative and a duplicate request is charged once; buttons disable while in flight; after a network failure mid-purchase the UI reconciles with server state on reconnect rather than trusting its optimistic update. Test first, see the failure if any, then fix.
7. Edge cases and feedback: empty inventory, full inventory, very long item names, insufficient $THREE (clear message plus how to get it, as `boutique-purchase.js` already maps), and silent-success loops that need a sound, flash or toast.
8. Event hooks: confirm the quest line, leaderboard and souvenir grant behave across the event window boundaries (before start, live, after end, and a clock-skewed client) using `scripts/drive-event-e2e.mjs`; the gate is server side and fails closed.
9. Results table (loop by loop pass or fixed, every price mismatch and which side was corrected, every failure mode and its result) in the report; `data/changelog.json` entry for user-visible fixes; `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node scripts/play-net-audit.mjs` exits 0 on the canonical world locally, covering chat, emotes, forced disconnect resync and backgrounding (output pasted), and exits non-zero when a seeded fault is injected.
- [ ] `npx vitest run tests/play-economy-truth.test.js` passes, and the double-spend/race tests pass with the failing-before evidence in the report.
- [ ] `npx vitest run tests/multiplayer-server-boot.test.js tests/walkroom-activity.test.js` still pass.
- [ ] Reported maximum simultaneous clients tested and the server CPU at that load.
- [ ] Zero console errors during purchases and during the reconnect run.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cannot start the multiplayer server locally | Follow `multiplayer/README.md`, or drive rooms in-process as `tests/multiplayer-server-boot.test.js` does; the production-read halves (economy page) still run. |
| QA account has no $THREE for the boutique path | Verify everything up to the confirmation step and the insufficient-balance state; a real purchase is a gated spend (see Gates). |
| Machine cannot field many headless clients | Report the highest N achieved and extrapolate from the per-client cost measured, labelled as an estimate. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Buying a boutique item charges $THREE on chain. Do not complete a real purchase. Test the purchase path up to the confirmation step and with the insufficient-balance state; if a full end-to-end paid purchase is wanted, state recipient, amount and token in one message at the end and wait for the owner's explicit yes.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/252-plan-play-meetup3-net-economy-audit.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `252-plan-play-meetup3-net-economy-audit.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/README.md` (whole file)

~~~~markdown
# Event readiness: prompt pack

Twenty-four self-contained agent prompts to get three.ws, and especially the /play world, to 100% before the event. Files 01-10 audit and fix what exists; files 11-16 build new event features; files 17-24 build new capabilities, things players can DO in the virtual world, by wiring in subsystems that are already built but unreachable from /play. Each file is a complete prompt: paste it into a fresh Claude Code session (or hand it to a subagent) and it runs end to end, fixing or building, then reporting.

Suggested order and parallelism (audits):

| # | Prompt | Surface | Can run in parallel with |
|---|--------|---------|--------------------------|
| 1 | [01-play-first-impression.md](01-play-first-impression.md) | /play load, intro, onboarding UX | 4, 5, 7, 8 |
| 2 | [02-play-mobile.md](02-play-mobile.md) | /play on phones (stability + touch) | 7, 8 |
| 3 | [03-play-performance.md](03-play-performance.md) | /play load weight, FPS, memory | 7, 8 |
| 4 | [04-play-multiplayer-net.md](04-play-multiplayer-net.md) | WebSocket, reconnects, voice, crowd | 1, 5 |
| 5 | [05-play-economy-loops.md](05-play-economy-loops.md) | Store, bank, wheel, combat, quests, cosmetics | 1, 4 |
| 6 | [06-play-auth-errors.md](06-play-auth-errors.md) | Sign-in, gates, error/empty states, console | after 1 |
| 7 | [07-platform-smoke-sweep.md](07-platform-smoke-sweep.md) | Every page on the live site | 1, 2, 3 |
| 8 | [08-api-production-health.md](08-api-production-health.md) | Cloud Run, crons, logs, DB, x402 | 1, 2, 3 |
| 9 | [09-accessibility-i18n.md](09-accessibility-i18n.md) | Keyboard, ARIA, contrast, translations | after 1 |
| 10 | [10-event-day-runbook.md](10-event-day-runbook.md) | Pre-scale, monitoring loop, rollback | last, after all fixes deploy |

Feature builds (run after audits 1-3 land, or in parallel if staffed; 12, 14, and 16 interlink but each stands alone):

| # | Prompt | Builds | Depends on |
|---|--------|--------|------------|
| 11 | [11-event-live-ops.md](11-event-live-ops.md) | Operator broadcast, go-live moment, live event config | nothing |
| 12 | [12-photo-mode-share.md](12-photo-mode-share.md) | Photo mode with branded one-tap share | nothing |
| 13 | [13-event-quests-leaderboard.md](13-event-quests-leaderboard.md) | Time-boxed quest line + live leaderboard + cosmetic reward | nothing (better with 12) |
| 14 | [14-welcome-concierge.md](14-welcome-concierge.md) | Greeter NPC, guided tour, event-aware opening line | nothing |
| 15 | [15-live-hype-feed.md](15-live-hype-feed.md) | Activity ticker + market hype moments | nothing (better with 13) |
| 16 | [16-invite-flow.md](16-invite-flow.md) | Invite sheet, QR, OG card truth, arrival continuity | nothing (better with 14) |

Capability builds (17-24): each wires an existing, finished subsystem into the world or adds a missing social primitive. All stand alone; the noted pairings just make them better together.

| # | Prompt | Builds | Wires in / pairs with |
|---|--------|--------|-----------------------|
| 17 | [17-plaza-live-show.md](17-plaza-live-show.md) | Live hosted show on a plaza stage, with $THREE tips | StageRoom + ShowDirector (built, unreachable from /play) |
| 18 | [18-coin-wars-portal.md](18-coin-wars-portal.md) | In-world Coin Wars portal: standings, queue, spectate | ClashRoom + war standings (built, arena-page only) |
| 19 | [19-forge-props-live.md](19-forge-props-live.md) | Text-to-3D prop generation inside build mode | Forge lane + the networked prop pipeline |
| 20 | [20-world-chat-scrollback.md](20-world-chat-scrollback.md) | Chat scrollback for late joiners + community-feed bridge | the WalkRoom relay + api/community/messages |
| 21 | [21-party-system.md](21-party-system.md) | Parties: form, see, reach, and talk to your crew | friends/presence stack; pairs with 13, 16 |
| 22 | [22-venue-projector-mode.md](22-venue-projector-mode.md) | Broadcast spectator view for the venue big screen | camera rig + event.json; pairs with 15, 16, 17 |
| 23 | [23-signature-wall.md](23-signature-wall.md) | Persistent signature wall, the event's artifact | world-persist patterns + name safety |
| 24 | [24-dance-off.md](24-dance-off.md) | Judged dance-off rounds with crowd voting and tips | dance floor beat + King of the Totem round machine |

Rules that apply to every prompt in this pack:

- The canonical test URL for the world is the $THREE community: `https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&image=%2Fapi%2Fimg%3Furl%3Dhttps%253A%252F%252Fipfs.io%252Fipfs%252Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q%26seed%3DFeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`
- Fix what you find. Do not produce a findings report and stop; the report is what you fixed plus what genuinely cannot be fixed in-session and why.
- Verify locally with `npm run dev` (port 3000) plus the named audit scripts before claiming done. `npm test` must stay green.
- Commit finished work promptly with explicit paths (concurrent agents share this worktree; never `git add -A`).
- Deploys stay owner-gated. Prepare everything so shipping is one command (`npm run deploy:gcp:full`), then say so in the report.
~~~~

### `docs/event-readiness/04-play-multiplayer-net.md` (whole file)

~~~~markdown
# Audit 4: /play multiplayer, networking, and presence

The event means many strangers in one world at once. Connection handling has to be boring and invisible: join fast, never silently desync, recover from every drop.

## Where the code lives

- Net layer and server URL: `src/game/community-net.js` (defaultServerUrl is documented in `pages/play.html`)
- World boot: `src/game/coincommunities.js`
- Voice: `src/game/voice-chat.js`
- Ambient population (client-side, non-networked): `src/game/ambient-crowd.js`
- Friends/presence: `src/game/friends-panel.js`
- Persistence: `src/game/world-persist.js`

## What to audit

1. **Join path.** Time from page load to seeing other players. Any handshake failure must surface a designed, actionable error (what happened + retry button), never an empty world that looks single-player when it silently failed.
2. **Reconnect.** Kill the socket mid-session (devtools offline toggle, 10s, then online). The client must reconnect automatically, resync player positions, and show a subtle "reconnecting" indicator while it does. State after resync must match the server (no ghost players, no duplicated self). Note `community-net.js` already reconnects with backoff: the attempt counter resets on every successful join, so `MAX_RECONNECT_ATTEMPTS` (14, about 11 minutes with the once-a-minute tail) bounds one outage and rides out a server redeploy before parking on `offline` with the manual `retry()`; a holder-gate refusal from `onAuth` is terminal and routes back to the gate instead of looping. A failed connect logs at info through the gated logger, not as a console warning. The boot watchdog in `pages/play.html` deliberately ignores a WebSocket-shaped rejection, so a flaky reconnect never trips the "could not load the world" card.
3. **Backgrounding.** Switch tabs for 2 minutes and come back. Mobile Safari will have frozen the socket: same reconnect path must handle it.
4. **Two-client consistency.** Open two browser contexts in the same coin world. Movement, chat, and emotes must appear on the other client within a human-imperceptible delay. Check name labels, avatar appearance, and cosmetics sync both ways.
5. **Chat hygiene.** Long messages wrap, links do not inject HTML (verify escaping), spam has some throttle, and the log does not grow unbounded in memory.
6. **Voice.** `voice-chat.js` is surfaced (lazy-imported by `coincommunities.js` behind the HUD voice button), so test the full path: permission prompt, mute state visible to others, teardown on leave. Two hardening points to keep intact: a denied mic closes the `AudioContext` it just opened (browsers cap concurrent contexts, so leaking one per refusal made voice permanently unopenable), and an already-connected peer holds two ranks of hysteresis past `MAX_VOICE_PEERS` before it is dropped, so a crowd cannot churn WebRTC handshakes frame to frame. If it is broken and unfixable today, hide the entry point rather than shipping a dead button.
7. **Scale behavior.** Simulate a crowded room (multiple headless Playwright contexts, or whatever the net layer allows). Watch for O(n^2) update patterns and per-player DOM label churn.
8. **Mobile memory.** A phone that runs out of memory does not throw a JS error: the browser kills the tab, the socket dies mid-session, and the page reloads. In the server log that reads as a join followed by a leave a few seconds later, over and over, which looks like a networking bug and is not one. Watch the bytes, not the console. `scripts/play-mobile-repro.mjs` drives a phone-emulated /play session and prints every download attributed to the code that asked for it (`ENGINE=chromium node scripts/play-mobile-repro.mjs https://three.ws/play 120000`). Anything that loads community-uploaded models must work to a budget: the gallery is uncapped and single avatars there reach 24 MB. `src/game/ambient-crowd.js` holds the reference implementation (per-model cap, per-visit download cap, load-once-and-clone, release on leave).

## Verify

- Scripted two-context Playwright run joins the canonical $THREE world (URL in `docs/event-readiness/README.md`), exchanges chat, survives a forced disconnect, and asserts resync. Keep the script in `scripts/`.
- Zero console errors across the run.
- `npm test` stays green.

## Report format

Each failure mode tested and its result (pass / fixed / cannot-fix-with-reason). State the server-side capacity assumption you tested against so the event-day runbook (prompt 10) can pre-scale it.
~~~~

### `docs/event-readiness/05-play-economy-loops.md` (whole file)

~~~~markdown
# Audit 5: /play economy, activities, and progression loops

The world's stickiness is its loops: gather, fight, trade, spin, buy cosmetics. Every loop must pay out correctly and every price shown must match what the server actually charges.

## Where the code lives

- Activities and systems: `src/game/play-activities.js`, `src/game/play-systems.js`
- Store/bank/economy UI: `src/game/economy-ui.js`, `src/game/agent-commerce.js`, `src/game/boutique-purchase.js`
- Wheel: `src/game/wheel-station.js`, `src/game/spin-wheel-ui.js`
- Combat: `src/game/combat-system.js`
- Quests: `src/game/quests-ui.js`
- Cosmetics: `src/game/cosmetics-shop.js`, `cosmetics-purchase.js`, `cosmetics-loadout.js`, `cosmetics-wardrobe.js`, `cosmetics-flex.js`
- Items and persistence: `src/game/items.js`, `src/game/world-persist.js`
- Published economy pages (must agree with the game): `/play/economy` and `/play/solver` (routes in `vercel.json`; `api/play/economy.js` imports every number from the same modules WalkRoom prices with, `multiplayer/src/{shop,items,cosmetics-catalog,spin-wheel,economy}.js`, so nothing is transcribed and a mismatch means one side drifted)

## What to audit

1. **Every loop end to end, with a real signed-in session.** Gather from a tree/rock/pond, sell at the store, bank cash, die and confirm the bank protected it, spin the wheel, complete a quest, buy and equip a cosmetic. Each step: correct payout, correct balance update in the HUD without a refresh, correct persistence across a reload.
2. **Price truth.** Cross-check a sample of prices shown in-game against `/play/economy`. Any disagreement is a bug; find which side is stale.
3. **The $THREE boutique.** The cosmetics boutique charges $THREE: verify the full purchase path including insufficient-balance handling (clear message + how to get $THREE, never a silent failure or a raw error toast). `boutique-purchase.js` already maps a short balance to "Not enough $THREE (or SOL for network fees) for this purchase. Get $THREE at three.ws/three-token, then try again.", times out a quote that never arrives, and only unlocks the item after the server's settle notice, never on the client's own "it worked"; verify that path holds rather than rebuilding it.
4. **Race and double-spend.** Double-click every buy/spin/sell button fast. Balances must never go negative or double-charge; buttons must disable while a request is in flight.
5. **Edge cases.** 0 inventory, full inventory, extremely long item names, network failure mid-purchase (the UI must reconcile with server state on reconnect, not trust its optimistic update).
6. **Progression feel.** XP and skill levels visible, level-ups celebrated (even minimally), next-unlock always discoverable. If a loop pays out but gives no feedback (no sound/flash/toast), add the feedback; silent success reads as broken.
7. **Wheel odds honesty.** The wheel paytable shown to users must match the server's real odds (that is the published promise of /play/economy).

## Verify

- Full loop walkthrough on `npm run dev` with a signed-in session, then the same on production for read paths.
- Zero console errors during purchases.
- `npm test` stays green; add a test where a payout calculation was wrong.

## Report format

Loop-by-loop pass/fixed table, every price mismatch found and which side you corrected, edge cases now handled.
~~~~

