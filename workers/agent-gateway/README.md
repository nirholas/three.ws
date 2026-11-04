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
