# LIVE-OPS: $THREE Community Meetup #3

One page. Everything an operator needs while the event is running, and nothing else.
Prepared 2026-11-03, re-verified 2026-11-06 06:40 UTC after the release deploy. Project `aerial-vehicle-466722-p5`, region `us-central1`.
Freshness is machine-checked: `npm run check:live-ops` fails when the three lines
below disagree with `public/event.json` or with what `/api/version` serves.

**Event id:** `three-community-meetup-3`
**Starts:** `2026-11-06T16:00:00Z` (ends `2026-11-06T17:00:00Z`, one hour)
**Live release:** `449584c41` on revision `three-ws-api-00528-n5h`

"The Three.ws User Group on IBM Community, meeting inside the world." Virtual: every
attendee joins from their own network, so there is no shared venue NAT to plan for.

| Pacific | Eastern | London | Berlin |
|---|---|---|---|
| 08:00 | 11:00 | 16:00 | 17:00 |

---

## The link and the release

**Event URL** (the canonical $THREE world, from [README.md](README.md)):

```
https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&image=%2Fapi%2Fimg%3Furl%3Dhttps%253A%252F%252Fipfs.io%252Fipfs%252Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q%26seed%3DFeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump
```

The event release is live. API build `449584c41` (built 2026-11-06 06:00 UTC) on
`three-ws-api-00528-n5h`: every /play fix from the 2026-11-06 audit, the $THREE
flagship card resolving its name and art, HTML kept off the CDN edge
(`private, no-cache`, so a skipped purge can no longer strand /play on deleted
chunks), and the leak scanner's idle-wallet rotation capped so it stops exhausting
the paid Solana RPC lanes. `npm run smoke:prod` passed on all 1,058 pages.

The world server runs `three-ws-multiplayer-00013-qor` (tag `event`), built
2026-11-06 from every unshipped multiplayer commit (dance-off, presenter PA,
souvenir, moderation, parties, signature wall) with `WALK_ROOM_MAX_CLIENTS=250`.
The TRELLIS text-to-3D worker runs `model-trellis-00032-gp2` with the queued-job
orphan fix.

> **Do not deploy the world server inside the event window.** A fresh revision
> briefly runs two instances while it hands over, which expires seat reservations
> and can split a crowd into two rooms.

---

## Health: three commands that prove the site is up

```bash
# 1. API alive, and which build is actually serving
curl -s https://three.ws/api/version

# 2. API subsystems. "status":"ok" is the gate; read the known-down list below
#    before reacting to an individual subsystem.
curl -s https://three.ws/api/healthz | head -c 600

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

Subsystems `/api/healthz` reported as not-ok on 2026-11-03, all known and none on
the /play path: `rpc_lanes` degraded (paid Solana RPC quotas spent, see failure
modes), `world.three.ws` 404 (the Hyperfy world, not /play), `three_token_rail` down
(treasury and rewards wallets unset), `sniper` starved, `telegram_push` disabled.

---

## Logs: two commands for fast triage

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"

# Errors across the whole fleet, last 6h
npm run logs:errors

# The world server specifically: join refusals, origin rejections, room churn
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="three-ws-multiplayer" severity>=WARNING' \
  --freshness=1h --limit=50 --project aerial-vehicle-466722-p5
```

Deeper sweep when the cause is not obvious: `npm run triage:gcp:deep`.

Recurring 5xx in the 24h before 2026-11-03 19:00 UTC, so they are not mistaken for
event breakage: `/api/crypto/bonding` 503 (3,953, fixed in `a5879f4bc`, unshipped:
pollers retried non-pump mints forever), `/api/pump/trending` and `/api/pump/coin`
502 (pump.fun upstream), `/api/crypto/holders` 503 (RPC quota), `/api/x402-pay` and
`/api/x402/forge` 503 (sponsor fee floor), `/api/tts/synthesize` 502 (bursty).

---

## Rollback: pre-filled, per service

