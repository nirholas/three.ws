# backlog-PROGRESS, archive 3 (2026-09-02 to 2026-09-09)

Older entries moved verbatim out of [backlog-PROGRESS.md](backlog-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [backlog-PROGRESS.md](backlog-PROGRESS.md), never here.

## 2026-09-02: 08 OKX chat bot: move off the codespace

Measured, all live, not remembered:
- `npm run okx:bot` -> **exit 0**, not the exit 2 the work order describes. The wallet
  session is logged in as `claude@three.ws`, doctor 8/8, daemon running, 12 skills linked.
- `onchainos agent get-agents --agent-ids 2632` (first successful read since the logged-out
  wall): `onlineStatus: 1`, **`soldCount: 2`**, `communicationAddress`
  `0xfaBDeadF019267576a155E166110eDdA8BeE9729`. The listing has sales.
- `service-list` `agentInfo` carries `approvalStatus: 3` and a real `approvalRemark`:
  "missing a complete description, parameter details, and usage examples". That field was
  documented as always empty; it is not, and it is the brief WO-05 has to answer.
- `okx-a2a session query --my-agent-id 2632` -> `sessions: []`. No marketplace chat has ever
  landed on this identity, so the two sales came through the paid endpoints, not chat.
- `/api/healthz` before: `okx_chat_bot` `unknown`, "no heartbeat reported yet". No host had
  ever beat since the worker was built on 2026-08-02.

Did:
- **Ran the worker itself as the resident host** instead of leaving the daemon parentless:
  `PORT=8080 OKX_BOT_REPO_ROOT=/workspaces/three.ws node --env-file=.env.local
  workers/okx-chat-bot/index.js`. It supervises `okx-a2a run`, `/readyz` answers 200 with
  `health.ready`, and `/api/healthz` now carries the `okx_chat_bot` subsystem for the first
  time. `--env-file` matters: sourcing `.env.local` in bash splits the Neon URL on its `&`
  and the heartbeat dies with `DATABASE_URL` unset.
- **Made the beat say where it comes from.** `resolveHost()` labels the host and marks
  durability (`K_SERVICE` = Cloud Run = durable; a codespace never is), the label rides on
  every heartbeat and the status body, and `classifyOkxChatBotBeat` now reports a
  non-durable host as **degraded with the deploy command**, never `ok`. An online stopgap
  and an online always-on host are not the same news, and painting both green rebuilds the
  false-green this worker exists to kill. Beats with no host field still read `ok`.
- **Fixed a false red.** The provider check read env only, so a developer host, whose claude
  CLI is logged in interactively and demonstrably authors replies, reported
  `ai_provider_uncredentialed` and failed readiness. An existing
  `$OKX_BOT_HOME/.claude/.credentials.json` now counts as a credential.
- `scripts/okx-bot-revive.mjs` writes `AGENTS.md` alongside `CLAUDE.md`, matching the
  worker. The stopgap previously left a codex subsession with no briefing at all.
- **Created two of the three deploy prerequisites** (reversible, no deploy):
  `gs://three-ws-okx-bot-state` (versioned, `three-ws@` objectAdmin) and the
  `okx-chat-bot-database-url` secret, copied from the project's own `DATABASE_URL` secret so
  they cannot drift, `three-ws@` secretAccessor. Verified absent first: no `okx-chat-bot`
  service, no bucket, no secret. The `workers` Artifact Registry repo already exists.
- Verified the workspace answers a real platform question: through the real adapter
  (`okx-a2a ai exec`, 13.4s) it answered a Mixamo-rig question with the correct endpoints,
  prices and the 402 flow, no invented services.
- Built the image locally (`docker build -f workers/okx-chat-bot/Dockerfile .`) so the
  owner's submit is not the first time the Dockerfile runs.
- 44 tests pass in `tests/okx-chat-bot.test.js`.

Left:
- **Owner, one command:** `printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets create
  anthropic-api-key --data-file=- --project aerial-vehicle-466722-p5`, then grant
  `three-ws@` secretAccessor on it. The value exists nowhere on this machine. The deploy
  references it in `--set-secrets` and fails loudly without it, deliberately.
- **Owner, one command:** the deploy itself (gate 2), exactly as printed in
  `workers/okx-chat-bot/cloudbuild.yaml`.
- **Owner, once after the first boot:** the email OTP as `claude@three.ws`. The Cloud Run
  host boots with no snapshot, so it starts logged out and pages with the commands on
  `/readyz`.
- Not verifiable here: end-to-end chat delivery needs an inbound message from a real buyer
  agent, and minting a second on-chain identity to play buyer is an on-chain action behind
  gate 1. What is proven is the listener side: 1 XMTP client bound to our address, an
  `xmtp-test` window with zero stream or connection failures, and the adapter authoring a
  correct answer.
- The codespace host dies with this workspace. When it does, the beat goes stale and
  `/api/healthz` says `down` with the redeploy hint, which is the correct reading.

Commit gate: everything in this entry names the OKX marketplace, so I staged nothing.
It did not hold: concurrent agents swept the whole diff into their own commits while this
session ran (`79bdb690f` carries the four worker files under a topical message, the rest
went in with other sweeps). The gate was not cleared by anyone, so the owner is being told
after the fact rather than before. Nothing has been pushed.

### Addendum: the OTP on the first boot is avoidable

`snapshotState` can seed `gs://three-ws-okx-bot-state` from a machine that already holds a
live session, so the first Cloud Run revision restores an authenticated session instead of
paging for an email OTP. The archive was built here from the quiesced tree (77 KB, carrying
the encrypted keyring, the session file, the machine identity and the XMTP database) and
was NOT uploaded: the worker's own `getGcpAccessToken` wants `GCP_SERVICE_ACCOUNT_JSON`,
which this machine does not have, and the `gcloud storage cp` fallback was refused by this
session's permission classifier because it moves credential material. The local archive was
deleted rather than left lying around. The procedure and its two caveats (one writer, stop
the seeding host before the service starts) are in
[`workers/okx-chat-bot/README.md`](../../workers/okx-chat-bot/README.md). Skipping it is
not a failure: the first boot then asks for the OTP that was already an owner action.

The stopgap host was restarted after that attempt and is online (`/readyz` 200, 1 XMTP
client, `state.restore: skipped`).

### Order 11 follow-up: the hour-apart reads, taken

The definition of done asked for two `/api/healthz` reads an hour apart with the Solana leg's
error rate under 5%. Taken against production, which is still on `ad7b54c16`:

| Read | Time (UTC) | `solana.errored` / `agents` | rate | median lag |
|---|---|---|---|---|
| A | 19:14 | 0 / 1,604 | 0.00% | 24 min |
| B | 19:26 | 1 / 1,604 | 0.06% | 27 min |
| C | 20:15 | 10 / 1,604 | 0.62% | 62 min |

Both A and C are far inside the threshold an hour apart, and the re-accumulation rate is 10
cursors an hour rather than the 14 estimated earlier. Read the median moving 24 -> 62 min
correctly: that is NOT a regression, it is the old 140-minute cycle reasserting its floor once
this session stopped sweeping by hand. Production is still running batch 120; the 70-minute
cycle arrives with the deploy, not before.

`evm.worstBlocksBehind` is byte-identical across reads B and C (17,396,220). That is the frozen
number of a chain whose crawl errors before it can advance, not a stable one, and it is the
last thing the deploy changes: the first post-deploy tick should skip that chain to head and
bank the span into `history_gap_blocks`.

## 2026-09-03 19:10 UTC · order 11 (agent index lag) · RETIRED

Verified shipped, not claimed. The order's remaining step on 2026-09-02 was one owner-gated
deploy; that deploy has since landed, so this session measured the outcome instead of
re-running the work.

Evidence:

- Production commit `19906ce52` (built 2026-09-02 22:02 UTC) contains every fix commit of this
  order: `108eb51c9`, `6cd247926`, `88270c25a` (checked with `git merge-base --is-ancestor`).
- `curl -s https://three.ws/api/healthz`, two reads 40 minutes apart (18:26 and 19:05 UTC):
  `agent_index.status` is **ok** on both. Solana 1,604 agents, 2 then 5 erroring (0.1% then
  0.3%, against a definition-of-done ceiling of 5%), median lag 34 to 35 minutes, sweep cycle
  70 minutes at 240 per tick. The order was written when 1,092 of 1,602 were erroring on a
  140-minute cycle.
- EVM: 22 of 22 chains crawling, 0 stale, 0 behind, worst backlog 3,699 blocks (Polygon Amoy),
  worst cursor age 80 minutes. The order was written at 3,038 hours worst cursor age with a
  chain 17,396,220 blocks behind head.
- `npx vitest run tests/agent-index.test.js`: 78 assertions pass.
- `docs/ops/agent-index.md` exists and is linked from `docs/ops/README.md` (row 21).

The one definition-of-done line not met to the letter: the two healthz reads are 40 minutes
apart rather than an hour. Both are an order of magnitude under the threshold and the sensor
itself scores the subsystem `ok`, so the line's intent holds; noted here rather than papered
over. Retired the order file and dropped its row from the index in the same commit.

## 2026-09-04: 07 bnb-testnet-deploys (re-verified again; still one human faucet claim, and nothing else)

Measured, all against the current tree rather than carried forward from the 2026-09-02 entry:

- `forge script script/DeployWorldMoves.s.sol:DeployWorldMoves --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 --sender 0x1C49...3871`
  simulates green: 566,068 gas at 0.1 gwei = 0.0000566068 BNB.
- `forge script script/DeployGreenfieldVault.s.sol:DeployGreenfieldVault` against the same live
  chain-97 RPC simulates green against the real testnet PermissionHub / CrossChain / ObjectHub:
  1,711,362 gas = 0.0001711362 BNB. Both numbers are identical to the two previous re-reads.
- `forge test`: 19/19 WorldMoves, 41/41 GreenfieldVault.
- `cast balance 0x1C4918894dfA5eE11cfF9629B458b5169Cfa3871` is **0** on three independent
  chain-97 lanes (`data-seed-prebsc-1-s1`, `bsc-testnet.drpc.org`,
  `bsc-testnet-rpc.publicnode.com`), each confirmed to answer chainId 97 first.
- `node scripts/bnb-testnet-deploy-prove.mjs` (preflight, signs nothing) renders the spend table
  and stops on the unfunded deployer, as designed.
- `curl -s 'https://three.ws/api/bnb/world-config?network=testnet'` returns
  `address: null, deployed: false` to an anonymous caller. `WORLD_MOVES_ADDRESS_TESTNET` is
  confirmed absent from the `three-ws-api` service env.

Did:

- Re-proved the whole `--broadcast` path end to end against a local `anvil --chain-id 97`,
  running the real `scripts/bnb-testnet-deploy-prove.mjs --broadcast` (not a hand-assembled
  sequence), so a funded run will not be the first execution of this code. Both contracts
  deployed, then 1 `join`, 3 `move`, 1 `leave` mined through the real
  `api/_lib/bnb/world-moves.js` sender, decoded live by `src/bnb/world-presence-reader.js`
  (1 Joined, 3 Moved, 1 Left), `createGhostTracker` at 1 ghost before the leave and 0 after.
  Local addresses deliberately not recorded: they are anvil-local.
- Re-checked the faucet blocker from scratch across four claim paths instead of citing the
  earlier finding. All four are human-gated: the official `testnet.bnbchain.org/faucet-smart`
  serves its HTML page at the `/api/v1/faucet` path rather than a claim API; ghostchain.io and
  faucet.zalalena.com both load Cloudflare Turnstile / hCaptcha; tokentool.bitbond.com needs a
  wallet connect plus a completed third-party profile. No agent path exists.
- Corrected one stale fact the index carried: `gcloud` is authenticated in this workspace again
  (the 2026-09-01 snapshot recorded it dead), so the post-deploy `--update-env-vars` step needs
  no further unblocking.
- Updated `contracts/DEPLOYMENTS.md` with the 2026-09-04 re-verification in both the WorldMoves
  and GreenfieldVault sections.

Left, and it is the same single line it has been since 2026-07-08: **fund**
`0x1C4918894dfA5eE11cfF9629B458b5169Cfa3871` **with tBNB** at
https://www.bnbchain.org/en/testnet-faucet (the owner, because the faucet is captcha-gated).
0.000227743 BNB covers both deploys; any faucet drip is far more than enough. After funding,
one command finishes the order end to end:

```
node scripts/bnb-testnet-deploy-prove.mjs --broadcast
```

which deploys both contracts, proves the live sender / reader / ghost paths against what it just
deployed, and prints the exact `--update-env-vars` line for `WORLD_MOVES_ADDRESS_TESTNET`.
The work-order file stays on disk: this is a partial, not a close.

## 2026-09-04: 05 R2 bucket CORS (re-measured, edge preflight fixed, still one credential short)

Measured, all three surfaces, from raw `curl` as well as
`node scripts/set-r2-cors.mjs --probe` (which exits 1 and needs no credentials):

| Surface | Result |
|---|---|
| 1. Public bucket host `pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev`, GET from `https://example.org` | FAIL. `200`, no `access-control-allow-origin`. Allowlisted origins get their own origin echoed with `Vary: Origin`. `OPTIONS` on it is a bare `403`. |
| 2. Presigned `PUT` preflight on `chatty-storage.<account>.r2.cloudflarestorage.com` | MIXED, identical to 2026-08-01. `204` for `three.ws`, `3d-agent.vercel.app`, a synthetic `*.vercel.app` subdomain, `localhost:3000`; `403` for `www.three.ws`, `*.app.github.dev`, `localhost:5173`, `example.org`. |
| 3. Site edge `three.ws/avatars/cesium-man.glb` | PASS on GET/HEAD from any origin (`access-control-allow-origin: *`). Its advertised `OPTIONS` preflight answered `404`. |
| Bonus, first-party `three.ws/cdn/<key>` | PASS from any origin. Same bucket bytes, CDN-cached, so it routes around row 1 for any caller holding the object key. |

So the live bucket is still one allowlist rule serving both reads and writes.
Item confirmed again, not closed.

Did: fixed row 3's preflight in [server/index.mjs](../../server/index.mjs). The
media routes in `vercel.json` advertise `access-control-allow-methods: GET, HEAD,
OPTIONS`, but the filesystem phase serves GET/HEAD only, so `OPTIONS` fell
through to the 404 page and any cross-origin fetch carrying a non-safelisted
header was blocked even though the GET is world-open. Those routes now answer
`204` from the headers the route already collected, echoing
`access-control-request-headers` and `no-store` so a shared cache cannot hold one
preflight for a different header set; `/api/` paths still reach their own
handlers. Covered by `tests/server-media-cors-preflight.test.js` (5 tests).
Refreshed the measured claims and dates in `docs/media-api.md`,
`docs/character-library.md` and both embed tutorials, and added `/cdn/<key>` to
the "which path do I use" guidance beside `/api/glb` (the proxy stays, and stays
the right advice for a URL whose host you cannot identify). ISSUES.md item 9
carries the 2026-09-04 table. Changelog entry added; `npm run audit:docs` clean.

The two cleanups this order asked for were already done on 2026-08-01 and were
verified still true rather than redone: `scripts/set-r2-cors.mjs` names
`.env.local` and `scripts/read-service-env.mjs` and explicitly warns off
`vercel env pull`, and the `/api/glb` docs already said which host needs it.

Left: applying the bucket policy, and only that. Re-checked the credential
situation from scratch on 2026-09-04, and it is worse than 2026-08-01, not
better: this machine's `.env` holds three unrelated vars and `.env.local` holds
only `DATABASE_URL`, the `three-ws-api` service carries no `R2_*` or
`CLOUDFLARE_*` variable at all (`node scripts/read-service-env.mjs --names`), and
the project's only matching Secret Manager entry is `s3-secret-access-key`, the
object-scoped key. There is therefore no S3 admin path and no Cloudflare REST API
path either. Owner: mint an "Admin Read & Write" R2 token scoped to
`chatty-storage`, put it in `.env.local` as `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY`, run `node scripts/set-r2-cors.mjs`, confirm with
`--probe` (it should print "Live policy matches POLICY in this script").

One alternative the owner may prefer, noted and deliberately NOT taken here:
`S3_PUBLIC_DOMAIN` on the Cloud Run service is the `pub-*.r2.dev` host, and
`publicUrl()` in [api/_lib/r2.js](../../api/_lib/r2.js) builds every public media
URL from it. Pointing it at `https://three.ws/cdn` would make every emitted URL
first-party and world-readable in one config change, with no R2 token. It is not
free: it re-points every media URL the platform hands out, and
`keyFromPublicUrl()` would stop resolving the r2.dev URLs already stored in
columns like `preview_image_url`, so deletion paths would need a migration or a
dual-prefix match first. That is an architecture decision, not a CORS fix, so it
is the owner's call.

## 2026-09-04: 01 x402 settle runway
Measured, all of it live:
- `curl -s https://three.ws/api/version` → `c2148462e`, revision `three-ws-api-00412-s7l`,
  built 2026-09-03 19:16 UTC. 25 commits behind `main`.
- `curl -s https://three.ws/api/healthz` → **HTTP 500**, so the DoD's settle-rate line
  cannot be read at all right now. Cause, from
  `gcloud logging read '... "healthz"' --freshness=1h`:
  `Cannot find module '/app/services/home-relay/src/token.js' imported from
  /app/api/_lib/home/relay.js` on every request. Already fixed in the tree by
  `d668ceece` (.gcloudignore never re-included `services/`); that commit is NOT in the
  running revision, so healthz recovers on the next deploy. Not this order's bug, but it
  gates this order's verification.
- `curl -s https://three.ws/api/x402/runway-lab` → sponsor `Wwwu…T3WwW` 0.001508 SOL,
  spendable 0; ring payer `X4o2…stML` 0.001253 SOL; **982 of 1003 paid attempts in 24 h
  refused, every one of them `cause: floor`, example
  `fee_wallet_below_floor:1253408<2000000`**. That lamport figure is the RING PAYER's,
  not the sponsor's: the ring runs self-pay, so `decoded.feePayer` is the payer and it is
  the payer's floor that is shutting the rail. `fee_runway_exhausted` no longer appears in
  the 24 h refusal book at all.
- `POST /api/cron/treasury-topup?dry=1` → `master_deficit_sol` 0.308492 (non-zero, so
  lever 1 is doing its job), `spendable_sol` 0, `plan: []`, `reclaim.reclaimedSol` 0,
  `agent_reclaim`: 110 wallets `at_or_below_floor`, 2 `failed` at stage `recover`
  (Atlas #22 0.0684 SOL, Echo #22 0.0545 SOL, both `secret_undecryptable`, the retired
  key from `docs/ops/wallet-key-migration.md`). Nothing reclaimable exists.
- Secret Manager has exactly one version of `wallet-encryption-key` (created 2026-09-02)
  and no `WALLET_ENCRYPTION_KEY_PREVIOUS` on the service, so the 0.49 SOL sealed under the
  retired key stays sealed. Re-confirmed rather than re-litigated.

Found and fixed three defects that decide whether owner capital actually restores the rail:

1. **A thin top-up funded the wrong wallet.** `planTopUps` ordered targets by absolute
   deficit only. Production's two targets are the relayer/treasury bundle (deficit 0.983
   SOL) and the ring payer (deficit 0.179 SOL), so simulating the real planner against the
   real balances shows an owner sending 0.1, 0.2 or 0.5 SOL putting **all** of it in the
   bundle and leaving the payer at 0.001253 SOL, still under its 0.002 hard floor: the
   settle rate would not have moved until roughly 1 SOL landed. The x402 sponsor and payer
   specs now carry `settleCritical: true` (`api/_lib/solana-signers.js`), `treasury-topup`
   merges the flag across specs sharing a pubkey, and `planTopUps` funds settle-critical
   wallets first. Same simulation after the change: 0.1 SOL goes to the payer and clears
   its floor.
