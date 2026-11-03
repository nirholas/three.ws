# /play world moderation with host mute, kick, ban and player reports

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

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ibm-event-offer-map.md` (whole file)

~~~~markdown
# Everything three.ws can offer an IBM Community event

A working inventory for planning events with the
[Three.ws User Group on IBM Community](https://community.ibm.com/community/user/usergroup?CommunityKey=e71510cc-d953-408f-9a1c-019f5c0a7016).
It answers one question: across the whole platform, what do we actually have that an IBM
audience would show up for, and which of it works today.

It sits beside two existing documents and does not replace them:

- [ibm-next-event.md](./ibm-next-event.md) argues for one headline format (the Forge-Off Open)
  and carries a 12-idea bank.
- [marketing/growth/events/ibm-event-two.md](../marketing/growth/events/ibm-event-two.md) is
  the paste-ready kit for a one-hour in-world session, and
  [three-world-session.md](../marketing/growth/events/three-world-session.md) is the monthly
  template.

Every status below was checked against the code or the live site on 2026-09-18. Anything
IBM-facing that comes out of this document is read against [ibm.md](./ibm.md) and
[badge-usage.md](../marketing/ibm-partner-plus/badge-usage.md) before it ships.

---

## 1. Where we stand today

| Fact | State | Why it matters |
| --- | --- | --- |
| Meetup #2 is already configured | `public/event.json` holds "$THREE Community Meetup #2", Friday 2026-09-25, 16:00 to 17:00 UTC, souvenir `star-shades-meetup-2`. Committed in `0e184e441`, passes `npm run check:event`. **Not deployed**: the live `/event.json` still answers the no-event state | The date exists in the repo and nowhere else. IBM Community shows 0 upcoming events, and T-7 is today |
| The first meetup | 2026-08-07, nine hours inside `/play`, peak 3,145 concurrent avatars in the open world | The format is proven and the audience is mostly the open world, not the 18 group members |
| Group size | 18 members, 7 blogs, 8 threads, 2 past events | Small. Events should recruit into the group, not assume it |
| No IBM model is serving in production | Verified live: `/api/ibm/galaxy` answers `watsonx_not_configured` and `/api/guardian/assess` answers `guardian_unconfigured`. The Cloud Run service carries no `WATSONX_*` and no `GRANITE_GUARDIAN_*` variable, and the self-hosted Guardian GPU worker in `workers/granite-guardian/` is not deployed | Every idea below marked "needs Granite" is code-complete and dark. Restoring this is the single highest-leverage fix on the page (section 6) |
| One room holds 100 people | `WALK_ROOM_MAX_CLIENTS` defaults to 100 and is not set on the live service. Past the cap, new joiners land silently in a parallel copy of the world | A crowd above 100 does not see itself as one crowd. Host announcements still reach every copy |
| Moderation | Automatic slur gate and rate limits only. No mute, no kick, no ban | Plan a human answer, or build the tools first |
| In-world stage | `StageRoom`, the show director and `/stage` all work. The plaza landmark `src/game/plaza-stage.js` is never imported by the world, and the show module it lazy-loads does not exist | Living Stage shows run at `/stage` today, not inside `/play`. The event-two kit's tour beat that points at a Plaza Stage marquee will find nothing |
| Host broadcast | `node scripts/announce-play.mjs` raises a banner in every live room, HMAC-signed | This is the host microphone that exists |
| Post-event numbers | Nothing records peak concurrency. `/api/play/population` is instantaneous | Leave `npm run event:watch -- --interval 15` running and keep its output, or the recap has no number |

---

## 2. What we can offer, by who is in the room

IBM Community is not one audience. Each group below gets a different hour.

### Non-technical members (the largest untapped group)

Everything here needs no account and finishes in under five minutes.

| Surface | What they do | Event use |
| --- | --- | --- |
| `/forge`, `/create/prompt` | One sentence becomes a textured model or a rigged avatar | The opening "make one with me" beat |
| `/create/selfie`, `/avatar-studio` | One selfie, or a from-scratch builder for the camera-shy | Everyone arrives as themselves |
| `/daily` | A new creative challenge every day with a streak, no sign-up | The retention layer under any event |
| `/ar`, `/ar/view` | Prompt to model to the table in front of you, QR handoff from desktop | One QR on screen, the whole audience places the same object |
| `/portal` | Paste a web address and walk through the site in 3D | Walk through a site the audience names |
| `/diorama` | Describe a scene and walk around inside it | Audience-directed world building |
| `/holo` | A procedural holographic sticker with your own text, downloadable | The 60-second event badge |
| `/walkthroughs/build-your-first-agent` | Five guided steps to a named agent, before sign-in | The safest guided group exercise we have |
| `/timeline`, `/tour`, `/pitch` | Company history as a walkable scene, a narrated site tour, a slide deck with a live avatar in it | Replaces every slide a host would otherwise make |

### Developers

| Surface | What they do | Event use |
| --- | --- | --- |
| Free 3D Studio MCP (`/docs/mcp-studio`) | No-auth server: connect Claude, ChatGPT or Cursor and generate, rig and edit models from chat | The best hands-on lab we have: two minutes to connect, works on any laptop |
| `npm create @three-ws/agent` | One command, one sentence, a rigged character and a demo page. No key, no account | The whole room types the same command |
| `/3d` and `/docs/3d-api` | Keyless text-to-3D and glTF validation over plain HTTP with live OpenAPI | `curl` from the audience |
| `<agent-3d>` and `/studio` | Web component plus a no-code snippet builder | Everyone leaves with a working embed |
| `/cookbook` | Runnable recipes: text-to-3D CLI, parallel asset packs, an MCP 3D tool, a self-correcting generation loop, a CI quality gate | One recipe per breakout |
| `/embed-doctor`, `/inspect`, `/rig-doctor`, `/diff` | In-browser diagnostics, nothing uploaded | A live clinic on attendees' own files and pages |
| `/tty` | `curl three.ws/tty` and a rigged agent walks in the terminal | The one-liner that gets a room typing |
| `/spatial-mcp` | An open, CC0 standard for returning a live 3D scene as an MCP tool result | A standards talk, and an invitation for others to implement it |
| `@three-ws/ibm-watsonx-mcp` | Five watsonx.ai tools on the caller's own IBM Cloud key | **Works today**, because the attendee brings the credentials. The right IBM-specific lab while our own keys are absent |
| `@three-ws/ibm-x402-mcp`, `/api/ibm-mcp` | Granite chat, code, embeddings, document analysis and forecasting, paid per call, no IBM account | Needs our watsonx credentials restored |

### Enterprise, governance and risk people

This is IBM's home audience and the one we have shown the least.

| Surface | What it shows | Event use |
| --- | --- | --- |
| `/ledger` | Every consequential agent decision, its reasoning, its prediction and the outcome, tamper-evident and independently verifiable | The auditability centerpiece |
| `/autopilot-activity` | Every autonomous action, the memory that motivated it, signed and reversible | Explainable autonomy, shown rather than claimed |
| `/payments`, `/pay/simulator` | Budget-limited sessions with spend caps, allowlists and expiry; dry-run a spend policy against real prices with no money moving | "Give an agent a budget, not a key", demonstrated safely |
| `/docs/agent-runtime` | The seven-layer policy engine that preflights every fund-moving tool call | The security architecture talk |
| `/docs/mcp-safety`, `/api/mcp-policy` | What each tool's safety annotation means, and a ready-to-paste allowlist in three profiles | The answer to "can my IT team approve this" |
| `/guardian` | Threshold-approved, time-locked wallet recovery that never exposes a key | Continuity and key management |
| `/brownout`, `/status`, `/guards` | Every fallback proven by breaking its upstream inside the real request path; 90-day uptime; a repo with no CI held correct by local guards | A reliability engineering session that is genuinely unusual |
| `/smart-home` and its privacy pages | An agent that runs a real house and stops to ask before it unlocks, opens or disarms anything; role scopes; data that is never stored | Physical-world consent, the subject of the governance post published to the group on 2026-09-18 |
| `/api/guardian/assess`, `@three-ws/guardian` | Granite Guardian verdicts plus a hash-chained audit ledger and per-period spend caps | The IBM-native governance demo. Dark until Guardian is restored |
| `/agent-identities`, `/pill` | A brand brief becomes a rigged mascot with studio renders; the write-up of rigging a flat logo into a 52-bone character | "We can rig your mascot", made concrete |
| `/concierge`, `/assistant`, `/herald`, `/glance` | One-tag site concierge, floating assistant, a character that announces events with an accessible fallback, an agent card on the Windows widgets board or in Slack | The embeds-on-your-site commercial track |
| 85 locales | The site UI is translated and swapped at runtime | A global community can attend in its own language |

### Accessibility and education

| Surface | What it does | Event use |
| --- | --- | --- |
| `/sign-language` | Avatars fingerspell any word, sign chat replies, and read your fingerspelling back by webcam | The flagship accessibility demo |
| `/sign-mirror` | The avatar forms a letter, the camera grades your handshape and names the finger that is off. On-device, no video uploaded | A group drill with a clean privacy story |
| `/asl-alphabet` | Every letter, the look-alikes, and a reading drill | Five-minute learning exercise |
| `/docs/stage` | Living Stage shows carry live captions and late joiners sync | A captioned Q&A format |
| `/glossary`, `/what-is` | Plain-English definitions and introduction | The handout for people new to all of this |

### Camera, microphone and body demos (the "how is that a browser" moments)

| Surface | What happens |
| --- | --- |
| `/sonar` | Hand gestures steer an avatar with no camera, using an inaudible tone and the microphone |
| `/mocap-studio` | Live webcam facial capture onto an avatar |
| `/lipsync/mic` | The avatar's mouth tracks a live voice |
| `/motion-swap` | Upload a video of yourself and get it back with your avatar performing the motion |
| `/capture` | A phone video of a room becomes an explorable point cloud |
| `/voice` | Hundreds of voices, or clone your own from a short recording |
| `/assembly` | A radial engine and a steam locomotive generated from code with solved linkages and exploded views |
| `/stream` | A GLB whose first 50 KB is already a complete avatar, raced against a classic load |

### Inside the world itself

Verified shipped in `/play`: spatial voice, world chat, emotes and a reaction bar, avatar
switching mid-session, `/forge <prompt>` in chat placing a prop for everyone, collaborative
voxel building that persists, fishing, chopping, mining and cooking, vehicles, a store and
bank, the wheel, quests and an event quest line with a server-scored leaderboard
(`/api/play/event-leaderboard`), King of the Totem and tag rounds, a synced dance floor, a
kickable ball, Coin Wars from a portal in the plaza, the Agent Exchange where one agent pays
another with a real on-chain receipt, photo mode that stamps the event name, synchronized
fireworks, the countdown chip and agenda drawer, and a free event-tier souvenir granted
server-side to everyone present.

Specified but not built (each has a prompt pack in
[event-readiness/](./event-readiness/README.md)): a welcome concierge NPC, a hype ticker,
an in-world invite sheet with QR, chat scrollback for late joiners, parties, a projector or
spectator mode, a signature wall, and judged dance-off rounds. A live event-config override
is also unbuilt, so changing the window means a deploy.

---

## 3. The format menu

Grouped by what kind of event it is. "Ready" means it can run on what is deployed today.
The IBM group rule still applies to all of them: one post a week at most, tutorials that
stand alone, and no token or price content on IBM's platform.

### A. In-world gatherings (the format that drew 3,145)

| # | Format | The hour | Ready |
| --- | --- | --- | --- |
| 1 | **Community Meetup, numbered and monthly** | The configured Sep 25 run of show: build, wear it, forge into the world, an agent pays for a tool, showcase, Q&A, photo | Yes, after a deploy |
| 2 | **Build Night** | One landmark, built together with the voxel tools, left standing. Hosted by voice, progress broadcast with the announce script | Yes |
| 3 | **Quest Hour** | The event quest line switched on for the window, the leaderboard on screen, winners named at the close. Prizes settle manually | Yes |
| 4 | **Furnish the Venue** | Every attendee forges one object for a shared room by typing in chat. The room is the group photo | Yes, with one rehearsed prompt. There is no size ceiling on forged props yet, which is the documented way to crash a phone tab |
| 5 | **Office Hours in the plaza** | No agenda. The team stands at spawn for an hour each week and answers anything. Spatial voice makes it a hallway, not a webinar | Yes |
| 6 | **Docs Walk** | `/docs/world` turns the documentation into 14 walkable pavilions. A guided group walk with stops | Yes |
| 7 | **Living Stage show** | An embodied AI host takes typed questions with captions, monthly, with one human guest | Yes at `/stage`. Not reachable from inside `/play` |
| 8 | **Opening Night** | The month's best community creations curated into a built exhibition, creators present beside their work | Yes, needs curation time |

### B. Workshops in IBM's own webinar format (the 2026-06-23 format)

These fit IBM Community's event tooling directly and need nothing from the world.

| # | Format | The hour | Ready |
| --- | --- | --- | --- |
| 9 | **MCP in ten minutes** | Everyone connects the free 3D Studio server to their own assistant and builds a model from chat, then rigs it | Yes |
| 10 | **watsonx from any MCP client** | Attendees install `@three-ws/ibm-watsonx-mcp` with their own IBM Cloud key and call Granite from their editor. Community-built connector, framed that way | Yes, and the only Granite lab that does not depend on our credentials |
| 11 | **Embed clinic** | Attendees bring a page. `/studio` builds the snippet, `/embed-doctor` names the line that breaks it | Yes |
| 12 | **Bring your own model clinic** | Drop a GLB into `/inspect`, `/rig-doctor` and `/diff`. Nothing uploads, so enterprise attendees can use real assets | Yes |
| 13 | **Agents with budgets** | `/pay/simulator` dry-runs a spend policy, `/payments` shows the session limits, `/ledger` shows the audit trail. No money moves | Yes |
| 14 | **When an agent can open your front door** | The smart-home consent model as a governance case study, following the post already published to the group | Yes as a talk. The Granite Guardian live verdicts need Guardian restored |
| 15 | **Sixty-second speedrun** | A timed race from blank prompt to a live embedded agent. A segment, not an event | Yes |
| 16 | **Open source hour** | The seven verified first issues in [open-source-friday-menu.md](../marketing/growth/events/open-source-friday-menu.md), four of which need no 3D knowledge. A rig that did not animate, animating, by the end | Yes |

### C. Programs longer than an hour

| # | Format | Shape | Ready |
| --- | --- | --- | --- |
| 17 | **The Forge-Off Open** | One week, five daily themes, no-login entry and voting, crowned in-world. Full case in [ibm-next-event.md](./ibm-next-event.md) | Needs a landing page and theme copy. The pitch must say the entry screen is an NVIDIA classifier, not Granite Guardian |
| 18 | **30-Day Forge Streak** | `/daily` wrapped in a leaderboard and weekly prizes | Nearly free |
| 19 | **Sign Week** | A letter a day on `/sign-mirror`, closing with a fingerspelled relay in the world | Surfaces ready. Requires deaf collaborators before it is announced, and must be framed as fingerspelling, one narrow slice of ASL |
| 20 | **Mascot Week** | Companies submit a mascot or logo and get back a rigged, talking agent with a one-line embed. Published as a gallery | Ready. The only format that produces embeds on other companies' sites |
| 21 | **Crews Cup** | A team layer over any other format: an office or a chapter enters as a crew and stands in one HQ | Ready |
| 22 | **Remix chain** | `/creations` tracks lineage. Each entrant remixes the previous entry, and the family tree is the artifact | Ready |
| 23 | **Granite Agent Jam** | A two-week builders division for agents that think on Granite | Needs Granite restored, or entrants bring their own keys through format 10 |

### D. Physical and hybrid

| # | Format | Shape | Ready |
| --- | --- | --- | --- |
| 24 | **TechXchange side meetup** | IBM TechXchange runs 2026-10-26 to 10-29 in Atlanta. Speaking is closed. A user-group gathering, in person or as an in-world session that week timed for attendees, is still open to ask for. `/irl` pins and printable `/irl/sign` sheets give a physical room something to scan | Surfaces ready. The ask goes in the same email as the event date |
| 25 | **World Lines hunt** | Agents placed at real coordinates issue a signed proof of presence at roughly one-kilometre granularity. IBM offices as anchor pins, with a virtual twin of each pin in the world so geography locks nobody out | Surfaces ready, coverage is the work |
| 26 | **Two Rooms, One Stage** | A physical room and the world wired together for a finale | About two weeks of new work, and a single point of failure in someone else's wifi |
| 27 | **Printed prize** | `/materialize` turns the winning model into a printed object with a certificate page at `/cert` | Ready, and the payment step is owner-gated |

### E. What Granite unlocks once it is serving again

All of this is code-complete and tested, and all of it is dark today.

| Surface | The demo |
| --- | --- |
| `/galaxy` | Every public agent placed in 3D by Granite embeddings, searched by meaning |
| `/api/ibm/vision` | Granite Vision reads an avatar image into a full agent identity |
| `/api/ibm/twin` | Granite TimeSeries back-tests itself and runs what-if scenarios |
| `/api/guardian/assess` | Allow, review or block, with a hash-chained ledger and a spend cap that makes an agent refuse |
| Granite as the avatar brain | Provider `watsonx` in the chat proxy, with Guardian inline before any autonomous money action |
| watsonx Orchestrate as the brain | Provider `orchestrate`: a three.ws avatar as the embodied front end of an enterprise Orchestrate agent. For an IBM audience this is the strongest single demo in the repo, and it has never been shown |
| A Granite-hosted Living Stage | The `/stage` host thinking on Granite and taking the community's questions with captions |

Avoid a live model-against-model comparison on any IBM stage. An event where Granite might
place second is not one IBM can co-host.

---

## 4. What we can offer IBM as an institution

Events are one lane. These are the others, and most are already built and waiting on a
single message.

| Offer | State | Blocker |
| --- | --- | --- |
| The 3D Studio MCP server in the watsonx Orchestrate Agent Catalog | Submission pack complete in [agent-connect-listing.md](../marketing/ibm-partner-plus/agent-connect-listing.md), icon built to IBM's spec | One email to `IBMAgentConnect@ibm.com` for the `APP_ID` |
| three.ws framed inside IBM's partner surfaces | Production CSP already allows `*.ibm.com` and `*.seismic.com` to frame the site | Nobody has asked |
| A partner-authored recap on an IBM surface | We supply the recording, screenshots and captured numbers within 24 hours | Part of the event ask |
| A mascot and an in-world home for the user group | `/agent-identities` builds the character, `/crews` gives the group an HQ, `/three` lists branded worlds | Owner decision |
| A souvenir per event | The grant path is server-side and idempotent. Souvenir one was never granted because the world server was on an old build | Redeploy the multiplayer service before every event |
| My Digital Marketing, the Build track Partner Marketing Kit, co-marketing funding, digital badging | Entitled and never requested, per [ibm-partner-plus.md](./partners/ibm-partner-plus.md) | One request |
| IBM Champions self-nomination | Packet written in `marketing/partner-packets/ibm-champions-nomination.md`, waiting on three facts only the nominee can supply. Treat 2026-11-20 as the latest safe date | Owner |
| The two June commitments still open | More co-promotion from IBM, and a page on the IBM domain | The same email as the event date |

---

## 5. A season instead of a single event

One meetup is a spike. The pattern that holds a community is a rhythm, a habit and a
headline, all running at once. Every item below is independently cancellable.

| When | What | Format |
| --- | --- | --- |
| Fri 2026-09-25 | Community Meetup #2, already configured | 1 |
| Weekly from then | Office Hours in the plaza, same hour each week | 5 |
| Early October | MCP in ten minutes, in IBM's webinar format, to recruit developers into the group | 9 |
| Thu 2026-10-15 | The event-two session with an IBM guest, doubling as the Forge-Off Open kickoff | 17 |
| Week of 2026-10-26 | TechXchange week: an in-world session timed for attendees, in person if IBM opens the user-group route | 24 |
| November | "When an agent can open your front door", the governance session, ideally with Guardian live | 14 |
| Tue 2026-11-24 (fallback Nov 17) | Meetup #3, "An agent pays for its own tool", already drafted in the monthly template | 1 |
| Underneath all of it | The 30-Day Forge Streak on `/daily` | 18 |

If only one new thing gets added to a repeat of the meetup, make it a second audience. The
first meetup was a tour. A session for the governance and risk crowd (13 or 14) reaches
the people IBM Community is actually full of, and nobody else can run it inside a product
that does the thing being discussed.

---

## 6. Before Sep 25, in order

1. **Tell IBM.** The date lives only in this repo. Create the event in the IBM Community
   group and send the relationship note. The same message carries the five standing asks
   listed in [ibm-visibility-map.md](./ibm-visibility-map.md).
2. **Deploy.** The event config and the souvenir are committed and not live. The
   multiplayer service needs its own redeploy, or souvenir two repeats souvenir one. Then
   run `node scripts/play-souvenir-conformance.mjs` and `npm run audit:meetup`.
3. **Set the room size.** Decide `WALK_ROOM_MAX_CLIENTS` (ceiling 500) before the doors
   open. One room of several hundred has not been load-tested as a single crowd, so run
   `npm run event:capacity` against the chosen value.
4. **Restore one IBM model.** Either create a watsonx.ai API key and project and set
   `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` on the Cloud Run service, or deploy the
   self-hosted Guardian worker and set `GRANITE_GUARDIAN_URL`. Until one of these lands,
   no Granite claim, no live Granite beat and no `@IBM` tag.
5. **Fix the run of show.** The kit's plaza tour points at a Plaza Stage marquee that the
   world never mounts. Cut that stop or mount the landmark.
6. **Plan moderation.** There is no mute and no kick. Name a moderator, and keep the
   announce script open in a terminal.
7. **Capture the numbers.** Start `npm run event:watch -- --interval 15` before doors and
   keep the log. It is the only source for a headcount.
8. **Refresh the runbook.** [event-readiness/LIVE-OPS.md](./event-readiness/LIVE-OPS.md)
   still carries the first meetup's release SHA and revisions.

Worth building before the October session, smallest first: chat scrollback for late
joiners, a triangle and file-size ceiling on forged props, host mute and kick, mounting the
plaza stage, and a projector mode for a physical room.
~~~~

### `docs/event-readiness/LIVE-OPS.md` (whole file)

~~~~markdown
# LIVE-OPS: $THREE Community Day

One page. Everything an operator needs while the event is running, and nothing else.
Prepared 2026-08-08. Project `aerial-vehicle-466722-p5`, region `us-central1`.

---

## The link and the release

**Event URL** (the canonical $THREE world, from [README.md](README.md)):

```
https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&image=%2Fapi%2Fimg%3Furl%3Dhttps%253A%252F%252Fipfs.io%252Fipfs%252Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q%26seed%3DFeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump
```

**Live release as of this writing:** `c1e600a04` on revision `three-ws-api-00364-n65`.
The world server runs an image built 2026-08-06 (revision `three-ws-multiplayer-00010-g89`).

> The release SHA above is NOT the event build. The event features (quest line,
> photo mode, live event board, `/event` landing page, operator announce, the
> `/population` endpoints) are committed but unshipped. See
> [Ship the release](#ship-the-release-owner-gated) at the bottom. Confirm the SHA
> with `curl -s https://three.ws/api/version` after the deploy and update this line.