The release revisions serve 100% now (`three-ws-api-00528-n5h`,
`three-ws-multiplayer-00013-qor`, `model-trellis-00032-gp2`,
`three-ws-redis-proxy-00005-8d6`). The table lists what to roll back TO.

| Service | current (roll back to this after the deploy) | previous |
|---|---|---|
| `three-ws-api` | `three-ws-api-00527-gz9` (`b1d1eaf83`: the release without the CDN header and RPC cap) | `three-ws-api-00526-fvq` (`f3121e379`, pre-audit) |
| `three-ws-multiplayer` | `three-ws-multiplayer-00012-fhl` (2026-10-30 image, 100 per room) | `three-ws-multiplayer-00011-qjv` |
| `model-trellis` | `model-trellis-00031-5zm` (without the orphan fix) | `model-trellis-00030-nm2` |
| `three-ws-redis-proxy` | `three-ws-redis-proxy-00005-8d6` | `three-ws-redis-proxy-00004-bwk` (min 3 / max 10) |

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
R="--region us-central1 --project aerial-vehicle-466722-p5"

# API + frontend
gcloud run services update-traffic three-ws-api $R \
  --to-revisions=three-ws-api-00527-gz9=100

# The /play world server (kicks everyone in-world; they auto-reconnect)
gcloud run services update-traffic three-ws-multiplayer $R \
  --to-revisions=three-ws-multiplayer-00012-fhl=100

# Text-to-3D worker (the "one sentence to a rigged agent" beat)
gcloud run services update-traffic model-trellis $R \
  --to-revisions=model-trellis-00031-5zm=100

# Redis proxy (presence, durable builds)
gcloud run services update-traffic three-ws-redis-proxy $R \
  --to-revisions=three-ws-redis-proxy-00005-8d6=100
```

Then purge the edge or the CDN keeps serving the bad build:

```bash
npm run deploy:gcp:purge-cdn
```

Return to normal afterwards with `--to-latest` instead of `--to-revisions`.

**Rehearsal (2026-11-03, re-read 2026-11-04 17:20 UTC: same revisions, all `Ready=True`, 100% on the current ones):** every revision above reports `Ready=True`. The API's
previous revision was proven routable without shifting traffic: it was tagged
`rollback` at 0%, `https://rollback---three-ws-api-lp642k3kpa-uc.a.run.app/api/version`
answered 200 in 0.39s with commit `0a913e8a7`, and the tag was removed. Re-run the
same probe against any target before a real rollback:

```bash
gcloud run services update-traffic three-ws-api $R --update-tags=rollback=<revision>
curl -s https://rollback---three-ws-api-lp642k3kpa-uc.a.run.app/api/version
gcloud run services update-traffic three-ws-api $R --remove-tags=rollback
```

---

## Scale: what is set, and how to raise it

Pre-scaled 2026-11-03 (config-only, pre-approved per
[docs/ops/gcp-credits-plan.md](../ops/gcp-credits-plan.md)):

| Service | min | max | concurrency | CPU / memory | changed from |
|---|---|---|---|---|---|
| `three-ws-api` | **12** | 100 | 160 | 2 / 8Gi | min was 6 |
| `three-ws-multiplayer` | 1 | **1 (hard)** | 1000 | 4 / 8Gi | unchanged |
| `three-ws-redis-proxy` | **4** | **20** | 80 | 1 / 1Gi | was min 3 / max 10 |

A full API deploy keeps these: `server/cloudbuild.yaml` pins memory, CPU and the VPC
connector but not min or max instances, and `gcloud run deploy` keeps unpinned
scaling settings.

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
R="--region us-central1 --project aerial-vehicle-466722-p5"

# More API headroom (safe, instant)
gcloud run services update three-ws-api $R --min-instances=20 --max-instances=200

# More world-server headroom. Raise CPU/RAM or concurrency, never max-instances.
gcloud run services update three-ws-multiplayer $R --cpu=8 --memory=16Gi
gcloud run services update three-ws-multiplayer $R --concurrency=2000

