# 09. Telegram feed bots: durable hosting for both channels

Read [00-INDEX.md](_context/backlog-00-INDEX.md) first.

> **Commit gate.** These bots track a launchpad other than `$THREE`. The code
> lives in a different repo (`nirholas/pump-fun-sdk`), so nothing here should land
> in three.ws without owner approval. Build and deploy freely; ask before
> committing anything that names the launchpad into this repo.

## Status: both feeds live and hardened, re-verified 2026-09-09

The 2026-09-02 pass declared this done. It was half true. Re-measuring on
2026-09-09 found the graduation tracker healthy and **the all-claims firehose
silently dead**: 99 hours of uptime, `mode: websocket`, and zero events.

Root cause: `rpc.magicblock.app` went key-gated. It now answers `401` on the
WebSocket upgrade and `{"error":"invalid api key"}` over HTTP, and it was the
firehose's only WebSocket endpoint *and* its primary RPC. The 2026-08-01 note
below calling it a working free endpoint is what stopped being true.

Why it stayed invisible for four days is the part worth keeping: **subscribing
cannot fail loudly.** web3.js returns a subscription id immediately and retries
the socket internally, so `startWebSocket()` resolved, `transport` was set to
`websocket`, and `/stats` reported a healthy feed. The 90-second silence
heartbeat did fire, but its reconnect rebuilt the same dead endpoint, so the
watchdog looped instead of escaping. Nothing in the metrics distinguished a
connected socket from a refused one.

Both halves are fixed and deployed.

| Feed | Cloud Run service | Revision | Transport | Measured 2026-09-09 |
|---|---|---|---|---|
| Graduation and migration tracker | `pumpfun-channel-bot` | `-00006-wp4` | websocket on `solana-rpc.publicnode.com` | 156 events in 3m17s, `degraded: false`, delivery `ok` |
| All-claims firehose | `pumpfun-allclaims-bot` | `-00010-bdc` | websocket on `solana-rpc.publicnode.com` | 745 claims and 242,207 WS events in 23m, 145 instant posts, 23 digests, **0 post failures** |

Both `Ready=True`, pinned singletons (`minScale=1`, `maxScale=1`) on the
`three-ws@` runtime SA, each with its own bot token in its own Secret Manager
secret and its own numeric channel id (`-1003965305979`, `-1003905427189`).

The firehose recovered the moment its endpoints were repointed: 62 claims in the
first two minutes, against the ~20 claims/min baseline this order set.

### The config fix (immediate)

Both services were repointed off magicblock onto endpoints verified keyless and
streaming the same day: `solana-rpc.publicnode.com`, `api.mainnet-beta.solana.com`
(HTTP and WS), and `solana.leorpc.com/?api_key=FREE` (HTTP only; its WS refuses).
`drpc.org` and `rpc.ankr.com` are no longer keyless either and were rejected.

A trap this exposed: `deploy-cloudrun.sh` ships env from `.env` via
`--env-vars-file`, which **replaces the whole set**. The local `.env` still held
the magicblock config, so the next deploy would have silently re-broken the feed.
`recover-env.sh` now regenerates it from the corrected live revision, and both
`.env` files carry the new endpoint lists.

### The code fix (so this class of outage cannot hide again)

Landed in the sibling repo at `2a12ec3a`, canonical copy first and propagated to
`channel-bot`, per the rule in its own `DECODERS.md`:

- **A WebSocket endpoint list, not one endpoint.** `SOLANA_WS_URLS` is
  comma-separated, and whatever the RPC list implies is appended, so there is
  always somewhere to fail over to. The firehose now runs with 5 resolved.
- **Liveness is proven by traffic, not by a subscription id.** A new
  subscription must deliver a real log event within 20 seconds or the endpoint is
  rejected and the next one tried. The monitored programs emit thousands of
  events a minute, so silence that long means the endpoint, not the chain.
- **Reconnects rotate** instead of retrying the endpoint that just went quiet.
- **The heartbeat timer is cleared before it is re-armed.** Every reconnect since
  this code was written had been stacking another interval.
- **`/stats` exposes `activeWs` and `wsEventsReceived`,** so a WebSocket carrying
  no traffic is visible rather than indistinguishable from a healthy one.
- `channel-bot`'s live feed runs on `event-monitor.ts`, not the claim monitor, so
  the rotation was applied there too rather than only to the shared decoder path.

Verified by running the monitor against the dead endpoint first: it rejected
magicblock, settled on `solana-rpc.publicnode.com`, and reported 9,773 events.
Covered by `src/__tests__/ws-urls.test.ts` in both bots (7 cases, including the
regression that a single explicit endpoint must never de-duplicate down to a
single point of failure). Suites green: 95 tests allclaims, 205 channel-bot.

Deliberately not done: neither bot has a persistent volume, so tracker state is
ephemeral and a redeploy resets it. That is pre-existing, was true before this
pass, and mounting one is a separate change.

### Standing observation, not a failure

`queueDrops` sits at 53 on the firehose (~0.9% of pipeline claims). That is the
RPC queue's designed backpressure, and the levers are queue capacity and endpoint
count. The 2026-08-02 baseline of zero drops was a 3h43m measurement, not a
contract.

## The work


1. **Deploy both to Cloud Run.** `channel-bot/deploy-cloudrun.sh` exists and is the
   template. Write the equivalent for the all-claims package. Pin the
   `three-ws-build@` and `three-ws@` service accounts.

