# Mount the plaza stage in /play and write the show client so a crowd can attend a live hosted show in the world

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/704-plan-play-plaza-live-show-mount-and-client.md`.

**Priority:** P2, new capability with clear value (score 66 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Living Stages (an embodied AI host with spatial voice, lip-sync, captions, an audience question queue and a verified on-chain $THREE tip leaderboard) works at `/stage` but is unreachable from the $THREE world, which is where the events happen. The next community meetup is 2026-11-06 (`public/event.json`, "$THREE Community Meetup #3"), and a hosted show inside the plaza is the strongest in-world moment available. Half of the build landed (landmark, server footprint, API claim) but nothing mounts it and the show client the landmark lazy-imports does not exist, so the feature is dead code.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Exists: `src/game/plaza-stage.js` (593 lines; class `PlazaStage({ scene, camera, getPlayer, coin, ui })`, marquee canvas, proximity gate, 45 s show-state poll, `interact()`, `ask(text)`, `isAttending()`, anchors `hostAnchor` and `audienceAnchor`, button `btn`); `multiplayer/src/plaza-stage.js` (`plazaStageId(mint)` is uuidv5 of the mint); `PLAZA_STAGE`, `stageInRange`, `stageMarqueeInRange` in `multiplayer/src/world-features.js`; `api/stage/index.js` (`GET /api/stage?coin=<mint>`, `POST /api/stage { action: 'plaza', agentId, coinMint }`), `api/stage/tip.js` (on-chain verified, idempotent per signature), `api/stage/host.js`, `multiplayer/src/rooms/StageRoom.js` (messages `reaction`, `question`, `heartbeat`), `src/stage-net.js` (`StageNet`, events host/utterance/audience/tip/leaderboard/reaction), `src/shared/stage-voice.js` (`StageVoice`, `MouthTarget`, `findHead`, `modelHeight`), `src/shared/agent-tip.js` (`tipAgent`, `TipError`).
- Missing: `src/game/plaza-stage-show.js` does not exist (`plaza-stage.js` line ~332 does `await import('./plaza-stage-show.js')` and expects a class `PlazaStageShow` with constructor options `{ stageId, coin, camera, hostAnchor, audienceAnchor, ui, detail, onShowState }` and methods `start()`, `dispose()`, `setStageDetail(data)`, `togglePanel()`, `ask(text)`).
- `src/game/coincommunities.js` imports and constructs `WheelStation` (line ~1851) and `WarPortal` (line ~1878) but never `PlazaStage` (`grep -rn "plaza-stage" src/game` finds only the module itself).
- Tests: `tests/stage-show.test.js`, `tests/stage-split.test.js`, `tests/stage-host-line.test.js` cover the server show logic; nothing covers the game-side landmark or client.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
ls src/game/plaza-stage-show.js
grep -rn "plaza-stage" src/game multiplayer/src --include=*.js | grep -v "^src/game/plaza-stage.js"
grep -n "PlazaStage\|WheelStation\|WarPortal" src/game/coincommunities.js | head
curl -s "https://three.ws/api/stage?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump" | head -c 600
sed -n 1,60p src/shared/agent-tip.js
```

