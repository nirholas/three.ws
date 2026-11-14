# OKX.AI Launch: Progress Log

Handoff file for the work-order sequence in this directory. Each session appends a dated
entry: what was done, what was verified, what's blocked, what's next. (Created by the
Work Order 04 session, no earlier entries existed because no earlier work order has run.)

**Older entries:** [okx-ai-PROGRESS-archive-1.md](okx-ai-PROGRESS-archive-1.md) (2026-09-09 to 2026-09-09), [okx-ai-PROGRESS-archive-2.md](okx-ai-PROGRESS-archive-2.md) (2026-09-04 to 2026-09-09), [okx-ai-PROGRESS-archive-3.md](okx-ai-PROGRESS-archive-3.md) (2026-07-10 to 2026-09-02), [okx-ai-PROGRESS-archive-4.md](okx-ai-PROGRESS-archive-4.md) (2026-07-06 to 2026-07-08), [okx-ai-PROGRESS-archive-5.md](okx-ai-PROGRESS-archive-5.md) (2026-07-06 to 2026-07-17), [okx-ai-PROGRESS-archive-6.md](okx-ai-PROGRESS-archive-6.md) (2026-07-23 to 2026-08-02). They were moved there verbatim on 2026-11-10 to keep every file under the 50,000-character limit; search them too when you need history.

---

## 2026-09-09, the chat host is durable and unchanged; every AI lane it could use is out of money, so the host now uses whichever one is funded

Read live before touching anything. The Cloud Run host from 2026-09-04 is still
serving and nothing about it regressed:

| Read | Value |
|---|---|
| `gcloud run services describe okx-chat-bot` | `okx-chat-bot-00001-926`, `Ready=True` |
| `host.durable` | **true** (`cloudrun:okx-chat-bot`) |
| `daemon` | `running pid=32`, 0 restarts, uptime 4.2 days |
| `session` | `loggedIn: true`, `claude@three.ws`, no OTP needed |
| `agents` | 1 XMTP client serving 1 agent identity: buyer chat IS delivered |
| `/readyz` | 503 `ai_provider_unauthorized`, remedy attached |
| `/api/healthz` | `okx_chat_bot` degraded, quoting the dunning 403 |

So the backlog prompt's headline ("get it off the codespace") has been done since
2026-09-04. The one line that has never passed is chat delivery end to end, and
that has one cause.

### Every AI credential this org holds was measured today. All four are out of funds.

| Lane | Probe | Answer, 2026-09-09 |
|---|---|---|
| Vertex Claude | `claude-haiku-4-5@20251001:rawPredict` | `403 Lightning dunning decision is deny for project: projects/93741856042` |
| Vertex Gemini | `gemini-2.0-flash-lite-001:generateContent` | same 403. The hold is project-wide, not publisher-scoped |
| OpenAI (`openai-api-key`) | `POST /v1/chat/completions` | `429 billing_not_active` |
| OpenRouter (`OPENROUTER_API_KEY`) | `POST /api/v1/messages` | `402 Insufficient credits` (key is valid, `is_free_tier: false`, usage $0.00036) |
| Groq (`groq-api-key`) | `POST /openai/v1/chat/completions` | `429` tokens-per-day 200,000 exhausted (199,939 used, shared with the whole platform) |

No engineering fixes a billing hold. **That line is the owner's, and it is the
only thing between this listing and a bot that answers buyers.**

### What DID need fixing: the host held a chain with one rung

The host was pinned to Vertex alone. When the hold landed it sat on that one dead
lane for days and never considered the other credentials on the same service, and
would not have picked one up if the owner had funded it. That is the worker's own
defining failure (silence with a healthy-looking process) rebuilt one level up.

`workers/okx-chat-bot/` now holds an ordered chain and elects on a live probe:

`vertex` (GCP credits) > `anthropic-key` > `anthropic-gateway` > `anthropic-login`
> `openai-key`

- `providerLanes()` / `resolveProviderChain()` (`config.js`) build it; `applyLane()`
  points the flat `provider*` fields at the elected lane, so the heartbeat, the
  health body and `cliEnv()` all follow with no plumbing change.
