# backlog/: the open work, one prompt per item

Every file here is a **self-contained work order**. Paste one into a fresh Claude
Code chat in this repo and run it to 100% without further input. Read this index
first; every work order assumes it.

The pack exists because the open items were scattered across [../../ISSUES.md](../../ISSUES.md),
retired campaign progress logs, and agent memory. A tracker line tells you a thing
is broken. A work order tells you how to finish it.

---

## Verification snapshot (2026-09-01, measured, not remembered)

Re-measure before you trust any number below. Commands are in each work order.

| Fact | Value | How it was read |
|---|---|---|
| Production commit | `ad7b54c16` (built 2026-08-28), revision `three-ws-api-00404-ph7` | `curl -s https://three.ws/api/version` |
| Deploy gap | **107 commits**; `main` was `73c8ccbb7` | compared to `git rev-parse --short main` |
| `x402_settle` | **down**, 5.9% (4/68 paid attempts, 3h), `cause: sponsor_floor` | `curl -s https://three.ws/api/healthz` |
| Settle reject class | `fee_runway_exhausted` 49,513 of 50,554 failures since boot | same, `x402.self_facilitator.settle.fail_reasons` |
| Solana RPC lanes | all 4 paid lanes cooling, `recoversIn` per lane exposed | same, `subsystems[].name == rpc_lanes` |
| Forge generation | 98% (48/49 finished, 6h) | same |
| Fact-check benchmark | `ran: true`, `source: "database"`, 40% (16/40), published 2026-08-10 | `curl -s https://three.ws/api/fact-check-benchmark` |
| Media CORS at the site edge | `access-control-allow-origin: *` | `curl -I -H 'Origin: https://example.org' https://three.ws/avatars/cesium-man.glb` |
| `gcloud` auth | **live again** (re-read 2026-09-04; it was dead on 2026-09-01) | `gcloud run services describe three-ws-api --region us-central1` |