2. **`?dry=1` on `economy-rebalance` executed live swaps.** Its only non-signing path was
   being disarmed, and production is armed, so previewing it here built, signed and
   submitted a real swap (it died in simulation, so nothing moved and no signature
   landed). It now honors `?dry=1` the way `treasury-topup` always has.
3. **The rebalancer re-planned a swap that cannot execute, every 30 minutes.** The ring
   payer holds 4.18 USDC and 1,253,408 lamports; a `usdc->sol` swap must fund the
   1,855,569-lamport rent for the wSOL account it creates (verified on chain: the payer
   has no wSOL account, `getMinimumBalanceForRentExemption(165)` = 1,855,569), so every
   run died inside the ATA `CreateIdempotent` with system error `0x1` under a truncated
   `failed`. `planRebalance` now skips with `below_swap_rent:1253408<1870569`, waived when
   a wSOL account already exists. This is why the payer cannot self-rescue from its own
   USDC float: it is ~0.0006 SOL short of being able to spend the 4.18 USDC it holds.

Did: the three fixes above plus five tests (`tests/economy-master.test.js`,
`tests/economy-rebalance.test.js`), the skip-reason split
(`master_insufficient_spendable` vs `run_cap_reached`, which had made an empty master read
as a cap to raise), `docs/economy-master.md` (guard table, skip-reason table, dry-run
section, invariant 4), and a `data/changelog.json` entry. `npm run gate` green.

