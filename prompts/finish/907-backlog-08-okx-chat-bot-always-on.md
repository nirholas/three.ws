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

## Owner actions (both, and nothing else, as of 2026-09-09)

1. **Fund one AI lane.** Clearing the GCP billing hold on `aerial-vehicle-466722-p5` is
   the one that also restores the platform's own Vertex anchor (`LLM providers DOWN`,
   count 657). OpenRouter credit or an OpenAI reactivation each work too, because the
   chain elects on a live probe.
2. **Deploy the worker**, so the AI-lane chain from `ad723e87f` is actually running. The
   live beat carries no `providerLane`/`providerChain` key, which is how you can tell
   the serving revision predates it without `gcloud`: it is pinned to Vertex and cannot
   pick up a funded lane even after step 1.

   ```sh
   gcloud builds submit --config workers/okx-chat-bot/cloudbuild.yaml \
     --region us-central1 --project aerial-vehicle-466722-p5 \
     --substitutions=SHORT_SHA=manual$(date +%s) .
   ```

Order does not matter; whichever lands second is picked up by the next 15-minute election.
An email OTP is **not** currently needed: the session has been `loggedIn: true` since
2026-09-05.

## A second route to the reply lane, found 2026-09-10 (owner's call, not taken)

Owner action 1 (clear the GCP billing hold) is still the clean fix, and it now unblocks four
orders rather than two, so it is worth doing on its own merits. But it is no longer the ONLY
route to a working reply lane, and the alternative needs no payment:

`providerLanes()` in [config.js](../../workers/okx-chat-bot/config.js) already carries an
`anthropic-gateway` lane that accepts any Anthropic-wire-format endpoint via
`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`. **three.ws serves exactly that shape itself** at
`/api/llm/anthropic`, the we-pay proxy the avatar embeds already use, and its free NVIDIA rungs
were repaired on 2026-09-10 (`4dbe02cc7`); before that they were retired ids answering `410 Gone`,
so this route would not have worked even if someone had tried it. Pointing the bot at our own
proxy bills no third party and needs no Google lane.

Three things gate it, and none is a code change:

1. **The API deploy carrying `4dbe02cc7` has to land first**, or the proxy's NVIDIA rungs are
   still the dead ids.
2. **The proxy meters per agent.** It answers `400 agent query param required`, so this needs an
   agent id owned by the platform user, and the i18n lane's own docs warn never to point it at
   someone else's agent. Which agent to meter is an owner decision. Its embed-policy default is
   10 requests/min, which is ample for chat but is a real ceiling.
3. **Electing a lane respawns the daemon.** That is the documented mechanism (an env overlay plus
   a respawn), and this bot's identity, the wallet keyring plus the XMTP client database, is a
   single-writer state object whose corruption costs a human email OTP to recover. That risk is
   why this was left for the owner rather than applied from a session.

Not verified end to end from here, deliberately: proving it would mean metering a real agent and
respawning the live daemon. What IS verified is that the gateway lane exists, that
`/api/llm/anthropic` speaks the Anthropic wire format, and that its free chain answers again.

## Definition of done

- [ ] **Chat delivery verified end to end with a real inbound message.** The inbound half
      is proven (`activeClients: 1`, `agentCount: 1`, 0 daemon restarts since
      2026-09-05). The reply half cannot pass until owner action 1. The original wording
      of this line, "`npm run okx:bot` exits 0", is retired: that command is the
      codespace stopgap and must not run while the deployed host is up.
- [x] **The daemon runs on an always-on host, not this codespace.** Cloud Run
      `okx-chat-bot-00001-926`, 4.8 days of continuous 30s beats.
- [ ] **Its workspace carries real three.ws context.** The mechanical half is done and
      tested: `buildChatBriefing()` renders 10,069 bytes from the live catalog module and
      is rebuilt on every boot. Asking the bot a platform question needs owner action 1.
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