- `probeLane()` probes each lane **through its own env overlay**, and
  `electProvider()` (`provider.js`) walks the chain and stops at the first `ok`,
  so a funded lane is never skipped and an unfunded one is never paid to learn
  nothing. `unprobed` (a developer host's interactive grant) is still electable;
  `unauthorized` is not.
- A lane change re-asserts `okx-a2a config provider`, re-runs the codex login when
  it applies, and calls the new `supervisor.restart()`: the adapter hands the AI
  subsession the daemon's environment, fixed at spawn, so a credential change is
  only real once the daemon carries it.
- The election re-runs every `OKX_BOT_PROVIDER_PROBE_MS` (15 min), so **a lane the
  owner funds is picked up with no deploy.**
- `/readyz` now carries `provider.lane` and `provider.chain` (every lane's verdict
  and detail), and the `remedy` lists them. Whoever fixes this needs to know which
  credential to fund, not merely that one was refused.

The new rung is a generic **Anthropic-wire-format gateway**: the same `claude`
CLI with `ANTHROPIC_BASE_URL` moved, so the task lifecycle (accept / negotiate /
deliver, driven by the subsession calling `okx-a2a` itself) is untouched. A
one-shot responder would have broken it. OpenRouter serves such an endpoint and
`three-ws@` already holds `secretAccessor` on `OPENROUTER_API_KEY`, so
`cloudbuild.yaml` wires the lane in permanently: while the account has no credit
the lane probes 402 and is never elected, and funding it is then a billing action
rather than a deploy.

**Two bugs the live probe caught before they could ship**, both of which would
have produced exactly the silence this worker exists to kill:

1. `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1` makes the CLI request
   `/api/v1/v1/messages`. The base URL is the prefix `/v1/messages` is appended
   to, so it ends at `/api`. One segment too deep answers 404 forever.
2. `classifyProbeStatus()` reads a 400/404 as proof the credential works (true of
   api.anthropic.com: it had to authenticate the caller before objecting to the
   body). For a gateway that reasoning is false, and lane 1 above would have been
   elected on its own 404. A gateway lane is now elected on a 2xx and nothing else.

Verified: `tests/okx-chat-bot.test.js` 69 pass (10 new), `check-rules` clean on
the touched paths, `audit:docs` clean, `build:pages` validated the changelog entry.
The election was also run against the REAL endpoints with the real service
credentials: chain `vertex > anthropic-gateway > openai-key`, elected `none`, each
lane quoting its own live refusal.

### What is left, and who owns it

1. **Owner: fund one AI lane.** Clearing the GCP billing hold is the preferred
   one (Vertex leads the chain and bills the credit pool). Adding OpenRouter
   credit or reactivating the OpenAI account both work too, and neither needs a
   deploy once the chain is live. Nothing in code is blocking.
2. **Owner: deploy the worker**, one command, prepared and gated:
   `gcloud builds submit --config workers/okx-chat-bot/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s) .`
   Re-seed the session snapshot first only if a host other than Cloud Run holds a
   newer one; today Cloud Run is the sole writer, so the deploy is safe as-is.
3. Still open from 2026-09-07 and unrelated to the bot:
   `onchainos agent activate --agent-id 2632 --preferred-language en-US`.

**Do not restart the codespace stopgap.** The GCS state object still has exactly
one writer and Cloud Run still owns it.

---

## 2026-09-09, Work Order 04 (later session): every unfunded leg green, and case 6 was found testing the wrong side of the acceptance line

Re-ran the whole no-money half of the gauntlet against production, root-caused a defect in
the paid half BEFORE spending on it, and stopped at the one stop-and-ask gate. Nothing was
simulated in place of a real payment; no on-chain write was attempted.

### Step 0 preconditions, all verified live today

| Check | Result |
| --- | --- |
| `onchainos --version` / `wallet status` | 4.5.2, `loggedIn: true` as `claude@three.ws`. **The OTP gate from the 2026-08-01 session is discharged.** |
| `GET /api/okx/3d/health` | 200, six subsystems, `payment-rail settleable: true`, block 70196288 |
| `GET /api/okx/3d/catalog` | 200, 7 rows, byte-identical to `catalogIndex()` |
| 402 sweep, 4 listed paid rows, MCP headers sent | all 402, `accepts[0].network = eip155:196`, amounts byte-exact (10000 / 50000 / 250000 / 250000), `payTo` `0x4022de2D...f402` unchanged. Evidence: `96-2026-09-09-402-sweep.txt` |
| `npx vitest run tests/api/okx-3d-services.test.js` | 36 passed |
| `npm run okx:three-copy` | module == live == submission. The only divergence is the known stale on-chain DESCRIPTIONS, owned by work order 08, not by this one. |
| `node scripts/okx-e2e-gauntlet.mjs --dry-run` | 4/4 unfunded cases PASS (1, 1d, 5d, 7); the other ten are the paid legs |
| `scripts/okx-verify-glb.mjs` controls | 4/4 correct: michelle.glb 0 and 0 `--rigged`, mannequin.glb 0 and 1 `--rigged`, an error JSON named `.glb` exits 1, a 404 exits 2 |

### The defect: case 6 would have spent $0.25 to prove the opposite of our promise

Case 6 asserts the pay-on-acceptance promise by forcing a job to fail after payment verifies
and checking the EIP-3009 nonce is still unredeemed. It forced that failure with an
`image_urls` entry that 404s. **Measured against production: that input does not fail.**
`POST /api/forge` with a 404 image URL answers `200 queued` (job `f1.eyJwIjoiZ2NwIi...`,
creation `67c9d5ad-e14c-466b-97b9-b48d00006baa`); validation on that lane is format-only and
never fetches the image. The job would have been accepted, settled, and failed later in
generation, which is the CHARGED side of the line `docs/okx-marketplace.md` documents.

Fixed by moving case 6 to `forge-draft` ($0.01) with a whitespace-only prompt: it clears the
tool's JSON schema (minLength counts the spaces, so a real payable 402 is still issued,
confirmed by Ajv against the live schema and by a 402 from production) and is then refused
inside the handler with `invalid_input` before the lane is asked for any work. Both hops are
now covered by a unit test in `tests/api/okx-forge.test.js` (46 passed), so the premise cannot
rot silently. Float floor for a clean run drops from $1.32 to $1.08.

### One docs defect fixed in the same pass