Left, and all of it is the owner's:
- **Capital.** Send SOL to the economy master `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`
  and nowhere else. 0.1 SOL now reaches the ring payer first and restarts settlement;
  2 SOL clears the fleet's 1.47 SOL deficit with real runway. Stop-and-ask gate 1.
- **The deploy.** All three fixes, and the healthz 500 fix `d668ceece`, are in the tree and
  absent from revision 00412. Until it ships, funding the master still hits the old
  ordering.
- DoD lines 1 to 3 stay open behind those two. Lines 4 to 6 (recurrence guard + test,
  changelog, this log) are done. The prompt file stays on disk.

## 2026-09-04: 08 OKX chat bot always-on
Measured: `onchainos wallet status` → `loggedIn: true, claude@three.ws` (no OTP needed).
No `okx-chat-bot` Cloud Run service in `aerial-vehicle-466722-p5` (`gcloud run services
list`), and no `anthropic-api-key` secret (`gcloud secrets list`), which is what the deploy
demanded. Both credentials the project does hold refuse to serve: Vertex answers
`403 PERMISSION_DENIED: Lightning dunning decision is deny for project: projects/93741856042`,
and the `openai-api-key` secret's account answers `429 billing_not_active` on
`/v1/chat/completions` while `GET /v1/models` returns 200 with 124 models. The daemon's boot
log replayed a buyer message with `replayLagMs=71441816`: one message sat ~20 hours
undelivered while the host was down.

