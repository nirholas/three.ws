# World chat keeps a capped per-world scrollback for late joiners and surfaces the persisted community feed in-world

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/727-plan-play-chat-scrollback-community-bridge.md`.

**Priority:** P2, new capability with clear value (score 54 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

In-world chat is a pure relay: the server broadcasts and forgets, so anyone joining the event late sees an empty chat and no evidence anything is happening. Meanwhile `api/community/messages.js` persists a per-coin message stream that the 3D world never reads. A world with memory feels alive for the 200th arrival as much as for the first, which is exactly the event-night case.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `multiplayer/src/rooms/WalkRoom.js` `_handleChat` (about line 1957) broadcasts only; the 700 ms cooldown and the slur gate (`multiplayer/src/display-name-safety.js` `containsHateSlur`) are enforced there. No history is stored (`grep -n "history\|scrollback" multiplayer/src/rooms/WalkRoom.js` is empty).
- `api/community/messages.js` is a public GET with authed POST (`withAuthRefresh`, 401 `auth_required` on a dead session). The world does not read it.
- UI: chat bar and list in `src/game/coincommunities-ui.js` (sticks to bottom only when near it) and `src/game/coincommunities.css`.
- Storage precedents with Upstash Redis: `api/_lib/builds-store.js` (behind `api/play/builds.js`) and `multiplayer/src/social-hub.js`; the feed writer `multiplayer/src/feed.js` shows the best-effort, never-throw Redis pattern.
- No scrollback module or test exists.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "_handleChat" -A40 multiplayer/src/rooms/WalkRoom.js | head -80
sed -n 1,60p api/community/messages.js
grep -n "chat" src/game/coincommunities-ui.js | head -30
sed -n 1,50p multiplayer/src/social-hub.js
curl -s "https://three.ws/api/community/messages?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&limit=5" | head -c 600
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Add `tests/chat-scrollback.test.js` for a pure module `multiplayer/src/chat-scrollback.js`: append with trim to the cap, TTL expiry, dedupe by message id (never by text), ordering, and that a stored line has already passed the slur gate and contains no wallet address or session id (store the rendered display name only). Use an injectable store interface with an in-memory implementation for the unit test and the real Upstash-backed implementation for production; do not mock the Redis client inside the production path.
2. Implement `multiplayer/src/chat-scrollback.js`: a capped Redis list per world key (coin plus tier), about 200 messages, a TTL of a few days (pick the values, state them in the module header and the report), write on relay, trim on write, best-effort (Redis unreachable means no history, never a thrown error in a handler). Use the same env vars as `multiplayer/src/feed.js`.
3. Wire into `WalkRoom.js`: write after a line passes cooldown and the slur gate; on join send ONE batched `chat_history` message with the tail (never N replays). Keep ids stable so the client can dedupe.
4. Client rendering in `coincommunities-ui.js`: build the history DOM off-screen and attach it once; render it muted with timestamps and a "you're caught up" divider; never steal focus or scroll position from someone mid-conversation; dedupe against live messages by id so a refresh mid-conversation shows no duplicates. Add hover, focus-visible, active states and an empty state ("No messages yet. Say hi.").
5. The bridge, chosen deliberately: add a read-only tab or pinned board in the chat panel showing the persisted community stream from `GET /api/community/messages` for the world's coin, with skeleton loading, an empty state and an error state with retry. Decision recorded in the report and in the docs: in-world chat does NOT write into the community stream by default (different expectations: persistent public record versus ephemeral room chat, and the community POST requires a signed-in user while world chat allows guests); the bridge is read only. If you choose otherwise, justify the privacy reasoning in the docs.
6. Privacy: no long-term archive, no wallet addresses or session ids stored, trimmed lines are gone for good. Add a test proving a trimmed message is unrecoverable from the module.
7. Browser verification with two browsers on `npm run dev` and the multiplayer server: chat in one, join late with the other and see the tail with the divider; live messages continue seamlessly; cooldown and slur gate still enforced on the stored path; the bridge tab shows real persisted community messages for $THREE. Report the join-time payload size for a full tail.
8. Docs: a section in `docs/play-live-events.md` or a new `docs/play-chat.md`, `STRUCTURE.md` row if a new file class lands, `data/changelog.json` entry, `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/chat-scrollback.test.js` passes (trim, TTL, dedupe by id, privacy, unrecoverable trim).
- [ ] `tests/multiplayer-server-boot.test.js` and `tests/walkroom-activity.test.js` still pass.
- [ ] Browser: late joiner sees the tail and divider; a refresh shows no duplicate lines; the bridge tab renders real messages.
- [ ] The tail is sent as exactly one message on join (asserted in a test or shown in the network log).
- [ ] No console errors or warnings from the new code.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Upstash credentials locally | The module's in-memory store backs local runs exactly as `social-hub.js` does; production uses the Upstash env already on the multiplayer service. Verify Redis writes with a read-after-write script against the QA env if available, otherwise state it was not run. |
| Multiplayer server not running locally | Start it per `multiplayer/README.md`, or drive `WalkRoom` through the in-process pattern in `tests/walkroom-activity.test.js`. |
| `api/community/messages` empty for the coin | Post one test message as the QA user (the self-unblock playbook has the QA login) and verify the bridge renders it. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/727-plan-play-chat-scrollback-community-bridge.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `727-plan-play-chat-scrollback-community-bridge.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/20-world-chat-scrollback.md` (whole file)

~~~~markdown
# Feature 20: chat scrollback and a persistent world record

In-world chat is a pure relay: the server broadcasts and forgets, so everyone who joins the event late sees an empty chat and no evidence anything is happening. Meanwhile `api/community/messages.js` persists a per-coin message stream that the 3D world never reads. Give the world a memory: late joiners get scrollback, and the room's page-level community feed and the in-world chat stop being strangers.

## Where the code lives

- The relay today: the chat handler in `multiplayer/src/rooms/WalkRoom.js` (700ms cooldown and slur gate already enforced there; keep both)
- Persisted community chat (separate system): `api/community/messages.js` (public GET; POST as the signed-in user now refreshes the 1 h access token off the refresh cookie first via `withAuthRefresh`, and a genuinely dead session answers `401 auth_required` rather than the `posting_locked` the composer renders as "this world does not take posts"; a bridge that writes in-world chat into this stream inherits that contract)
- Chat UI: the chat bar and message list in `src/game/coincommunities-ui.js` (it already sticks to the bottom only when the reader is near it, so a history tail must not fight that), styles in `src/game/coincommunities.css`
- Name safety: `multiplayer/src/display-name-safety.js` (`containsHateSlur`, applied to names on join and to every chat line in the relay)
- Storage precedents: Upstash Redis usage behind `api/play/builds.js` (`api/_lib/builds-store.js`) and in `multiplayer/src/social-hub.js`

## What to build

1. **Server-side scrollback.** Persist relayed chat per world (coin plus tier) in a capped Redis list (on the order of 200 messages with a TTL of a few days; pick values and state them). Write on relay, trim on write. On join, the room sends the recent tail so a new arrival scrolls up into the last stretch of conversation instead of a void.
2. **Rendered as history.** Scrollback renders visually distinct from live messages (muted, timestamped, a "you're caught up" divider), loads without jank, and never steals focus or scroll position from someone mid-conversation.
3. **One bridge, chosen deliberately.** Surface the persisted community stream (`api/community/messages.js`) inside the world as a read tab or pinned-board view, so page-side conversation is visible in-world. Decide whether in-world chat also writes into that stream; whichever way you choose, record the decision and the privacy reasoning in the report. Do not silently merge two systems with different expectations.
4. **Privacy and safety.** Scrollback stores display names as rendered (already passed through name safety), never wallet addresses or session identifiers. The existing slur gate applies to everything stored. A player's messages disappear from scrollback when trimmed; no long-term archive is being built here.
5. **Event-night behavior.** Under load the tail send must be one batched message on join, not N replays; the client renders it in one frame's worth of DOM work (build off-screen, attach once).

## Verify

- Two browsers on `npm run dev`: chat in one, join late with the other, and see the tail with the divider; live messages continue seamlessly after it.
- Cooldown and slur gate confirmed still enforced on the stored path.
- Refresh mid-conversation: scrollback plus live picks up without duplicates (dedupe by message id, not text).
- The bridge tab shows real persisted community messages for the $THREE coin. `npm test` green, with a unit test for trim and dedupe logic.

## Report format

Files shipped, the cap and TTL chosen, the bridge decision and why, join-time payload size for a full tail, and the `data/changelog.json` entry.
~~~~