`docs/okx-marketplace.md` stated the acceptance line precisely in "Payment semantics" and then
contradicted it 80 lines later in the REST-rows section ("an engine failure answers before
settlement and never charges"). A buyer reading only the second paragraph concludes a
generation failure is refunded. Corrected to name acceptance explicitly and to cross-link the
precise section. Code and promise now agree everywhere; no code change was needed.

### Two more adversarial cases went green with NO funding

`5b` and `5c` were assumed to need money by every prior session's plan; they do not. The
`onchainos` CLI signs an EIP-3009 authorization off-chain regardless of balance, and the
server rejects both before it ever reaches a balance or settlement check, so the pair is fully
provable at a zero balance and was proved today (`node scripts/okx-e2e-gauntlet.mjs --yes
--only 5b,5c`, `2/2 cases passed. Settlements: 0`, buyer balance unchanged at 0.000000):

- **5b PASS**: an authorization signed for `forge-draft` (10000) replayed against `forge-hd`
  answers 402 with a fresh challenge and `signed payment amount 10000 is below required
  250000`. Nonce unspent on-chain. Evidence `51-case5b-cross-service.json`.
- **5c PASS**: an expired authorization answers 402, the message names expiry, and a full
  fresh challenge is offered. Nonce unspent. Evidence `52-case5c-expired.json`.

**Three of the four adversarial cases (5b, 5c, 5d) are therefore closed without funding.**
Only 5a still needs it, because replaying a VALID authorization first requires a real
settlement to replay. Case 6 was deliberately NOT attempted unfunded: at a zero balance verify
rejects on balance before the handler is reached, so it would pass for the wrong reason and
the evidence would be worthless. Its handler half is instead covered mechanically by the new
unit test above.

### Still blocked on exactly one owner action

**5.0 USD₮0 to `0x75d00a2713565171f33216e5aa2a375e076ecf69` on X Layer (chainId 196), token
`0x779Ded0c9e1022225f8E0630b35a9b54bE713736`.** Buyer holds 0.000000, unchanged for six
weeks. Details, arithmetic and the optional Solana leg are in
`prompts/okx-ai/e2e-evidence/FUNDING-REQUEST.md`, refreshed today. Note the money largely
returns: `payTo` is our own merchant wallet, so a full run costs the platform only gas
(~0.00002 OKB), and that wallet already holds 2.427731 USD₮0 if funding from there is easier.
`gcloud` auth is expired in this session, so the merchant key cannot be read here either way.

### GO/NO-GO for OKX-05 / the relisting

**NO-GO on the settlement evidence, unchanged and for the same reason as every prior session:
no real settlement has ever landed on this rail.** Six of the fourteen cases now pass for real
against production with no funding (1, 1d, 5b, 5c, 5d, 7). The eight that remain (2, 2b, 3,
3i, 3r, 4, 5a, 6) are written, wired and budget-checked, and they are unproven until they
spend. `docs/okx-marketplace.md` still carries no "verified behavior" section, deliberately:
writing settlement timing and replay protection from intention rather than from a tx hash is
exactly what this work order forbids.

Agent #2632 untouched. The relisting (work order 08) does not depend on this: a listing does
not require a settled payment to be submitted.

## 2026-09-09, Work Order 04 (evening session): the unfunded half re-proved, and the case 7 "green" retracted

Re-ran every precondition and every case that cannot move money against production, found
and fixed a reporting defect that had inflated this campaign's own status, and stopped at the
funding gate. Nothing was signed that could settle; the buyer is still at 0.000000.

### Preconditions, all re-verified live today

| Check | Result |
| --- | --- |
| `onchainos --version` / `wallet status` | 4.5.2, `loggedIn: true` as `claude@three.ws`. No OTP needed. |
| `GET /api/okx/3d/health` | 200, six subsystems ok, `payment-rail settleable: true`, block 70213386 |
| `GET /api/okx/3d/catalog` | 200, 7 rows |
| `npm run okx:three-copy` | module == live == submission payload. The only divergence is the known stale on-chain DESCRIPTIONS, owned by work order 08. |
| `npx vitest run tests/api/okx-3d-services.test.js tests/api/okx-forge.test.js` | 82 passed |
| Buyer float, direct `eth_call` on X Layer | 0.000000 USD₮0, 0.000000 OKB. `payTo` holds 2.427731 USD₮0. |
| `onchainos wallet balance` (all chains) | `totalValueUsd: "0.00"`. There is no rail this wallet can pay on today. |

### The defect: case 7 was never green, and this file said it was

The 2026-09-09 earlier entry above reports "six of the fourteen cases now pass for real
against production with no funding (1, 1d, 5b, 5c, 5d, 7)". **Case 7 does not belong on that
list.** Its title is "legacy rail still answers AND PAYS its own challenge", and its paid leg
has never run. The pass came from a dry run, where the record expression was
`advertised && (args.dryRun || paidLeg?.ok === true)`: in a dry run the advertisement half
alone satisfied the full title. The evidence file proves it, `"paidLeg": null`, and the last
real summary (`00-gauntlet-summary.json`) never contained case 7 at all.

Fixed in the script, not just in the notes:

- Case 7 now records **SKIP** whenever the run is not allowed to pay, with the advertisement
  result kept in the detail line, so an advertisement-only result can never again be counted
  as a pass. A failed advertisement is still a hard FAIL in any mode.
- Added `--no-spend`, which runs every case that cannot move money and refuses every case that
  can, on any rail. It is distinct from `--dry-run`: a dry run signs nothing and so only
  proves the free lanes, while `--no-spend` signs the real authorizations the server must
  refuse (5b, 5c) and therefore actually proves the replay and expiry protections at a zero
  balance. It also overrides `--yes`, so it can only ever narrow a run.
- `SPENDING_CASES` is a deliberate superset of the X Layer settlement plan, because case 7
  pays in USDC on Solana rather than USD₮0 on X Layer. A startup check refuses to run if any
  settling row is missing from it, so the two cannot drift.
- `--budget` no longer prints "rejected before settlement" against case 7 (it settles, just on
  another rail) and now names the Solana leg's USDC requirement, which the X Layer float math
  does not price.

### Today's run

`node scripts/okx-e2e-gauntlet.mjs --no-spend`: **5/5 cases exercised passed, 9 skipped,
Settlements: 0**, buyer balance unchanged at 0.000000. Evidence:
`101-2026-09-09-no-spend-sweep.json`.

| Case | Result | Evidence |
| --- | --- | --- |
| 1 free lane | PASS | `30-case1-free-lane.json` |
| 1d MCP discovery free | PASS | `33-case1d-mcp-discovery.json` |
| 5b cheap auth cannot buy dearer | PASS, nonce unspent | `51-case5b-cross-service.json` |
| 5c expired auth refused | PASS, fresh challenge offered | `52-case5c-expired.json` |
| 5d garbage header | PASS, 4xx on all four shapes | `53-case5d-garbage.json` |
| 7 legacy rail | SKIP, advertisement ok, paid leg never attempted | `70-case7-legacy-rails.json` |
| 2, 2b, 3, 3i, 3r, 5a, 6, 4 | SKIP, need funding | n/a |

So the honest count is **five of fourteen green**, not six, and **nine remain**, not eight.

### Docs

`docs/okx-marketplace.md` already carried a "Verified behavior" section that correctly
refuses to claim settlement timing. Added the legacy-rail line (advertised: measured; paid:
not) so the same honesty covers case 7, and the `npm run okx:gauntlet -- --no-spend` command
so any reader can reproduce the section without spending.

### Still blocked on exactly one owner action, now with a second leg named

**1.08 USD₮0 minimum (5.0 requested for the fix loop) to
`0x75d00a2713565171f33216e5aa2a375e076ecf69` on X Layer (chainId 196), token
`0x779Ded0c9e1022225f8E0630b35a9b54bE713736`**, plus **0.10 USDC on Solana to
`9PirGw9wVLLNFgVyjgAt5jvuFQwJ3pYUBWt9n3vZfnyc`** for case 7, which the earlier version of the
funding request wrongly called optional. Details and arithmetic:
`prompts/okx-ai/e2e-evidence/FUNDING-REQUEST.md`. The X Layer money largely returns, since
`payTo` is our own merchant wallet (holding 2.427731 USD₮0, enough on its own); that key is in
Secret Manager and gcloud in this session cannot refresh its token, so the transfer is the
owner's either way.

### GO/NO-GO for OKX-05

**NO-GO on settlement evidence, unchanged: no real settlement has ever landed on this rail.**
Every case that can be proved without money is proved and reproducible on demand. Agent #2632
untouched. The relisting (work order 08) does not depend on this.

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'okx-ai-PROGRESS' prompts/finish/
       git rm prompts/finish/_context/okx-ai-PROGRESS.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.

## 2026-09-10 | order 07 (914) | Part 1 and Part 2 re-audited against production

Ran the audit rather than trusting the previous entry, per the order's own binding clause. Part 3
(approval watch, launch execution) and Part 1 item 2 (a real paid call) still need the owner: an
OTP and a funded buyer wallet. Everything else below was measured today.

**Part 1 item 1, unpaid 402s, spec-valid: PASS, and it found a real bug.** Checked five endpoints
across the whole price range (`model-check` $0.001, `skill-marketplace` $0.001, `forge` $0.15,
`fact-check` $0.10, `pump-launch` $5). All answer `402` with `x402Version: 2`, scheme `exact`, a
`payTo` and an `asset`, and amounts matching the discovery catalog exactly.

The bug: **the live 402 and the discovery catalog disagreed about which chain to settle on.**
`/.well-known/x402.json` advertised these Solana-first, but fifteen routes under `api/x402/`
passed `networks: ['base', 'solana']` to `paidEndpoint`, overriding the platform's Solana-first
default, so the live challenge handed back Base as `accepts[0]`. Twelve routes were confirmed
mismatched against the catalog. An agent that reads the catalog picks Solana and then settles on
Base. Not one of the fifteen carried a comment explaining the override, and `paidEndpoint`'s
default documents itself as Solana-first "unless a route explicitly overrides the network order",
so this was copy-paste drift and not a decision. Fixed by deleting the overrides so every route
inherits the default (`72c841f5e`), with a source-level guard in
`tests/x402-solana-first-ordering.test.js` so it cannot creep back. 535 x402 tests pass.

**Part 1 item 4, free lane honest and catalog identical to the module: PASS.**
`/api/okx/3d/health` answers `200` with real subsystem latencies, and `/api/okx/3d/catalog`
answers `200` with 7 listed services plus 9 under `unlisted`, which is exactly the 16 in
`api/_lib/okx-catalog.js`. The split is deliberate and documented in both the route header
(`api/okx/3d/[service].js`: back-burner services stay routable but off the listing) and
`docs/okx-marketplace.md`. Worth recording because reading only `services` makes this look like a
9-service regression, and it is not.

**Part 1 item 6: PASS.** `npm run audit:docs` clean across 1,605 markdown files;
`npm run build:pages` green, which is what validates the changelog entries.

**Part 2, docs closure: PASS on everything checkable without the OTP.** The `curl` examples in
`docs/okx-marketplace.md` were RUN, not read: catalog `200`, health `200`, and `forge-standard`
with no body returns a spec-valid `402` naming `PAYMENT-SIGNATURE`. `docs/okx-marketplace.md` is
linked from `docs/start-here.md`. `specs/okx-agent-payments.md` and `docs/agent-identities.md` are
present and current. `STRUCTURE.md` carries OKX rows. `data/pages.json` registers both
`/agent-identities` and `/docs/agent-identities` (they live under `sections[].pages`, so a flat
scan of the file reports a false negative). README coverage under `packages/`, `workers/` and
`services/` is 100%.

**Left open:** Part 1 items 2 and 3 (a real paid call and the replay spot check, both needing a
funded buyer wallet) and all of Part 3 (OTP). The order stays on disk.

## 2026-09-18 | backlog order 08 (907) | payment-free reply lane proven, single-writer lease built, deploy reduced to one command

**Measured first.** Cloud Run `okx-chat-bot-00001-926` is Ready and beating (`hostDurable: true`),
chat is delivered, and `/api/healthz` reports `okx_chat_bot` degraded: Vertex answers 403
`Lightning dunning decision is deny`. Live API `4291900c7` (`three-ws-api-00448-hst`) contains
`4dbe02cc7` (the NVIDIA re-pin). Live worker contains no lane election (no `providerLane` on its
beat), no lease.

**The reply lane, proven against production.** The `anthropic-gateway` lane pointed at three.ws's own
we-pay proxy needs no payment anywhere, but three things stood between it and working, none visible
until the real CLI was driven through it:

1. The CLI appends `/v1/messages` to `ANTHROPIC_BASE_URL` and cannot add `?agent=`; production
   answered `404 No API route matches /api/llm/anthropic/v1/messages`. Fixed: an agent-scoped base URL,
   `/api/llm/anthropic/agents/<agent>/v1/messages`, the same handler with the agent bound from the
   path (`53687d994`).
2. The CLI's default request was refused by the proxy schema: `system` as a block array, `max_tokens`
   32000, and an environment block sent as a `role: system` turn inside `messages` (captured from
   `claude` 2.1.273 against a local echo server). Fixed: block-array system accepted (flattened only for
   OpenAI-shape lanes), `max_tokens` clamped to 16000, in-thread system turns passed to Anthropic lanes
   and folded into the system prompt for OpenAI-shape ones (`f7f7da9b6`, `53687d994`, `d3074c1c8`).
   Committed: these name no marketplace.
3. The proxy meters per agent and admits a header-less caller only with a platform identity.

Proof, all against production:
- The bot's own probe body (`provider.js probeGateway`: model, `max_tokens: 1`) on the canonical path:
  `200`, model `nvidia/nemotron-3-super-120b-a12b`, 657 ms (the free NVIDIA rung `4dbe02cc7` repaired).
- **The full CLI request.** `claude -p` with the exact env overlay `config.js gatewayLane` builds (the
  22-tool agentic prompt, streaming) ran through production's proxy on
  `nvidia/nemotron-3-super-120b-a12b`, made a real Bash tool call, read the output back and answered
  the marker (`is_error: false`, 2 turns, 14 s; three proxy calls, all `200`). Because the SDK path is
  not deployed yet, the CLI reached production through a local shim that applies exactly the request
  adaptations commits `53687d994`/`d3074c1c8` make server-side and forwards to the live canonical path,
  authenticated as the QA account's own agent (`f8841960-...`, per the i18n lane's rule). The
  adaptations themselves are unit-tested in `tests/api/llm-anthropic.test.js` (65 pass).