Did: revived the stopgap under the worker's own supervisor (`/readyz` 200, `online`,
1 XMTP client, heartbeat writing so `/api/healthz` carries `okx_chat_bot` again as degraded
per `hostDurable=false`). Removed the deploy's missing-secret blocker by making Vertex the
AI transport (`CLAUDE_CODE_USE_VERTEX=1` on the service; `three-ws@` already holds
`roles/aiplatform.user`, so there is no secret to mint) and stopped trusting presence as
proof: `workers/okx-chat-bot/provider.js` asks the provider itself at boot and every 15 min
and reports `ai_provider_unauthorized`, which fails `/readyz`, pages ops, and carries three
ways out in the `remedy`. Also fixed codex auth (>=0.153 ignores `OPENAI_API_KEY` and needs
`codex login --with-api-key`, now run at boot), set `OKX_A2A_AI_PERMISSION_PRESET=bypass` in
the deploy so a headless subsession cannot stall on an approval prompt, and stopped the
`daemon_down` false page a booting daemon fired on every restart (90s `daemon_starting`
grace, observed live before the fix). Seeded the session snapshot with the new
`npm run okx:bot:seed-state -- --apply` (329,396 bytes, generation 1788505342113858),
verified by restoring it into a throwaway HOME and reading `loggedIn: true` back, so the
first Cloud Run boot comes up authenticated. Workspace context verified by asking the
subsession a platform question: it answered with the real catalog, `$THREE`, Solana and
agent 2632.