# After the event, return the API floor
gcloud run services update three-ws-api $R --min-instances=6
```

**`three-ws-multiplayer` max-instances must stay 1.** Colyseus rooms live in one
process. A second instance only works when the room registry and presence are
shared through Redis *and* each instance is individually addressable. Cloud Run
gives every instance the same URL, so instance 2 would silently split players in
the same world into two crowds that cannot see each other. Use CPU, memory and
concurrency instead.

---

## Capacity: measured, not assumed

**Assumed peak: 200 concurrent players.** Source: there is no attendance record for
the previous meetups (`/api/play/population` reads 0 between events), and this is a
one-hour virtual user-group session. 200 is a deliberately generous ceiling, and
the test below drove 2x that.

`node scripts/play-capacity-smoke.mjs --n 400 --ramp 60 --hold 120` against live
production, 2026-11-03 19:25 UTC:

| | |
|---|---|
| requested / joined | 400 / 400 (100%) |
| held to the end | 400 (server population read 400) |
| mid-run drops / silent sessions | 0% / 0% |
| join latency | p50 981ms, p95 15,950ms (harness-bound, see below) |
| moves sent / state patches | 121,682 / 254,114 |
| world server | 1 instance, CPU p99 peak 8%, memory p99 2% |
| API | up to 20 instances |

The join p95 threshold failed, but the cause was the load generator, not the
server: this box ran at load average ~140 and the harness's own event loop stalled
up to 3.8s. A 5-player probe from the same box immediately after joined at
p95 418ms, and the world server never exceeded 8% CPU. The single instance carries
400 walking players with headroom to spare. The known cliff is concurrency 1000,
where Cloud Run wants a second instance that `max-instances=1` refuses: raise
`--concurrency` if the count approaches it.

World server at the event build, 2026-11-06 (`00013-qor`, `WALK_ROOM_MAX_CLIENTS=250`,
run from Cloud Build so the load generator is not this box): 250 of 250 joined one
room, 0 failures, 0 drops, join p50 233ms, p95 455ms, patch delivery 99.86%, CPU at
most 7%. A 251st player opens a second room of the same world.

Re-run 2026-11-04 17:10 UTC (`--n 400 --ramp 45 --hold 150`, same box, load average
~118): **PASS on all four thresholds.** 400 of 400 joined, 400 held to the end, 0%
drops, 0% silent sessions, join p50 1,505ms, p95 3,518ms, max 6,131ms, 212,272 moves
sent, 413,882 state patches. An idle `curl` of `/play` straight after measured
57-143ms.

---

## Third-party failover (proven 2026-11-03, re-proven 2026-11-04 17:00 UTC)

| Dependency | Primary today | Failover proof |
|---|---|---|
| Solana RPC | Helius and Alchemy both 429 (monthly quota spent, parked 6h by design) | `npm run event:failover`: 4 of 6 free rungs live, the $THREE supply read served through them; stale-serve covers gaps |
| Pump.fun | frontend API intermittently 403/502 | `getBondingStatus` falls back to last-known-good, then the on-chain curve reader |
| IPFS images | ipfs.io | `api/img.js` races five gateways; event:failover served the $THREE CID |
| LLM | free-first chain | event:failover answered through the chain |
| TTS | NVIDIA Magpie, OpenAI backstop | `/api/tts/speak` 200 audio/wav in 2.1s; `/api/tts/synthesize` 200 audio/mpeg in 1.4s |
| Multiplayer Redis | Memorystore via `three-ws-redis-proxy` | min 4 warm siblings; the API cache has a circuit breaker and memory fallback |
| Text-to-3D (`forge_free`) | NVIDIA NIM 504, Vertex reference image 403 (unpaid GCP balance) | The image ladder still produced a reference image and TRELLIS delivered a GLB on production: `https://three.ws/cdn/forge/anon/90fd5e22-b5fe-4968-921a-b01447095f6d.glb`. Fragile until the release ships, see failure modes |