Skip any task whose artifact already exists and works.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Mount the landmark. In `src/game/coincommunities.js`, construct `PlazaStage` next to the wheel station and war portal with `scene`, the follow camera, a `getPlayer` returning the local avatar pose, the world's coin and `this.ui`; call its per-frame update from the main loop beside the other stations; route the E-key interact chain to `plazaStage.interact()` (it must stay synchronous); route the chat bar to `plazaStage.ask(text)` when it returns something other than `'away'` (a question to the host, not a chat line); dispose it in the world teardown. Only mount in worlds that have a coin mint.
2. Write `src/game/plaza-stage-show.js` exporting `PlazaStageShow` with exactly the interface above, built around `StageNet` (join `stage_world` filtered by `stageId`, listen to `host`, `utterance`, `audience`, `tip`, `leaderboard`) and `StageVoice` (TTS via `/api/tts/speak` through a `PositionalAudio` on `hostAnchor`, lip-sync, stop cleanly when a tip beat pre-empts). Load the stage host avatar GLB (from `detail.hostAvatar`) into `hostAnchor` with the same canonicalize and retarget path the world uses for other avatars (`src/game/boot-avatar.js`, `src/glb-canonicalize.js`); fall back to a designed placeholder body if the GLB is blocked, never a T-pose or an invisible host.
3. Audience presence: render the server-dealt ring seats from the `audience` event as marked spots on `audienceAnchor`, add the local player's seat, and show live captions in the panel `togglePanel()` opens. Report state changes back through `onShowState` so the marquee matches what the audience sees.
4. Tips in the world: add a Tip control to the panel that calls `tipAgent` (`src/shared/agent-tip.js`) then `POST /api/stage/tip`. This is an on-chain $THREE spend: before signing, render recipient (the host wallet from `detail.hostWallet`), amount and token in an explicit confirm step every time. Preset amounts only from the existing `TIP_PRESETS` in `src/stage.js` (move them to a shared module if needed). Show `TipError` messages as designed, actionable states (no wallet, insufficient $THREE with the link to get it, user rejected).
5. Lifecycle and cost: `start()` joins only when the player is inside the attend ring; `dispose()` closes the room, stops audio, removes the avatar and frees geometry, textures and listeners. A player who never approaches opens zero stage requests and runs no audio. When no show exists or none is scheduled, the stage stays a quiet landmark (the `unclaimed`, `dark` and `scheduled` marquee states already exist). Honor the reduced-motion and power-saver settings used elsewhere in `src/game`.
6. States: marquee and panel need designed loading (skeleton, not a spinner), empty (no show scheduled, tells the player when the next one is or how a host claims the stage), error (feed offline, retry button wired to `StageNet.retry()`), and hover, focus-visible and active states on every control; keyboard-operable; panel text through the i18n layer.
7. Tests: add `tests/plaza-stage-show.test.js` with a fake `StageNet` event emitter proving join-on-approach, leave-on-walk-away with hysteresis, no network before approach, the tip confirm gate (no signing without confirmation), idempotent display of a replayed tip signature, and full disposal. Add a `tests/plaza-stage-mount.test.js` source-level or harness test that `coincommunities.js` constructs and disposes `PlazaStage`.
8. Browser verification on `npm run dev` with the multiplayer server per `multiplayer/README.md`: create a show via `api/stage/index.js`, go live, open two browsers on the canonical $THREE world, confirm both hear and read the same utterances at the stage, seats are assigned, a question reaches the host, a small test tip (owner-confirmed amount) lands and updates the leaderboard once, and walking away closes the socket (network tab). Record the results in the report.
9. Docs: add a section to `docs/play-live-events.md` (or a new `docs/play-plaza-stage.md`), update `STRUCTURE.md` if needed, add a `data/changelog.json` entry, and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `ls src/game/plaza-stage-show.js` exists and `grep -n "new PlazaStage" src/game/coincommunities.js` matches.
- [ ] `npx vitest run tests/plaza-stage-show.test.js tests/plaza-stage-mount.test.js` passes.
- [ ] Browser: a player who never walks within the marquee ring makes zero requests to `/api/stage` or the stage socket (network tab).
- [ ] Browser: with a live show, two clients render identical captions and the leaderboard updates once per tip signature.
- [ ] No console errors or warnings from the new code across join, tip refusal, walk-away and re-approach.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No host agent has claimed the plaza for the $THREE coin | Claim it with `POST /api/stage { action: 'plaza', agentId, coinMint }` using a QA-owned agent on a local or QA world; for production, state the exact claim call in the report. |
| Multiplayer server not running locally | Start it per `multiplayer/README.md`; if the in-process boot test pattern in `tests/multiplayer-server-boot.test.js` is easier, use it for the automated half. |
| TTS provider quota | `/api/tts/speak` already degrades; test with captions-only and note it. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The tip flow is an on-chain $THREE spend. The automated tests use a fake wallet and a recorded settlement fixture only. Any live tip during browser verification needs the user's explicit yes on recipient, amount and token; batch that ask into one message at the end and otherwise verify the confirm gate without signing.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/704-plan-play-plaza-live-show-mount-and-client.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `704-plan-play-plaza-live-show-mount-and-client.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/17-plaza-live-show.md` (whole file)

~~~~markdown
# Feature 17: live hosted show on a plaza stage inside /play

The platform already has Living Stages: an embodied AI host runs a real-time show with spatial voice, lip-sync, synced captions, an audience question queue, and a verified on-chain $THREE tip leaderboard where a tip pre-empts the host's next line in about a second. All of it works, and none of it is reachable from the world yet. Half of this build has landed: `src/game/plaza-stage.js` is the landmark (platform, canvas marquee via `screen-texture.js`, a proximity gate, a 45 s show-state poll while a player is near), `multiplayer/src/plaza-stage.js` derives the stage id, `PLAZA_STAGE` in `multiplayer/src/world-features.js` is the server-validated footprint, and `api/stage/index.js` answers `GET /api/stage?coin=<mint>` and claims a plaza with `POST /api/stage { action: 'plaza', agentId, coinMint }`. But nothing imports `plaza-stage.js` (`coincommunities.js` never mounts it), and the show client it dynamically imports on first proximity, `src/game/plaza-stage-show.js`, does not exist. Finish it: mount the landmark and write the show client so the event crowd can attend a show without leaving /play.

## Where the code lives