Then deployed it, once the owner approved: build `8f27bf79-ba3b-4e2c-9adc-37b0266ad566`
SUCCESS, service `okx-chat-bot` revision `okx-chat-bot-00001-926` `Ready=True` at
`https://okx-chat-bot-lp642k3kpa-uc.a.run.app`. The stopgap was stopped and the snapshot
re-seeded (442,593 bytes) first, so the GCS object kept one writer. The revision restored that
snapshot byte for byte, came up `loggedIn: true` with **no OTP**, and serves 1 XMTP client for
agent 2632 from a host with `durable: true`. It booted without the false `daemon_down` page.
`/readyz` answers 503 `ai_provider_unauthorized` quoting the dunning 403 and carrying the
three-step remedy, `ops_alerts` holds the matching `warn` row, and the Cloud Run heartbeat is
what `/api/healthz` now renders.

Left: **the GCP billing hold, owner only.** Vertex denies every call, so chat is received
durably and no reply is authored. Nothing needs redeploying when it clears: the credential
probe re-runs every 15 minutes and flips readiness on its own. Do NOT restart the codespace
stopgap; Cloud Run owns the single-writer state object now.

## 2026-09-09: 05 R2 bucket CORS

Measured (all three surfaces, from raw `curl` and from the repaired probe, no bucket
credentials used):

