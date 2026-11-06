# three.ws · multiplayer

Authoritative [Colyseus](https://colyseus.io/) server for the realtime worlds on three.ws. One Node process hosts six room types:

| Room | Class | Powers |
| --- | --- | --- |
| `walk_world` | [`src/rooms/WalkRoom.js`](src/rooms/WalkRoom.js) | The open-world coin communities on `/play` and the walkaround world reached from `/walk`: movement, chat, voice signalling, voxel building, the in-game economy, combat, quests, and the minigames |
| `agora_world` | [`src/rooms/AgoraRoom.js`](src/rooms/AgoraRoom.js) | `/agora` play mode: walk the Commons among the working citizens and other live humans |
| `irl_world` | [`src/rooms/IrlRoom.js`](src/rooms/IrlRoom.js) | `/irl` geocell presence and ambient reactions |
| `clash_arena` | [`src/rooms/ClashRoom.js`](src/rooms/ClashRoom.js) | Coin Wars battles on `/play/war` |
| `stage_world` | [`src/rooms/StageRoom.js`](src/rooms/StageRoom.js) | Living Stages live performances |
| `studio_world` | [`src/rooms/StudioRoom.js`](src/rooms/StudioRoom.js) | `/ar/studio` shared build-together rooms |

This process runs as its own service, apart from the main web container: the request/response API and a long-lived WebSocket fleet have different scaling shapes, so the worlds get a dedicated deploy. Production is the `three-ws-multiplayer` Cloud Run service (see "Deploy" below). Clients resolve the host with [`src/shared/game-server-url.js`](../src/shared/game-server-url.js) in the web app: localhost first in dev, then the `walk-server` / `game-server` meta tag baked into the page.

## Run locally

```bash
# From the repo root
npm install                  # installs this workspace too
npm run dev:multi            # boots the Colyseus server on :2567

# Or, in another terminal, both servers together:
npm run dev:walk-all         # Vite (first free port from :3000 up) + Colyseus (:2567)
```

The Vite dev pages at `http://localhost:3000/walk` and `http://localhost:3000/play` autodiscover the server at `ws://localhost:2567` (see [`src/walk-net.js`](../src/walk-net.js)), so no environment plumbing is needed. Vite takes the first free port from 3000 upward, so a second checkout on the same machine lands on 3004 or higher; outside production the WS upgrade accepts any loopback origin, so those still connect without touching `ALLOWED_ORIGINS`.

Nothing here needs a credential: with no env at all the process boots memory-only (no durable builds, no presence fan-out, no play gate) and logs exactly which capability each missing var would switch on.

## Configuration (env)

Everything is optional except `HOLDER_PASS_SECRET` in production, which the process refuses to boot without.

**Process and transport**

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `2567` | TCP port to bind |
| `HOST` | `0.0.0.0` | Interface to bind |
| `NODE_ENV` | unset | `production` hardens three things: origin-less WS upgrades are refused, the admin monitor stays unmounted unless credentials are set, and boot fails without `HOLDER_PASS_SECRET` |
| `ALLOWED_ORIGINS` | `http://localhost:3000-3003,https://three.ws,https://www.three.ws` | Comma-separated origin allow-list for the WS upgrade. `*.vercel.app` and `*.three.ws` are always allowed so preview deploys connect; outside production, loopback and Codespaces/Gitpod hosts are too |
| `WALK_ROOM_MAX_CLIENTS` | `100` | Per-room client cap for `walk_world` (clamped to 2-500) |
| `MONITOR_USER` / `MONITOR_PASS` | unset | Basic-auth credentials for `/colyseus`. Both set mounts the monitor behind auth anywhere; unset leaves it open in dev and unmounted in production |

**State**

| Var | Default | Purpose |
| --- | --- | --- |
| `REDIS_URI` (or `REDIS_URL`) | unset | Colyseus room registry + presence Redis; setting it switches on horizontal scaling (see Scaling notes). If it is set but Redis is unreachable within `REDIS_BOOT_TIMEOUT_MS` (default 10000) the process exits non-zero instead of running single-instance |
| `PUBLIC_ADDRESS` | unset | `host:port` Colyseus hands clients as the owner of a room. Leave unset behind one shared load balancer; set per instance only when instances are individually addressable (the two-instance test does) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | unset | Durable persistence for builds, player profiles, cosmetics ownership, the activity feed, the live war registry, and the settlement replay guard; memory-only without them. The friends/DM presence hub alone also accepts `KV_REST_API_URL` / `KV_REST_API_TOKEN` as a fallback pair |

**Trust boundaries (shared secrets)**

| Var | Default | Purpose |
| --- | --- | --- |
| `HOLDER_PASS_SECRET` | dev secret | HMAC key for the signed play pass and holder gate. **Required in production**: without it both this process and the API signer fall back to a public dev secret, so the gate would be forgeable, and the process exits rather than boot that way |
| `MULTIPLAYER_SHARED_SECRET` | falls back to `HOLDER_PASS_SECRET` | HMAC key the API signs the `/internal/*` webhooks, presence tickets, guest tokens, and persistence calls with |
| `WAR_TICKET_SECRET` / `WAR_RESULT_SECRET` | fall back to `HOLDER_PASS_SECRET` | Verify a Coin Wars pairing ticket and sign the result report back to the API |
| `GAME_TOKEN_SECRET` | falls back to `HOLDER_PASS_SECRET`, then `REALM_TRANSFER_SECRET` | Signs the boutique / wheel payment quotes the client settles on-chain |

**Play gate and on-chain settlement**

| Var | Default | Purpose |
| --- | --- | --- |
| `PLAY_GATE_MINT` (or `THREE_MINT`) | unset | Require wallet sign-in plus a token balance to enter `walk_world` / `clash_arena`. Unset leaves the worlds open, and the boot log says which |
| `PLAY_GATE_MIN` | `1` | Minimum token balance the gate demands |
| `HOLDER_MIN_USD` | `8` | USD floor a holders-only world displays, used only when the signed pass does not carry one (the client's unsigned option is never trusted) |
| `PA_HOST_KEY` | unset | Shared secret a guest presenter pastes into the `/host` panel to take the presenter PA mic in any world (see [docs/play-live-events.md](../docs/play-live-events.md#the-presenter-pa)). Ignored when shorter than 12 characters; unset leaves the PA to coin creators and `PA_HOST_WALLETS` |
| `PA_HOST_WALLETS` | unset | Comma- or space-separated wallets that may take the presenter PA mic in every coin world, for staff who run events in coins they did not create |
| `GAME_TOKEN_MINT` | the `$THREE` mint | Mint that prices in-world premium purchases |
| `GAME_TOKEN_DECIMALS` | `6` | Decimals for that mint |
| `GAME_TOKEN_TREASURY` (or `PAYMENT_RECIPIENT_SOLANA`) | unset | Treasury wallet; without it token-priced listings stay disabled rather than silently taking payment |
| `GAME_TOKEN_REWARDS` (or `THREE_REWARDS_WALLET`) | falls back to the treasury | Holder-rewards half of a split payment |
| `GAME_TOKEN_VERIFY_COMMITMENT` | `confirmed` | Set to `finalized` to wait for finality before granting a purchase |
| `SOLANA_RPC_URL` | public mainnet RPC | RPC the settlement verifier reads |
| `BIRDEYE_API_KEY` | unset | Price feed for the USD holder floor |

**Upstream reads**

| Var | Default | Purpose |
| --- | --- | --- |
| `WORLD_API_BASE` | `https://three.ws` | three.ws API this process calls for persistence, quest notifications, event scores, and the event window |
| `THREE_WS_API_BASE` / `THREEWS_API_BASE` / `MULTIPLAYER_API_BASE` | `https://three.ws` | Same, for the war report and the Living Stages room |
| `EVENT_CONFIG_URL` | `${WORLD_API_BASE}/api/event-config`, then `/event.json` | Pins one source for the event window + souvenir config the join-time grant reads (default reads the live override first, the static file as fallback) |
| `EVENT_CONFIG_TTL_MS` | `120000` | How long that config is cached (floor 1000) |

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /health`, `GET /healthz` | Liveness probe, returns `{ok,name,presence:"redis"|"local",instance}`. `presence` shows whether this process shares state with peers; `instance` is a per-process id (prefixed with the Cloud Run revision) so two sockets can be proven to have landed on different instances |
| `GET /population` | Public live aggregate: `{ok,coin,rooms,players}` across every `walk_world` (cluster-wide when `REDIS_URI` is set). `?coin=<mint>` narrows to one community. A count only, never an identity; the site reads it through `api/play/population.js` |
| `POST /internal/notify` | Friends/DM delivery from the API. HMAC-signed (`x-mp-signature` + `x-mp-timestamp`); answers `{delivered}` so the API knows whether to fall back to next-login delivery. With Redis presence, an instance that does not hold the recipient's socket asks its peers (see Scaling notes) |
| `POST /internal/stage` | Living Stages tip bridge; the API calls it once a `$THREE` tip settles on-chain so the live `stage_world` reacts within ~1s. Same HMAC scheme (`x-stage-*`) |
| `POST /internal/announce` | Operator broadcast into every live `walk_world` (optionally one coin's), delivered on the `notice` channel every deployed client already renders. Same HMAC scheme (`x-announce-*`). Fans out to every instance; answers `{ok,rooms,players,instances}` summed across the fleet |
| `POST /internal/moderate` | Operator moderation: `mute`, `unmute`, `kick`, `ban`, `unban`, `list` against a player picked by name, session id, wallet or player key. HMAC scheme with prefix `moderate:` (`x-moderate-timestamp`, `x-moderate-signature`, 120 second window); a bad signature is `401` before any room is touched. Fans out to every instance. Driven by `scripts/moderate-play.mjs` (`node scripts/moderate-play.mjs`). Bans persist in Upstash Redis when configured. Players also send `report` over the room socket (rate limited; 3 distinct reporters in 5 minutes mute the target for 10) |
| `/colyseus` | Admin monitor UI ([@colyseus/monitor](https://docs.colyseus.io/tools/monitor/)). Set `MONITOR_USER` + `MONITOR_PASS` to mount it behind basic auth; in production it is not mounted at all without them |
| WS upgrade | Colyseus protocol; clients connect with `new Client('ws://host:2567')`. Origin-filtered (see `ALLOWED_ORIGINS`), with each room's `onAuth` as the real access boundary |

The three `/internal/*` routes are signed against the exact body plus a fresh timestamp, so a captured signature cannot be replayed with different content. [`tests/multiplayer-server-boot.test.js`](../tests/multiplayer-server-boot.test.js) boots this entry point for real and holds the whole table down: both probes, the population aggregate, a live `walk_world` join, webhook forgery refusal, the origin allow-list, and the production posture.

## Anti-cheat

Every `move` message is validated server-side in [`WalkRoom.js`](src/rooms/WalkRoom.js):

- **Max-step clamp**: positions farther than `1.2 m` from the player's last position are rejected (legit deltas at 15Hz × 4 m/s run speed are ~0.27 m).
- **World bounds**: the square open-world district, ±198 m from origin on x/z (`WORLD_BOUND_M`, mirroring `DISTRICT.half` in [`src/game/world-zones.js`](../src/game/world-zones.js)); out-of-bounds positions are clamped.
- **Y clamp**: vertical position pinned to `[-10, 10]`.
- **Rate limit**: 30 moves/sec per client window (twice the 15Hz the client sends), so it absorbs jitter without dropping legit traffic.
- **Field types**: every numeric field is `Number.isFinite`-checked; motion strings are validated against an allow-list.

## Reconnects

A dropped client does not resume its old session: `src/game/community-net.js` re-runs `joinOrCreate`, so it comes back with a new `sessionId`. Two things make that clean rather than messy, and both matter at event scale.

**The client's own previous session is retired on sight.** A socket that dies uncleanly (a phone sleeping, a tab freezing, a wifi handover) stays half-open here: the transport still reads it as OPEN and only reaps it once its ping retries expire, several seconds later. The client reconnects well inside that window, so without help the room holds two sessions for one person, and every other player watches a frozen copy of them standing at spawn. So a reconnecting client sends its previous session id as a `prevSession` join option and `WalkRoom._evictPriorSession` closes exactly that session.

`prevSession` on its own would be a kick primitive, since session ids are published on the player schema and anyone could name a stranger's. It is honoured only alongside a matching persistent player key (`client.userData.playerKey`, set from the identity `_resolveIdentity` verified: the wallet from `onAuth`, a wallet proven by a signed play pass, or a server-minted guest id sealed in an HMAC token). A second tab or a second device is never touched, because each carries its own prior session id.

**The client rebuilds its roster from the snapshot, not from memory.** The old room's listeners are removed before it leaves, so `onRemove` never fires for the peers it had. `/play` flags every peer stale when a reconnect starts, clears the flag for each peer the new room re-announces, and disposes whatever is still flagged once the first full state patch lands. Anyone who left while the client was away disappears then, instead of standing in the world for the rest of the session.

Two scripts in the repo root hold this behaviour down.

`scripts/play-reconnect-proof.mjs` is the fast one and needs nothing but Node: it starts its own server, joins as two players over `colyseus.js`, and asserts the room's end state directly. Nine checks, seconds to run, and it fails loudly if the eviction is removed (the room ends up holding the same player twice).

```bash
node scripts/play-reconnect-proof.mjs      # wire level, starts and stops its own server
```

`scripts/play-multiplayer-e2e.mjs` is the full product check: two real browser contexts in one coin world, exchanging movement, emotes and chat, surviving a forced network drop, then asserting the resynced state on both sides. It also covers what only a browser can judge, that chat is written as text and never parsed as markup, that the burst throttle holds, and that the log is capped.

```bash
npm run dev:walk-all                       # vite :3000 + this server :2567
node scripts/play-multiplayer-e2e.mjs      # two contexts, forced drop, resync assertions
BASE=https://three.ws node scripts/play-multiplayer-e2e.mjs   # against the live world
```

Two software-rendered 3D worlds at once is the heaviest thing you can ask a headless Chrome to do, so give the browser run a machine with headroom; the wire-level proof is the one to reach for on a busy box or in a tight loop.

There is also a fishing-lane smoke check in this directory: with a server on `:2567`, `node scripts/fish-smoke.mjs` joins `walk_world`, walks to the east pond, casts, and asserts the profile, catch notice, XP gain, and inventory land.

## Deploy (Cloud Run, production)

Production runs as the `three-ws-multiplayer` Cloud Run service in `us-central1`, separate from the main `three-ws-api` container. [`deploy-cloudrun.sh`](deploy-cloudrun.sh) is the whole deploy: Cloud Build builds the local [`Dockerfile`](Dockerfile), Cloud Run terminates TLS and hands back a stable https URL.

```bash
cd multiplayer
./deploy-cloudrun.sh          # override SERVICE/REGION/CPU/MEMORY/... via env
```

Read the script's header before touching capacity: it re-applies its CPU/memory/concurrency defaults on every deploy, so a hand-raised limit on the live service survives exactly until the next deploy. Without `REDIS_URI` it pins max-instances to 1 on purpose; players in the same coin world must land on the same instance until the room registry is shared.

Clients find the server through meta tags baked into the pages (use the `wss://` form of the service URL):

- `<meta name="walk-server">` in [`pages/temporary.html`](../pages/temporary.html), [`pages/agora.html`](../pages/agora.html), and [`pages/marketplace-walk.html`](../pages/marketplace-walk.html)
- `<meta name="game-server">` in [`pages/play.html`](../pages/play.html)

[`fly.toml`](fly.toml) is kept as an alternative host config (`fly launch --no-deploy`, set `ALLOWED_ORIGINS` and the Upstash secrets, `fly deploy`), but production is Cloud Run.

## Scaling notes

- A single Node process holds many rooms; Colyseus's matchmaker creates a new room per coin world as needed and spills into a fresh one when a room fills.
- `walk_world` caps at 100 clients per room by default in code (`MAX_CLIENTS_PER_ROOM` in [WalkRoom.js](src/rooms/WalkRoom.js), tunable via `WALK_ROOM_MAX_CLIENTS`, clamped to 2-500). Production runs 250: `deploy-cloudrun.sh` sets `WALK_ROOM_MAX_CLIENTS=250` on every deploy, because at 100 an event crowd in one coin is split into worlds that cannot see each other. Measured 2026-11-06 on the live service (single instance, 4 vCPU): 250 clients in one coin world joined 250/250, join p95 455 ms, no drops, under 7 percent CPU.
- Across instances: horizontal scaling is wired in [`src/index.js`](src/index.js). Set `REDIS_URI` and the server boots with `@colyseus/redis-driver` + `@colyseus/redis-presence`, making matchmaking cluster-aware; `deploy-cloudrun.sh` then allows multiple instances. Without it the server logs `single-instance mode` and must stay at one instance. A set-but-dead `REDIS_URI` is a boot failure on purpose: the old "stay single-instance" fallback silently split every coin community across instances.
- Per-process state audit (what makes a second instance safe): game, play-pass, guest and presence tokens are stateless HMACs from env secrets, so they verify on any instance. The settlement replay guard, player profiles, cosmetics and social presence live in Upstash, not in memory. The event-score and feed caches are per-instance read caches that only cost a refetch. The stage registry and walk registry are per-process by nature, so the three `/internal/*` webhooks use [`src/fanout.js`](src/fanout.js): the receiving instance handles the event locally, publishes it on the Redis presence channel `three-ws:fanout`, and every peer handles it against its own sockets and rooms and acks on a per-request channel (bounded 300 ms wait).
- Fresh revisions hand over once: about a minute after a new revision starts, Cloud Run replaces its deploy-time instance with the warm min-instance, and for that minute or two two instances serve at once (max-instances is a soft cap). Single-instance mode cannot share a room across them, so joins in that window can fail with `seat reservation expired` or land in a second copy of a coin world. The same overlap happens at routine instance replacement (four times in the week before 2026-11-06). Never deploy the world server inside an event window, and run the load test only after a new revision has settled.
- Cloud Run caveat: with a shared load balancer a client that is told a room lives on a peer connects back to the balancer, which may land on a third instance. `--session-affinity` (already set) pins repeat connections but cannot choose the room's host. Measure it with the load test below before trusting a high `--max-instances`.

### Provision Memorystore (owner step, one time)

```bash
PROJECT=aerial-vehicle-466722-p5; REGION=us-central1
gcloud services enable redis.googleapis.com vpcaccess.googleapis.com --project $PROJECT
gcloud redis instances create three-ws-multiplayer --size=1 --tier=basic --region=$REGION --redis-version=redis_7_0 --project $PROJECT
HOST=$(gcloud redis instances describe three-ws-multiplayer --region=$REGION --project $PROJECT --format='value(host)')
PORT=$(gcloud redis instances describe three-ws-multiplayer --region=$REGION --project $PROJECT --format='value(port)')
printf 'redis://%s:%s' "$HOST" "$PORT" | gcloud secrets create MULTIPLAYER_REDIS_URI --data-file=- --project $PROJECT
gcloud secrets add-iam-policy-binding MULTIPLAYER_REDIS_URI --member=serviceAccount:three-ws-build@$PROJECT.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor --project $PROJECT
# Cloud Run reaches the instance's private IP over Direct VPC egress:
USE_REDIS_SECRET=1 ./deploy-cloudrun.sh   # binds REDIS_URI from the secret, max-instances 10
gcloud run services update three-ws-multiplayer --region $REGION --network default --subnet default --vpc-egress private-ranges-only
```

Then confirm `curl <service>/health` shows `"presence":"redis"`.

### Tests

`npm test` in this directory runs `node --test`: `test/boot.test.js` (local presence, and a dead `REDIS_URI` exits non-zero) and `test/two-instance.test.js` (two real server processes plus a real Redis from `redis-server` or `docker run redis:7-alpine`: same-coin players on different instances share a room, and `/internal/announce` counts both). Without `REDIS_URI` the two instances host disjoint rooms, which is what the shared-room assertion catches.

### Load test

```bash
node scripts/multiplayer-load-test.mjs --url wss://<service-host> --clients 200 --duration 60 --coins 4
```

Real colyseus.js clients across N coin worlds move and chat for the duration. It reports join latency p50/p95, dropped sockets, distinct instances seen on `/health`, rooms per coin (must be 1) and chat delivery percent (must be 100); exit code 1 otherwise. Repeat `--url` to dial several entry points.

Local two-instance reference run (60 clients, 3 coins, 15 s, two processes sharing one Redis): 100 percent chat delivery (4800 of 4800), one room per coin. The production-fleet figures are recorded here once the service is redeployed with Memorystore (owner step above); until then they are not claimed.

## What the schema looks like on the wire

See [`src/schemas.js`](src/schemas.js). Each `Player` is 21 primitive fields (position, motion, identity, cosmetics, combat flags), encoded as a binary delta: only the fields that changed since the last patch are sent. The live wire budget is kept in the capacity comment above `MAX_CLIENTS_PER_ROOM` in [`WalkRoom.js`](src/rooms/WalkRoom.js): a full 100-client room costs each client roughly 40 KB/s down (99 peers × ~28 B average × 15 Hz), well inside both the container and a normal connection.