- Show engine (server): `multiplayer/src/rooms/StageRoom.js`, `multiplayer/src/stage-show.js` (the pure `ShowDirector` with beats OPENER, TIP_SHOUTOUT, ANSWER, BANTER, GAME), `multiplayer/src/stage-schemas.js`, `multiplayer/src/stage-registry.js`. Room registered as `stage_world` with `filterBy(['stageId'])` in `multiplayer/src/index.js`
- Show client (page-level, reuse it): `src/stage.js`, `src/stage-net.js`, `src/stage-element.js`, served at `pages/stage.html`. The host's performance is already extracted out of that page into `src/shared/stage-voice.js` (`StageVoice`: fetches `/api/tts/speak`, routes it through the host's `PositionalAudio`, taps an `AnalyserNode` for lip-sync, and stops cleanly when the next beat pre-empts it), written to be imported by the plaza show client too
- Show API: `api/stage/index.js` (directory, create, golive, endshow, `nextShowAt` scheduling, plus the `?coin=` read and the `plaza` claim; one `stageDetail()` serves the `?id=` and `?coin=` reads so /stage and the plaza never see two shapes of the same show), `api/stage/host.js` (the host's words; the prompt names $THREE as the only coin the host may mention, and `sanitizeLine` strips control characters and dashes from every spoken line before it becomes a caption), `api/stage/tip.js` (on-chain verified, idempotent per signature); host voice via `api/tts/speak`
- The world to mount into: `src/game/coincommunities.js` (main scene), landmark placement precedent in `src/game/wheel-station.js` and `src/game/home-town.js`; server-validated landmark coordinates in `multiplayer/src/world-features.js`
- Multiplayer client for the world room: `src/game/community-net.js` (Colyseus `walk_world`); the stage join is a second, concurrent room connection

## What to build

1. **The stage landmark.** Built in `src/game/plaza-stage.js` but not mounted: construct it from `coincommunities.js` next to the wheel station and the war portal. The marquee already reads the show state from `GET /api/stage?coin=`: live now, next show time (`nextShowAt`), or a designed idle state. The footprint is `PLAZA_STAGE` at (18, 26) with a 5 m radius in `world-features.js`; the attendance ring around it is `STAGE_ATTEND_REACH` (8 m past the edge, so 13 m from the stage centre), sized to contain the golden-angle seat ring StageRoom deals out (`RING_RADIUS` 6 m plus 1.6 m per concentric ring, so 6.0/7.6/9.2 m from the stage origin). A nearer ring, `STAGE_MARQUEE_REACH`, is where the marquee is still legible and where the 45 s show-state poll (`REFRESH_MS` in `plaza-stage.js`) runs.
2. **Proximity attendance.** Walking near the stage joins the coin's `stage_world` room alongside the existing `walk_world` connection. `stageId` is already derived: `plazaStageId(mint)` in `multiplayer/src/plaza-stage.js` is uuidv5 of the mint, which is both the `stage_world` `filterBy` key and the `stages.id` a plaza claim writes, so client and server agree offline. Write `src/game/plaza-stage-show.js` (the module `plaza-stage.js` lazy-imports on first proximity) around `stage-net.js` and `src/shared/stage-voice.js` rather than rewriting either: the host avatar on stage speaks with TTS voice, lip-sync, and captions, synced across every attendee. Walking away (past `LEAVE_HYSTERESIS_M`, 3 m beyond the edge) leaves the stage room cleanly.
3. **Audience presence.** Attendees get the server-assigned ring seats StageRoom already deals out, rendered as marked spots in front of the stage; the question queue is reachable from the in-world chat bar while attending.
4. **Tips in-world.** A tip action at the stage that runs the existing `api/stage/tip.js` flow (this is an on-chain $THREE spend: render recipient, amount, and token and get the user's explicit confirmation before signing, every time). The tip leaderboard renders on the marquee, and a landed tip pre-empts the host beat exactly as it does on /stage.
5. **Cost discipline.** Everything here mounts lazily on first proximity and fully unmounts when the show is over and the player leaves. No stage room connection, no TTS fetches, no per-frame work for players who never approach. When no show exists and none is scheduled, the stage is a quiet decorated landmark, not an error.

## Verify

- Two browsers on `npm run dev` (multiplayer server running locally per `multiplayer/README.md` if present, else against the deployed room): create a show via `api/stage/index.js`, go live, and confirm both clients hear and read the same utterances at the stage, seats assigned, question queue round-trips.
- Tip path exercised end to end on a test amount with the confirmation gate shown; leaderboard updates; replaying the same signature does not double-count.
- Walk-away tears down the stage room connection (network tab shows the socket close); a player who never approaches the stage opens zero stage requests.
- `npm test` green.

## Report format

Files shipped, how `stageId` is derived, the join and teardown lifecycle in three sentences, what the marquee shows in each state, and the `data/changelog.json` entry.
~~~~

