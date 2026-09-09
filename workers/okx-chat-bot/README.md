# okx-chat-bot

Always-on host for the OKX.AI marketplace chat bot (agent **#2632**).

Buyers message our marketplace listing over XMTP. That chat is delivered to a
local `okx-a2a` daemon, which reads agent identities through an `onchainos`
wallet session and spawns an AI subsession to author the reply and drive the
task lifecycle (accept, negotiate, deliver). Both CLIs used to run on a
developer codespace, which cannot stay up: a rebuild wipes the CLIs and an idle
nap kills the daemon (observed alive at 21:09, dead by 03:13 the same night).
OKX's own chat test then reports "no delivery in 30 minutes" and flags the
listing offline.

This worker is the durable host for that pair. It restores the wallet identity,
supervises the daemon, rebuilds the AI subsession's world knowledge on every
boot, and makes the one failure a human must clear (an expired OKX session) page
loudly with the exact commands to fix it.

## The failure it exists to kill

The dangerous outage here is **silent**. The process stays up, the container
reports healthy, and chat is simply never delivered because the wallet session
expired or no XMTP client came online. From the outside that is
indistinguishable from "nobody messaged us".

So readiness is deliberately strict: a bot that cannot receive a message is
**not ready**, even though the process is perfectly alive. `/readyz` returns 503
in every state below except `online`.

| `reason` | Status | Ready | What it means |
|---|---|---|---|
| `daemon_starting` | unknown | no | The daemon child is alive but has not claimed its lock yet. Deliberately not a page: `daemon status` reads a lock file written seconds after the spawn, so every healthy boot passes through this window. |
| `daemon_down` | down | no | `okx-a2a` is not running. No chat is delivered. |
| `wallet_unreadable` | unknown | no | `onchainos wallet status` did not answer. Session state unknown. |
| `session_logged_out` | down | no | Session expired. Every XMTP client is offline. **Needs a human OTP.** |
| `no_active_client` | degraded | no | Logged in, but 0 XMTP clients serving. The daemon retries every minute. |
| `ai_provider_uncredentialed` | degraded | no | Chat arrives but no credential is configured, so the subsession cannot author a reply. |
| `ai_provider_unauthorized` | degraded | no | A credential IS configured and the provider **refuses** it (expired, revoked, or an account that cannot bill). Chat arrives and every reply dies. **Needs a human.** |
| `online` | ok | yes | At least one XMTP client is serving at least one agent identity. |

`classify()` in [session.js](session.js) is pure, so this state machine is
testable without a daemon, a wallet, or a network.

## Architecture

| File | Role |
|------|------|
| `index.js` | Entrypoint. Boot order, session probe, heartbeat, ops alerts, graceful shutdown. |
| `config.js` | Env-driven config (`loadConfig`, `paths`) and the AI lane chain (`providerLanes`, `resolveProviderChain`, `applyLane`). |
| `cli.js` | Timeout-bounded, non-throwing wrappers around the `okx-a2a` and `onchainos` binaries. |
| `provider.js` | Probes each AI lane (`probeLane`), elects the first that serves (`electProvider`), and hands codex its key. |
| `session.js` | Pure health `classify()` plus `loginInstructions()`, the exact commands a human runs. |
| `health-server.js` | The HTTP surface: strict `/readyz`, always-200 liveness, and the `remedy` payload. |
| `state.js` | Tar the wallet/XMTP identity to GCS and restore it on boot (`snapshotState`, `restoreState`). |
| `supervisor.js` | Owns the `okx-a2a run` child with capped exponential backoff restarts. |
| `workspace.js` | Rebuilds the AI subsession's briefing and skills from the image on every boot. |
| `log.js` | Structured JSON lines for Cloud Logging. |

### Four things that are load-bearing

**The daemon runs in the foreground, never via `daemon start`.** `okx-a2a daemon
start` delegates to an OS autostart unit (systemd/launchd). There is no systemd
in a container, so that call installs a unit and silently leaves the daemon
**down**: the exact trap that made the local bot look staged but offline. The
supported foreground entrypoint is `okx-a2a run`, and `supervisor.js` owns that
child directly. It also clears the lock file before every spawn, because a
crashed daemon leaves one behind that blocks the next start.

**Identity lives on disk, not in a database.** `~/.onchainos/keyring.enc` plus
`session.json` and `machine-identity` are what make the wallet session survive,
and `~/.okx-agent-task/` holds the XMTP client database. Cloud Run's filesystem
is in-memory and dies with the revision, so `state.js` tars both trees to one
GCS object and restores it on boot. Without that, every deploy would log the bot
out and need a fresh human OTP.

**A daemon that cannot be spawned must not take the host with it.** A missing or
unrunnable `okx-a2a` binary raises `error` on the child, not just `exit`. Node
throws on an unhandled `error` event, so without a listener the whole worker dies
and "the daemon binary is missing" surfaces as "the host is gone": no health
verdict, no heartbeat, no alert naming the real problem. `supervisor.js` handles
both events through one restart path, and a spawn that raises both never
schedules two restarts.

**The AI workspace is rebuilt from the image, not from the snapshot.** The
adapter spawns the AI CLI with cwd set to `~/.okx-agent-task/workspace`, and
whatever is in that directory **is** the subsession's world knowledge. A naive
containerisation ships an agent that knows nothing about three.ws and improvises
answers to paying buyers. `workspace.js` writes a briefing (as both `CLAUDE.md`
and `AGENTS.md`, since which one is read depends on the spawned CLI) and copies
12 skills in on every boot, so a redeploy always ships the current catalog.

## Configuration

Every knob is env-driven, so the same image runs on Cloud Run, on a plain VM, and
locally with no code change. Defaults are the production posture.

| Env | Default | Purpose |
|---|---|---|
| `OKX_BOT_HOME` | `$HOME` | HOME for both CLIs. Decides where all durable state lands. |
| `PORT` | unset | Health server port. Unset means no health server (fine locally, never on Cloud Run). |
| `OKX_BOT_AGENT_ID` | `2632` | The marketplace agent this bot answers for. |
| `OKX_BOT_STATE_BUCKET` | unset | GCS bucket for the state snapshot. Unset means ephemeral mode. |
| `OKX_BOT_STATE_OBJECT` | `okx-chat-bot/state.tar.gz` | Object name within that bucket. |
| `OKX_BOT_REPO_ROOT` | `/app` | Where the briefing and skills are read from. |
| `OKX_BOT_AI_PROVIDER` | auto | Pin the provider (`claude`, `codex`, `hermes`, `openclaw`). Narrows the chain to that CLI's lanes rather than emptying it. |
| `CLAUDE_CODE_USE_VERTEX` | unset | `1` routes the Claude subsession to Vertex AI, authenticated by the runtime service account. The production posture: no secret exists to leak, rotate, or forget. |
| `ANTHROPIC_VERTEX_PROJECT_ID` | unset | The GCP project Vertex bills. Required alongside the flag above. |
| `CLOUD_ML_REGION` | `global` | Vertex region for both the subsession and the credential probe. |
| `OKX_A2A_AI_PERMISSION_PRESET` | unset | `bypass` on a headless host. Without it the subsession stalls on a tool-approval prompt nobody is there to answer, which the buyer experiences as an unresponsive bot. |
| `OKX_BOT_ANTHROPIC_BASE_URL` | unset | Base URL of an Anthropic-wire-format gateway. The CLI appends `/v1/messages`, so OpenRouter's is `https://openrouter.ai/api`, **not** `.../api/v1`. |
| `OKX_BOT_ANTHROPIC_AUTH_TOKEN` | unset | That gateway's credential. Both it and the base URL are required, or no gateway lane exists. |
| `OKX_BOT_ANTHROPIC_MODEL` | unset | Model id in the gateway's catalog, e.g. `anthropic/claude-sonnet-4.6`. |
| `OKX_BOT_PROVIDER_PROBE_MS` | `900000` | How often every lane's own API is asked whether it will still serve. Also how quickly a recovered lane is picked up. |
| `OKX_BOT_HOST_LABEL` | auto | Name this host on every beat. Cloud Run names itself from `K_SERVICE`. |
| `OKX_BOT_HOST_DURABLE` | unset | Set to `1` to claim a non-Cloud-Run host stays up on its own. |
| `OKX_BOT_DAEMON_BIN` | `okx-a2a` | The XMTP daemon binary the supervisor owns. |
| `OKX_BOT_HEARTBEAT_MS` | `30000` | How often the `bot_heartbeat` row is written. Its own timer, not the probe's. |
| `OKX_BOT_SESSION_PROBE_MS` | `60000` | How often health is re-probed. |
| `OKX_BOT_SNAPSHOT_MS` | `300000` | Periodic state snapshot cadence. |
| `OKX_BOT_ALERT_REPEAT_MS` | `21600000` | Re-alert ceiling while a bad state persists (6 h). |
| `OKX_BOT_RESTART_BASE_MS` | `2000` | Daemon restart backoff floor. |
| `OKX_BOT_RESTART_MAX_MS` | `60000` | Daemon restart backoff ceiling. |

### The AI chain: whichever lane is funded is the lane that serves

The host used to hold exactly **one** AI lane, which is a chain with a single
rung. On 2026-09-04 the rung snapped: this GCP project's Vertex access started
answering `PERMISSION_DENIED: Lightning dunning decision is deny`, and the bot
went on receiving every buyer message and authoring no reply at all, for days,
while other credentials sat unused on the same service.

So [`providerLanes()`](config.js) builds an ordered chain and
[`electProvider()`](provider.js) probes it, best lane first, and elects the first
one that actually answers. The election re-runs every
`OKX_BOT_PROVIDER_PROBE_MS`, so a lane that recovers (or one the owner funds) is
picked up **with no deploy**: the config is re-asserted, codex is re-logged-in if
it is the new lane, and the daemon is restarted so the subsession it spawns
carries the new credentials.

| # | Lane | Selected by | Why here |
|---|---|---|---|
| 1 | `vertex` | `CLAUDE_CODE_USE_VERTEX=1` + a project | GCP credits, authenticated by the runtime service account. Nothing to mint, rotate or forget, and the spend lands on the pool the platform prefers over any paid third-party API. |
| 2 | `anthropic-key` | `ANTHROPIC_API_KEY` | A first-party key. |
| 3 | `anthropic-gateway` | `OKX_BOT_ANTHROPIC_BASE_URL` + `..._AUTH_TOKEN` | Any service that speaks the Anthropic wire format (OpenRouter serves one). Opt-in, and last, because it bills a third-party account per token. |
| 4 | `anthropic-login` | `$OKX_BOT_HOME/.claude/.credentials.json` | A developer host, whose `claude` CLI a human logged in. |
| 5 | `openai-key` | `OPENAI_API_KEY` | The codex CLI. |

**Every lane spawns a genuinely agentic CLI, and that is not negotiable.** The
adapter does not read a reply out of the CLI's stdout: the spawned subsession
sends the reply itself through `okx-a2a` and drives the task lifecycle (accept /
negotiate / deliver). A one-shot completion call would not just answer worse, it
would break the lifecycle. The gateway lane exists precisely because it keeps the
same `claude` CLI and only moves its endpoint.

A provider CLI with no key spawns, fails to authenticate, and produces exactly
the symptom this worker exists to kill: silence on the buyer's side. So with an
empty chain the worker boots, logs an error, and reports
`ai_provider_uncredentialed` rather than pretending to be healthy.

**Vertex wins over every key on purpose.** The credential is the runtime service
account, reached through ADC, so there is nothing to mint, rotate, paste into a
secret, or forget to renew, and the spend lands on the GCP credit pool the
platform already prefers over paid third-party APIs. `three-ws@` holds
`roles/aiplatform.user`, so the deploy needs no AI secret at all.

**A configured credential is not a working one, and the probe says which.**
This is the trap that would otherwise rebuild the worker's own defining failure
one level up. Measured 2026-09-04, *both* credentials this project holds are
present, well-formed, and refuse to serve: Vertex answers
`PERMISSION_DENIED: Lightning dunning decision is deny` (a billing hold that
reads like an IAM problem) and the `openai-api-key` secret's account answers
`billing_not_active`. A presence check calls either one green, the host reports
ready, a buyer's message lands, and no reply is ever authored.

So [provider.js](provider.js) asks each lane's own API: one tiny request at boot
and every `OKX_BOT_PROVIDER_PROBE_MS`, classified into `ok`, `unauthorized`,
`unreachable`, or `unprobed`. Only `unauthorized` fails readiness. `unreachable`
deliberately does not: a provider outage is transient and self-heals, and paging
a human for something no human can fix is how alerts stop being read. An
interactive OAuth grant is `unprobed`, because the CLI refreshes that grant
itself and no endpoint here can prove it without reimplementing the refresh, and
`unprobed` is the one non-`ok` verdict a host may still be elected on.

Every lane's verdict, not just the elected one's, is on `/readyz` under
`provider.chain` and in the `remedy`. A human deciding which credential to fund
needs the whole picture, not the news that one of them was refused.

**A gateway lane is elected on a 2xx and nothing else.** `classifyProbeStatus()`
reads a 400 or a 404 as proof the credential works, because api.anthropic.com had
to authenticate the caller before it could object to the request. That reasoning
does not survive a gateway: a base URL one path segment too deep, or a model id
from a different catalog, answers exactly those statuses and then fails every
real reply. Measured 2026-09-09, `https://openrouter.ai/api/v1` makes the CLI
request `/api/v1/v1/messages` and answers 404 forever, which is why the base URL
in [cloudbuild.yaml](cloudbuild.yaml) ends at `/api`.

**One thing about Vertex that could not be tested here.** The billing hold denies
every Vertex call on this project, so the credential probe was verified against
the real endpoint (it returns the 403 above, and `classifyProbeStatus` calls that
`unauthorized`) but the spawned subsession's own Vertex round trip was not. When
the hold clears, watch the first reply: if the CLI reports an unknown model, pin
one Vertex publishes with `ANTHROPIC_MODEL` on the service (a config-only
`gcloud run services update --update-env-vars`, which is pre-approved). Nothing
else about the transport is in question: the URL shape, the region and the
service account's `roles/aiplatform.user` were all exercised.

**Codex needs a login, not an env var.** Codex >= 0.153 authenticates from
`~/.codex/auth.json` and ignores `OPENAI_API_KEY` in the environment: with the
key set and no login, every request fails
`401 Missing bearer or basic authentication in header`. `loginCodex()` runs
`codex login --with-api-key` at boot, before the daemon can spawn a subsession.

`DATABASE_URL` is also required, for the heartbeat row.

## Running it

Both CLIs must be on `PATH`. `cliEnv()` prepends `$HOME/.local/bin` (where the
`onchainos` installer drops its binary) so a local run works whether or not the
binary has been relocated to `/usr/local/bin`.

```bash
# Local, ephemeral: no state bucket, no health server.
npm run worker:okx-bot

# Local, with a health server and an explicit provider.
PORT=8080 OKX_BOT_AI_PROVIDER=claude npm run worker:okx-bot
```

Then read the health verdict:

```bash
curl -s localhost:8080/readyz | jq '{ready: .health.ready, reason: .health.reason, agents}'
```

To stage the same workspace on a developer machine without running the worker,
use [scripts/okx-bot-revive.mjs](../../scripts/okx-bot-revive.mjs), which keeps
the identical skill list. It refuses to start a daemon while any other host is
serving agent 2632: see **One writer, enforced** below.

### One writer, enforced

The wallet keyring and the XMTP client database are one state object with exactly
one writer, which is what `--max-instances=1` protects on Cloud Run. Nothing
protected it from a *second machine*, and `npm run okx:bot` is the one command
that starts one. On 2026-09-09 it did: run from a codespace while the Cloud Run
host was serving, it installed the CLIs, started a daemon, and came up
`agentCount=1 activeClients=1` against the same inbox. It was stopped within
three minutes and the deployed host never missed a beat, but nothing about the
command said no.

Now it asks first, through
[scripts/lib/okx-bot-host-guard.mjs](../../scripts/lib/okx-bot-host-guard.mjs):

| What the health endpoint says | Verdict |
|---|---|
| unreachable | **allowed**, with a warning. An emergency revive must not need the internet to work |
| `no heartbeat reported yet` | **allowed**. Nothing has ever hosted this bot |
| `down`, heartbeat stale | **allowed**. The host is gone; this is the emergency the script exists for |
| any beat, host is this machine | **allowed**. Re-staging the workspace where the daemon already runs adds no writer |
| any beat, another host | **refused**, exit 3, `--force` to override |
| any beat, host not named | **refused**. An API build older than the `host` field answers exactly this, and reading it as an all-clear is what started the rival daemon |

The read is `GET /api/healthz` and nothing else: no `DATABASE_URL`, no
`gcloud` login, no secret. The machine most likely to run this by mistake is a
fresh clone with none of those, so the guard has to work there or it does not
work at all. That is also why [subsystem-health.js](../../api/_lib/ops/subsystem-health.js)
now puts `host` and `hostDurable` on the `okx_chat_bot` subsystem as fields
rather than only inside a sentence.

## HTTP surface

| Path | Behaviour |
|---|---|
| `/readyz` | **Strict.** 200 only when `health.ready` is true, 503 otherwise. |
| any other path | Liveness. Always 200, with the same status body under `ok: true`. |

Liveness is deliberately always-200: Cloud Run must **not** restart the
container for a logged-out session. A restart cannot fix it (only a human OTP
can) and a restart loop would destroy the state snapshot cadence.

When a human is needed, the response carries a `remedy` array with the real
commands, so the fix travels with the status instead of living in a runbook
someone has to go find.

## Deploying

**Status: deployed 2026-09-04.** Service `okx-chat-bot` in
`aerial-vehicle-466722-p5`, revision `okx-chat-bot-00001-926`, `Ready=True` at
`https://okx-chat-bot-lp642k3kpa-uc.a.run.app` (authenticated invocations only).
The first boot restored the seeded snapshot byte for byte, came up
`loggedIn: true` with no OTP, and serves one XMTP client for agent 2632. The
codespace stopgap is stopped and **must stay stopped**: the GCS state object has
exactly one writer and Cloud Run owns it now.

It reports `ai_provider_unauthorized` and answers `/readyz` 503, which is the
design working rather than a fault: chat is delivered durably, the GCP billing
hold denies Vertex, and the bot says so with the fix attached instead of going
quiet. Clearing the hold needs no redeploy; the credential probe flips readiness
on its own within 15 minutes.

Everything the deploy depends on:

| Prerequisite | State |
|---|---|
| `gs://three-ws-okx-bot-state` | created 2026-09-02, versioned, `three-ws@` holds `objectAdmin` |
| `okx-chat-bot-database-url` secret | created 2026-09-02 from the project's own `DATABASE_URL`, `three-ws@` holds `secretAccessor` |
| AI credential | **no secret needed.** `three-ws@` already holds `roles/aiplatform.user`, so `CLAUDE_CODE_USE_VERTEX=1` in the deploy authenticates through ADC |
| Seeded session | seeded 2026-09-04 and proven: the first revision restored it and needed no OTP |

The AI-provider secret used to be the one blocker, and the deploy was written to
fail loudly without it on the reasoning that a bot receiving chat it can never
answer is worse than a refused deploy. That was right about the failure and wrong
about the remedy: the key was never minted, the deploy never happened, and chat
kept being served by a workspace that dies every night. Vertex removes the trade
(the credential cannot go missing) and the case the gate really guarded against,
a credential that is present but refused, is now caught at runtime by the
credential probe and reported as `ai_provider_unauthorized` with the fix in the
`remedy`.

Since 2026-09-02 this worker has beat from a codespace, so `/api/healthz` reports
the `okx_chat_bot` subsystem instead of `unknown`. That is a stopgap and says so
on the wire: every beat carries `host` and `hostDurable`, and a beat whose host
cannot survive on its own reads as **degraded**, never `ok`, with the deploy
command as its hint. Calling a codespace green would rebuild, one level up, the
false-green this worker exists to kill.

### Re-shipping it (one command, after the two steps below)

```bash
# 1. Refresh the seeded session from the host that holds it, daemon stopped:
npm run okx:bot:seed-state -- --apply

# 2. Stop that host. The GCS object has exactly one writer; a codespace stopgap
#    and the Cloud Run service running at once interleave snapshots.

# 3. Deploy.
gcloud builds submit --config workers/okx-chat-bot/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s) .
```

The build pins `three-ws-build@` and the service runs as `three-ws@`; the
project's default compute service account was deleted, so both pins are required.
The service must run `--min-instances=1 --max-instances=1`. That is not a capacity
choice: the GCS snapshot has exactly one writer, and concurrent revisions would
interleave snapshots and corrupt the identity.

Cloud Run's startup probe is wired to `/healthz` and deliberately **not** to
`/readyz`, for the same reason liveness is always-200.

### Seeding the session (why the first boot does not page)

`gs://three-ws-okx-bot-state` holds a snapshot taken 2026-09-04 from the codespace
stopgap, verified by restoring it into a throwaway HOME and reading
`onchainos wallet status` back as `loggedIn: true, claude@three.ws`. So the first
Cloud Run revision restores an authenticated session and comes up online rather
than alerting for an email OTP.

[scripts/okx-bot-seed-state.mjs](../../scripts/okx-bot-seed-state.mjs) (`npm run
okx:bot:seed-state`) writes that archive from any machine holding a live session.
It builds the tar from the same exported `STATE_ROOTS` / `STATE_EXCLUDES` the
worker uses, so the two cannot drift, and uploads it with `gcloud` (the deployed
host uses ADC; a developer codespace has none). A bare run is plan-only; `--apply`
uploads. It **refuses to run while the daemon is up**, because a live copy of the
XMTP sqlite files can tear, and a torn identity costs a human OTP to recover.

The archive carries the wallet keyring and the XMTP identity. It belongs in that
private bucket and nowhere else.

Skipping the seed is not a failure; it just leaves the OTP the first boot would
otherwise have asked for.

### Adding a lane

Never patch an AI key onto the service by hand. `--set-secrets` in the deploy step
replaces the whole secret set, so a hand-added key survives exactly until the next
deploy and then vanishes without a single error line. A lane belongs in
[cloudbuild.yaml](cloudbuild.yaml), where the next deploy carries it too:

- **A first-party Anthropic key**: create the secret, grant `three-ws@`
  `secretAccessor` on it, and add `ANTHROPIC_API_KEY=anthropic-api-key:latest` to
  `--set-secrets`. It ranks below Vertex, so nothing else has to change; drop
  `CLAUDE_CODE_USE_VERTEX` only if you want the key to lead.
- **A gateway**: set `OKX_BOT_ANTHROPIC_BASE_URL` and `OKX_BOT_ANTHROPIC_MODEL` in
  `--set-env-vars` and `OKX_BOT_ANTHROPIC_AUTH_TOKEN=<secret>:latest` in
  `--set-secrets`. The deploy already carries the OpenRouter one.

Because the chain elects on a live probe rather than on presence, a lane with no
funds behind it is inert (it probes `unauthorized` and is never elected) and
costs nothing to leave configured. That is the point: funding it is then a
billing action, not a deploy.

Shutdown order matters and is handled on SIGTERM: the daemon is stopped **before**
the final snapshot, so the sqlite files are quiesced rather than copied mid-write.
The periodic timer snapshot is a live copy and is best-effort by design, so an
ungraceful kill loses minutes, not the identity.

## Monitoring

The worker writes a `bot_heartbeat` row (keyed on `worker = 'okx-chat-bot'`)
carrying the current verdict, agent and client counts, provider, and restart
count. [api/_lib/ops/subsystem-health.js](../../api/_lib/ops/subsystem-health.js)
turns it into the `okx_chat_bot` subsystem, so the bot's reachability shows up
next to every other platform dependency:

```bash
curl -s https://three.ws/api/healthz \
  | jq '.subsystems.subsystems[] | select(.name=="okx_chat_bot")'
```

A host that stops beating reads as `down` rather than silently vanishing, which
is the whole point: a dead host cannot report that it is dead. The beat runs on
its own timer (`OKX_BOT_HEARTBEAT_MS`) rather than at the end of a probe,
because a probe is bounded at 15s + 30s + 90s of CLI calls and can outlast the
two-minute freshness window `/api/healthz` judges the host by. One slow wallet
call must not read as "the host is gone".

What a human has to do, read off the service itself:

```bash
URL=$(gcloud run services describe okx-chat-bot --region us-central1 \
  --project aerial-vehicle-466722-p5 --format='value(status.url)')
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL/readyz" | jq .remedy
```

Three signatures are classified in
[scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), so `npm run triage:gcp`
explains them instead of filing them as unknown: `okx-bot-session-logged-out`
(owner action, needs the OTP), `okx-bot-provider-unauthorized` (owner action, the
AI credential is present and refused) and `okx-bot-daemon-restart` (self-healing
unless the restart count climbs continuously).

A transition into a bad state fires an ops alert through `sendOpsAlert`, at most
once per `OKX_BOT_ALERT_REPEAT_MS` while it persists, so one overnight expiry
does not become a hundred notifications. Recovery fires a matching info alert.

Daemon stdout and stderr are forwarded into the worker's own log stream under a
`daemon` prefix, since that output is the only window into XMTP delivery.

## Related

- [scripts/okx-bot-revive.mjs](../../scripts/okx-bot-revive.mjs) stages the same workspace locally, and refuses while another host is serving.
- [scripts/lib/okx-bot-host-guard.mjs](../../scripts/lib/okx-bot-host-guard.mjs) is the one-writer check that script runs first.
- [scripts/okx-bot-seed-state.mjs](../../scripts/okx-bot-seed-state.mjs) seeds the GCS session snapshot (`npm run okx:bot:seed-state`).
- [api/_lib/okx-chat-briefing.js](../../api/_lib/okx-chat-briefing.js) generates the subsession briefing.
- [workers/README.md](../README.md) is the worker index.