---

## Known failure modes and what to do

| If this happens | Why | Do this |
|---|---|---|
| `/play` loads but nobody sees anyone else | World server restarted or a second instance appeared | `curl .../health`; confirm `max-instances=1`; rollback command above |
| Players kicked seconds after joining, phones only | Mobile memory kill, not a network fault | `node scripts/play-mobile-repro.mjs` reproduces it |
| `/walk` offline while `/play` works | Someone set `PLAY_GATE_MINT`/`THREE_MINT` on the world server (both unset today) | `gcloud run services update three-ws-multiplayer $R --remove-env-vars=PLAY_GATE_MINT,THREE_MINT` |
| Wallet balances read zero, holder tier collapses to Member | Helius and Alchemy quotas spent | `npm run event:failover`; the owner tops up either plan |
| The minute-6 avatar beat takes too long on stage | Measured 2026-11-06 on the release: `forge_avatar` mesh on `trellis_selfhost` in about 6.5 minutes, rig in about 35 s | Start the generation at least 8 minutes before the beat. Fallback rigged GLB from that run: `https://three.ws/cdn/forge/anon/2bb633b0-cb2e-4d64-9eed-80d53d83ec7f.glb` |
| `/forge` or the "one sentence to a rigged agent" beat fails with "1 stage missed (Mesh)" | The TRELLIS worker's event loop freezes 30-140s while post-processing a mesh; on the live build, five timed-out status polls trip one breaker shared by every GPU worker and every submit then fails as `provider_unreachable`. The Hunyuan3D and HF fallbacks fail closed because the load balancer sends no client-region header | Ship the release (per-worker breakers, `0cc3627d0`). Add the region header (owner): `gcloud compute backend-services update three-ws-backend --global --project aerial-vehicle-466722-p5 --custom-request-header='X-Client-Region:{client_region}'`. On stage, leave 2 minutes between generations and keep a pre-built GLB as the fallback |
| An x402 payment, the Agent Exchange beat, or `/api/x402-pay` 503s | Sponsor fee wallet `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` held 0.036 SOL on 2026-11-06 06:30 UTC (over the 0.002 floor). The NOVA buyer is a platform wallet, so its settles share the sponsor's paced daily fee budget with the autonomous ring: about 5% of settles are refused `fee_runway_exhausted`, and a refusal is cached 60 s | Pause the ring for the event hour (checklist 15:40). Then run the `x402-economy-triage` agent. If the floor is the cause, the owner sends SOL to the sponsor wallet |
| Coin image missing on the link or OG card | One IPFS gateway slow | Nothing: `api/img.js` takes the first of five |
| Something breaks and nobody is told | `TELEGRAM_ALERTS_CHAT_ID` unset | Email alerting is live (uptime checks on the site and world server, a 5xx-rate policy). Keep `npm run event:watch` on a screen |
| `gcloud` stops working mid-event | Auth expires on its own schedule here | `gcloud auth login --no-launch-browser`; verify with a real `gcloud run services describe`, never `gcloud auth list` |

---

## Talk to the whole world mid-event

`scripts/announce-play.mjs` pushes a message to every player in a live world. Use
it to call each agenda beat. It is HMAC-signed with `MULTIPLAYER_SHARED_SECRET`
(falling back to `HOLDER_PASS_SECRET`, in `.env`).

```bash
# Agenda beats (minutes after 16:00 UTC)
node scripts/announce-play.mjs --title "Doors open" "Welcome to the meetup. Gather in the plaza."
node scripts/announce-play.mjs --title "Live build" "One sentence to a rigged agent. Watch the stage."      # +6
node scripts/announce-play.mjs --title "Forge" "Type /forge in chat to make something."                     # +20
node scripts/announce-play.mjs --title "Agent Exchange" "An agent pays for a tool. Head to the Exchange."    # +27
node scripts/announce-play.mjs --title "Dance-off" "Step onto the dance floor, vote with a reaction."       # +49
node scripts/announce-play.mjs --coin FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump \
  --duration-ms 30000 --title "Group photo" "Gather at the totem. Shutter at minute 58."                     # +55
```