---

## Health: three commands that prove the site is up

```bash
# 1. API alive, and which build is actually serving
curl -s https://three.ws/api/version

# 2. API subsystems (x402, monitor, speech, alerts) - status must be "ok"
curl -s https://three.ws/api/healthz | head -c 400

# 3. The world server itself. If this is not {"ok":true}, /play is dead
#    no matter what the site says.
curl -s https://three-ws-multiplayer-93741856042.us-central1.run.app/health
```

Continuous version, one terminal, quiet unless something changes:

```bash
npm run event:watch                  # every 30s
npm run event:watch -- --interval 15 # tighter during the opening rush
npm run event:watch -- --once        # single sweep; exit 1 if anything is down
```

It watches the API, the live release SHA, the `/play` page (including that the
game bootstrap is still in the HTML), the world server, and the live player
count. It is plain HTTPS on purpose: it keeps working when `gcloud` auth has
expired, which it does on its own schedule in this environment.

---

## Logs: two commands for fast triage

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"

# Errors across the whole fleet, last 6h
npm run logs:errors

# The world server specifically - join refusals, origin rejections, room churn
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="three-ws-multiplayer" severity>=WARNING' \
  --freshness=1h --limit=50 --project aerial-vehicle-466722-p5
```

Deeper sweep when the cause is not obvious: `npm run triage:gcp:deep`.

---

## Rollback: pre-filled, per service

**These three revisions are the known-good pre-event state.** They are live right
now and all report Ready. After tomorrow's release deploy creates new revisions,
these are what you roll back TO.

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
R="--region us-central1 --project aerial-vehicle-466722-p5"

# API + frontend
gcloud run services update-traffic three-ws-api $R \
  --to-revisions=three-ws-api-00364-n65=100

# The /play world server (kicks everyone in-world; they auto-reconnect)
gcloud run services update-traffic three-ws-multiplayer $R \
  --to-revisions=three-ws-multiplayer-00010-g89=100

# Redis proxy (presence, durable builds)
gcloud run services update-traffic three-ws-redis-proxy $R \
  --to-revisions=three-ws-redis-proxy-00004-bwk=100
```