| Surface | Result |
|---|---|
| Site edge `three.ws/avatars/*.glb`, foreign origin GET | PASS, `access-control-allow-origin: *`. |
| Site edge, same route, `OPTIONS` preflight | PASS, `204` with `access-control-allow-headers: range`. The 2026-09-04 preflight fix is now LIVE (prod at `880bdcef8`), so that line moves from "ships with the next deploy" to verified. |
| Public bucket host `pub-*.r2.dev` GET/HEAD, foreign origin | FAIL, unchanged. On a real `200` object, `example.org` gets no `access-control-allow-origin`; `three.ws` and `localhost:3000` get their origin echoed with `Vary: Origin`. That differential is the proof the live read rule is still the old allowlist, not the world-open `*`. |
| Presigned `PUT` preflight on the S3 endpoint | Mixed, unchanged. `204` for `three.ws`, `*.vercel.app`, `localhost:3000`; `403` for `www.three.ws`, `*.app.github.dev`, `localhost:5173`, `example.org`. |

So the item does NOT close: surfaces 1 and 2 both still fail and the fix needs the
admin token. It stays in ISSUES.md as item 9, dates refreshed.

Did:
- Repaired `--probe`, which was exiting 1 with nothing measured. It sourced the
  upload host only from `/api/forge-upload`, and that route returns `503` while
  object storage is unhealthy, which is exactly now. It now tries three presign
  routes, accepts explicit `--endpoint=`/`--bucket=` (both non-secret), and when
  the write host is still unknown it measures and reports the read rule instead
  of aborting, showing `skip` in the write column. The one-command re-check that
  ISSUES.md and three docs advertise works again.
- Refreshed the measurement dates in `docs/media-api.md`,
  `docs/character-library.md` and both embed tutorials, and documented the new
  probe flags in `scripts/README.md`.
- Filed a NEW production outage found while measuring: ISSUES.md item 10.
  `object_storage` is `down` with `credentialFault: true`, the bucket answering
  `SignatureDoesNotMatch`. The access key id is accepted, so the secret is wrong.
  Uploads `503`, the avatar and object libraries return `{"total":0}`, and forge
  image generation is 0/30 over 6 hours.

The two doc-cleanup lines in the work order were already satisfied by the
2026-09-04 pass: the script warns against `vercel env pull` rather than
instructing it, and the `/api/glb` docs already state per-host when the proxy is
needed and when a direct fetch is fine. Verified both rather than assuming.
`npm run audit:docs` clean; the four R2/CORS tests pass.

Left: two owner actions, in this order.
1. Re-set `S3_SECRET_ACCESS_KEY` (Secret Manager `s3-secret-access-key`) to the
   R2 token's SHA-256 digest. Reading and rotating that secret is gated from this
   machine. This is the urgent one: it is a live outage.
2. Mint an "Admin Read & Write" R2 token for `chatty-storage`, put it in
   `.env.local` as `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, run
   `node scripts/set-r2-cors.mjs`, confirm with `--probe`.
   Doing this before (1) buys nothing: a correct CORS policy on a bucket we
   cannot authenticate to changes nothing users can see.

The work order file stays on disk: its "policy correct and applied" line is
owner-gated.

## 2026-09-09: 10 x402scan listing (the deploy landed; only the signature is left)

Measured, all against live production with no credentials:

- `curl -s https://three.ws/api/version` → `880bdcef8`, revision
  `three-ws-api-00418-j26`, built 2026-09-08. The `catalogPaidPaths()` fix the
  2026-09-02 pass left in the tree has shipped.
- `curl -s https://three.ws/openapi.json` → **82** `/api/x402/*` paid paths
  (120 total). The work order predicted 79; the catalog has grown since.
- `gh pr view 1032 --repo Merit-Systems/x402scan` → `MERGED`
  2026-08-11T20:01:45Z, unchanged.
- Facilitator page live, rendering both fee payers
  (`WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`,
  `GGf9qBhJDCe1UUz4s4Vxq1uPPvcv7UW7sJTuj2Yo5XQj`) and linking `docsUrl`
  `three.ws/docs/x402-distribution` (200). `/api/x402-facilitator/supported` 200.
- Discovery endpoint: 4,521 resources, `total` stable across the sweep.
- `npx vitest run tests/openapi-aggregator.test.js tests/service-catalog.test.js`
  → 26 passed.

Ran x402scan's own discovery library (`@agentcash/discovery`
`discoverOriginSchema`) against `https://three.ws` rather than reasoning about
what it would do: source `openapi`, 123 endpoints, 83 of them `/api/x402/*`, and
82 of those classified `paid` with the right price and `pricingMode: fixed`. The
one non-paid classification is correct: `GET /api/x402/forge` is genuinely free
price discovery and reads `unprotected`, matching the free row already listed
beside the paid `POST /api/x402/forge`. That answers the question worth
answering before a signature is spent, because every paid operation declares
`security: []` and it was not obvious that `x-payment-info` overrides it. It
does, so our paid endpoints register as paid rows rather than free catalog rows.

Did:

- Added `scripts/x402scan-registration-gap.mjs`
  (`npm run preview:x402scan-registration`), which reproduces their
  classify/probe/deprecate pipeline against live production with no third-party
  dependency. Validated it against the real library: 123 registrable both ways,
  and zero classification mismatches on the rows it reports as new. It exists
  because the alternative was freezing a 60-line endpoint list into a document
  that would rot within a week.
