# /play world moderation with host mute, kick, ban and player reports

**Status (2026-11-04):** Code, tests, CLI and runbook are committed (5944e12c5). Verified: 21 unit tests, a live signed e2e against a real multiplayer server (list, mute, unmute, kick, 401 on bad or missing signature), and a browser run of the report dialog and muted strip. Remaining for the owner: redeploy the multiplayer service with `multiplayer/deploy-cloudrun.sh`, set `UPSTASH_REDIS_REST_URL`/`_TOKEN` on it for ban persistence, run `npm run i18n:translate` once Vertex billing is restored (non-English locales fall back to English).

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/741-plan-play-world-moderation-mute-kick-report.md`.

**Priority:** P2, new capability with clear value (score 46 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The /play world hosts public live events (the IBM-community sessions, plaza shows, the Forge-Off kickoff plan) with strangers in voice and text chat. The only moderation the multiplayer service has is a narrow hate-slur filter on chat and display names plus a 700 ms per-client chat cooldown. The IBM event offer map states it directly: "There is no mute and no kick. Name a moderator, and keep the announce script open in a terminal." A single abusive guest can only be handled by restarting a room. Partners and sponsors will not co-host an event without this, and it is the smallest of the "worth building before the next session" items that has not shipped.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `multiplayer/src/rooms/WalkRoom.js` `_handleChat` (around line 1941): `containsHateSlur` drop and the 700 ms cooldown only. No mute, kick, ban or report message handler is registered (handler list at lines ~656 to 726).
- `multiplayer/src/index.js` has HMAC-signed internal webhooks (`/internal/notify`, `/internal/stage`, `/internal/announce`) whose signature scheme lives in `multiplayer/src/presence-token.js` (`verifyAnnounceSignature`, 120 second window, `MULTIPLAYER_SHARED_SECRET`). The matching signer for operators is `scripts/announce-play.mjs`.
- `src/game/friends-panel.js` has a per-user client-side mute only; nothing host-level.
- Identity fields available on a joined client: `client.userData.account` (wallet), `accountUid`, `playerKey`, guest tokens (`multiplayer/src/guest-token.js`). Voice is signaled through `voice-state` and `voice-signal` (the voice path needs to honor mute too).
- Event readiness items such as scrollback, projector mode and the plaza stage are shipped (`src/game/plaza-stage.js`, `docs/event-readiness/`), so moderation is the remaining blocker called out in `docs/ibm-event-offer-map.md`.
- Tests beside it: `tests/walkroom-*.test.js` (for example `tests/walkroom-build-perms.test.js`), `tests/display-name-safety.test.js`, `tests/multiplayer-server-boot.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -n "mute\|kick\|ban\b\|report" -i multiplayer/src/rooms/WalkRoom.js | grep -vi "ball:kick\|_handleBallKick" | head
grep -n "internal/" multiplayer/src/index.js
sed -n 1,40p scripts/announce-play.mjs | head -5
ls multiplayer/src | grep -iE "moder|block|ban"
```

If any of mute, kick or report already exists, build only the missing pieces.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Add `tests/walkroom-moderation.test.js` following `tests/walkroom-build-perms.test.js`: failing cases for (a) a muted session's `chat` is not relayed and its `voice-state`/`voice-signal` are not forwarded, while an unmuted peer still chats; (b) a mute expires after its duration; (c) a kicked session is disconnected with a distinct close code and a `notice` explaining why; (d) a banned `playerKey`/`account` is refused at join with a typed error; (e) a signed `/internal/moderate` request with a stale or wrong signature is rejected with 401 before reaching a room.
2. New module `multiplayer/src/moderation.js`: a small store of `{ key, kind: 'mute'|'ban', until, reason, by }` keyed by stable identity (account wallet, `accountUid`, `playerKey`), with expiry sweep. Persist bans through the store the multiplayer service already uses for durable state (inspect `multiplayer/src/block-store.js` and the account store the service writes to); if none is durable across restarts, persist through a new signed API endpoint `api/internal/play-moderation.js` backed by a new migration (`api/_lib/migrations/<ts>_play_moderation.sql`, applied with `npm run db:migrate` only after reading `npm run db:status`).
3. `WalkRoom.js`: add `report` (rate limited; body `{ targetSessionId, reason }`) and enforce mute in `_handleChat`, `voice-state`, `voice-signal`, `emote` broadcast, and plaza stage chat. Enforce ban in `onAuth`/`onJoin` before a seat is taken. Automatic action: when 3 distinct reporters flag the same target within 5 minutes, apply a 10 minute mute and log it; never auto-ban.
4. `multiplayer/src/index.js`: `POST /internal/moderate` with the same HMAC, timestamp and body-hash scheme as `/internal/announce` (add `verifyModerateSignature` to `presence-token.js` using the prefix `moderate:`), supporting `action: mute|unmute|kick|ban|unban|list`, a target selector (name, sessionId or account) and an optional coin world. Reply with what matched.
5. Operator tool `scripts/moderate-play.mjs` mirroring `scripts/announce-play.mjs` (same `.env` loading and signing): `node scripts/moderate-play.mjs list`, `mute <name> --minutes 15 --reason "..."`, `kick`, `ban`. Add `npm run play:moderate`.
6. Client in `src/game/` (the nameplate or player card menu and the chat panel): a "Report" action on another player, a visible "You have been muted for N minutes" state when the server sends the notice, and for moderators nothing extra in the client (they use the script). States: hover, focus-visible and active on the Report control, a confirmation step with the reason picker, an error state when the report fails with Retry, and keyboard operation. Add the strings to the play locale files.
7. Docs: add a "Moderation" section to `docs/event-readiness/LIVE-OPS.md` with the moderator runbook, update the moderation row in `docs/ibm-event-offer-map.md` (no longer "no mute, no kick, no ban"), add `multiplayer/README.md` coverage of the new endpoint, a `data/changelog.json` entry, and run `npm run build:pages`.
8. Deploy surface note for the report: the multiplayer service deploys separately from the API (`multiplayer/deploy-cloudrun.sh`); say in the report which services changed. Do not deploy.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test tests/walkroom-moderation.test.js` exits 0; before the fix at least cases (a) to (d) failed.
- [ ] `node scripts/moderate-play.mjs --server http://localhost:2567 list` against a locally running multiplayer server (`cd multiplayer && npm start`) returns the live players, and `mute` on one stops their chat reaching a second browser tab in the same room.
- [ ] A signed request with a wrong secret to `/internal/moderate` returns 401 (curl transcript in the report).
- [ ] In a real browser with two tabs, Report on the other player shows the confirmation, the muted player sees the muted notice, and no console errors appear.
- [ ] `grep -n "no mute" docs/ibm-event-offer-map.md` no longer matches the old claim.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No durable store in the multiplayer service | Add the signed API persistence path in task 2 with a migration; check `npm run db:status` before `npm run db:migrate` |
| Guests have no stable identity | Key guest bans on the guest token subject plus a hashed IP bucket, with short expiry, and document the limitation |
| Local multiplayer server will not boot | Follow `multiplayer/README.md` and `tests/multiplayer-server-boot.test.js` for required env; use the `MULTIPLAYER_SHARED_SECRET` fallback chain documented in `presence-token.js` |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/741-plan-play-world-moderation-mute-kick-report.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `741-plan-play-world-moderation-mute-kick-report.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/ibm-event-offer-map.md`
- `docs/event-readiness/LIVE-OPS.md`