**Metering agent: a dedicated one, not an existing agent.** No agent represents the listing (searched
names, meta, and every agent of the platform account `three-ws@users.three.ws.local`). The reply
subsession runs with tool access on buyer text and can read its own environment, so its bearer key
must be worth as little as possible: `scripts/okx-bot-llm-gateway.mjs` provisions a service-account
user `marketplace-chat@agents.three.ws` (`service_account = true`) owning ONE unpublished agent
"three.ws 3D Studio (marketplace chat)" (`meta.purpose = llm-gateway-meter`) whose embed policy fits
a Claude Code loop (30 calls/min, 20,000 calls and 30M tokens a month; the embed default of 10/min
and 1M tokens would starve it), mints an `sk_live_` key for it straight into Secret Manager
(`okx-chat-bot-llm-gateway-token`, `three-ws@` as `secretAccessor`, never printed), and proves the
lane with the worker's own `probeLane`. **Not run yet:** the session's Secret Manager write was
refused by the permission layer, and gcloud auth then expired. It runs as step 3 of the deploy.

**Single-writer safety: the gap was real.** `--max-instances=1` is a revision annotation
(`autoscaling.knative.dev/maxScale: 1` on the template; the service-level `maxScale` is 100), and a
rollout runs the new revision's instance beside the old until it is Ready. Nothing in the worker
guarded that window: both would restore the identity and run a daemon, and the old one's SIGTERM
snapshot would then overwrite the new one's. Built `workers/okx-chat-bot/lease.js`: a lease row in
`bot_heartbeat` (`worker = 'okx-chat-bot:lease'`, no migration), one conditional upsert per
transition on the database clock. The new instance serves `/healthz` first (so the rollout proceeds),
waits (`lease_wait`, `lease.waitingOn` on `/readyz`, no heartbeat while waiting), and only restores
and starts the daemon once the old instance has snapshotted and released; a dead holder is waited out
for 120 s; a holder that cannot renew fences itself (stops the daemon, exits without a snapshot).
A revision built before the lease is recognised by a heartbeat without `leaseHolder` and waited out
until that beat is 90 s stale: that is what makes the first rollout off `00001-926` safe. The SQL was
exercised on the production DB under a throwaway key (acquire, refuse a second holder, renew, release,
hand over, expire, lose; row removed after), and the live beat read back as
`cloudrun:okx-chat-bot (okx-chat-bot-00001-926), leaseAware: false`. 11 lease tests added.