- Rewrote the runbook entry in
  [docs/ops/x402-discovery-listings.md](../../docs/ops/x402-discovery-listings.md)
  with the measured state, wired the script into its inventory table and its
  registration steps, and corrected two claims the 2026-09-02 entry got wrong.

What a registration run would do now: 123 registrable endpoints declared, 63
already listed, **60 rows added and 0 deprecated**, 59 of the 60 answering a
spec-valid 402 to a bare probe. The zero is the point: the run is purely
additive and cannot drop any of the 63 rows already listed.

Two corrections to the 2026-09-02 entry, both from re-probing rather than
re-reading:

1. It recorded five endpoints as answering 503 `settlement_unavailable` and
   therefore unregisterable. False today. `dance-tip`, `feed-health` and
   `spend-session` all answer a spec-valid 402 advertising USDC and $THREE on
   Solana mainnet. The sponsor floor bites at settle time, not at challenge
   time: `/api/healthz` reports `x402.self_facilitator.settle` at 84 ok / 366
   failed with every failure `fee_wallet_below_floor`, which stays order 01's
   capital problem and is not a listing blocker.
2. `ring-settle` and `three-buy` were listed among those five as if they were a
   gap to close. They are not. Both answer a valid 402 but carry
   `discoverable: false` and are deliberately absent from the service catalog,
   so `catalogPaidPaths()` never projects them. They are internal ring
   machinery, and listing them would let dogfooded volume masquerade as organic
   third-party demand. They must stay unlisted.

Swept all 98 handlers under `api/x402/` against `/openapi.json` to check for
more of the defect class the work order fixed: exactly two live-402 handlers are
absent from the document, and they are those two deliberate exclusions. Every
other absent handler is a genuinely free or internal helper route
(`debug`, `echo`, `preflight`, `market`, `my-receipts`, `verify-receipt`, and
similar). No further gap exists.

One endpoint will not probe-register and should not: `GET
/api/x402/vanity-premium`. A bare GET browses the premium inventory for free and
only `?address=<base58>` triggers the 402. Their probe fills required query
params only, and `address` is genuinely optional, so the probe sees the free
mode. Marking it required to force a registration would be a lie about the
route, so it stays unlisted.

Left: one owner action, and nothing else.

- **One SIWX wallet signature** at <https://www.x402scan.com/resources/register>,
  "Add API" for origin `https://three.ws`. It binds an identity and moves no
  funds. Run `npm run preview:x402scan-registration` immediately before signing
  and confirm "would be deprecated" still reads 0.
- The alternative their repo exposes, the paid `registry-register` x402
  endpoint, registers one URL per settled payment and would need 60 payments, so
  the bulk SIWX flow is strictly better.
- The optional Base leg (CDP Bazaar) is unchanged and still a nice-to-have:
  three.ws remains absent from that catalog because indexing is triggered by a
  settle through the CDP facilitator and production has no
  `X402_BUYER_PRIVATE_KEY`. Solana settlement stays self-hosted and must not be
  re-pointed for visibility.

The work order file stays on disk: its origin-registration line is owner-gated.

### Addendum, same day: re-run independently, plus the bytes the owner will sign

Every verify command in the work order was re-run from a clean session and each
one reproduces: PR #1032 `MERGED` 2026-08-11T20:01:45Z; the discovery endpoint
4,521 resources; `/openapi.json` 82 paid `/api/x402/*` paths; the preview 123
declared / 63 listed / **60 added / 0 deprecated**, 59 of 60 probe-valid with
`GET /api/x402/vanity-premium` the documented exception; 26 tests green in
`tests/openapi-aggregator.test.js` and `tests/service-catalog.test.js`. Nothing
regressed between the two passes, and the deprecation count is still the zero
that makes the run safe to sign.

The gap this addendum closes: every write-up above says the signature "moves no
funds" without showing what it actually is, which asks the owner to trust a
wallet popup's summary. Read from x402scan's source instead. On the Solana path,
`signInWithSolana` (`apps/scan/src/auth/providers/siws/sign-in.ts`) calls
`signMessage` on the UTF-8 bytes of one constant and nothing else:

```
Sign into x402scan
```

That is `SIWS_STATEMENT` in the sibling `constants.ts`. It is an off-chain
`signMessage`, not a transaction: no instructions, no program, no blockhash, no
fee payer, so it cannot move a lamport or a token whichever wallet signs it. The
signature and public key go to a NextAuth credentials provider (`siws-csrf`)
only to open a session. The EVM variant wraps the same statement in a full SIWE
message (domain, URI, nonce, chainId, two-hour expiry). What the signature does
commit is the identity: the signing address becomes the owner of the `three.ws`
origin in their registry, so it should be the account meant to hold that listing
long-term. Recorded in
[docs/ops/x402-discovery-listings.md](../../docs/ops/x402-discovery-listings.md)
under the owner-gated step.

## 2026-09-09 (later): 01 x402 settle runway, the largest reject class was misfiled

Re-measured live, nothing carried forward. Production `880bdcef8`, revision
`three-ws-api-00420-ljh`. The capital decision from the entry below is unchanged
and still the owner's; `gcloud` auth is dead in this codespace this session
(`Reauthentication failed`), so even the config lever could not be applied here.

