# 08. OKX marketplace chat bot: get it off the codespace

Read [00-INDEX.md](_context/backlog-00-INDEX.md) first.

> **Commit gate.** Content here references a marketplace outside the `$THREE`
> ecosystem. Get owner approval before committing anything that names it.

## What is wrong

Chat for the marketplace listing (agent #2632, "three.ws 3D Studio") is delivered
by a **local `okx-a2a` daemon plus a wallet session**, both outside this repo. It
goes offline on its own: a codespace rebuild wipes the CLIs and an idle nap kills
the daemon (observed alive at 21:09, stale pid by 03:13). The marketplace's own
tests then report "timeout, no delivery in 30 min", which is what got the listing
flagged offline once already.

**State on 2026-09-09, measured.** The durable host exists and this order is mostly done.
Cloud Run service `okx-chat-bot`, revision `okx-chat-bot-00001-926`, booted
2026-09-05T00:33Z and beating every 30s with `loggedIn: true`, `activeClients: 1`,
`daemonRestarts: 0`. What is left is one reply lane: the AI provider refuses this
project's credential (`Lightning dunning decision is deny`, a GCP billing hold), so chat
arrives and no reply is authored. Both remaining steps are the owner's, and they are listed
at the bottom of this file.

## Do NOT start a local daemon (read this before running anything)

The codespace stopgap is retired and **must stay stopped**. The bot's identity, the
onchainos wallet keyring plus the XMTP client database, is a single state object with
exactly one writer, which is what `--max-instances=1` protects on Cloud Run. Starting a
second daemon anywhere puts a second writer on it, and a torn identity costs a human email
OTP to recover.

An earlier version of this file opened with "Immediate revive (do this first)" and
`npm run okx:bot`. Following it on 2026-09-09 started exactly that rival daemon. The
command now refuses while any other host is beating (exit 3, `--force` to override), so the
trap is closed mechanically as well as here, but the rule stands: run nothing local while
the deployed host is up.

Read the deployed host's state instead. This read needs no `gcloud` and no credential:

```sh
curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[]|select(.name=="okx_chat_bot")'
```

## The durable fix

A codespace cannot stay up on its own, so the real deliverable is an always-on
host. Build it:

1. **Containerize the daemon and its session state.** The daemon spawns the AI CLI
   in `~/.okx-agent-task/workspace`, and that directory's `CLAUDE.md` and
   `.claude/skills` are the **only** context chat answers have. It is empty by
   default, which means a naive host ships an agent that knows nothing about
   three.ws. Bake real context in.

2. **Do not replace the adapter with a one-shot responder.** The adapter does not
   read a reply out of the CLI's stdout; the AI subsession sends the reply itself
   via the `okx-a2a` CLI. A simple LLM responder would break the task lifecycle,
   not just chat. Custom hosts are supported through
   `OKX_A2A_AI_<PROVIDER>_COMMAND` and `..._EXEC_ARGS_JSON`, but whatever runs
   there must be genuinely agentic.

3. **Deploy to Cloud Run** in `aerial-vehicle-466722-p5`, pinning the
   `three-ws-build@` build service account and the `three-ws@` runtime service
   account (the default compute SA was deleted). Config-only env updates are
   pre-approved; the deploy itself is owner-gated, so prepare it to one command.

4. **Add a liveness signal.** The listing goes offline silently today. Expose a
   health endpoint and wire it into the same monitoring that watches the rest of
   the fleet, so "the bot is logged out" becomes an alert instead of a discovery.

5. **Session renewal.** The wallet session expires and needs a human OTP. Make the
   host detect an expired session and emit an actionable alert naming the exact
   command, rather than failing chat silently.

## State on 2026-09-25, re-measured: gcloud is back, the deploy is one approval away

- **Bot host: unchanged.** `/api/healthz` still reports `okx_chat_bot` `degraded` on
  `cloudrun:okx-chat-bot (okx-chat-bot-00001-926)`, same Vertex `403 Lightning dunning decision is
  deny`. Live API still `c8f10f437` (`three-ws-api-00458-njs`).
- **Owner step 0 is done.** `gcloud` is installed and authenticated (project
  `aerial-vehicle-466722-p5`); `npm run okx:bot:deploy -- --dry-run` passes step [1].
- **Fresh-clone fix.** This workspace has no `.env.local`, so step [3] died on `DATABASE_URL is not
  set`. `scripts/okx-bot-llm-gateway.mjs` now falls back to the API service's `DATABASE_URL`
  (`requireServiceEnvValue`, the same path `rug-signature.mjs` uses). Measured after the change,
  with no local env: step [3] reads production and reports service account, metering agent, key
  and secret all `missing`, which is exactly what `--apply` creates. Steps [1] and [4] green.
- **Why the bot is not deployed yet:** the real run refuses while
  `scripts/okx-bot-llm-gateway.mjs` has uncommitted edits, and committing a file that names the
  marketplace needs owner approval (commit gate). Owner: approve the commit of that file plus this
  order, then run `npm run okx:bot:deploy`, then step 3 below.

## State on 2026-09-24, re-measured: the API half has shipped, only the bot deploy is left

- **API deploy: DONE.** Live API `c8f10f437` (`three-ws-api-00458-njs`) contains `53687d994`,
  `d3074c1c8` and `f7f7da9b6`. The agent-scoped path is served: a POST to
  `/api/llm/anthropic/agents/<unknown id>/v1/messages` answers `404 agent not found`, where it
  answered `No API route matches` on 2026-09-18. Owner action 1 below is complete.
- **Bot host: unchanged revision, still beating.** `bot_heartbeat` row `okx-chat-bot` was 20 s
  old at 06:33 UTC, `host cloudrun:okx-chat-bot (okx-chat-bot-00001-926)`, `loggedIn: true`,
  `activeClients: 1`, `agentCount: 1`, `daemonRestarts: 0`, instance `bootAt`
  2026-09-22T13:44Z. No `providerLane` / `leaseHolder` in the beat, so it is still the pre-lane,
  pre-lease code, pinned to Vertex, which still answers `403 Lightning dunning decision is deny`.
  `/api/healthz` reports `okx_chat_bot` `degraded` for exactly that reason.
- **`npm run okx:bot:deploy -- --dry-run`** reaches step [4] green ("live API c8f10f437 contains
  d3074c1c8") and stops at steps [1] and [3] because this workspace has no `gcloud` binary at all
  (`spawn gcloud ENOENT`), not just an expired login. The metering service account
  `marketplace-chat@agents.three.ws` does not exist yet, as expected: `--apply` creates it.
- **What remains is owner step 2 below**, preceded by installing and authenticating `gcloud`.

## State on 2026-09-18, and the one command left

The payment-free reply lane is built and proven, the rollout overlap is closed, and the deploy
is one command. Full measurements: [okx-ai-PROGRESS.md](_context/okx-ai-PROGRESS.md), entry
2026-09-18.

- **Reply lane.** The bot's `anthropic-gateway` lane now points at three.ws's own proxy at the
  agent-scoped base URL `https://three.ws/api/llm/anthropic/agents/<agent>` (the path the `claude`
  CLI builds by appending `/v1/messages`), model `nvidia/nemotron-3-super-120b-a12b`, on the free
  chain. The proxy changes that make the CLI's default request acceptable (`53687d994`,
  `d3074c1c8`, plus `f7f7da9b6`) are committed and **not live yet**: live API `4291900c7`.
  Proven on production: the bot's probe body answers `200` on the free NVIDIA rung, and the real
  `claude -p` agentic request made a Bash tool call and answered through the live proxy (via a
  shim applying exactly those server-side adaptations, until the API deploy lands).
- **Metering.** A dedicated service account `marketplace-chat@agents.three.ws` owning one
  unpublished agent, with a key minted straight into Secret Manager
  (`okx-chat-bot-llm-gateway-token`). Never someone else's agent, and a leaked key is worth one
  agent's AI budget. `npm run okx:bot:gateway` provisions and proves it; not run yet (Secret
  Manager writes are the owner's).
- **Single writer.** `max-instances` is per revision, so a rollout overlapped two daemons on one
  identity. [workers/okx-chat-bot/lease.js](../../workers/okx-chat-bot/lease.js) sequences it: the
  new instance waits for the old one's final snapshot and lease release (or, for the pre-lease
  `00001-926`, for its heartbeat to go 90 s quiet) before restoring and starting its daemon.