**Checked:** `ad723e87f` (lane election) is in HEAD; `cloudbuild.yaml` pins `three-ws-build@` (build)
and `three-ws@` (runtime). `tests/okx-chat-bot.test.js`: 95 pass. `cloudbuild.yaml` now points the
gateway lane at `https://three.ws/api/llm/anthropic/agents/${_GATEWAY_AGENT}` with model
`${_GATEWAY_MODEL}` and the new secret (the unfunded OpenRouter rung is replaced). Vertex still leads,
so clearing the billing hold moves the bot back to Claude on Vertex by itself.

**Commit gate breach, not by this session.** A concurrent agent's sweep committed this order's
marketplace-naming files as `8fc06331d` (gateway script, already on `threews/main`) and `a71cc4425`
(lease, deploy script, worker, tests, package.json; local only). The owner decides whether those stand.

**The owner's sequence** (either deploy may land first; the lane is elected on a live probe every 15 min):

```sh
gcloud auth login && gcloud auth application-default login
# approve and commit the still-uncommitted files named in the order file, then:
npm run clean:worktrees -- --apply
npm run prep:worktree -- --apply
(cd /workspaces/.deploy-wt && npm run deploy:gcp:full)   # API: ships 53687d994 + d3074c1c8
git worktree remove --force /workspaces/.deploy-wt
npm run okx:bot:deploy                                    # bot: provision lane, clean build, deploy, verify
npm run okx:bot:gateway -- --verify --cli                 # prove the real CLI through the lane on production
curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[]|select(.name=="okx_chat_bot")'
```

