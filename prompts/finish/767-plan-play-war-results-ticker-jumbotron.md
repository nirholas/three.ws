# Finished Coin Wars results echo into the world activity ticker and the chart-screen jumbotron

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/767-plan-play-war-results-ticker-jumbotron.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 32 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The Coin Wars portal inside /play is shipped (board, queue, spectate, results toast and a 9 s board takeover on a win). The one open item from its spec is the results echo into the two other shared surfaces: a jumbotron moment on the chart screen and a row in the activity ticker, so a war result is visible to everyone in the world and not just a player standing at the portal. The game server already publishes a `war-result` event to the activity feed; no client consumes it.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Producer: `multiplayer/src/rooms/ClashRoom.js` (about lines 355 to 375) calls `publishFeedEvent({ type: 'war-result', actor, winner, reason, a, b, matchKey, network })`; `multiplayer/src/feed.js` allows `war-result` in `ALLOWED_TYPES`.
- Consumer gaps: `grep -rn "war-result" src multiplayer/src` finds the producer, the allowed-type list and CSS class names only. `src/game/activity-feeds.js` (`createActivityHub`) builds ticker rows from room state, tape and cosmetics but has no war row. `src/game/chart-screen.js` exposes `hype(label, ms)` (5 s band, 60 char cap) used by `celebrate()`.
- `src/game/war-portal.js` `_announce(battle)` is where a finished battle is detected client-side (toast, plus board takeover on a win) from `/api/wars` polling and the `?war=` return link.
- The world mounts `createActivityHub({ ticker, coin, flash })` at `src/game/coincommunities.js` about line 1582 and the portal at about line 1878.
- Tests present: `tests/activity-feeds.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -rn "war-result" src multiplayer/src api --include=*.js | grep -v "\.css"
grep -n "hype(" src/game/chart-screen.js src/game/activity-feeds.js src/game/coincommunities.js
sed -n 1,60p tests/activity-feeds.test.js
grep -n "new WarPortal" -B2 -A12 src/game/coincommunities.js
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Add cases to `tests/activity-feeds.test.js`: a finished-war input yields one ticker row (`kind: 'war'`, highlight on a win for this coin) and one jumbotron flash string within the 60 character cap, neither duplicates when the same `matchKey` is reported twice (portal poll plus return link plus feed), a draw reads as a draw, and untrusted coin names are passed through the existing `cleanLabel`.
2. Add `noteWarResult(battle, { mint })` to the hub in `src/game/activity-feeds.js` producing the ticker row and calling `flash` on a win for this coin (and a quieter row only for a loss or draw). Dedupe by `matchKey` with a bounded set.
3. Single detection point, no second fetch path: have `WarPortal` take an `onResult(battle, outcome)` option invoked from `_announce`, and have `coincommunities.js` pass `(b) => this._activity?.noteWarResult(b, { mint: coin.mint })`. Do not add polling.
4. If worlds in the same room should also see wars involving other communities, decide deliberately: only this coin's wars are shown by default (the portal's own concern). Record the decision in one line in the docs.
5. Browser verification: complete a short war with two browsers as in the portal doc (`docs/coin-wars.md`), return via the link and observe the ticker row and the jumbotron band on a win, once, with the console clean. Verify the ticker row does not appear twice on a refresh of the return link.
6. Docs: a line in `docs/coin-wars.md`, a `data/changelog.json` entry, `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/activity-feeds.test.js` passes with the new war cases (dedupe, draw, loss, cap).
- [ ] `grep -n "onResult" src/game/war-portal.js src/game/coincommunities.js` shows the single wiring.
- [ ] Browser: a won war produces exactly one ticker row and one jumbotron flash; a reload of the return link does not repeat them.
- [ ] No new network request is introduced (network tab shows the same `/api/wars` cadence as before).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cannot field two communities for a real war locally | Unit-test the hub with a recorded `/api/wars` payload for the $THREE world; for the browser half use the `?war=<matchKey>` return path against a real ledger row from `GET /api/wars?coin=<mint>` on production. |
| Another unrelated war-portal change in flight | Keep the diff to the `onResult` hook and the hub method. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/767-plan-play-war-results-ticker-jumbotron.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `767-plan-play-war-results-ticker-jumbotron.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/18-coin-wars-portal.md` (whole file)

~~~~markdown
# Feature 18: Coin Wars portal inside the world

Coin Wars is finished and, since the portal landed, visible. `ClashRoom` runs full community-vs-community battles (lobby, countdown, live, sudden death, kill cap, round clock) with an Elo league behind it, the arena is a real page at /play/war, and every coin world's plaza has a war portal (`src/game/war-portal.js`, constructed by `coincommunities.js`) to see the standings, queue for a war, and come back with the result without leaving /play. The player-facing walkthrough is [docs/coin-wars.md](../coin-wars.md). This prompt is now the spec to verify against and extend, not a blank build.

## Where the code lives

- Server: `multiplayer/src/rooms/ClashRoom.js` (registered as `clash_arena` with `filterBy(['matchKey'])` in `multiplayer/src/index.js`), match logic in `multiplayer/src/clash.js`, league in `multiplayer/src/war-standings.js`, summaries in `multiplayer/src/war-report.js`, schemas in `multiplayer/src/clash-schemas.js`, pairing in `multiplayer/src/war-matchmaking.js` and live-war state in `multiplayer/src/war-live.js`
- Public API: `api/wars.js` (`GET /api/wars?coin=` for the board, `?action=live` for the spectator poll, `POST ?action=queue` and `?action=leave` for the queue, `POST ?action=report` for the game server's HMAC-signed result), backed by `api/_lib/wars-store.js` and the signed war ticket in `api/_lib/war-ticket.js`. Standings are folded from the battle ledger by `war-standings.js`, the same module the arena uses, never recomputed
- Arena client the portal hands off to: `pages/play/war.html`, `src/play/war.js`, `src/play/war-world.js` (ClashRoom is authoritative; the client renders and sends intent), plus `src/play/war-board.js`, the war-room panel every terminal state on that page renders (hand-typed URL, expired ticket, holding that came up short): live battles, the queue, and the top of the Elo ladder off the same `/api/wars` fold the portal board reads, each row linking back into that coin's world. `/play/arena` (`src/play/arena.js`, `arena-world.js`) is the Sniper Arena, the AI-agent trading floor, not Coin Wars; do not route war traffic there
- Gating: the same holder pass as the Holders world (`multiplayer/src/holder-pass.js`, `api/community/holder-pass.js`)
- World mount: the portal in `src/game/war-portal.js` follows the landmark precedent in `src/game/wheel-station.js` and the canvas-board precedent in `src/game/chart-screen.js`; live feed producer `multiplayer/src/feed.js` (`war-result` is an allowed event type)
- Deep-link return path: the canonical URL emission in `src/game/coincommunities.js` (`history.replaceState` in `enter()`)

## What to build

1. **The portal landmark.** Shipped: the board in `war-portal.js` paints this coin's league row, recent battles, and any live war from `GET /api/wars`. Idle cost is zero by design: nothing is fetched until a player is inside the board's legibility ring (`WAR_PORTAL_BOARD_REACH`), the slow poll runs while someone idles near it, and the fast poll only while a war involving this coin is live, the panel is open, or the community is queued. Verify those cadences hold; do not add a second fetch path.
2. **Queue from the world.** Shipped: E at the portal runs the holder gate, `POST /api/wars?action=queue` pairs the community with a waiting one and returns the `matchKey` plus a signed war ticket (ClashRoom takes both competing communities from the ticket, never from a joining client), and the handoff goes to `/play/war` with a return link carrying `coin`, `name`, `symbol`, `image` so coming back lands in the same world with no lobby detour. Verify the round trip both ways.
3. **Spectate without leaving.** Shipped: while a war involving this coin is live the board becomes a scoreboard (score, round clock, kill feed) off the `?action=live` poll, text and numbers only, with the same numbers in the panel's spectator card.
4. **Results echo.** Partly shipped: the game server reports the result through `POST /api/wars?action=report`, `war-result` events go out through `multiplayer/src/feed.js`, and a win holds a 9 s takeover on the board (`HYPE_MS`). Still open: a jumbotron moment on the chart screen, and a ticker row if Feature 15 lands.
5. **Honest empty states.** Shipped for the unranked community, the empty battle log, the unreachable ledger, and the empty kill feed (each says what it is and what to do, e.g. "No wars fought yet. Press E to queue this community, the arena opens as soon as a second one does."). Verify each still renders in the designed style of the lobby's retry cards.

## Verify

- Two browsers on `npm run dev`: queue from the portal in both, complete a short war on the arena page, return via the return link into the same coin world, and see the result echoed on the portal board.
- Holder gating verified both ways: a gated war refuses cleanly with the existing gate UX; an open war admits.
- Portal costs nothing when idle: no polling while no player is near it, no console errors.
- `npm test` green.

## Report format

Files shipped, the standings read path (existing or the one endpoint you added), the handoff and return URL shapes, and the `data/changelog.json` entry.
~~~~