### Owner actions, in order (either deploy may go first)

```sh
# 0. As of 2026-09-24 this workspace has no gcloud binary at all (install the Google Cloud CLI
#    first), and any earlier login is gone with it.
gcloud auth login && gcloud auth application-default login

# 1. DONE by 2026-09-24 (live API c8f10f437 serves the agent-scoped path). Kept for the record:
#    approve and commit the gated files, then ship the API:
npm run clean:worktrees -- --apply
npm run prep:worktree -- --apply
(cd /workspaces/.deploy-wt && npm run deploy:gcp:full)
git worktree remove --force /workspaces/.deploy-wt

# 2. Ship the bot: provisions the gateway lane (agent, key, secret, IAM), builds a clean
#    worktree of HEAD, submits cloudbuild.yaml, and waits for the new revision to take the lease.
npm run okx:bot:deploy            # preview first with: npm run okx:bot:deploy -- --dry-run

# 3. Verify.
npm run okx:bot:gateway -- --verify --cli
curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[]|select(.name=="okx_chat_bot")'
```

Clearing the GCP billing hold is no longer required for replies, but it is still worth doing:
Vertex leads the chain, so the next election moves the bot back to Claude on Vertex by itself.

## Definition of done

- [ ] **Chat delivery verified end to end with a real inbound message.** The inbound half
      is proven (`activeClients: 1`, `agentCount: 1`, 0 daemon restarts since
      2026-09-05). The reply lane is proven against production (2026-09-18: the real
      `claude` agentic request, tool call included, answered through the free proxy
      chain); a real buyer reply needs the two deploys above. The original wording
      of this line, "`npm run okx:bot` exits 0", is retired: that command is the
      codespace stopgap and must not run while the deployed host is up.