Then purge the edge or the CDN keeps serving the bad build:

```bash
npm run deploy:gcp:purge-cdn
```

Return to normal afterwards with `--to-latest` instead of `--to-revisions`.

**Rehearsal result (2026-08-08):** every target above exists and reports
`Ready=True` with 100% of traffic. Traffic was not actually shifted, because
shifting it and back is itself two world-server restarts on the eve of the event;
the commands are the same `update-traffic` calls that created the current
routing, and the revisions are the ones already serving.

---

## Scale: what is set, and how to raise it

Pre-scaled 2026-08-08 (config-only, pre-approved per
[docs/ops/gcp-credits-plan.md](../ops/gcp-credits-plan.md)):

| Service | min | max | concurrency | CPU / memory | changed from |
|---|---|---|---|---|---|
| `three-ws-api` | **6** | 100 | 160 | 2 / 4Gi | min was 2 |
| `three-ws-multiplayer` | 1 | **1 (hard)** | 1000 | **4 / 8Gi** | was 2 CPU / 4Gi |
| `three-ws-redis-proxy` | **3** | **10** | 80 | default | was min 2 / max 4 |

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
R="--region us-central1 --project aerial-vehicle-466722-p5"

# More API headroom (safe, instant)
gcloud run services update three-ws-api $R --min-instances=12 --max-instances=200