## 2026-09-24 | orders 907, 911, 913, 914 | re-measured end to end; nothing on-chain, nothing paid, nothing deployed

One session ran all four open orders' Step 0 against production. Standing constraints for this
session, set by the owner's instruction and binding over the orders: no payment, no signature
of any kind (including the `--no-spend` authorizations), no on-chain listing write, no OTP, no
deploy, no push, and no commit of any file that names OKX until the owner approves it.

**907, chat bot.** The API half shipped: live API `c8f10f437` (`three-ws-api-00458-njs`)
contains `53687d994`, `d3074c1c8` and `f7f7da9b6`, and the agent-scoped path answers
`404 agent not found` instead of `No API route matches`. The bot host is unchanged:
`okx-chat-bot-00001-926`, beat 20 s old, `loggedIn: true`, `activeClients: 1`,
`daemonRestarts: 0`, instance rebooted 2026-09-22T13:44Z, no `providerLane` or `leaseHolder` in
the beat, Vertex still `403 Lightning dunning decision is deny`. `npm run okx:bot:deploy --
--dry-run` passes its live-API check and stops on `gcloud`, which is not installed here at all.
One owner step left: install and authenticate `gcloud`, then `npm run okx:bot:deploy`.

**911, relisting.** Step 0 PASS (seven forge/free rows listed, nine unlisted). Step 1 PASS:
four paid rows 402 with `accepts[0]` `exact`/`eip155:196` at 10000/50000/250000/250000, one entry
per rail and asset, free rows free, compliance probe PASS 20 with OKX's own parser, three local
copies identical, OKX suites 228/228. Steps 2 and 3 need the session: `onchainos` v4.6.2 was
installed from the release binary (sha256 matches the release `checksums.txt`; the release has
no `installer-checksums.txt`), and every agent read answers `session expired`.

**913, real payment.** Every unsigned leg green: `--dry-run` 3/3 (cases 1, 1d, 5d). Its captures
overwrote three committed evidence files with a narrower record, so they were restored from
git and the 2026-09-09 `--no-spend` evidence stands. `/api/okx/3d/health` now carries
`relayer_funded: true` (the `4e9ad0419` field is live). X Layer at block 71462665: buyer
`0x75d0…cf69` 0 USD₮0 / 0 OKB, seller `0x4022de2D…f402` 2.427731 USD₮0 / 0.839596 OKB, relayer
`0xe81DE501…415B` 0.02 OKB with nonce 0. The seller balance has not moved since 2026-09-09, so
no sale has settled on this rail since then. `--budget`: a clean run needs 1.08 USD₮0; with
the order's retry margin, 2.16 USD₮0 to the buyer on X Layer, plus 0.02 USDC on Solana for
case 7.

