# Chat gateway worker passes a build-verify and a live Telegram round trip, ready to ship in one command

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/270-plan-gateway-chat-worker-ship-readiness.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 68 of 100 inside the tier). **Area:** gateway. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Telegram, Discord and Signal users cannot talk to their three.ws agents because the consumer of `gateway_inbox` is not running. The receivers in `api/gateway/telegram.js` and `api/gateway/discord.js` already accept deliveries and queue them, so every message sent to a connected bot today sits unanswered. The worker is built and unit-tested, but nobody has proven the production image builds, nor driven one real message through it. Shipping becomes a single owner-approved command only once that proof exists.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/agent-gateway/` has Dockerfile, cloudbuild.yaml, `src/`, `scripts/`, and five test files under `workers/agent-gateway/tests/` (drain, telegram-adapter, discord-adapter, approval-buttons, registry-setup). Its README says "built and tested, not deployed".
- `gcloud run services list` (project aerial-vehicle-466722-p5) shows no `agent-gateway` service. `workers/agent-orders/cloudbuild.verify.yaml` is the existing pattern for a build-only proof; the gateway has no equivalent.
- Receivers exist at `api/gateway/telegram.js`, `api/gateway/discord.js`, `api/gateway/connections.js`. Both gateway migrations are reported applied in production.
- `three-ws-api` carries `TELEGRAM_BOT_TOKEN` and no Discord variables, so a deploy today would load the Telegram adapter only.
- `workers/signal-bridge/` (Dockerfile, cloudbuild.yaml, persist.sh) has no tests and no verify config. Signal needs this bridge before the gateway can reach it.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
gcloud run services list --project aerial-vehicle-466722-p5 --format='value(metadata.name)' | grep -E 'agent-gateway|signal-bridge' || echo "neither deployed"
ls workers/agent-gateway/cloudbuild.verify.yaml workers/signal-bridge/cloudbuild.verify.yaml 2>&1
(cd workers/agent-gateway && npm ci --dry-run >/dev/null && npx vitest run 2>&1 | tail -15)
npm run db:status 2>&1 | grep -i gateway
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json > "$TMPDIR/api.json" && node workers/agent-gateway/scripts/deploy-env.mjs "$TMPDIR/api.json" --print; rm -f "$TMPDIR/api.json"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Add `workers/agent-gateway/cloudbuild.verify.yaml` and `workers/agent-gateway/verify.gcloudignore`, copying the structure of `workers/agent-orders/cloudbuild.verify.yaml`: same Dockerfile, repo-root context, pinned `three-ws-build@` service account, stops before push and deploy. Run it with `gcloud builds submit` and record the build id and result in the worker README.
2. Make the image prove itself at build time: add a final `RUN` (or verify step) that imports the worker entry point and the registry in `workers/agent-gateway/src/` and runs `ffmpeg -version`, so a missing system dependency fails the build instead of the first voice note.
3. Add `workers/agent-gateway/tests/healthz.test.js` covering the `/healthz` payload: loaded adapters, `skipped` list with the reason for each skipped platform, and a non-200 when no adapter loads. Test-first: write it against current behavior, confirm which assertions fail, and fix any gap in `src/`.
4. Add an end-to-end drain test against a real Postgres (use the test database approach already used in `workers/agent-gateway/tests/_db.js`): insert a real Telegram `update` row shaped like the production receiver writes it (read `api/gateway/telegram.js` for the exact columns), run one drain cycle with the Telegram API replaced by the existing recorded fixtures in `workers/agent-gateway/tests/fixtures/`, and assert the reply row, the lease release, and exactly-once behavior on a duplicate `update_id`.
5. Write a live smoke script `workers/agent-gateway/scripts/live-smoke.mjs`. It reads `TELEGRAM_BOT_TOKEN` from Secret Manager (`gcloud secrets versions access`), never prints it, calls `getWebhookInfo` and reports URL, `pending_update_count`, `last_error_message`; then reports `select count(*) from gateway_inbox` grouped by status. Run it and record the real numbers in the README Deploy section.
6. Resolve the backlog policy: decide what happens to rows already queued before the worker starts (age them out after a configurable TTL with a polite "sorry, I was offline" reply, or answer them). Implement in `workers/agent-gateway/src/`, with a test for the TTL boundary, and document it.
7. Signal: add `workers/signal-bridge/cloudbuild.verify.yaml`, a smoke test that starts the bridge container's HTTP surface without a real number registered and asserts its health route, and document in `workers/signal-bridge/README.md` the exact `gcloud run deploy` flags (min instances 1, persistent volume path used by `persist.sh`). Run the verify build.
8. Add `npm run gateway:ship-check` to the root `package.json` that runs the worker's vitest suite, the Step 0 deploy-env preview, and prints the exact owner command (`gcloud builds submit --config workers/agent-gateway/cloudbuild.yaml . --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s)`).
9. Update `workers/agent-gateway/README.md` (Deploy status with today's date and the verify build id), `docs/chat-gateways.md` (what users see until the worker runs vs after), `STRUCTURE.md` if a row is missing, and add a `data/changelog.json` entry only if user-visible behavior changed.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Each of the agent-gateway and signal-bridge verify builds has a SUCCESS result, with the build id recorded in the worker README (check with `gcloud builds describe <id> --region us-central1 --format='value(status)'`).
- [ ] `cd workers/agent-gateway && npx vitest run` passes with the new `healthz` and end-to-end drain tests included.
- [ ] `npm run gateway:ship-check` exits 0 and prints the single ship command.
- [ ] `node workers/agent-gateway/scripts/live-smoke.mjs` prints webhook info and inbox counts without printing any token (grep the output for the token prefix returns nothing).
- [ ] README Deploy section states the real verify build id and date; no "built, not deployed" line is left unqualified.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Local docker cannot build the image (3000+ packages, memory) | Use the Cloud Build verify config; never rely on a local docker build |
| Unpinned `gcloud builds submit` fails with "Unknown service account" | Pin `three-ws-build@aerial-vehicle-466722-p5.iam.gserviceaccount.com` in the config, as agent-orders does |
| No Discord variables on three-ws-api | Out of scope to invent them: the worker loads Telegram only and lists Discord under `skipped`; document that and keep going |
| No test Postgres reachable | Use the same approach `tests/_db.js` already uses; if it needs a database URL, take it from the self-unblock playbook database row |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The actual `gcloud run deploy` of agent-gateway and signal-bridge is the routine owner production-deploy gate; prepare everything and report the one command. Registering a Signal number or sending a message from a real user account is external posting: do not do it.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/270-plan-gateway-chat-worker-ship-readiness.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `270-plan-gateway-chat-worker-ship-readiness.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `workers/agent-gateway/README.md` (whole file)