# More world-server headroom. NOTE: raise CPU/RAM or concurrency, never max-instances.
gcloud run services update three-ws-multiplayer $R --cpu=8 --memory=16Gi
gcloud run services update three-ws-multiplayer $R --concurrency=2000
```

**`three-ws-multiplayer` max-instances must stay 1.** Colyseus rooms live in one
process. A second instance is only correct when the room registry and presence
are shared through Redis *and* each instance is individually addressable so a
seat reservation lands on the box hosting the room. Cloud Run gives every
instance the same URL, so instance 2 would silently split players in the same
world into two invisible crowds. A Memorystore Redis exists
(`three-ws-redis`, `10.234.231.139:6379`) and `REDIS_URI` would switch the driver
on, but the addressability half is not solved and the eve of an event is not when
to find out. Use CPU, memory, and concurrency instead.

---

## Capacity: measured, not assumed

`npm run event:capacity -- --n 400 --ramp 45 --hold 150` against live production,
2026-08-08:

| | |
|---|---|
| requested / joined | 400 / 400 (100%) |
| held for the full 150s | 400 |
| join latency | p50 155ms · p95 219ms · max 388ms |
| mid-run drops | 0 |
| moves sent / state patches | 269,633 / 415,418 |
| verdict | PASS on all four thresholds |

The single world instance carried 400 concurrent players walking at 8 Hz with
zero drops. The known cliff is the concurrency ceiling: at 1000 simultaneous
connections Cloud Run wants a second instance and `max-instances=1` refuses it.
If the count approaches that, raise `--concurrency`, not `--max-instances`.

One caveat baked into the harness: at 400 clients its own event loop stalls, so
the page-latency figure it prints measures the machine running it, not the
origin. It now prints its own loop lag next to that number and says so. An idle
`curl` during the same run measured `/play` at a steady 420-490ms.

---

## Known failure modes and what to do

Audits 1-9 did not leave an accepted-risk register, so this is derived from the
code's own documented landmines plus what was measured on 2026-08-08.

| If this happens | Why | Do this |
|---|---|---|
| `/play` loads but nobody sees anyone else | World server restarted or a second instance appeared | `curl .../health`; confirm `max-instances=1`; rollback command above |
| Players kicked seconds after joining, phones only | Mobile memory kill, not a network fault | `node scripts/play-mobile-repro.mjs` reproduces it; it reads as bytes, not as a networking bug |
| `/walk` looks completely offline while `/play` works | Someone set `PLAY_GATE_MINT`/`THREE_MINT` on the world server. `/walk` sends no play pass, so every join throws `play_pass_required` (landmine documented in `multiplayer/src/rooms/WalkRoom.js`) | Unset it: `gcloud run services update three-ws-multiplayer $R --remove-env-vars=PLAY_GATE_MINT,THREE_MINT` |
| NPC / concierge replies slow or absent | Paid LLM tier is degraded today: OpenRouter `402 Payment Required`, OpenAI `429`. Vertex Gemini is healthy and the free-first chain leads, so players still get answers (measured 8-16s first token after live demotions) | Nothing during the event. Topping up OpenRouter is an owner spend decision |
| Wallet balances read as zero / holder tier collapses to Member | Helius and Alchemy are both `429` today. 6 free rungs plus the QuickNode reserve carry it (proven by poisoning the primary) | `npm run event:failover` to see which rungs are live now |
| Coin image missing on the event link or OG card | `4everland.io` gateway times out, `gateway.pinata.cloud` is slow (~4s). `api/img.js` races five gateways and takes the first valid one | Nothing. 4 of 5 gateways served the CID on 2026-08-08 |
| An x402 / boutique payment does not settle | `/api/healthz` shows 50,442 settle failures with `fee_runway_exhausted`. This is settle-floor starvation, which looks identical to "the wallets are dry" and has a different fix | Run the `x402-economy-triage` agent BEFORE concluding anything about wallet balances |
| A deploy dies at `npm ci` with "package.json and package-lock.json are not in sync" | Almost certainly NOT a dependency mistake. `FROM node:24-slim` floats, so a newer bundled npm resolves the tree differently and rejects an untouched lockfile. This took the 2026-08-08 release build down | The Dockerfile now pins `ARG NPM_VERSION`. If it recurs, compare `npm --version` locally against `docker run --rm node:24-slim npm --version` and set the pin to the version that produced the lockfile |
| Something breaks and nobody is told | Push alerting is thin. `TELEGRAM_ALERTS_CHAT_ID` is unset in production, so `/api/healthz` reports `telegram_push: "disabled"` and platform alerts land only in the `ops_alerts` table | Email now works: two uptime checks (site + world server) and two alert policies (uptime failure, `three-ws-api` 5xx rate) were created 2026-08-08 and page `nich@sperax.io`. Email is slow, so also keep `npm run event:watch` open on a screen |

---

## Talk to the whole world mid-event

`scripts/announce-play.mjs` pushes a message to every player standing in a live
world, right now. It is the host's microphone: use it to call each agenda beat,
to tell people where to go, and to say anything that cannot wait for chat to
scroll. Requires the world server to be running the event build (the endpoint is
`/internal/announce`; a 404 means the deploy below has not happened yet).

```bash
# Every live world, toast only
node scripts/announce-play.mjs "Totem showdown starts in 2 minutes. Get to the plaza."