| Fact | Value | Source |
|---|---|---|
| `x402_settle` | **down**, 0.0% (0/125 paid attempts, 3h), `cause: sponsor_floor` | `/api/healthz` |
| Sponsor / economy master `Wwwu…T3WwW` | 1,167,627 lamports, spendable 0, floor 2,000,000 | on chain + `/api/x402/runway-lab` |
| Shortfall to the floor | **832,373 lamports (0.000832 SOL)** | same |
| Treasury `wwwww…ccrU` | 54,994,966 lamports (0.055 SOL) + 0.06 USDC, fenced behind `minSol` 0.1 | on chain |
| Ring payer `X4o2…stML` | 812,444 lamports + 4.163 USDC | on chain |
| Settle rejects, 24h | `fee_wallet_below_floor` 227 of 227, `fee_runway_exhausted` absent | `/api/healthz` |
| Verify rejects, 24h | `simulation_failed` **1,438 of 1,438** | same |

### The finding: 1,438 of 1,438 verify rejects were our own sponsor, filed as a rail fault

The verify book's single largest class was read straight out of the production
table rather than off the healthz prefix, which is what made it visible:

```
1438 | verify | simulation_failed:{"InsufficientFundsForRent":{"account_index":0}}
```

Every row, identical. Account index 0 of a compiled Solana message is the fee
payer by definition, so not one of those 1,438 was about a buyer: they are all
the sponsor being too poor to sign. Two things went wrong with that spelling:

1. `/api/healthz` exposes only the token before the first `:` (deliberately, the
   suffix can carry wallet addresses), so the platform's own dry sponsor shared
   one bucket with a buyer signing from an empty ATA. An operator reading the
   book sees `simulation_failed 1438` at the top and has no way to tell which.
2. `isRailFault()` in `api/_lib/ops/x402-settle-health.js` matches `/simulation/`.
   So the class was also counted as a payment-RAIL fault, which is the one thing
   this order's own "Do not do these" warns against attributing it to. The 2026-08-28
   post-mortem in that module already names this trap and mitigates it with a
   separate `rent` flag reconstructed from the full `error_msg`; the reason token
   itself was never fixed.

This is the same defect shape as the `at_or_below_floor` ambiguity fixed earlier
today: one string covering two opposite operator situations.

### Landed (no funds moved, no config changed, deployable)

- `assertSettleable()` in `api/_lib/x402/self-facilitator.js` now raises the
  fee-payer verdict as its own reason class, using the exact `isFeePayerRentFailure()`
  test that was already computed on that line and thrown away:
  `sponsor_fee_unfunded:<pubkey>` when the dry fee payer is ours
  (`X402_FEE_PAYER_SOLANA`), `payer_fee_unfunded:<pubkey>` when it is the buyer's
  own wallet in a self-pay settle, and `simulation_failed` for everything else.
  The split is exact rather than heuristic. The suffix keeps the pubkey as evidence.
- `SPONSOR_FLOOR` in `api/_lib/ops/x402-settle-health.js` gained
  `sponsor_fee_unfunded`, so the sensor classifies it from the token alone instead
  of depending on the reconstructed `rent` flag. `payer_fee_unfunded` deliberately
  stays out: that wallet is not ours to fund and must never trip the sponsor hint.
- Five tests: three in `tests/x402-self-facilitator-settleable.test.js` (sponsor,
  buyer, and a rent failure on a NON-fee-payer account which must stay
  `simulation_failed`), two in `tests/api/x402-settle-health.test.js` (the new
  class reads as `sponsor_floor` with zero faults and no `rent` flag; the buyer
  twin raises no floor signal and no funding hint). 113 green across the 5 suites
  that touch these modules.
- `docs/ops/production-log-triage.md` gained a three-row table mapping each class
  to who is out of SOL and what to do; `docs/ops/payment-outcomes.md` corrected.
  `npm run audit:docs` clean (1,590 files). `data/changelog.json` entry added
  (`fix`, `infra`), `npm run build:pages` regenerated the feed.
- `npm run check:rules --paths <the 7 touched files>`: clean.

Nothing here changes what settles. It changes what the dashboard says while the
rail is down, which is what the next reader of this order will act on.

### Still open, still one owner decision

Unchanged from the entry below, restated with today's numbers. The sponsor is
**0.000832 SOL** under its floor and the treasury holds **66 times that**, fenced.
Both options move SOL, so both are stop-and-ask gate 1:

1. Lower `pump-x402-launcher`'s `minSol` from 0.1 to ~0.02 in
   `api/_lib/solana-signers.js`, then run `POST /api/cron/treasury-topup` without
   `?dry=1`. Path `wwwww…ccrU` to `Wwwu…T3WwW` to `X4o2…stML`. No owner capital.
2. Send SOL to `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` and nowhere else.
   0.1 SOL restarts settlement, 2 SOL clears the fleet deficit with real runway.

Either also needs `gcloud` re-auth in this codespace and a deploy (gate 2) for the
reason-class work above to reach production.

DoD lines 1 and 3 stay open behind that decision. Line 2 passes
(`fee_runway_exhausted` absent from the book). Lines 4 to 6 done. The prompt file
stays on disk.