**914, audit.** Findings fixed: 16 legacy em-dashes in the two OKX test suites; the forge lane
tests broken by a stale `forge-store.js` mock (`9acf0cba2`, 18 tests); two unclassified studio
tools (`bfeca3aa1`). RUNBOOK §0.5 retitled so it no longer leads with the rival-daemon
command, with today's host state and `npm run okx:bot:deploy` as the ship path; CLI version line
updated. The 913 and 914 "never blocked" rows that still said `npm run okx:bot` now say to read
the Cloud Run host. Not fixed, outside this stream: 5 README-less directories flagged by
`audit:docs`, and about 25 failing test files unrelated to OKX. Approval status of #2632 was
not readable; the last reading is still 2026-09-09's `Listing rejected`.

**Owner actions, in order:**
1. Approve committing the uncommitted OKX-naming files from this session and the earlier ones.
2. Install and authenticate `gcloud`, then `npm run okx:bot:deploy` (preview with `-- --dry-run`).
3. Browser login for `claude@three.ws` (`onchainos wallet login --phase init`, open the URL,
   enter the emailed code), then run 911 Steps 2 and 3. That gives an on-chain
   `agent update --agent-id 2632` replacing the seven stored rows' descriptions, then
   `agent activate --agent-id 2632 --preferred-language en-US`, confirmed by the owner on the
   diff card.
4. Fund buyer `0x75d00a2713565171f33216e5aa2a375e076ecf69` with 2.16 USD₮0
   (`0x779ded0c9e1022225f8e0630b35a9b54be713736`) on X Layer (chain 196), plus 0.02 USDC on
   Solana to the buyer's Solana address, then approve the 913 gauntlet
   (`npm run okx:gauntlet -- --yes`), which settles 1.07 USD₮0 on X Layer to seller
   `0x4022de2D36C334E73C7a108805Cea11C0564f402` (cases 2, 2b, 3, 3i, 3r, 5a) and 0.01 USDC on
   Solana to the Solana payTo `wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU` (case 7).

## 2026-09-29 | backlog order 08 (907) | bot redeployed onto the lease and the free gateway lane; healthz ok; no inbound message yet

Owner instruction "finish them all" was the approval for `npm run okx:bot:deploy`. No `okx:bot`,
no local daemon, no `onchainos wallet login` in any phase, no API deploy, no push, no spend.

**Blocker found and fixed before the real run.** `--dry-run` was green through step [4] (gcloud ok,
clean worktree of HEAD, lane `missing` as expected, live API `f2081d946` contains `d3074c1c8`), but
the image itself could not have built: onchainos releases from v4.6.0 on ship no `install.sh` and no
`installer-checksums.txt` (both 404 on v4.6.3), and the Dockerfile's installer step used them. It
now downloads the release binary for the build platform and verifies it against the release's own
`checksums.txt` (`0b1335882`). Verified locally first (`onchainos-x86_64-unknown-linux-gnu: OK`,
`onchainos 4.6.3`), then in Cloud Build.

**Deploy.** `npm run okx:bot:deploy` exit 0.
- Step [3] provisioned the lane: user `106ec2ec-83a0-4f79-b350-a6b23fd986b4`
  (`marketplace-chat@agents.three.ws`), metering agent `55479fa8-13c6-44b3-a245-3156f2c836e5`,
  key `365d6994-...` minted into `okx-chat-bot-llm-gateway-token`, `three-ws@` granted
  `secretAccessor`; proxy `200` on `nvidia/nemotron-3-super-120b-a12b`, bot probe ok.
- Cloud Build `ea753445-ab27-4d1e-bcc9-659930a223f5` SUCCESS (onchainos 4.6.3 baked in, was 4.5.2),
  revision **`okx-chat-bot-00002-s4s`** serving 100%.

**Lease handoff, from the service logs (UTC):**
- 06:40:50 new instance boots, chain `vertex > anthropic-gateway`, health server up, then
  `waiting for the single-writer lease`: "`okx-chat-bot-00001-926` predates the single-writer lease
  and beat 11s ago".
- 06:41:13 `00001-926` gets SIGTERM, `daemon stopped` (0 restarts), `state snapshot saved`
  (7,121,505 bytes, reason SIGTERM), `bye`.
- 06:42:43 `single-writer lease acquired` (old beat 90 s quiet), 06:42:44 `state restored`
  (the same 7,121,505 bytes), 06:42:45 `workspace built` (briefing 10,068 bytes, 12 skills),
  06:42:46 `provider lane elected` vertex -> anthropic-gateway (`vertex=unauthorized
  anthropic-gateway=ok`), 06:42:58 `health changed` online / ok.
- No overlap: the new daemon started 90 s after the old one stopped. One `Uncaught signal: 6` at
  06:42:47 is the first daemon child being killed for the lane restart; `daemonRestarts` stayed 0.
- The restored session survived the onchainos 4.5.2 to 4.6.3 jump: `loggedIn: true`, no OTP.

**Heartbeat, `bot_heartbeat` row `okx-chat-bot`, 06:48:25:** 13 s old, `reason: online`,
`health: ok`, `ready: true`, `loggedIn: true`, `activeClients: 1`, `agentCount: 1`,
`daemonRestarts: 0`, `providerLane: anthropic-gateway`, `providerTransport: gateway`,
`providerChain: [vertex unauthorized, anthropic-gateway ok]`, `leaseHolder:
cloudrun:okx-chat-bot (okx-chat-bot-00002-s4s)#283fb2ec-...`. Lease row `okx-chat-bot:lease`
renewed 5 s earlier by the same holder.

