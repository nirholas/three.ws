# Add Slack, WhatsApp and voice-call adapters to the agent gateway

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/708-plan-gateway-slack-whatsapp-voice-adapters.md`.

**Priority:** P2, new capability with clear value (score 60 of 100 inside the tier). **Area:** gateway. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agents reach people only on Discord and Telegram. Slack is where teams work, WhatsApp is where consumers are, and voice is the natural interface for a talking 3D avatar. The adapter framework in `workers/agent-gateway` makes each adapter a bounded file, so this is the cheapest reach expansion available.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/agent-gateway/src/adapters/` holds `discord`, `telegram` and `index` only.
- `api/gateway/{connections,discord,telegram,...}.js` and the `/settings/connections` page exist.
- Missing: Slack, WhatsApp and voice adapters, their webhook routes, connection UI cards, tests.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls workers/agent-gateway/src/adapters api/gateway
sed -n 1,80p workers/agent-gateway/src/adapters/index.js
ls tests | grep -i gateway; ls workers/agent-gateway
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read the adapter contract in `adapters/index.js` and the Telegram adapter as the reference.
2. Tests first in the worker's suite: each adapter verifies inbound signatures (Slack signing secret with timestamp window, WhatsApp `X-Hub-Signature-256`), rejects replays, maps a fixture inbound event to the common message shape and an outbound reply to the platform payload.
3. Implement `slack.js` (Events API, `url_verification`, threads, slash command), `whatsapp.js` (Cloud API webhook verify and message send, 24h window handling), `voice.js` (Twilio-style media stream or WebRTC bridge feeding the existing STT and TTS in `api/_lib/tool-gateway/speech.js` or the agent voice path; confirm which exists in Step 0).
4. Routes `api/gateway/slack.js`, `api/gateway/whatsapp.js`, `api/gateway/voice.js` plus `vercel.json`, connection records through the existing `connections.js` with encrypted tokens.
5. `/settings/connections`: cards for the three with connect steps, status, last message time. States: skeleton, empty, error with retry, hover/focus/active.
6. Docs `docs/gateways.md`, worker README, changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Worker tests pass including signature and replay refusals.
- [ ] A Slack test workspace round trip (message in, agent reply out) observed locally with a tunnel, or fixture-signed requests against the local worker if no workspace credentials exist.
- [ ] `/settings/connections` verified in a browser in all states.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Slack or Meta app credentials | Build against fixture-signed webhooks, document app creation steps in the doc, list the env vars. Creating the apps is owner-only. |
| Voice carrier | Implement the WebRTC/browser path first; telephony adapter behind an env flag. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/708-plan-gateway-slack-whatsapp-voice-adapters.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `708-plan-gateway-slack-whatsapp-voice-adapters.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/24-more-gateways-and-voice.md` (whole file)

~~~~markdown
# 24. Slack, WhatsApp, Signal, SMS, email and voice on the agent gateway

Read `docs/prompts/README.md` first.

## The problem

Prompt 13 adds Telegram and Discord. Users also live in Slack, WhatsApp, Signal, SMS and email, and send voice notes. The gateway worker should be the single process that serves all of them with the same pairing, approval and continuity rules.

## Build

Extend `workers/agent-gateway/` with adapters behind the same `Gateway` interface:

- **Slack:** app with Socket Mode for development and Events API in production, slash commands, DM and channel mentions, Block Kit approve and cancel buttons.
- **WhatsApp:** Cloud API business number, template messages for outbound notifications, interactive buttons for approvals.
- **Signal:** through a maintained bridge container deployed on Cloud Run with its own `cloudbuild.yaml`.
- **SMS:** through the messaging provider already on the account if one exists, otherwise list the credential as the single missing var; approvals by reply code, never by free text.
- **Email as chat:** an agent mailbox from prompt 11 accepts threaded replies as messages.
- **Voice:** inbound voice notes transcribed with the speech path in `docs/assistant-widget.md`; outbound replies optionally spoken with the TTS path used by the announcement voice (`docs/announce-voice.md`) when the user enables "voice replies".
- **Continuity:** every channel writes to the same thread with a channel tag; `/settings/connections` shows all links; notifications choose the channel the user prefers.
- Docs: `docs/chat-gateways.md` extended; `workers/agent-gateway/README.md`; changelog entry tagged `feature`.