It prints how many rooms and players it reached; `0 player(s)` means nobody is in
the world yet or the coin is wrong.

---

## Change the event window live (no deploy)

`public/event.json` is baked into the image. An operator override sits on top of it
(`app_settings` key `event_override`, served by `GET /api/event-config`). The browser,
the leaderboard API and the game server's quest gate converge within about a minute.
Writes need an admin session or `OPS_SECRET` (`node scripts/read-service-env.mjs`
shows it).

```bash
export OPS_SECRET=<from the Cloud Run service env>

npm run event:override -- --show                  # effective window, in Pacific/Eastern/London/Berlin
npm run event:override -- --extend 30             # end 30 minutes later (run again to stack)
npm run event:override -- --end                   # end now (cancels cleanly if not started)
npm run event:override -- --rename "New name"
npm run event:override -- --clear                 # drop the override; public/event.json governs again

# the same thing with curl
curl -X POST https://three.ws/api/event-config \
  -H "x-ops-secret: $OPS_SECRET" -H "content-type: application/json" \
  -d '{"endsAt":"2026-11-06T17:30:00Z"}'          # or {"end":true} or {"clear":true}
```

The id can never change (the leaderboard is keyed by it); the `npm run check:event`
rules apply and a rejected write returns 422. **The endpoint ships with the release
below**: on the live build `0a913e8a7` it does not exist yet.

---

## Moderation

Name one moderator before doors. They need `MULTIPLAYER_SHARED_SECRET` in `.env` (the same secret `scripts/announce-play.mjs` uses) and a terminal. Every command is a signed request to the multiplayer service's `/internal/moderate`; a wrong or stale signature gets `401`. Without `--server` the commands go to the production multiplayer service.

```
node scripts/moderate-play.mjs list                                     # who is online: name, session id, world, [muted]
node scripts/moderate-play.mjs mute rowdy --minutes 15 --reason "spam"  # chat, voice, emotes and reactions stop reaching others
node scripts/moderate-play.mjs unmute rowdy
node scripts/moderate-play.mjs kick rowdy --reason "harassment"         # closes the socket; they may rejoin
node scripts/moderate-play.mjs ban rowdy --minutes 1440 --reason "abuse" # omit --minutes for permanent; refused at join
node scripts/moderate-play.mjs unban --account <wallet>
```

Targets are a display name (case-insensitive), `--session <id>`, `--account <wallet>` or `--key <playerKey>`. Add `--coin <mint>` to act in one community's world only. A ban matches the wallet, the three.ws account and the guest token together, so reconnecting does not dodge it. A guest who clears browser storage gets a new guest identity: kick again, or ban their wallet if they sign in.

Players can report each other from the player card (click a nameplate, then Report). Three distinct reporters inside five minutes mute the target for ten minutes automatically; a report never bans, a moderator decides that. The muted player sees a strip above the chat box saying how long is left. Reports are logged as `report <from> -> <to> (<reason>)` in the multiplayer service logs.

Bans are stored in memory and, when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set on the multiplayer service, in Redis, so they survive a restart. Check the service log for `[moderation] bans persisted in Upstash Redis`; if it says `memory-only`, re-apply bans after a restart. Mutes are always memory-only and end on their own.

## Escalation: which tool for which subsystem

| Subsystem | Tool |
|---|---|
| x402 payments, settles, "wallets are dry" | `x402-economy-triage` agent |
| Cloud Run, crons, logs, DB migrations, TLS | `gcp-triage` skill, or `npm run triage:gcp:deep` |
| Phones dropping out of the world | `node scripts/play-mobile-repro.mjs` |
| Any page 404/500 across the site | `npm run smoke:prod` |
| A third-party provider suspected down | `npm run event:failover` |
| World capacity under a crowd | `npm run event:capacity -- --n <2x current peak>` |
| Is this sheet still true? | `npm run check:live-ops` |