**`/api/healthz`:**
`{"name":"okx_chat_bot","host":"cloudrun:okx-chat-bot (okx-chat-bot-00002-s4s)","hostDurable":true,"status":"ok","detail":"online (1 XMTP client(s), provider=claude, host=cloudrun:okx-chat-bot (okx-chat-bot-00002-s4s))"}`
The subsystem does not surface `providerLane`/`leaseHolder`; they are in the beat above.

**`npm run okx:bot:gateway -- --verify --cli`:** exit 0. Secret holds the active key; proxy `200`;
probe ok; `claude -p through the lane: OK {"turns":2,"result":"gateway-proof-mumbc703","isError":false,"durationMs":6851}`.

**`$OKX_BOT_URL/readyz`:** not readable from this workspace. Unauthenticated answers 403 (correct,
`--no-allow-unauthenticated`); the gcloud user identity token here carries a non-default OAuth
audience, which Cloud Run answers 401, and the account lacks `getOpenIdToken` to mint one for
`three-ws@`. No IAM was changed to get around it. The heartbeat is written from the same verdict
`/readyz` serves, and reads `ready: true`.

**A platform question, answered with real three.ws context (off-host).** The bot's own
`buildWorkspace()` staged into a throwaway HOME, the real `claude` CLI run in it with the exact
gateway env overlay against production. Question: a buyer wants a rigged character and a cheap
prop. Answer (19 s): Text to Rigged Avatar $0.50 at `/api/okx/3d/avatar`, Forge 3D Draft $0.01 at
`/api/okx/3d/forge-draft`, Text to 3D Model $0.01 at `/api/okx/3d/text-to-3d`, status via the free
Forge Job Status service. Every price and endpoint matches the briefing. Two flaws: it called the
$0.01 text-to-3d "even cheaper" than the $0.01 draft, and it wrote en-dashes because the briefing
only banned em-dashes. The briefing now bans both (`1f4f48313`); that ships on the next bot deploy.
This proves the context and the lane, not a reply on the host.

**No real inbound message has reached the bot since 2026-09-03.** The daemon's offline replay on
both boots reports `newest=2026-09-03T10:28:06Z`, `scanned=1`, `replayed=0`. Inbound chat on this
marketplace is job-scoped (`a2a-agent-chat` with a `jobId`, from a counterparty agent), and
`okx-a2a` quarantines anything else into `invalid-xmtp-messages.sqlite`, so a raw XMTP DM from a
fresh key would prove nothing. The honest way to produce one needs a counterparty agent in a
**different** OKX account: any agent on `claude@three.ws` would be loaded by `get-my-agents` next to
#2632, so a second daemon for it on that account is a second writer on #2632's identity. Two real
sources, both owner-held: (a) OKX's own chat test during listing review, triggered by the 911
resubmission once the owner's login completes; (b) a buyer agent registered under a second OKX
account, publishing a task that names #2632 and sending one chat line.

**Other agents' work observed, not touched.** A concurrent `deploy:sniper` run wrote into the same
scratch log path and failed on its own (`agent-sniper-00034-7zp` did not listen on 8080).

**907 stays open.** DoD lines 1 and 3 need a real inbound message and a reply on the host. When one lands, the daemon logs `queued ai-dispatch command=... job=...` then `ai-dispatch command completed`; read them with `gcloud logging read 'resource.labels.service_name="okx-chat-bot" jsonPayload.line:"ai-dispatch"' --freshness=1h`.

## 2026-11-14 | order 913 (WO-04) | Step 0 re-proved against production; still parked on funding plus a fresh wallet login

Nothing signed, nothing paid, nothing deployed. Every leg that needs no signature was re-run live:

| Check | Result |
| --- | --- |
| `GET /api/okx/3d/health` | `ok: true`, six subsystems ok, `payment-rail` `settleable: true`, `relayer_funded: true` |
| `npm run okx:three-copy` | PASS, module == live == listing (7 rows); on-chain not compared (logged out) |
| Unpaid `POST /api/okx/3d/text-to-3d` | 402, `accepts[0]` `exact` / `eip155:196` / 10000 / USD₮0, `payTo` `0x4022de2D…f402` unchanged |
| `okx-3d-services` + `okx-forge` suites | 83/83 |
| `npm run okx:gauntlet -- --dry-run` | 3/3 exercised PASS (1, 1d, 5d), 11 skipped, 0 settlements; captures went to `/tmp/okx-gauntlet-dry-run`, committed evidence untouched |
| `--budget` | $1.07 settles from a $1.08 float; buyer SHORT by 1.08 |

X Layer block 75854189: buyer `0x75d0…cf69` 0 USD₮0 / 0 OKB (nonce 1), seller 2.427731 USD₮0 /
0.839596 OKB (nonce 3), relayer 0.02 OKB (nonce 0). Nothing has moved on this rail since
2026-09-09. The buyer's Solana account still has no token account for case 7. `onchainos` is now
v4.6.9 and `loggedIn: false`, so `--no-spend` (5b, 5c) and every paid case need the browser login
first.

Owner message sent with both gates batched: the browser login for `claude@three.ws`, and the
funding legs in `prompts/okx-ai/e2e-evidence/FUNDING-REQUEST.md` (2.16 USD₮0 to the buyer on X
Layer chain 196, plus the case 7 Solana leg). GO/NO-GO for OKX-05: **NO-GO on settlement
evidence, unchanged**; no real settlement has landed. Order 913 stays on disk.