# With a title: also raises the centre-screen banner for 12s
node scripts/announce-play.mjs \
  --title "Wheel hour" \
  --detail "Free spin at Fortune's Folly, prizes on every wedge" \
  "Wheel hour is open. Head to the plaza wheel."

# Only the $THREE world, and hold the banner 30s
node scripts/announce-play.mjs --coin FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump \
  --duration-ms 30000 --title "Fireworks" "Look up."
```

It prints how many rooms and players it reached, so `0 player(s)` is your cue
that nobody is in the world yet (or that you targeted the wrong coin). The
request is HMAC-signed with `MULTIPLAYER_SHARED_SECRET` (falling back to
`HOLDER_PASS_SECRET`, which is in `.env`), and the server rejects an unsigned or
stale call, so the endpoint is safe to leave exposed. Announcements ride the same
`notice` channel the game already uses, so they reach every connected client
regardless of which build the player loaded.

---

## Escalation: which tool for which subsystem

| Subsystem | Tool |
|---|---|
| x402 payments, settles, the ring, "wallets are dry" | `x402-economy-triage` agent. Do not diagnose by hand; settle-floor starvation and capital dispersion look the same from outside |
| Cloud Run, crons, logs, DB migrations, TLS, fleet readiness | `gcp-triage` skill, or `npm run triage:gcp:deep` |
| Phones dropping out of the world | `node scripts/play-mobile-repro.mjs` |
| Any page 404/500 across the site | `npm run smoke:prod` |
| A third-party provider suspected down | `npm run event:failover` |
| World capacity under a crowd | `npm run event:capacity -- --n <2x current peak>` |

---

## Ship the release (owner-gated)

Two services, two commands. Both need explicit owner approval.

```bash
# 1. API + frontend (26+ commits ahead of what is live)
npm run deploy:gcp:full