Two of these overturn text elsewhere in this pack: the benchmark is live from the database
(order 04's only remaining line closed with the 2026-08-28 deploy), and production is no
longer at `main`, so "ships with the next deploy" is a real dependency again for anything
committed after 2026-08-28 06:49 UTC.

---

## Run order

Nothing here is strictly sequential, but the money rail gates the platform's
observable health, so 01 to 03 come first.

| # | Work order | Blocked on | Owner action needed |
|---|---|---|---|
| 01 | [x402 settle: clear `fee_runway_exhausted`](../902-backlog-01-x402-settle-runway.md) | **the deploy landed 2026-09-08**; one capital decision left (re-measured 2026-09-09 third pass: `fee_runway_exhausted` is gone, the sponsor is 0.000842 SOL under its floor, and the outage hint has been corrected to name the right mechanism) | pick one: release the **0.0558 SOL the platform already owns** but has fenced behind `pump-x402-launcher`'s 0.1 SOL `minSol`, or send SOL to the economy master. Either moves funds, so either is gate 1 |
| 05 | [R2 bucket CORS: verify, then fix at the origin](../906-backlog-05-r2-bucket-cors.md) | one credential (re-measured twice on 2026-09-09, both bucket-origin surfaces still fail) | mint an R2 "Admin Read & Write" token for `chatty-storage`. The storage outage that briefly gated this (`S3_SECRET_ACCESS_KEY`) recovered the same day, so this is the only step left |
| 07 | [BNB testnet: deploy the two finished contracts](../910-backlog-07-bnb-testnet-deploys.md) | one funded EOA | send tBNB to `0x1C4918894dfA5eE11cfF9629B458b5169Cfa3871` (faucet is reCAPTCHA-gated) |
| 08 | [OKX chat bot: move off the codespace](../907-backlog-08-okx-chat-bot-always-on.md) | **deployed 2026-09-04** and still beating (re-measured 2026-09-09 from `bot_heartbeat`, no `gcloud` needed); only the reply lane is blocked, and the AI-lane chain committed the same day has not shipped | two: clear the GCP billing hold (it also restores the platform Vertex anchor, `LLM providers DOWN` x657), and deploy `workers/okx-chat-bot/cloudbuild.yaml` so a funded lane can actually be elected |
| 09 | [Telegram bots: durable hosting for both feeds](../908-backlog-09-telegram-bots-durability.md) | **done**; the firehose was found silently dead on 2026-09-09 (dead RPC), fixed and hardened the same day | clear the commit gate on its file update |
| 10 | [x402scan listing: finish the last three steps](../909-backlog-10-x402scan-listing.md) | **the deploy landed 2026-09-08**; only the origin registration is left (re-measured 2026-09-09) | one SIWX wallet signature at x402scan `/resources/register` for origin `https://three.ws`; no funds move |

---

## Retired after verification (2026-09-01)

Four orders were deleted once every agent-doable line of their definition of done was
verified on disk and in production, not from this log: 02 (Solana RPC capacity: the lane
probe script, per-method capability routing, `recoversIn` on the ops surface, the runbook),
03 (sponsor runway: burn measurement, the alert and its formatter tests, the `sponsor_floor`
sensor that healthz reports today), 04 (the benchmark run: live from the database since the
2026-08-28 deploy), and 06 (LLM lanes: transport-failure tests for every free rung, the
metering audit, the opt-in paid mirror, corrected docs). Their files are readable in git
history; the evidence per line is in [PROGRESS.md](backlog-PROGRESS.md) under 2026-09-01.

State of what remains, measured the same day: 01 is code-complete but its outcome line is
false (settle 5.9%, sponsor wallet under its SOL floor; capital is the owner's). The dry-run
reclaim plan that reported sealed wallets as reclaimable was fixed on 2026-09-02 (`afd349790`):
it now opens each planned wallet's key and lists the ones that will not decrypt under
`agent_reclaim.failed`, so a dry total of 0 means the owner has to send SOL. 05 waits on one R2 admin
token. 07 needs one faucet claim and nothing else: a deployer key now exists in the gitignored
`contracts/.env` at `0x1C4918894dfA5eE11cfF9629B458b5169Cfa3871` (re-verified 2026-09-04,
still 0 tBNB on three chain-97 lanes), both dry runs simulate green against the live chain-97
RPC at unchanged gas, and the `--broadcast` path was re-proven end to end on a local chain-97
node with the real `scripts/bnb-testnet-deploy-prove.mjs --broadcast`. Fund that address, not
the retired 2026-08-02 one.
08's worker is built and committed; on 2026-09-02 it beat for the first time, from this
codespace, so `/api/healthz` now carries the `okx_chat_bot` subsystem and reports it as the
stopgap it is (`hostDurable=false`). On 2026-09-04 the deploy stopped waiting on a credential
nobody had: it now authenticates the AI subsession through Vertex with the runtime service
account, so `--set-secrets` carries only the heartbeat database URL, and the session snapshot
is seeded and verified so the first boot comes up authenticated rather than paging for an OTP.
The Cloud Run host went live the same day (revision `okx-chat-bot-00001-926`): it restored the
seeded session with no OTP, reports `durable: true`, and serves one XMTP client for agent 2632,
so the codespace era is over and that stopgap must stay stopped (one writer per state object).
Read the same day: both AI credentials this project holds are present and refused (Vertex
`Lightning dunning decision is deny`, a billing hold; the `openai-api-key` account
`billing_not_active`, which kills the platform's OpenAI lane everywhere, not just here), so a
deployed host will report the new `ai_provider_unauthorized` until the owner clears billing.
09 is done, but the 2026-09-02 reading that closed it was only half right and is worth learning
from. Both services were `Ready=True` on websocket transport, and the codespace rebuild that
killed their local twins did prove the hosting durable. What `Ready=True` did not prove is that
a feed was carrying traffic: re-measured on 2026-09-09, the all-claims firehose had 99 hours of
uptime, `mode: websocket`, and **zero events**, because `rpc.magicblock.app` went key-gated and
its only WebSocket endpoint had been answering 401 for four days. Subscribing cannot fail loudly
in web3.js, so nothing in the metrics distinguished that from health. Fixed the same day:
endpoints repointed, and both bots given a WebSocket endpoint list, a traffic-based liveness
check, rotating reconnects, and `activeWs`/`wsEventsReceived` in `/stats`. **Read a feed's event
counter, never just its readiness condition.**
10's remaining external step resolved on its own
(the upstream pull request merged 2026-08-11, the registry attributes 18,636 settlements and
$1,055 of volume to our facilitator, and their own crawler replayed against production returns
4,519 stable items with no duplicates). What was left was on our side: their registration flow
reads `/openapi.json`, which hand-enumerated 24 of the 75 live paid services, so 52 endpoints
answered a valid 402 and could not be listed. **That shipped on 2026-09-08** (production
`880bdcef8`), so the document now declares 82 paid paths. Re-measured 2026-09-09 by running
x402scan's own discovery library against production and by
`npm run preview:x402scan-registration`, which agrees with it endpoint for endpoint: 123
registrable endpoints declared, 63 already listed, **60 rows a registration run would add and
0 it would deprecate**, 59 of the 60 answering a spec-valid 402 to a bare probe. The run is
purely additive, so the only step left is one owner wallet signature. Two claims from the
2026-09-02 pass are now false and were corrected in the runbook: the five "503
`settlement_unavailable`" endpoints all answer a valid 402 today (the sponsor floor bites at
settle time, not at challenge time, which stays order 01's problem), and `ring-settle` /
`three-buy` are `discoverable: false` internal ring machinery that must stay unlisted rather
than being a gap to close.

## Shared rules (every work order obeys these)

1. **CLAUDE.md wins.** Read it before you start. The stop-and-ask gates are real:
   irreversible spends, `git push` and production deploys, other-coin commits,
   unrecoverable data deletion. Everything else: proceed, then report.
2. **Config-only `gcloud run services update` is pre-approved.** Use
   `--update-env-vars` (merges). Never `--set-env-vars` (replaces the whole set).
3. **Moving funds is not config.** Any transfer, reclaim, swap, or top-up needs an
   explicit owner yes with recipient and amount rendered first, even when the
   endpoint that does it is a cron you can already call.
4. **Measure before and after.** Every work order names the exact command that
   proves its claim. A fix without a re-read is not a fix.
5. **The gate.** `npm run gate` at the start and again before you claim done.
   `gate-after` must be no worse than `gate-before`.
6. **`npm run check:rules -- --paths <files you touched>`** before committing.
   Concurrent agents share this worktree, so stage explicit paths, never `-A`.
7. **User-visible change means a `data/changelog.json` entry** plus the docs layer
   that applies (see the Documentation section of CLAUDE.md).
8. **Log your outcome in [PROGRESS.md](backlog-PROGRESS.md)** when you finish or hand off.
   It is the only memory between chats.

## Commit gate applies to four of these

Work orders 07, 08, 09, and 10 reference crypto projects other than `$THREE`
(a second chain, a marketplace, a launchpad, a registry). Building and running
them is fine. **Committing a diff that names any of them requires explicit owner
approval first**, per CLAUDE.md. Each of those files repeats the warning at the
top. The other two touch only platform infrastructure and `$THREE`.

## The diagnosis reflex that keeps being right

Before debugging any production symptom, check three things in this order:

```sh
curl -s https://three.ws/api/version    # is prod at main, or are you debugging old code?
curl -s https://three.ws/api/healthz    # which subsystem is actually down, with counts
npm run db:status                       # are migrations pending behind you
```

More than one session in this repo has been spent debugging a fix that had already
shipped, or one that never had.

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'backlog-00-INDEX' prompts/finish/
       git rm prompts/finish/_context/backlog-00-INDEX.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.