---

## Ship the release (owner-gated)

```bash
git push threews main

# 1. API + frontend. Four migrations are pending and belong to this release
#    (account_purge, microsoft_marketplace_saas, webhook_bearer_token,
#    inception_programs_and_shoutouts, all dated 2026-11-04): read
#    `npm run db:status` (it must show no drift), then apply them alongside the deploy.
npm run deploy:gcp:full

# 2. The world server: reconnect-position, chat-draft, prop-budget and event-config
#    fixes are in multiplayer/ commits after its 2026-10-30 image.
cd multiplayer && ./deploy-cloudrun.sh
```

After either deploy: `curl -s https://three.ws/api/version`, `npm run smoke:prod`,
`npm run event:watch -- --once`, then update the **Live release** line and the
rollback table, and run `npm run check:live-ops`.

---

## T-minus checklist (UTC)

**2026-11-05 (T-1 day)**
- [ ] 12:00: owner decisions in one pass: approve the deploy, pay the GCP billing balance, fund the sponsor fee wallet (0.05 SOL), top up Helius or Alchemy, add the `X-Client-Region` header on `three-ws-backend` (command in failure modes).
- [ ] 13:00: push and deploy both services with the commands in "Ship the release" above. Apply the four pending migrations as described there.
- [ ] 15:00: `npm run smoke:prod` clean (the `/coin-control` and `/docs/coin-control` 404s go away with the deploy), then `npm run deploy:gcp:purge-cdn`.
- [ ] 15:30: update the **Live release** line and the rollback table; `npm run check:live-ops` and `npm run check:event` pass.
- [ ] 16:00: confirm `forge_free` delivers a GLB twice in a row; rerun `x402-economy-triage`.
- [ ] 17:00: rehearse every agenda beat once in the $THREE world with `scripts/announce-play.mjs`.
- [ ] 18:00: `npm run event:failover`, `npm run event:capacity -- --n 400 --ramp 45 --hold 120`, `npm run clean:worktrees`.

**2026-11-06**
- [ ] 14:00: `npm run event:watch -- --once`, `npm run event:failover`.
- [ ] 15:00: `npm run event:capacity -- --n 50 --hold 30` (a quick join check, not a load test).
- [ ] 15:30: `npm run event:watch -- --interval 15` on a screen; logs terminal open.
- [ ] 15:40: give the Agent Exchange beat the sponsor's fee budget by pausing the autonomous ring (config-only, reversible): `gcloud run services update three-ws-api $R --update-env-vars=X402_AUTONOMOUS_ENABLED=false`. Confirm `curl -s https://three.ws/api/healthz` shows `"ring":{"spend_enabled":false,"paused":true`. Update the **Live release** revision line, since this makes a new revision.
- [ ] 16:00: "Doors open" announce; follow the agenda beats.
- [ ] 16:58: group photo; 17:00 window ends (extend with `event:override` if needed).
- [ ] After: `gcloud run services update three-ws-api $R --min-instances=6 --update-env-vars=X402_AUTONOMOUS_ENABLED=true` (lowers the floor and resumes the ring).

---

## Removing a signature from the wall

Removal is owner-only (Bearer `CRON_SECRET`) and by signature id. Find the id in the
wall's public read (`curl "https://three.ws/api/play/signature-wall?limit=50"`) or a
share link (`/api/play/signature-wall-og?id=<id>`). Ships with the release above.

```bash
curl -X DELETE -H "Authorization: Bearer $CRON_SECRET" \
  "https://three.ws/api/play/signature-wall?id=<id>"
```

Returns `{ "ok": true, "removed": "<id>", "total": N }`, or 404 for an unknown id.
