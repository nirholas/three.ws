# agent-gateway

The process behind every three.ws chat gateway. It lets people talk to their three.ws agent from Telegram and Discord: the same agent turn as the web copilot (the LLM chain, market data, the agent's own custodial wallet and its spend previews), delivered as chat messages, buttons, images and voice notes.

## How it works

The webhook receivers in the API verify each delivery and queue it; this worker does the slow part.

1. **Inbound.** `api/gateway/telegram.js` checks Telegram's secret header and `api/gateway/discord.js` checks Discord's Ed25519 signature (deferring inside Discord's three-second window). Each queues the raw delivery in the `gateway_inbox` table. Notifications for paired chats are queued there too (`api/_lib/gateway/notify.js`). Discord DMs and mentions never reach an HTTP endpoint, so the worker holds a Discord gateway connection and queues those itself.
2. **Drain** (`src/drain.js`). The worker claims rows under a lease, at most one open row per chat, so a chat's replies leave in the order its messages arrived and concurrency is across chats. A long agent turn renews its lease so it is never answered twice.
3. **Answer.** Each row is normalized by its platform adapter and run through the shared gateway core (`api/_lib/gateway/core.js`). The adapter sends the result with that platform's API.
4. **Settle.** A delivered row is acknowledged. A failed one is retried with exponential backoff (honoring the platform's `retry_after`), and after `GATEWAY_MAX_ATTEMPTS` it is dead-lettered and the chat gets a short apology. A sweeper expires stale trade previews and prunes finished rows.

Message text from chats never reaches a log line: the worker logs ids, platforms and error codes as single-line JSON that Cloud Logging reads by `severity`.

## Adapters

`src/adapters/index.js` is the registry. An adapter is a plain object (`platform`, `normalize`, `gateway`, and optional `handle`, `finish`, `start`, `stop`, `describe`), so a new platform is one entry in `FACTORIES` plus its file; the drain loop never changes. An adapter whose credentials are missing is skipped at boot, and `/healthz` names the variable it needs.

| Adapter | Library | Needs | Inbound |
|---|---|---|---|
| `telegram` | grammY | `TELEGRAM_BOT_TOKEN` (optional `TELEGRAM_BOT_USERNAME` to tell commands and mentions aimed at this bot in a group from ones aimed at another) | the webhook; or `GATEWAY_TELEGRAM_POLLING=1` locally |
| `discord` | discord.js | `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID` | interactions via the webhook; DMs and mentions via the gateway connection |

## Configuration

The worker runs the same agent turn as the API, so it needs the API's configuration (database, LLM keys, `WALLET_ENCRYPTION_KEY`, the rate limiter) plus the bot credentials above. Every knob below has a production default (`src/config.js`):

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | health endpoint port (Cloud Run injects it) |
| `GATEWAY_CONCURRENCY` | `8` | inbox rows processed at once, one per chat |
| `GATEWAY_POLL_MS` | `1500` | idle wait between claims when the inbox is empty |
| `GATEWAY_LEASE_SECONDS` | `90` | how long a claimed row is held before another worker may take it |
| `GATEWAY_MAX_ATTEMPTS` | `5` | attempts before a row is dead-lettered |
| `GATEWAY_BACKOFF_BASE_MS` / `GATEWAY_BACKOFF_MAX_MS` | `5000` / `300000` | first retry delay (doubles per attempt) and its ceiling |
| `GATEWAY_TURN_TIMEOUT_MS` | `300000` | a row still running after this is failed and its lease released |
| `GATEWAY_SWEEP_MS` | `60000` | preview expiry sweep interval |
| `GATEWAY_PRUNE_KEEP_DAYS` | `7` | finished rows older than this are deleted |
| `GATEWAY_SHUTDOWN_GRACE_MS` | `8000` | how long SIGTERM waits for in-flight rows |
| `GATEWAY_PLATFORMS` | every configured one | comma list restricting which adapters load |
| `GATEWAY_CHAT_KEYS` | all chats | comma list to drain only some chats, for debugging one |
| `GATEWAY_TELEGRAM_POLLING` | off | `1` pulls Telegram updates with `getUpdates` instead of the webhook |
| `GATEWAY_DISCORD_GATEWAY` | on | `0` skips the Discord gateway connection |
| `GATEWAY_DEBUG` | off | `1` adds debug log lines |

Local runs read the repo root's `.env` and `.env.local`. A bot credential missing there can be read from the live API service with `node scripts/read-service-env.mjs '^TELEGRAM_BOT_TOKEN$' --raw` from the repo root.

## Run it locally

```bash
cd workers/agent-gateway
npm install
npm test           # adapters, drain loop and registry, against PGlite and recorded payloads
npm run inbox      # queue depth, the oldest open delivery, the latest dead letters
GATEWAY_TELEGRAM_POLLING=1 GATEWAY_PLATFORMS=telegram npm run dev
curl -s localhost:8080/healthz
```

Telegram polling refuses to start while a webhook is set, because `getUpdates` only works after deleting the webhook and that would cut production off. Use a separate test bot token for polling.

`/healthz` returns `200` with the loop state, each adapter's status, the skipped adapters with their missing variables, the counters and the inbox backlog, or `503` when the loop is stalled or no adapter loaded.

## Operator commands

| Command | What it does |
|---|---|
| `npm run register:discord` | register the slash commands (every command in `api/_lib/gateway/commands.js` plus `/start`, each also under `/three`); add `-- --guild <id>` for an instant test on one server, `-- --dry-run` to print them |
| `npm run webhook:telegram` | point the bot at `https://three.ws/api/gateway/telegram` with the secret the receiver verifies, and publish the command menu; `-- --info` reads the current webhook, `-- --delete` removes it |
| `npm run inbox` | queue depth and recent dead letters; `-- --failed 20` shows more |
| `node src/setup.js requeue <id>` | put one dead letter back on the queue with a fresh attempt budget |

## Deploying

It runs on Cloud Run as an always-on service: CPU always allocated and at least one instance, because it holds the Discord connection and polls the inbox. More instances are safe because the claim is exclusive. SIGTERM stops claiming, lets running rows finish within the grace period, and closes the platform connections.

Its environment is derived from the live `three-ws-api` service on every deploy rather than kept by hand, so it never drifts from the API. `scripts/deploy-env.mjs` turns `gcloud run services describe` output into an `--env-vars-file` of literals and a `--set-secrets` list of Secret Manager references, so no secret value passes through the script. It leaves out Cloud Run's reserved names and every platform signer (treasury, fee-payer, relayer and payout keys): a chat turn signs only with the agent's own custodial key, and a process that reads messages from the internet has no business holding the platform's money keys. Preview what it would mirror, names only, from the repo root:

```bash
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json > /tmp/api.json
node workers/agent-gateway/scripts/deploy-env.mjs /tmp/api.json --print
```

A production deploy is owner-approved, like every deploy in this repository (see the deploy runbook in `CLAUDE.md`).

## Related

- `api/_lib/gateway/`: the shared core, store, commands, approvals and formatting both the API and this worker use.
- `api/gateway/`: the webhook receivers and the pairing API behind the chat connections screen.