2. **Never use `--set-env-vars` for these.** Their config breaks the flag: the RPC
   URL list contains commas and the channel id can contain `@`, so neither the
   default separator nor the `^@^` alternate delimiter is safe. `deploy-cloudrun.sh`
   writes a YAML env file instead. Do the same for the second bot.

3. **Keep the bot identities separate.** Each feed has its own bot and its own
   channel. Reusing one token across both is unsupported and crosses the feeds.
   Put the **numeric `-100…` chat id** in `CHANNEL_ID`, never the handle: the
   shared `t.me` link is not always the username, and `getChat?chat_id=@handle`
   returns `chat not found` even with the bot already an admin. Recover the real
   id from `getUpdates?allowed_updates=["my_chat_member"]`, whose promotion event
   carries the chat id, username, and full admin rights object.

4. **Keep websockets, do not fall back to polling, and configure more than one.**
   `getSignaturesForAddress` limit-20 per 30s against the program samples a
   handful of valid transactions per minute out of thousands, so events get
   missed entirely. WS is enabled when `SOLANA_WS_URL` or `SOLANA_WS_URLS` is
   set. **`wss://rpc.magicblock.app/mainnet` is dead as of 2026-09-09**: it went
   key-gated and answers 401 on the upgrade. Do not re-add it. Keyless and
   verified streaming that day: `wss://solana-rpc.publicnode.com` and
   `wss://api.mainnet-beta.solana.com`. The three.ws Helius key is plan-exhausted
   and its WS handshakes 429 forever, so do not point these at it.

   Always set `SOLANA_WS_URLS` with at least two. A single endpoint is a single
   point of failure, and the failure is silent: see the status section above.

5. **Sync the stale decoders.** `@pumpkit/core` and `@pumpkit/channel` are March
   snapshots missing the post-2026-05-21 V2 layouts (quote-mint claims, lifetime
   claimed, fake social-claim detection). The current decoder lives in
   `channel-bot/src/claim-monitor.ts`. Either sync pumpkit from it or make every
   future bot copy from channel-bot, and write down which, because this trap has
   already been hit once.

6. **Process hygiene for whoever debugs this next.** The bot's cmdline is
   `node dist/index.js` (relative), so `pkill -f "channel-bot/dist/index.js"`
   silently matches nothing. Match on cwd via `/proc/<pid>/cwd`, and never kill a
   same-named process whose cwd is `/workspaces/three.ws`.

## Verify

Both services are private, so a stats read needs an identity token:

```sh
P=aerial-vehicle-466722-p5
for S in pumpfun-channel-bot pumpfun-allclaims-bot; do
  curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
    "$(gcloud run services describe "$S" --region us-central1 --project "$P" \
      --format='value(status.url)')/stats"
done
```

`localhost:3900` and `localhost:3901` only answer when a bot is running locally
as a fallback, which is no longer the normal state. If a local run is needed,
restore its config first with `./recover-env.sh` from the bot's directory: the
gitignored `.env` does not survive a codespace rebuild.

Baseline for the firehose once live: roughly 20 claims/min detected, digest every
60s, zero post failures. Flood control matters: Telegram caps around 20 posts/min
per channel, so large claims post individually and the rest batch into a digest,
with a sliding-window budget reserving one slot for the digest.

## Definition of done

- [x] Both bots run on Cloud Run, surviving a codespace rebuild. Proven by the
      2026-09-02 rebuild: both local processes died, both services stayed up.
- [x] Each uses its own token and numeric channel id, verified by live posts to
      distinct `-100...` ids (145 instant posts and 23 digests on the firehose in
      the 23 minutes after the fix, 0 post failures).
- [x] WS mode confirmed active on both, with event rates recorded above.
      Re-measured 2026-09-09 after the firehose was found silent for four days:
      both now carry traffic on `solana-rpc.publicnode.com`, and `/stats`
      reports `activeWs` so a dead socket is visible rather than reported as
      healthy.
- [x] A dead WebSocket endpoint can no longer flatline a feed: endpoint lists,
      a traffic-based liveness check, rotating reconnects, and the metrics to
      see it, committed in the sibling repo at `2a12ec3a` and deployed
      (`pumpfun-allclaims-bot-00010-bdc`, `pumpfun-channel-bot-00006-wp4`).
- [x] The decoder sync decision is made, executed, and written down in
      `DECODERS.md` at the sibling repo root: the all-claims copy is canonical,
      nothing was refactored into a shared package, and the two stale copies are
      marked do-not-copy. Its rule for future bots is to copy that file and its
      test together.
- [x] A README in each bot directory documents deploy, env, and revival, now
      including `recover-env.sh`.
- [ ] Owner approval to commit this file's update into three.ws. Nothing else
      here needs it: the code landed in the sibling repo, which the gate at the
      top of this file exempts.

## Retire this prompt when it is done (required)

1. Verify every Definition of done line against actual command output in front
   of you. Never claim a line you did not verify.
2. Record the outcome in this campaign's PROGRESS or INDEX file if it has one.
3. Commit with explicit paths and a subject that describes the diff (house
   style: type(scope): what changed and why a reader cares), and delete this
   prompt file in that same commit:

       git rm prompts/finish/908-backlog-09-telegram-bots-durability.md

   A finished order left on disk reads as open work to the next agent, so the
   shrinking directory is the campaign's progress ledger.

If a line genuinely cannot pass inside this session (an external party must
respond, or an owner-gated action is the final step), finish everything else,
leave this file in place, and state exactly which line remains and who owns it.
Never delete this file on a partial.