# 2. The world server - required for the event features and /population.
#    Its image predates every event commit.
cd multiplayer && ./deploy-cloudrun.sh
```

`deploy-cloudrun.sh` now defaults to `CPU=4 MEMORY=8Gi` so a redeploy cannot
silently undo the pre-scaling above. `gcloud run deploy` replaces resource limits
on every run, so a hotfix deploy with the old defaults would have halved the
world server's CPU mid-event.

After either deploy: `curl -s https://three.ws/api/version`, then
`npm run event:watch -- --once`, then update the release SHA at the top of this
page.

---

## Open items

1. **`TELEGRAM_ALERTS_CHAT_ID` exists nowhere** (not `.env`, not `.env.local`, not
   the Cloud Run service). Every alerting path in `api/_lib/alerts.js` is already
   wired behind it; it needs one private chat/DM id, which only the owner can
   create. Then:
   `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars=TELEGRAM_ALERTS_CHAT_ID=<id>`
   (`--update-env-vars`, never `--set-env-vars`.) It must be a private chat: alerts
   carry stack traces, URLs, and IPs.
2. **Email alerting now exists; it did not before 2026-08-08.** Created that day
   and wired to the existing verified `nich@sperax.io` channel:

   - uptime check `three.ws API healthz` on `https://three.ws/api/healthz`
   - uptime check `three.ws world server` on the world server's `/health`
   - policy "Event: three.ws or the /play world server is DOWN" (uptime failing
     from more than 2 probe locations)
   - policy "Event: three-ws-api 5xx rate elevated" (5xx above 5/s for 5 minutes)

   Both policies link back to this page. Email is minutes-slow by nature, so it is
   the backstop, not the primary: `npm run event:watch` is the primary.