~~~~markdown
# agent-gateway

The process behind every three.ws chat gateway. An agent owner pairs a Telegram
or Discord chat with their account, then talks to their agent from that chat:
plain messages, slash commands, voice notes and photos in, replies, trade
previews with Approve / Cancel buttons, approval requests with signed Approve /
Deny buttons, and account notifications out. From a paired chat the owner can
also list pending approvals, read open positions, and pause or kill agents
(`/approvals`, `/positions`, `/pause`, `/kill`; see
[docs/approvals.md](../../docs/approvals.md#approving-from-telegram-and-discord)).

The webhook receivers in the API only verify and queue. This worker does the
work: it drains the `gateway_inbox` table, runs each delivery through the shared
gateway core in [api/_lib/gateway/](../../api/_lib/gateway), and sends the
answer back through the platform's own API.

## How it fits

```
Telegram ──webhook──► api/gateway/telegram.js ─┐
Discord ──interaction► api/gateway/discord.js ─┤   verify, queue
Discord DMs + mentions ── gateway socket ──────┤   (held by this worker)
api/_lib/gateway/notify.js (notifications) ────┘
                                               ▼
                                         gateway_inbox
                                               │  claim one row per chat, under a lease
                                               ▼
                                 workers/agent-gateway (this)
                                 adapter.normalize(payload) → event
                                 handleEvent(event, gw)  (api/_lib/gateway/core.js)
                                               │
                                               ▼
                              reply / preview / notification in the chat
```

- **Ordering per chat.** `claimInbox` hands out at most one open row per chat,
  so a chat's replies leave in the order its messages arrived. Concurrency is
  across chats, never within one.
- **No double answers.** A claimed row is leased (`GATEWAY_LEASE_SECONDS`) and
  the lease is renewed every third of its length while the agent turn runs, so a
  slow turn is never reclaimed and answered twice. Running more than one
  instance is safe because the claim is exclusive.
- **Retries that respect the platform.** Every platform refusal is wrapped in a
  `PlatformError` ([src/errors.js](src/errors.js)). A 4xx other than 408 and 429
  is permanent and dead-letters at once; a 429 waits at least as long as the
  platform asked; anything else retries with exponential backoff
  (`GATEWAY_BACKOFF_BASE_MS`, doubling, capped at `GATEWAY_BACKOFF_MAX_MS`) up to
  `GATEWAY_MAX_ATTEMPTS`.
- **Nobody left in silence.** When a row is dead-lettered for a reason that is
  ours (not a platform refusal, not a partial answer, not a timeout that may
  still answer), the chat gets a short apology asking the owner to send it again.
- **Housekeeping.** Every `GATEWAY_SWEEP_MS` it expires overdue trade previews
  and edits their buttons away ("Expired. Ask your agent again for a fresh
  quote."), and once an hour it prunes finished rows older than
  `GATEWAY_PRUNE_KEEP_DAYS`.
- **Approval requests are rendered at send time.** The notification fan-out
  queues a `{kind:'approval'}` row per paired chat carrying only the request id
  and the link. The drain loads the request as it stands, skips it if it was
  decided or expired while queued, and sends the full confirmation table with
  Approve and Deny buttons signed for that one link, presser and payload hash
  ([api/_lib/gateway/approval-buttons.js](../../api/_lib/gateway/approval-buttons.js)).
- **Forwards are never instructions.** Both adapters flag forwarded messages
  (and Telegram posts made through another bot); the core runs no command for
  them and never hands them to the agent.
- **Privacy in logs.** Logs are one JSON line each with `severity` and `message`
  for Cloud Logging ([src/log.js](src/log.js)). Message text from chats never
  reaches a log: only ids, platforms and error codes.

## Files

| File | Role |
|---|---|
| [src/index.js](src/index.js) | Boot: loads config and adapters, starts the inbound listeners, the drain loop and the `/healthz` server, and handles SIGTERM. |
| [src/config.js](src/config.js) | Reads every knob once at boot, with production defaults and clamped ranges. |
| [src/drain.js](src/drain.js) | The platform-neutral drain loop: claim, lease renewal, timeout, acknowledge, retry, dead-letter, preview sweep, prune. |
| [src/adapters/index.js](src/adapters/index.js) | The adapter registry. A new platform is one entry in `FACTORIES` plus its file; the drain loop never changes. |
| [src/adapters/telegram.js](src/adapters/telegram.js) | Telegram over grammY: update normalization, the send surface, and optional `getUpdates` polling for local work. |
| [src/adapters/discord.js](src/adapters/discord.js) | Discord over discord.js: interaction replies through the interaction webhook, bot-token REST for everything else, and the gateway connection for DMs and mentions. |
| [src/errors.js](src/errors.js) | `PlatformError`, the permanent / retry-after / transient classification, and the backoff curve. |
| [src/setup.js](src/setup.js) | Operator commands: register Discord slash commands, point the Telegram webhook, read the inbox, requeue a dead letter. |
| [scripts/deploy-env.mjs](scripts/deploy-env.mjs) | Derives the Cloud Run environment from the live `three-ws-api` service at deploy time. |
| [Dockerfile](Dockerfile), [cloudbuild.yaml](cloudbuild.yaml) | The image (built from the repo root) and the Cloud Build to Cloud Run pipeline. |
| [tests/](tests) | Vitest suites for the drain loop, both adapters, the registry, the setup commands, and approval requests in chat. |

## Configuration

### Platform credentials

An adapter loads only when its credentials are present. A worker missing one
boots without that platform, logs `adapter not loaded` with the missing names,
and lists them under `skipped` in `/healthz`.

| Variable | Needed for | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram | The bot the receiver and the worker both speak as. On `three-ws-api` as the Secret Manager reference `telegram-bot-token`. |
| `TELEGRAM_BOT_USERNAME` | Telegram, optional | Lets the worker tell `/cmd@ourbot` from a command addressed to another bot without a `getMe` call at boot. |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram, optional | Pins the webhook secret header. When unset, the secret is derived from the bot token (`api/_lib/gateway/webhooks.js`). |
| `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID` | Discord | Both are required for the adapter to load. |
| `DISCORD_PUBLIC_KEY` | Discord receiver | Read by `api/gateway/discord.js` to verify interaction signatures, not by this worker, but the connections API only reports the Discord bot as available when all three Discord variables are set. |

The worker also needs everything the agent turn needs: `DATABASE_URL` for the
inbox, plus the LLM chain, market data, the rate limiter and
`WALLET_ENCRYPTION_KEY` for the agent's own custodial wallet. In production none
of that is configured by hand; see [Deploy](#deploy).

### Tuning knobs

All read by [src/config.js](src/config.js). Every one has a production default,
so the service needs only credentials.

| Variable | Default | Range | Meaning |
|---|---|---|---|
| `PORT` | `8080` | 1 to 65535 | Health endpoint port. Cloud Run injects it. |
| `GATEWAY_CONCURRENCY` | `8` | 1 to 64 | Inbox rows processed at once, one per chat. |
| `GATEWAY_POLL_MS` | `1500` | min 100 | Idle wait between claims when the inbox is empty. |
| `GATEWAY_LEASE_SECONDS` | `90` | min 15 | How long a claimed row is held before another worker may take it. |
| `GATEWAY_MAX_ATTEMPTS` | `5` | 1 to 20 | Attempts before a row is dead-lettered. |
| `GATEWAY_BACKOFF_BASE_MS` | `5000` | min 0 | First retry delay; doubles per attempt. |
| `GATEWAY_BACKOFF_MAX_MS` | `300000` | min 0 | Ceiling on a single retry delay. |
| `GATEWAY_TURN_TIMEOUT_MS` | `300000` | min 1000 | A row still running after this is failed and its lease released. |
| `GATEWAY_SWEEP_MS` | `60000` | min 1000 | Preview expiry sweep interval. |
| `GATEWAY_PRUNE_KEEP_DAYS` | `7` | min 1 | Finished rows older than this are deleted (checked hourly). |
| `GATEWAY_SHUTDOWN_GRACE_MS` | `8000` | min 0 | How long SIGTERM waits for in-flight rows before exiting. |
| `GATEWAY_PLATFORMS` | every configured one | comma list | Restrict which adapters load, e.g. `telegram`. |
| `GATEWAY_CHAT_KEYS` | all chats | comma list | Drain only these chats. For debugging one conversation. |
| `GATEWAY_TELEGRAM_POLLING` | off | `1` to enable | Pull Telegram updates with `getUpdates` instead of the webhook. Local development only. |
| `GATEWAY_DISCORD_GATEWAY` | on | `0` to disable | Hold a Discord gateway connection for DMs and mentions. |
| `GATEWAY_DEBUG` | off | `1` to enable | Emit `DEBUG` log lines (each queued inbound delivery). |

A malformed number (`GATEWAY_CONCURRENCY=eight`) stops the worker at boot
rather than running with a guess. Out-of-range numbers are clamped.

## Run locally

Every script loads the repo-root `.env` and then `.env.local`
(`node --env-file-if-exists`, so `.env.local` wins). `DATABASE_URL` lives in
`.env.local`; the platform tokens do not, so add the ones you need for the
session or read them from the service:

```bash
node scripts/read-service-env.mjs '^TELEGRAM_BOT_TOKEN$' --raw
```

**Read this before you start it with real tokens:** `.env.local` points at the
production database, so a local worker with a bot token claims and answers the
real queue for that platform. Use `GATEWAY_CHAT_KEYS` to confine it to your own
test chat.

From `workers/agent-gateway/`:

```bash
npm install          # the worker's own deps (grammy, discord.js); the rest resolves from the repo root
npm run dev          # boot with ../../.env and ../../.env.local
```

For Telegram without a public URL, `GATEWAY_TELEGRAM_POLLING=1 npm run dev`
pulls updates with `getUpdates` and queues them through the same inbox. Polling
refuses to start while a webhook is set on the bot (Telegram only allows
`getUpdates` after the webhook is deleted, which would cut production off), and
logs `telegram polling refused` instead.

### Example: boot it and read its health

With no platform token set the worker still boots, claims nothing (the claim is
filtered to the platforms that loaded), and reports what is missing. Run from
`workers/agent-gateway/`:

```bash
PORT=8799 npm run dev &
sleep 5
curl -s -w '\nHTTP %{http_code}\n' localhost:8799/healthz
kill %1
```

Output, abridged:

```
{"ok":false,"platforms":[],"inflight":0,"concurrency":8,"claimed":0,"completed":0,
 "adapters":{},"skipped":[{"platform":"telegram","missing":["TELEGRAM_BOT_TOKEN"]},
 {"platform":"discord","missing":["DISCORD_BOT_TOKEN","DISCORD_APP_ID"]}],
 "backlog":{"open":0,"oldestSeconds":0}}
HTTP 503
```

`/healthz` (also `/`) answers `200` when the drain loop is turning and at least
one adapter loaded, `503` otherwise. Beyond `ok` it carries the claim, completion,
retry and dead-letter counters, the preview sweep count, each adapter's status
(Telegram reports `webhook` or `polling` mode), and the open backlog from
`gateway_inbox`.

### Operator commands

```bash
npm run register:discord -- --dry-run          # print the slash command set, no credentials needed
npm run register:discord -- --guild <id>       # register on one guild (live immediately)
npm run register:discord                       # register globally (up to an hour to appear)
npm run webhook:telegram -- --info             # read the bot's current webhook
npm run webhook:telegram -- --dry-run          # show what would be set
npm run webhook:telegram                       # point the bot at https://three.ws/api/gateway/telegram and publish its command menu
npm run inbox                                  # queue depth, oldest open delivery, recent dead letters
npm run setup -- requeue <id>                  # put one dead letter back with a fresh attempt budget
```

The Discord command set is every command in `api/_lib/gateway/commands.js` plus
`/start`, registered top level and again as subcommands of `/three`. After
registering, set the interactions endpoint in the Discord developer portal to
`https://three.ws/api/gateway/discord`; the command prints it.

## Tests

```bash
cd workers/agent-gateway && npm test
```

Five suites, 87 tests, about eight seconds. They run against a real Postgres:
PGlite carrying the gateway tables built from the two shipped migrations
(`api/_lib/migrations/20260922180000_chat_gateways.sql` and
`20260922190000_more_chat_gateways.sql`) executed verbatim
([tests/_db.js](tests/_db.js)), so the claim, lease and dead-letter SQL is the
production SQL. Platform traffic is replayed from recorded payloads in
[tests/fixtures/](tests/fixtures) (Telegram text, voice, photo, callback and
group-start updates; Discord commands, buttons and mentions).

| Suite | Covers |
|---|---|
| `drain.test.js` | A queued `/help` answered through the real core; `/start` issuing a pairing code and storing only its hash; a duplicate delivery answered once; one row per chat at a time; held, renewed and expired leases; rows for a platform with no adapter left alone; `GATEWAY_CHAT_KEYS`; backoff then dead letter; a 429 `retry_after` honoured; a permanent refusal dead-lettered without an apology; a partially delivered turn never re-run; a timed-out turn; paired-chat approvals, strangers and `/new`; notifications delivered, or dropped when stale or unlinked; the preview sweep; start and graceful stop. |
| `telegram-adapter.test.js` | Command parsing (including `/cmd@otherbot` in groups), update normalization, voice notes through `getFile`, the largest photo size, long replies split across messages, inline buttons added and removed, photos versus documents, late button presses, spoken replies, error mapping, and the polling guard that refuses to run while a webhook is set. |
| `discord-adapter.test.js` | `/three` subcommands and top-level commands, button presses, mentions, audio and image attachments, the deferred reply filled first and then followups with mentions disabled, the "thinking..." placeholder removed when a command produced nothing, expired interaction tokens falling back to the channel API, notifications, audio uploads, and error mapping. |
| `approval-buttons.test.js` | Approval requests end to end through the real inbox library ([api/_lib/approvals.js](../../api/_lib/approvals.js)) and its migration: callback data within 64 bytes and refused on any changed character, link, presser, deadline or verb; fan-out queueing and the drain sending the full table with two signed buttons; Approve executing once and editing the message; a replayed press never re-running; Deny; a payload rewritten after delivery, a payload edited under an unchanged hash, a forged button, an expired request, a stranger's press, a button replayed into another chat and an unpaired chat all failing closed; forwarded commands and a forwarded `/link` ignored; `/approvals`, `/positions`, `/pause` and `/kill` against real rows. The transfer executor is the one stub: it records each call so the replay cases can prove it ran once. |
| `registry-setup.test.js` | Adapter selection by credentials and `GATEWAY_PLATFORMS`, the retry policy, config defaults and the malformed-number refusal, and the Discord and Telegram command sets `setup.js` registers. |

## Deploy

**Status: built and tested, not deployed.** There is no `agent-gateway` Cloud Run
service yet (checked 2026-10-09). Both gateway migrations are applied to
production, and the receivers in `api/gateway/` already queue into
`gateway_inbox`, so deliveries wait in the inbox until this worker runs. Deploys
are owner-gated (CLAUDE.md); the command is ready.

Build from the repo root, because the image carries the root install and `api/`
(the gateway core reaches the copilot engine, the agent wallet and the trade
engine) plus this worker's own two dependencies and the distro `ffmpeg` the voice
path transcodes with:

```bash
gcloud builds submit --config workers/agent-gateway/cloudbuild.yaml . \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)
```

`SHORT_SHA` is only set for trigger-driven builds, so a manual submit must pass
it or the image tag comes out empty.

**The environment is copied, never hand-kept.** On every deploy
[scripts/deploy-env.mjs](scripts/deploy-env.mjs) reads `gcloud run services
describe three-ws-api` and mirrors its env: literals into an `--env-vars-file`,
Secret Manager references into `--set-secrets` by reference, so no secret value
passes through the script or the build log. Two classes are left out on purpose:
Cloud Run's reserved names, and platform signers (treasury, fee-payer, relayer
and payout keys). A chat turn signs only with the agent's own custodial key, and
a process that reads messages from the internet has no business holding the
platform's money keys. `WALLET_ENCRYPTION_KEY` is kept. The reason for mirroring:
the `agent-orders` worker once ran on stale copies of `JWT_SECRET` and
`WALLET_ENCRYPTION_KEY` and could not decrypt a single agent key.

So a variable the gateway needs belongs on `three-ws-api`, and reaches the worker
on its next deploy. Today `three-ws-api` carries `TELEGRAM_BOT_TOKEN` and none of
the Discord variables, so a deploy now would load the Telegram adapter only and
list Discord under `skipped` in `/healthz`. To preview what a deploy would
mirror (names only, never values):

```bash
gcloud run services describe three-ws-api --region us-central1 --format=json > /tmp/api.json
node workers/agent-gateway/scripts/deploy-env.mjs /tmp/api.json --print
rm /tmp/api.json
```

The deploy flags in [cloudbuild.yaml](cloudbuild.yaml) are load-bearing:

| Flag | Why |
|---|---|
| `--no-cpu-throttling`, `--min-instances=1` | The drain loop and the Discord gateway connection run between requests; nothing calls this service over HTTP except Cloud Run's probes. |
| `--max-instances=1` (`_MAX_INSTANCES`) | One instance is enough for the load. More are safe because the claim is exclusive. |
| `--no-allow-unauthenticated` | No public HTTP surface. |
| `--vpc-connector=three-ws-vpc` | Matches `three-ws-api`: the rate limiter's Redis endpoint is a private address. |
| `--service-account=three-ws@` | The runtime account; the build runs as the pinned `three-ws-build@` (the default compute service account was deleted). |

`GATEWAY_CONCURRENCY` and `GATEWAY_MAX_ATTEMPTS` ride in as the `_CONCURRENCY`
and `_MAX_ATTEMPTS` build substitutions.

After the first deploy, point the bots at production once:
`npm run webhook:telegram` and `npm run register:discord` (from this directory).

## Operations

- **Logs:** `gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="agent-gateway"' --freshness=1h`. Filter `severity>=WARNING` for retries and dead letters; `row dead-lettered` carries the reason.
- **Stuck queue:** `npm run inbox` shows depth, the oldest open delivery and the latest dead letters; `npm run setup -- requeue <id>` retries one.
- **One bad chat:** a redeploy with `GATEWAY_CHAT_KEYS` set, or a local run with it, isolates that conversation.

## Related

- [api/_lib/gateway/](../../api/_lib/gateway): the platform-neutral core (pairing, commands, conversation, approvals, notifications, the inbox store).
- [api/gateway/](../../api/gateway): the Telegram and Discord webhook receivers and the owner's connections API (`/api/gateway/connections`).
- [workers/signal-bridge](../signal-bridge): the Signal leg, a signal-cli REST bridge this worker's adapter registry is built to take next.
- [STRUCTURE.md](../../STRUCTURE.md): where this sits among the other workers.
~~~~

### `workers/signal-bridge/README.md` (whole file)

~~~~markdown
# signal-bridge

The Signal leg of the three.ws agent chat gateway: a Cloud Run service that
holds one registered Signal number and exposes it over HTTP so the gateway can
send and receive Signal messages for agent owners.

It is a thin layer over the maintained
[signal-cli REST bridge](https://github.com/bbernhard/signal-cli-rest-api)
(`bbernhard/signal-cli-rest-api:0.100`). The upstream image does the hard part:
signal-cli, the REST surface, and the live receive websocket. This layer adds
the one thing Cloud Run lacks, **persistence**: a Signal registration is a set of
identity keys and ratchet state on disk, Cloud Run disks are in-memory, and
losing them means re-verifying the number. `persist.sh` restores that state from
a mounted Cloud Storage bucket on boot and snapshots it back on a timer.

## How it fits

```
Signal user ──► signal-bridge (this service) ◄── agent gateway worker ──► api/_lib/gateway/core.js
                 signal-cli + REST + receive WS      (workers/agent-gateway)     pairing, commands,
                 state snapshot in GCS                                           conversation, approvals
```

The gateway core is platform-neutral and already lists Signal as a platform
([api/_lib/gateway/platforms.js](../../api/_lib/gateway/platforms.js): no
buttons, no in-place edits, voice notes on). The process that connects this
bridge to the core is the gateway worker in [workers/agent-gateway](../agent-gateway).

## Files

| File | Role |
|---|---|
| `Dockerfile` | `FROM bbernhard/signal-cli-rest-api:0.100`, sets the bridge mode and state env, installs `persist.sh` as the entrypoint. |
| `persist.sh` | Restores `signal-cli.tgz` from the state volume, starts a background snapshot loop, then `exec`s the upstream `/entrypoint.sh`. |
| `cloudbuild.yaml` | Creates the Artifact Registry repo and the versioned state bucket if missing, builds, pushes, deploys to Cloud Run, and grants the runtime service account `run.invoker`. |

## Configuration

Set in the Dockerfile; override with `-e` locally or `--update-env-vars` on Cloud Run.

| Variable | Default | Meaning |
|---|---|---|
| `MODE` | `json-rpc` | Keeps one signal-cli process resident, so a send takes milliseconds instead of a JVM start, and serves the receive websocket. |
| `PORT` | `8080` | The REST port. |
| `JSON_RPC_TRUST_NEW_IDENTITIES` | `on-first-use` | Trust a contact's identity key the first time it is seen. |
| `JSON_RPC_IGNORE_STORIES`, `JSON_RPC_IGNORE_STICKERS` | `true` | Drop message types the gateway never handles. |
| `SIGNAL_STATE_DIR` | `/state` | Where the state volume is mounted. The snapshot is `$SIGNAL_STATE_DIR/signal-cli.tgz`. |
| `SIGNAL_SNAPSHOT_SECONDS` | `120` | Snapshot interval. A snapshot is written only when a file under the signal-cli config dir changed since the last one, so an idle bridge does not rewrite the object. |
| `SIGNAL_CLI_CONFIG_DIR` | `/home/.local/share/signal-cli` | Set by the upstream image: the tree that is snapshotted and restored. |

Snapshots are written to a temporary name and renamed, so a restart in the
middle of a write restores the previous complete tarball rather than a torn one.

## Run locally

From the repo root:

```bash
docker build -t signal-bridge workers/signal-bridge
mkdir -p .signal-state
docker run --rm -p 8080:8080 -v "$PWD/.signal-state:/state" signal-bridge
```

The first boot logs `no snapshot at /state/signal-cli.tgz, starting unregistered`.
Once the API is up:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/v1/health   # 204
curl -s http://localhost:8080/v1/about    # {"versions":["v1","v2"],...,"mode":"json-rpc","version":"0.100",...}
curl -s http://localhost:8080/v1/accounts # [] until a number is registered
```

Within one snapshot interval the log shows `snapshot written <time>`, and the
next container started on the same volume logs `restoring state from
/state/signal-cli.tgz`.

## Register the number

Do this once per number. The registration then lives in the state bucket and
survives every redeploy. These are the upstream bridge's endpoints
([full reference](https://bbernhard.github.io/signal-cli-rest-api/)); `+15551234567`
stands for the gateway's own number in E.164 form.

```bash
BRIDGE=http://localhost:8080

# Ask Signal for an SMS code. Signal usually requires a captcha token first:
# solve https://signalcaptchas.org/registration/generate.html and copy the
# signalcaptcha:// link it produces.
curl -X POST "$BRIDGE/v1/register/+15551234567" \
  -H 'content-type: application/json' \
  -d '{"use_voice": false, "captcha": "signalcaptcha://..."}'

# Confirm with the code that arrived by SMS.
curl -X POST "$BRIDGE/v1/register/+15551234567/verify/123456"

# Send a test message.
curl -X POST "$BRIDGE/v2/send" \
  -H 'content-type: application/json' \
  -d '{"number": "+15551234567", "recipients": ["+15557654321"], "message": "three.ws gateway online"}'
```

To use an existing phone's Signal account instead of a dedicated number, link
the bridge as a secondary device: open `$BRIDGE/v1/qrcodelink?device_name=three-ws-gateway`
in a browser and scan the QR code from Signal on the phone (Settings, Linked devices).

Inbound messages stream over the websocket at `ws://<bridge>/v1/receive/<number>`
in `json-rpc` mode; that is the socket a gateway Signal adapter consumes.

## Deploy

Production deploys are owner-gated (see CLAUDE.md). The command, from the repo root:

```bash
gcloud builds submit workers/signal-bridge --config workers/signal-bridge/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)
```

The build runs as `three-ws-build@`, the service runs as `three-ws@`, and the
deploy flags are load-bearing:

| Flag | Why |
|---|---|
| `--max-instances=1` | signal-cli owns one number's key material. Two instances would each advance the ratchets and corrupt the other's sessions. |
| `--min-instances=1`, `--no-cpu-throttling` | The gateway holds the receive websocket open; scale-to-zero would drop inbound messages. |
| `--no-allow-unauthenticated` | The upstream bridge has no auth of its own. Only the runtime service account (the gateway) may invoke it, with a Google ID token. |
| `--add-volume ... bucket=three-ws-signal-bridge-state` | The versioned bucket holds `signal-cli.tgz`, so a new revision restores the registration instead of needing the number verified again. |
| `--startup-probe=httpGet.path=/v1/health` | The JVM daemon takes a few seconds; traffic waits for it. |

To register the number against the deployed service, call the same endpoints
through an authenticated proxy:

```bash
gcloud run services proxy signal-bridge --region us-central1 --port 8080
# then use BRIDGE=http://localhost:8080 with the commands above
```

## Operations

- **Logs:** `gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="signal-bridge"' --freshness=1h`. Look for `restoring state from`, `snapshot written`, and `snapshot failed`.
- **Roll back the registration state:** the bucket has object versioning on, so an earlier `signal-cli.tgz` generation can be restored with `gcloud storage cp gs://three-ws-signal-bridge-state/signal-cli.tgz#<generation> gs://three-ws-signal-bridge-state/signal-cli.tgz` before restarting the service.
- **Upgrading the upstream image:** bump the `FROM` tag, then run it locally on a copy of the state tarball before deploying, since a signal-cli upgrade can migrate the on-disk format.

## Related

- [api/_lib/gateway/](../../api/_lib/gateway): the platform-neutral gateway core, inbox and pairing.
- [api/gateway/](../../api/gateway): the Telegram and Discord webhook receivers and the connections API.
- [workers/agent-gateway](../agent-gateway): the gateway worker.
~~~~

### `docs/chat-gateways.md` (whole file)

~~~~markdown
# Chat gateways

Talk to your three.ws agent from a chat app. A paired chat can ask for balances and portfolio, run `/pause` and `/kill`, approve or deny requests your spend policy holds, send voice notes and photos, and receive account notifications. Telegram and Discord are live today. Slack, WhatsApp, Signal, SMS and email share the same core.

The API only verifies and queues. The [agent-gateway worker](../workers/agent-gateway/README.md) drains the queue, runs the turn and replies.

## Platform capabilities

One table in [api/_lib/gateway/platforms.js](../api/_lib/gateway/platforms.js) drives behavior per platform.

| Platform | Buttons | Edit in place | Voice |
|----------|---------|---------------|-------|
| Telegram | yes | yes | yes |
| Discord | yes | yes | yes |
| Slack | yes | yes | yes |
| WhatsApp | yes | no | yes |
| Signal | no, reply with a six-digit code | no | yes |
| SMS | no, reply with a six-digit code | no | no |
| Email | no, reply with a six-digit code | no | yes |

## Pairing a chat

Three ways to pair, all ending in the same thing: a chat linked to exactly one account, by that account's owner.

1. **From the chat.** Send `/start`. The bot replies with a pairing code and a link to `/settings/connections?code=...`. Sign in on the site and confirm. Codes expire in minutes.
2. **From the site.** On [Connections](https://three.ws/settings/connections), press issue, then send `/link <code>` to the bot.
3. **From Linked devices.** On [Account, Linked devices](https://three.ws/dashboard/account#linked-devices), mint a code for a Telegram chat and send `/link <code>` in the chat. The chat claims the code, then the signed-in browser sees which chat is asking and must press Confirm. Nothing pairs until that confirmation. See [account-linking.md](./account-linking.md).

If the Telegram account that is chatting already signs in to a three.ws account (Telegram sign-in or a linked Telegram identity), a private chat resolves to that account without any code. Signing in with Telegram already proved control. Groups never auto-resolve, because a group is shared; they pair explicitly.

Rules that always hold:

- A paired group belongs to one person. Anyone else who writes there is told so and never reaches the owner's agent or wallet.
- A forwarded message is never an instruction. A forwarded `/link` pairs nothing, and a forwarded request is not run.
- `/unlink` disconnects a chat. The owner can also revoke it on Connections or Linked devices.

## Commands

`/balance`, `/portfolio`, `/runs`, `/launches`, `/agents`, `/use <agent>`, `/new`, `/voice on|off`, `/buy`, `/sell`, `/snipe`, `/orders`, `/cancel`, `/approvals`, `/positions`, `/pause`, `/kill`, `/unlink`, `/help`. `/help` is the source of truth; the list above mirrors [api/_lib/gateway/commands.js](../api/_lib/gateway/commands.js).

## Trading from chat

A paired chat takes five trade commands, as slash commands or as the bare words:

| Command | What it does |
| --- | --- |
| `/buy <mint or symbol> <sol> [tp=<pct>] [sl=<pct>]` | Quote a buy. `tp` and `sl` rest a linked take-profit and stop-loss pair after the buy fills. |
| `/sell <mint or symbol> <pct or all>` | Quote a sale of a percent of the wallet's holding. |
| `/snipe <mint> <sol>` | Quote a buy of a full mint. Refused when RugCheck reports high or critical risk. |
| `/orders` | List resting orders. |
| `/cancel [<order id>]` | Cancel an order by id prefix (a linked pair cancels together), or drop the trade waiting for a yes. |

Nothing signs from a command. Each one replies with a quote card: spend, expected output, route, price impact, RugCheck verdict, fees and slippage. The quote then waits for a typed confirmation.

- Only the exact word `yes` (case and surrounding space ignored), typed by the paired owner within 60 seconds, executes it. Anything else cancels it. A late `yes` sends nothing and says the quote expired.
- Voice notes, photos, forwarded messages and button presses never confirm a typed quote.
- A new trade command while one is waiting cancels the first and quotes the second.
- Execution goes through the same engine as the web app: kill switch, per-trade cap, daily budget, firewall, ledger and the mainnet real-funds agreement. A guard refusal comes back with its reason code.
- Symbols resolve only against tokens the wallet already holds, because a symbol is not an identity. Anything else needs the full mint.
- Token names and symbols come from the chain, so the quote card prints them stripped of links, mentions, markup and line breaks, in quotes, and never as instructions.
- `tp` and `sl` need the programmable orders engine switched on with `GATEWAY_TPSL_ORDERS=1`. While it is off a buy that asks for them is refused before it is quoted.

`/positions` lists open positions with live P&L, the last closed trades, and sends a PNG share card for each recent close (`/api/trade-og?id=<position id>&format=png`, the SVG card rasterized).

Code: [trade-parse.js](../api/_lib/gateway/trade-parse.js) (grammar, escaping, confirmation rule), [trade-commands.js](../api/_lib/gateway/trade-commands.js) (quote, confirm, exits, orders). Tests: [tests/gateway-trade-parse.test.js](../tests/gateway-trade-parse.test.js), [workers/agent-gateway/tests/trade-commands.test.js](../workers/agent-gateway/tests/trade-commands.test.js).

## What can and cannot be approved from chat

Trades the agent proposes in conversation never run from text alone, and the typed `/buy` family needs a typed `yes` (see Trading from chat). A preview arrives with Approve and Cancel buttons (or a six-digit code on platforms without buttons), expires after ten minutes, and only the exact approval executes it. Requests your spend policy holds arrive with Approve and Deny. `/pause` and `/kill` stop agents at once. Lifting a freeze is done on the web. Details: [approvals.md](./approvals.md#approving-from-telegram-and-discord). Changing a payout wallet is never auto-approved and always shows the old and new address.

## Telegram webhook

`POST /api/gateway/telegram` is the receiver. Telegram proves each delivery with the `X-Telegram-Bot-Api-Secret-Token` header it was given at `setWebhook`; an invalid header answers `401`. A verified update is stored in the inbox and answered `200` immediately. A retried `update_id` hits the inbox's unique key, so a redelivery never produces a second reply.

A sign-in magic link (`/start tl_<token>`) is claimed inline in the webhook, not queued, so the browser waiting for it sees the claim within a second. It only works in a private chat.

## Privacy

Messages are stored to run the turn and keep thread context. Pairing records hold the platform user id, chat id and display name, nothing else about the Telegram account. Unlinking revokes the pairing immediately. Every pair and unpair is in the audit log.

## Limits

| Limit | Value |
|-------|-------|
| Messages per paired chat | 20 per minute |
| Pairing codes issued per chat | 8 per hour |
| Settings writes per user | 30 per hour |

## Related

- [Account linking](./account-linking.md): Telegram sign-in, link codes, external wallets
- [Approvals](./approvals.md)
- [agent-gateway worker](../workers/agent-gateway/README.md)
~~~~