- [x] **The daemon runs on an always-on host, not this codespace.** Cloud Run
      `okx-chat-bot-00001-926`, 4.8 days of continuous 30s beats.
- [ ] **Its workspace carries real three.ws context.** The mechanical half is done and
      tested: `buildChatBriefing()` renders 10,069 bytes from the live catalog module and
      is rebuilt on every boot. Asking the bot a platform question needs the deploys above.
- [x] **A health endpoint exists and an offline session raises an alert.** `/readyz` is
      strict, `/api/healthz` carries the `okx_chat_bot` subsystem (now naming its
      `host` and `hostDurable` as fields), and `sendOpsAlert` fires on every
      transition into a bad state.
- [x] **[../okx-ai/PROGRESS.md](_context/okx-ai-PROGRESS.md) updated with the host details.**

## Retire this prompt when it is done (required)

1. Verify every Definition of done line against actual command output in front
   of you. Never claim a line you did not verify.
2. Record the outcome in this campaign's PROGRESS or INDEX file if it has one.
3. Commit with explicit paths and a subject that describes the diff (house
   style: type(scope): what changed and why a reader cares), and delete this
   prompt file in that same commit:

       git rm prompts/finish/907-backlog-08-okx-chat-bot-always-on.md

   A finished order left on disk reads as open work to the next agent, so the
   shrinking directory is the campaign's progress ledger.

If a line genuinely cannot pass inside this session (an external party must
respond, or an owner-gated action is the final step), finish everything else,
leave this file in place, and state exactly which line remains and who owns it.
Never delete this file on a partial.