3. **The release build failed once on 2026-08-08** at the `npm ci` layer, root
   caused to the floating base image (see the failure-modes table). The Dockerfile
   pin is committed; the build has not been re-run since, so the release still
   needs a green build before the deploy commands above are known good.

4. **`gcloud` auth expires on its own schedule here.** It died mid-session
   (`invalid_grant: reauth related error (invalid_rapt)`) and was restored with
   `gcloud auth login --no-launch-browser`. Verify with a real call
   (`gcloud run services describe three-ws-api --region us-central1`), never with
   `gcloud auth list`, which reports an expired account as ACTIVE.

## Removing a signature from the wall

The signature wall (`docs/signature-wall.md`) filters slurs and links on the way in,
but a human can still sign something that should come down. Removal is owner-only
(Bearer `CRON_SECRET`) and by signature id. Find the id in the wall's public read
(`curl "https://three.ws/api/play/signature-wall?limit=50"`, each record has `id`
and `no`) or in a share link (`/api/play/signature-wall-og?id=<id>`).

```bash
curl -X DELETE -H "Authorization: Bearer $CRON_SECRET" \
  "https://three.ws/api/play/signature-wall?id=<id>"
```

Returns `{ "ok": true, "removed": "<id>", "total": N }`, or 404 for an unknown id.
Players in the world drop the tile at their next full reload (within 5 minutes). The
signer's one-signature claim is kept on purpose, so removal cannot be used to
re-sign the same thing.
~~~~