## Acceptance

- Pair Slack and WhatsApp to the QA account and receive the wallet balance on both.
- A voice note asking for the portfolio returns a text and a spoken reply.
- A swap approval from any channel stops at the owner confirmation table (gate 1).
- `npm test` green.
~~~~

### `docs/prompts/13-chat-gateways.md` (whole file)

~~~~markdown
# 13. Chat gateways: talk to your agent from Telegram and Discord

Read `docs/prompts/README.md` first.

## The problem

Telegram is outbound only today (alerts, digests, the changelog push in `api/cron/changelog-push.js`, launch delivery in `api/pump/[action].js`). Discord appears only as embed card metadata. The one conversational bot in the tree, `workers/okx-chat-bot/`, is a partner lane, not a three.ws agent gateway. A user cannot open Telegram, message their agent, get a reply that used the agent's tools and wallet, and continue the same conversation on the web. The best agent platforms live where the user already is, from a single gateway process, with continuity across surfaces.

## Build

### Gateway worker

A new `workers/agent-gateway/` (Node, Cloud Run, its own `cloudbuild.yaml` pinning the build and runtime service accounts, README) that runs Telegram (grammY or telegraf, whichever is already a dependency; otherwise grammY) and Discord (discord.js) adapters behind one `Gateway` interface: `onMessage`, `sendText`, `sendMedia`, `sendChoice` (buttons), `editMessage`, `typing`. Long polling for Telegram in development, webhooks in production (`api/gateway/telegram.js`, `api/gateway/discord.js` verify signatures and enqueue). Both tokens come from the Cloud Run env (`TELEGRAM_BOT_TOKEN` exists; add `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`).

### Pairing

`/start` on Telegram or `/three link` on Discord prints a code; the user redeems it with `POST /me/link-code/redeem` from prompt 05 (through the settings page `/settings/connections`, in `data/pages.json`) or pastes a code the site generated. A migration for `gateway_links` (platform, platform user id, chat id, account, default agent, created, revoked). `/agents` lists the account's agents; `/use <agent>` sets the default for that chat; `/unlink` revokes.

### Conversation

- Every message runs through `POST /agents/:id/messages` from prompt 05 with a `channel` field, so history is one thread across web, Telegram and Discord (`three://agents/{id}/chat` shows all of it with the channel tag).
- Tool calls stream as a typing indicator plus a compact "working: swap_quote" status line edited in place; the final reply carries links to signatures and pages.
- Financial tools: the confirm flag is never set from chat text alone. The gateway renders the preview as a message with Approve and Cancel buttons; only the button press with the matching `preview_id` sets the flag, and it expires with the preview. The prompt 03 policy applies unchanged, including the per-key tool tier.
- Voice notes on Telegram are transcribed with the speech path already used by the assistant widget (`docs/assistant-widget.md`); images go to the vision path (`docs/3d-vision.md`).
- Slash commands on both platforms: `/balance`, `/portfolio`, `/runs`, `/launches`, `/help`, plus `/new` to start a fresh thread.
- Rate limits per link, and the gateway refuses to pair a chat to more than one account.

### Outbound continuity

Notifications from `api/_lib/notify-prefs.js` gain `telegram` and `discord` channels that deliver to the linked chat: alerts, run completions, received bids, incoming mail, so the user can reply in place.

## Docs and wiring

`docs/chat-gateways.md` (new) linked from `docs/start-here.md`: pairing, commands, what can and cannot be approved from chat, privacy. `workers/agent-gateway/README.md`. Cloud Scheduler is not needed; note the webhook URLs in `docs/ops/gcp-production.md`. `STRUCTURE.md` rows. `data/changelog.json` entry tagged `feature`.

## Acceptance

- Pair a Telegram chat with the QA account, ask "what is my balance", and receive the same number the web wallet shows.
- Ask for a swap: receive a preview with buttons; Cancel leaves no transaction; Approve stops at the owner's confirmation table in your report (gate 1).
- The exchange appears in the web chat history with the channel tag.
- Same on Discord in a server the owner controls.
- `npm test` green with adapter unit tests and webhook signature tests.
~~~~

