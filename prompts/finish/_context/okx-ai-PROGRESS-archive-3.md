# okx-ai-PROGRESS, archive 3 (2026-07-10 to 2026-09-02)

Older entries moved verbatim out of [okx-ai-PROGRESS.md](okx-ai-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [okx-ai-PROGRESS.md](okx-ai-PROGRESS.md), never here.

## 2026-09-02, Work Order 04: gauntlet rebuilt for the forge listing, one false promise removed, funding is the only gate

Fourth session on this stream today. WO-04 is the funded end-to-end payment test, so the
paid half stays gated; everything that does not move money is finished, and the harness that
runs the moment funding lands was rebuilt, because it would not have worked.

### The gauntlet was buying a listing that no longer exists

`scripts/okx-e2e-gauntlet.mjs` was written against the pre-2026-08-22 line-up: plain-JSON
REST POSTs to `text-to-3d`, `avatar` and `fbx-export`, reading a `model_url` straight out of
a 200. The listed product has been seven A2MCP rows since then. A funded run would have
signed a real authorization, sent an MCP JSON-RPC call the old code never built, and failed
on the first case with the money already committed. Rewritten around what OKX actually
sells:

- Every paid case now does the real buyer loop: unpaid `tools/call forge_3d` to 402, sign
  through the TEE wallet, replay, take the job id, poll the FREE `forge_status` tool to
  `done`, then verify the GLB bytes. Generation is asynchronous, so a case that stopped at
  the 200 would have proved nothing.
- Four paid rows covered individually (`forge-draft` 0.01, `forge-standard` 0.05, `forge-hd`
  0.25, `forge-image` 0.25), none "covered by" another.
- **Case 3r keeps the rigged-artifact assertion alive.** The listed forge rows deliver a
  static mesh by design, so the work order's "flagship ships a skeleton and skin weights"
  check would have quietly evaporated with the relisting. It now buys the back-burner
  `avatar` row ($0.50), which is the row that actually rigs, and verifies bones and non-empty
  skin weights with `scripts/okx-verify-glb.mjs --rigged`.
- **Case 1d is new and it FAILS against production**, on all four paid rows: a spec-compliant
  MCP client (`Accept: text/event-stream` + `MCP-Protocol-Version`) is answered **402 on
  `initialize` and `tools/list`**, so it can never read a tool description or a parameter
  schema. That is the sibling session's discovery-paywall fix, already in the tree with unit
  tests, not yet deployed. The unit tests prove the fix; case 1d is the production-side proof
  that it has not shipped, and it will flip to PASS on the deploy. Payment is unaffected:
  `tools/call` is never a discovery method.
- **A budget preflight that refuses to start.** `--budget` prices a run off the catalog
  module, and a paid run reads `balanceOf(buyer)` first and exits rather than half-running.
  A half-funded run burns the cheap cases and then fails the dear ones on balance, which
  reads exactly like a rail defect and is not one.
- Case 5d's assertion was rewritten. It judged "no tool ran" by string-matching the response
  body, and the 402 body legitimately carries the bazaar discovery block whose worked example
  contains a specimen job id. It now reads the structured result and the receipt header.

Dry run against production: **1, 5d and 7 PASS, 1d FAILS as described**, everything else
reports "dry run" as designed. Evidence in `prompts/okx-ai/e2e-evidence/`.

### Defect found and FIXED: we told paying buyers a failed job was free to retry

`shapePoll()` in `api/_mcp-studio/studio-shape.js` is shared by the free ChatGPT surface and
the paid OKX rows. Its failed-job message was written for the free lane and served verbatim
to both:

> 3D generation hit a snag upstream, it costs nothing to try again.

On the OKX rows that is false about the buyer's money. Settlement happens when the lane
accepts the job (`anySuccess` in `api/okx/3d/[service].js` judges the submit, which returns
`pending` with a job id), so a generation failure after acceptance **has been charged**, and
a retry is a new paid call. Measured, not assumed: over the 30 days to today, **255 of 10,278
`forge_creations` rows (2.5%) ended `failed`** after acceptance, so this was reaching roughly
one in forty paying buyers.

`shapePoll` now takes `paid`, the OKX surface passes it, and the free lane's wording and
response shape are byte-for-byte unchanged (its shape is the published custom-GPT Action
contract, byte-guarded against its submission source, so a new key there belongs to that work
stream, not to this fix). The paid message states the settlement model instead, and carries
`retryBackends`, the alternate engines `/api/gpt-forge` already names on a terminal failure,
so "an error the buyer can act on" now means something the buyer can act on. Two regression
tests in `tests/api/okx-forge.test.js`; the free-surface tests in `tests/api/3d-studio.test.js`
still pass untouched, which is the point.

`docs/okx-marketplace.md` carried the same false claim ("Generation failures are free to
retry"). Corrected in both places it appears, with the measured failure rate stated. The
on-chain listing copy and every catalog description already said the accurate thing ("You pay
only when a job is accepted"), so the doc and the runtime message were the outliers, not the
promise. **This is the work order's "fix the code or fix the promise" release blocker, and
both halves are done.** Ships on the same owner-gated deploy.

Also fixed: `scripts/okx-listing-payload.mjs --delta` died inside `JSON.parse` when run
without its stdin pipe, which reads as a broken script rather than a missing pipe. It now
names the pipe it wants.

### Verified live today (not re-deriving the sibling sessions, adding to them)

- Wallet **logged in** as `claude@three.ws`, buyer address confirmed unchanged at
  `0x75d00a2713565171f33216e5aa2a375e076ecf69`. The OTP owner action from every earlier
  version of the funding request is discharged.
- Three-copy check PASS (module 16 rows / 7 listed == live == listing submission), and
  `--delta` against the live `service-list` is **7 updates, 0 creates, 0 deletes**: the
  on-chain listing is exactly our catalog.
- Balances at block 69607441: buyer **0 USD₮0, 0 OKB**; payTo 2.427731 USD₮0, 0.839596 OKB;
  relayer 0 USD₮0, 0.02 OKB. Gas priced at 0.02 gwei, so one settle costs 0.000002 OKB and
  the relayer covers roughly 10,000 of them. The buyer needs no OKB.
- The buyer's Solana account is `9PirGw9wVLLNFgVyjgAt5jvuFQwJ3pYUBWt9n3vZfnyc` and its Base
  account is the same EVM address; both are empty. The Solana accept carries a `feePayer`, so
  case 7's real paid legacy leg needs the fee and no SOL.

### Blocked, and it is exactly one thing

**Funding the buyer.** `prompts/okx-ai/e2e-evidence/FUNDING-REQUEST.md` is rewritten against
the current catalog: **5.0 USD₮0 on X Layer (196) to `0x75d0…cf69`**. A clean run settles
$1.07 and needs a starting float of **$1.32** (the floor, not the sum: verify refuses any
authorization above `balanceOf`, including the ones designed to be rejected); the rest is the
fix loop. The money largely returns, because the buyer pays our own merchant wallet, so the
net platform cost of a full run is the gas. `payTo` holds 2.427731 USD₮0 and could fund it
without an external transfer, but its key is in Secret Manager and `gcloud` auth is expired
on this box, so either route is an owner action.

### Next

1. Owner funds the buyer. Then `node scripts/okx-e2e-gauntlet.mjs --yes` runs cases 1, 1d, 2,
   2b, 3, 3i, 3r, 5a, 5b, 5c, 5d, 6, 7 and finally case 4 (on-chain verification of every
   settlement the run produced), with the fix loop per phase 3.
2. Case 1d stays red until the pending deploy ships. That deploy now carries three fixes from
   three sessions today: the discovery paywall, the x402 v1 header string, and this session's
   failed-job wording.
3. `docs/okx-marketplace.md` gets its "verified behavior" section, and its "Not yet
   demonstrated end to end" note comes out, when the first tx hash exists. Not before.

---

## 2026-09-02, Work Order 07: independent audit, docs closure, memory; the 402 was still speaking x402 v1

Third session on this stream today. Ran WO-07 against production without reading the other
two sessions' conclusions first, so the overlap below is independent corroboration, not a
copy. Where they got there first I verified their claim and moved on rather than redoing it.

### Re-verified today, live, and it held

- **Approval state: `approvalDisplayStatus: 2`, `approvalLabel: "Listing under review"`,
  `status: 2` (not listed), `soldCount: 2`.** Day 6 since the 2026-08-27 resubmission. Read via
  `agent get-my-agents`; `get-agents` no longer carries the field, and `service-list`'s
  `agentInfo.approvalStatus: 3` plus its stale `approvalRemark` are not the verdict. **Branch
  executed: still pending.** Nothing submitted, no on-chain write attempted, no daemon left
  polling.
- **Four-way catalog identity**, checked by diffing the payloads rather than eyeballing them:
  `catalogIndex()` in `api/_lib/okx-catalog.js` is byte-identical to live
  `GET /api/okx/3d/catalog` (`JSON.stringify` equality, not a field spot-check), and all 7
  listed rows match `agent service-list` on name, price, endpoint and both description parts.
  `validateCatalog()` true.
- **402 on the cheapest and the flagship**, sent with real MCP client headers: `forge-draft`,
  `forge-standard`, `forge-hd`, `forge-image` all answer 402 with `accepts[0]` =
  `{scheme:"exact", network:"eip155:196"}` at their own atomic amounts (10000 / 50000 / 250000
  / 250000), asset USD₮0, payTo `0x4022de2D…f402`, `extra.decimals: 6`. Solana and Base follow.
  `access-control-expose-headers` carries `PAYMENT-REQUIRED, PAYMENT-RESPONSE`, per spec §1.1.
- **Free lane honest.** `/health` 200 with all six subsystems ok (`payment-rail settleable:true`,
  block 69606444); `getting_started` and `forge_status` served free on paid rows; a bogus job id
  answers `unknown_job` rather than an exception.
- **All 8 back-burner REST rows** answer GET 200 with a descriptor and unpaid POST 402, at
  exactly the prices `docs/okx-marketplace.md` quotes (0.01 / 0.30 / 0.30 / 0.25 / 0.50 / 0.10 /
  0.02 / 0.10). The doc's back-burner table is accurate line by line.

### Defect found and FIXED: our 402 named an x402 v1 header on a v2-only rail (`7e1b931ea`)

Every OKX service answered an unpaid call with `"error": "X-PAYMENT header is required"`, the
platform-wide default from `api/_lib/x402-spec.js`. That is the x402 **v1** header name. OKX
implements **v2**, whose buyer header is `PAYMENT-SIGNATURE`, and per this repo's own spec
research the OKX SDK's `extractPayment` reads only `payment-signature` with no v1 fallback. So
on the one surface whose 2026-07-04 rejection was literally "not integrated with the OKX Agent
Payments Protocol standard", the single string a reviewer is guaranteed to read named the
version we do not implement. Our handlers accept both header names on the wire, so the message
now names both, v2 first: `X402_HEADER_ERROR` in `api/_lib/x402-xlayer-okx.js`, threaded into
every forge row's challenge and the Identity Studio's. The platform-wide v1 default is
untouched, because the Solana and Base rails genuinely do read `X-PAYMENT`. Regression test:
`tests/api/okx-402-dialect.test.js` (4 cases, green). **Ships on the next deploy, which is
owner-gated**; it is one `npm run deploy:gcp:full` behind the same deploy that carries the
discovery fix from the sibling session.

### Replay and cross-service payment, proven live without funds

Case 5a (replay a *settled* proof) still needs a funded payment and stays blocked, but two of
its neighbours are provable today and were:

- A forged EIP-3009 proof sent twice to `forge-draft` was rejected both times at verify
  (`"EIP-3009 signature does not verify for authorization.from"`), no job started either time.
- The same draft-priced proof replayed against the flagship answers **`"signed payment amount
  10000 is below required 250000"`**, so a cheap challenge cannot buy an expensive row. That is
  case 5b, closed from evidence instead of intention.

### Docs closure (Part 2), each item verified rather than assumed

- `specs/okx-agent-payments.md` §1.1 matches the live challenge field for field, including the
  CORS expose header and the `payTo` correction note. No stale claim found.
- `docs/okx-marketplace.md`: every curl in it was executed. Free lane, poll example and the
  back-burner table are correct; the "not yet demonstrated end to end" note is still true and
  stays until a tx hash exists.
- **`docs/agent-identities.md` and `docs/api-reference.md` both linked
  `okx-marketplace.md#agent-identity-studio-150-per-identity`, an anchor that stopped existing
  when the 2026-08-22 rebuild moved the Identity Studio under "Back burner".** Two dead links on
  live doc pages; repointed to `#back-burner`.
- **`data/pages.json` still described `/docs/okx-marketplace` as "the Agent Identity Studio
  flagship plus micro-priced text-to-3D, rigging, retargeting, pose and export endpoints".**
  That description feeds the sitemap, `llms.txt` and `features.json`, so the listing we no
  longer sell was what crawlers and LLMs were told we sell. Rewritten around the forge line-up;
  `npm run build:pages` regenerated all five artifacts and validated the changelog.
- `STRUCTURE.md` rows for the OKX surface and the chat-bot worker are current.
  `workers/okx-chat-bot/README.md` exists. `data/changelog.json` carries 14 OKX entries, well
  formed, including the 2026-08-22 rebuild announcement; no entry claims a settled payment.
- `npm run audit:docs`: 1 finding across 1474 files, and it is another stream's untracked
  `docs/nvidia-forum-browser-digital-human.md`. Nothing on this stream.

### Corrected: `okx-ai-00-CONTEXT.md` said the 3D category was empty

It is not, and that claim was steering strategy. The same query that returned **1** result on
2026-07-06 returns **112** today; the category now holds real sellers with real volume (#6731
Agent Reel 576 sales, #5331 BrandCanvas 98, #6180 KULT 66, #5063 "3D Element" 18 with a $0.02
"Quick 3D Model" row). The section now leads with the live pull, keeps the July reading as
labelled history, and says to re-pull before quoting. What survives: volume sits on cheap
sharply-scoped rows, and nothing found sells a rigged animation-ready GLB with an AR link.

### Hygiene

`npm run check:rules` clean on every path touched. No TODOs, no banned dashes, no scratch files
from this stream; nothing this stream owns sits in the repo root. (The root does hold other
streams' untracked scratch: three `*_tweets_*.json` files and `mobile-final.png`. Left alone,
they are not ours and not committed.)

**Agent-memory file written** at `~/.claude/projects/-workspaces-three-ws/memory/okx-ai-agent-2632-listing.md`
and indexed in `MEMORY.md`: agent state, the 7-row line-up, where the runbook and evidence
live, the wallet roles, and the five CLI traps that each cost a session.

### Owner action, unchanged and still the only one

Fund buyer `0x75d00a2713565171f33216e5aa2a375e076ecf69` on X Layer (chain 196) with about $5 of
USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`. Re-read live today at block 69606531: buyer
0 USD₮0 / 0 OKB, seller `0x4022de2D…f402` 2.427731 / 0.839596, relayer `0xe81DE501…415B`
0 / 0.02. That unblocks WO-04's settled payment and nothing else; it does not gate the review.

---

## 2026-09-02, RUNBOOK repaired: the daily status check had been broken since the CLI moved its approval fields

Companion to the "Work Order 05 dispatched" entry below, same day, different session. That
one read the state and swept production; this one fixed the operator document both of them
read, which had drifted far enough that following it produced wrong answers.

**The document was lying in four places. Each was re-derived from a live source, not edited
from memory.**

1. **Section 1's daily status check did not work.** `onchainos agent get-agents --agent-ids
   2632` on v4.5.2 still returns the agent, but its payload no longer carries
   `approvalDisplayStatus`, `approvalLabel`, `status` or `statusLabel`. The scripted
   one-liner the runbook told an operator to run dies with `KeyError: 'approvalLabel'`,
   which reads like a broken CLI or an expired session and is neither. `get-my-agents`
   carries all four. Section 1 is rewritten around it and now records the trap, plus two
   look-alike fields that must NOT be read as approval state: `service-list`'s
   `agentInfo.approvalStatus` is a different enum (it read `3` today while the display
   status read `2`), and its `approvalRemark` still quotes the 2026-07-26 rejection verbatim
   in the middle of an open review. `agentInfo.updatedAt` is an online heartbeat, not a
   listing event: it moved 1 ms after `lastOnlineTime` today, so "updated today" means the
   daemon checked in, nothing more. Verified working replacement:
   `Listing under review | status not listed | sold 2`.
2. **Section 2 documented drift that no longer exists.** It described the live listing as
   the 7 old REST rows against an 11-row module, "expected, because WO-05 has never run".
   The 2026-08-27 update closed that. Re-pulled `service-list` and compared it row by row to
   `api/_lib/okx-catalog.js`: 7 rows, ids 39975 to 39981, every name and endpoint matching,
   all `A2MCP` on chain 196 quoting USD₮0. Section retitled "Drift resolved" and now carries
   the real table plus the note that 9 further rows are deployed, payable and deliberately
   `listed: false`.
3. **Section 3 claimed funding gates the resubmission.** "Only then does WO-05 unlock" is
   false and was a live tripwire: WO-08 says plainly that a listing needs no settled payment
   to be submitted, and the 2026-08-27 resubmission went out with all three wallets empty.
   What funding gates is WO-04's first real settlement. Corrected in place rather than
   deleted, so the next reader sees the claim was wrong and why. Balances re-read live at
   block 69606689 (`rpc.xlayer.tech`, direct `balanceOf` + `eth_getBalance`): buyer
   `0x75d0…cf69` 0 USD₮0 / 0 OKB, seller `0x4022de2D…f402` 2.427731 / 0.839596, relayer
   `0xe81DE501…415B` 0 / 0.02. Identical to 2026-08-01 and 2026-07-23. Live `payTo` re-probed
   across all four paid rows: no drift.
4. **Section 7's "probe this before any submission" command probed the wrong endpoint, with
   the wrong headers.** It curled `identity-studio`, which has been `listed: false` since the
   2026-08-22 rebuild, so the check a submission depended on was aimed at a row no reviewer
   sees. Replaced with a loop over the four listed paid rows carrying the two MCP client
   headers, and an explanation of why a bare curl is a false green here. Verified today: all
   four answer 402 with `eip155:196` leading, `GET /forge-status` answers 405.

Also refreshed: the CLI version line (v4.4.0 to the actual v4.5.2), section 4's confirm step
and section 5's remark-capture command (both pointed at the moved fields), and section 5's
pointer to the retired WO-05, now WO-08.

`npm run check:rules -- --paths prompts/finish/_context/okx-ai-RUNBOOK.md` passes; no banned dashes.

### One thing measured but not resolved, for whoever picks this up

`soldCount` reads **2** on an agent that has never had a settled payment on our rail. It was
already 2 on 2026-08-27, before the current listing existed, so it is not a forge sale, and
the seller wallet's 2.427731 USD₮0 predates it too. Nobody has established what OKX counts
there. Do not cite it as revenue until someone reconciles it against a tx hash.

### State

Under review, day 6. Nothing to submit, nothing on-chain attempted, no funding needed to
keep waiting. The pending discovery fix in `api/okx/3d/[service].js` (another session's, see
the entry below) is the only code between here and the next deploy.

---


## 2026-09-02, Work Order 05 dispatched: RETIRED at the gate, listing verified under review, nothing submitted

Asked to execute `okx-ai-05-relisting-resubmission.md`. **It was not executed, deliberately, and
the file now carries a retirement banner** so the next session does not repeat the dispatch.
Running it would have been destructive: WO-05 submits the 11-row `identity-studio` catalog,
every row of which is `listed: false` since the 2026-08-22 forge rebuild, so an `agent update`
built from it deletes seven live forge rows and replaces them with a retired set.
`okx-ai-08-forge-relisting.md` is the live successor and already ran on 2026-08-27.

### Agent #2632 state, read live today

| Field | Value |
|---|---|
| `approvalDisplayStatus` / `approvalLabel` | **2 / "Listing under review"** |
| `status` / `statusLabel` | 2 / not listed |
| `soldCount` | 2 |
| Services on the listing | 7 (ids 39975 to 39981), the forge line-up |
| `approvalRemark` | the 2026-07-26 rejection text, carried forward and stale; it is not a new verdict |

Under review means there is nothing to resubmit: `activate` on an agent already at
`approvalStatus: 2` is where the identity skill says to stop. Agent #2632 was not updated,
not activated, not deactivated. No on-chain write of any kind was attempted this session.

### Reviewer sweep, live against production (`ad7b54c16`, revision `00404-ph7`)

- All four paid rows answer **402** to an unpaid `tools/call forge_3d` sent with real MCP
  client headers, `accepts[0]` = `{scheme:"exact", network:"eip155:196"}` at the row's own
  amount (`10000` / `50000` / `250000` / `250000`), asset USDT0
  `0x779ded0c9e1022225f8e0630b35a9b54be713736`, payTo `0x4022de2D36C334E73C7a108805Cea11C0564f402`.
  Each rail appears exactly once; Solana and Base follow X Layer.
- `catalog` and `health` GET 200; all six health subsystems ok, `payment-rail settleable:true`
  at block 69606537. `forge_status` and `getting_started` served free on every row.
- `node scripts/okx-three-copy-check.mjs`: **PASS** (module == live == submission payload).
- **Fourth copy checked, which the three-copy script does not cover:** the seven rows actually
  stored on-chain, pulled with `agent service-list`, are byte-identical to the module across
  `serviceName`, `serviceDescription`, `endpoint`, `serviceType` and `fee`. Zero drift between
  what a reviewer reads on the listing and what our endpoints serve.

### One defect found, and it was already being fixed in this worktree

A real MCP client cannot complete a handshake with any OKX row: `initialize`, `tools/list`,
`resources/list` and `prompts/list` all answered **402**, including on the free `forge-status`
row. `allowFree` scoped free discovery to `!isMcpProtocolClient(req)`, a rule that belongs on
the surfaces with an OAuth story and paywalls discovery on this one. Every prior verification
used curl, which sends neither `mcp-protocol-version` nor `Accept: text/event-stream`, so the
sweeps all passed while a reviewer with a real client saw a server that charges to say hello
and a free service that charges to list its tools. The tool schemas are the parameter details
the rejection email asked for, and they were unreachable.

A concurrent session in this worktree landed the fix in `api/okx/3d/[service].js` while this
sweep was running (free discovery for every caller, plus a `sellsNothing` guard so a free row
never quotes a null amount). Confirmed present in the tree, **not yet deployed**: production
still answers 402 on `initialize`. Left to that session rather than edited twice.

### Next

Nothing to submit while the review is open. Watch with `onchainos agent get-my-agents`
(RUNBOOK section 1, not `get-agents`, which no longer carries the approval fields on v4.5.2).
On a rejection, the discovery fix above ships first, then a resubmission through WO-08.

---

## 2026-08-22, Listing REBUILT around the forge (owner directive): new A2MCP line-up shipped in-repo

**Owner directive this session:** put the current submission on the back burner and ship
something completely different. Everything the "three.ws 3D Studio" custom GPT does for a
ChatGPT user, an OKX.AI agent should be able to do against three.ws/forge, over MCP or
x402, whichever is most likely to be approved. Answer: both, because on this marketplace
they are the same thing. A listed row is `serviceType: A2MCP`, and the 2026-07-04 rejection
was specifically that our A2MCP service was not integrated with the OKX Agent Payments
Protocol. So every listed row is now a genuine MCP Streamable HTTP server whose paid tool
is genuinely x402-gated on the X Layer rail.

### The new listing (7 rows, down from 11; nothing on-chain has been submitted yet)

| Service | Fee | Endpoint | Tool |
|---|---|---|---|
| Forge 3D Draft | 0.01 | `/api/okx/3d/forge-draft` | `forge_3d` |
| Forge 3D Standard | 0.05 | `/api/okx/3d/forge-standard` | `forge_3d` |
| Forge 3D HD | 0.25 | `/api/okx/3d/forge-hd` | `forge_3d` |
| Forge 3D from Image | 0.25 | `/api/okx/3d/forge-image` | `forge_3d` |
| Forge Job Status | 0 | `/api/okx/3d/forge-status` | `forge_status` |
| 3D Studio Service Catalog | 0 | `/api/okx/3d/catalog` | (free REST) |
| 3D Studio Health Status | 0 | `/api/okx/3d/health` | (free REST) |

Design decisions, each deliberate:

- **Four paid rows for one capability.** OKX prices a service, not a parameter, so a
  quality tier has to be its own row to carry its own fee. Buyer code stays identical:
  every endpoint exposes the same `forge_3d` / `forge_status` / `getting_started` tools.
- **`forge_status` is free and lives on every endpoint**, and is also its own listed row.
  The old REST rows had no free poll on our OKX surface at all: a buyer got `queued` and
  was sent to `/api/forge?job=`, a different, unlisted host. That is fixed.
- **Buyers get the GPT payload.** `glbUrl`, `previewImageUrl`, `viewerUrl` and the
  device-aware `arUrl`, because "put it in the user's actual room" is the part that sells.
  The GPT route and the OKX tools now shape responses through ONE module
  (`api/_mcp-studio/studio-shape.js`), so the two fronts cannot drift.
- **Back burner, not deletion.** Identity Studio and the eight single-capability REST rows
  carry `listed: false`. They stay deployed, tested and payable; `catalogIndex()` publishes
  them under `unlisted` rather than hiding endpoints that answer real 402s; and
  `scripts/okx-listing-payload.mjs` builds the submission from listed rows only, so a
  `--delta` run turns each stale live row into an `operation: delete`.
- **The age-13+ content gate now runs on the OKX surface too**, before any generation
  starts, so a refused prompt can never settle.

### Fixed while building (real defect, both surfaces)

`accepts[]` advertised the X Layer rail **twice**. `paymentRequirements()` already emits it
when it is configured, and the endpoint prepended it again so it would lead. Harmless to a
payer, but it is the first array a reviewer reads. `mergeAccepts()` in `api/_mcp/auth.js`
now keeps the first occurrence and drops later twins; Identity Studio inherited the fix.

### Verified this session (no network, no chain)

- `validateCatalog()` passes, and every listed row is inside OKX's limits: name 5 to 30
  display columns, both description parts under 200.
- Listed descriptions carry no example prompt, no link and no tech-stack name, per
  `.agents/skills/okx-agent-identity/references/invariants.md`. A test now enforces it.
- Unpaid `tools/call forge_3d` on all four paid endpoints answers 402 with `accepts[0]`
  = `eip155:196`, `scheme: exact`, the row's own atomic amount, asset `0x779ded…713736`,
  and at least one non-X-Layer rail behind it. Nothing generates on an unpaid call.
- Free `getting_started` and `forge_status` are served with no payment on every endpoint.
- `node scripts/okx-listing-payload.mjs` emits exactly the 7 rows above.
- `npx vitest run tests/` : 25037 passed. The one failure,
  `tests/multiplayer-server-boot.test.js`, is a Colyseus boot test with no path to any file
  touched here.

### Audit pass, same day (owner: "audit it and improve it as much as possible")

Four real defects found and fixed, each with a regression test in `tests/api/okx-forge.test.js`:

1. **MCP clients got a 401, not a 402, on every OKX endpoint.** The shared auth answers an
   OAuth-capable client (`Accept: text/event-stream` or `mcp-protocol-version`) with 401 +
   `WWW-Authenticate: Bearer` so claude.ai can discover OAuth. A spec-compliant MCP client
   sends exactly those headers. The OKX buyer flow is explicit: "if it is not 402, return the
   body directly." So a real A2MCP client calling a paid tool unpaid was handed a status it
   could not pay, and a reviewer probing with one saw no payment integration at all. **This
   is a strong candidate for the actual 2026-07-04 rejection cause**: every prior
   verification used curl, which never sends those headers. `paymentStatus: 402` is now
   forced on every OKX A2MCP service (forge rows AND Identity Studio), and the
   `WWW-Authenticate` hint is dropped there.
2. **`forge-hd` overcharged.** The generator hold-gates its high tier; the lane client
   silently degraded a refused high job to standard. A buyer paid $0.25 for HD and got a
   standard mesh. The HD row now submits operator-funded (internal seed, same as the custom
   GPT) with `strictTier: true`, and refuses with `tier_unavailable` BEFORE settlement if the
   HD lane will not take the job. `charged: false` is stated in the error.
3. **No shareable link.** The lane records a `forge_creations` row on submit and every poll
   frame carries `creation_id`; nothing surfaced it. Done responses now carry `pageUrl`
   (`https://three.ws/m/<id>`: viewer, AR, download, embed, share, comments).
4. **Text content only named the GLB.** Most buying agents relay tool text verbatim, so the
   viewer, AR and page links were invisible to their humans. Every link is now on its own
   line in the text; pending frames carry `poll_arguments` to copy into `forge_status`, and
   the status tool recovers the title from the job's own prompt when none is passed.

Also fixed in passing: the GET discovery challenge quoted the shared default price beside the
real one (two amounts for one rail). `handleSse` now takes the list price.

**Production observation, not fixed here:** a real draft submit to `/api/gpt-forge` on
2026-08-22 took 156 s to answer `429 busy` while `/api/okx/3d/health` read all-green in
0.8 s. The health probe reads the generator's static tier matrix, not its acceptance
latency, so it cannot see a saturated lane. From inside `forge_3d` that call would have hit
the 90 s client timeout and surfaced as `timeout` with `retry_after`, which is honest but
slow. **Root-caused and fixed the same day.** Image-to-3D (no paint step) answered in 3.7 s, so
the hang was the text-to-image paint ladder: Vertex Imagen leads it with a 90 s timeout,
NIM follows with 60 s, and nothing bounded the ladder as a whole (90 + 60 + throttle = the
156 s → 429). None of the hung submits ever created a `forge_creations` row, which is what
placed the stall before job creation. `api/_mcp3d/text-to-image.js` now runs the ladder on
one shared budget (`TEXT_TO_IMAGE_BUDGET_MS`, default 60 s): a lane with a fallback behind
it is capped at max(25% of budget, 60% of what is left), a lane with under 10% left is
skipped, and exhaustion is a fast retryable `rate_limited`. Regression test:
`tests/text-to-image-budget.test.js`. Still open: the health probe cannot see a saturated
lane because it reads the static tier matrix.

### 2026-08-27, deploy loop: three more blockers cleared, hang measured down from "never" to a bounded answer

- **Signed in as `claude@three.ws` on the owner wallet (`0x75d0…cf69`).** `onchainos` v4.5.2
  installed and checksum-verified; login is browser-based now (`--phase init` mints a URL,
  `--phase poll` completes it), not an emailed code.
- **Live listing actually has 8 services, all pointing at `/api/mcp-3d`**, and `soldCount` is
  2. The delta is 8 deletes / 7 creates; `validate-listing` on the 7 creates: `pass: true`,
  no findings. Diff card rendered; the on-chain write is waiting on the owner's confirm.
- **Two `main` breakages found while deploying, both from other agents, both fixed here:**
  a duplicated `fmtPctPoints` in `src/claim-wallet.js` failed every Vite build (`9ca79294a`),
  and the `metaplex-agent-mcp` workspace was added without a lock update so `npm ci` failed
  every Cloud Build (`67bb2ada7`).
- **The hang had a third layer.** With the paint ladder AND the reference step bounded, live
  text submits answered 429 in 101-110 s: the art-director ran watsonx (20 s cap) then the
  whole LLM chain (another 20 s) before painting. One 15 s deadline now (`add00dab5`), and
  `TEXT_TO_IMAGE_BUDGET_MS=40000` set on the Cloud Run service (revision `00394`), so the
  worst case is director 15 + paint 40 + submit ~4.
- Reviewer sweep on the deployed build: every paid row 402 with `eip155:196` first and
  `PAYMENT-REQUIRED`, MCP headers included; `forge-status` GET 405; `/health` carries
  `submit-latency`; three-copy PASS; `smoke:prod` 724/724.

### 2026-08-27, SUBMITTED: agent #2632 updated on-chain and sent for review

- `onchainos agent update --agent-id 2632`: description replaced, 8 stale services deleted,
  7 forge/free services created. **tx `0xb4b2f51dc34d4c8ed6adc2cfb55b0e21e2a6a29d787c02a8a9ca110e178415ba`**
  (X Layer, chain 196). New service ids: 39975 Forge 3D Draft, 39976 Forge 3D Standard,
  39977 Forge 3D HD, 39978 Forge 3D from Image, 39979 Forge Job Status, 39980 3D Studio
  Service Catalog, 39981 3D Studio Health Status. `service-list` confirms exactly those 7.
- `onchainos agent activate --agent-id 2632 --preferred-language en-US`: the `activate` leg
  echoed the stored 2026-07-26 rejection (`approvalStatus: 5`), then `submitApproval`
  returned `approvalStatus: 2, success: true`: **under review**.
- Post-update hook run: `okx-a2a agent refresh --json` (agentCount 1, unchanged).
- Two CLI facts for the next session: `agent update` requires `endpoint` on delete entries
  (payload script fixed, `fa69ac85b`), and `onchainos` needs the `okx-a2a` daemon
  (`npm i -g @okxweb3/a2a-node`, then `okx-a2a daemon start`) before any write.
- Watch: `onchainos agent get-agents --agent-ids 2632` until the approval state moves. A
  rejection reason arrives by email to `claude@three.ws`; `approvalRemark` stays empty.

### 2026-08-27, later: the lane is back (deploy `8f16c071b`)

Root cause of "every text submit ends in 429" was two dead providers, not the budgets: Vertex
is billing-denied project-wide (`403 Lightning dunning decision is deny`, owner item) and the
NIM `flux.1-schnell` endpoint stopped answering entirely, while the director's free chat rungs
named models that no longer exist (Llama 3.x: 404 on Groq, 410 end-of-life on NIM as of
2026-08-26). Fixes: NIM lane moved to `flux.1-dev` (serves in ~5 s, needs steps >= 5 and a
cfg_scale), Groq on `qwen/qwen3.8-27b`, NVIDIA on `nemotron-3` with thinking disabled.
Measured on production after purge: text submits accepted in **3.3 s and 8.2 s** (HTTP 200,
real job ids), from 95 s+ hangs in the morning and 80 s 429s an hour earlier. Vertex is still
the intended primary painter; it returns when billing is fixed.

### Still owner-gated (unchanged, and unchanged by this rebuild)

Funding. (Correction 2026-08-27: the live relayer is `0xe81DE501Dd5D9299E2bA8964498858d3fAD0415B`,
rotated 2026-07-12, and it already holds 0.02 OKB; the `0x1F4a…bb74` address below is the
retired one.) Relayer `0x1F4a753c61b54Bdec7AE0AF338A887E63Cdbbb74` needs native OKB on X Layer
for settle gas, and buyer `0x75d00a2713565171f33216e5aa2a375e076ecf69` needs USD₮0
(`0x779ded0c9e1022225f8e0630b35a9b54be713736`). Re-checked live on 2026-08-22: **all three
balances are 0**. That gates a real settlement, which gates the resubmission.

### Next

`prompts/finish/911-okx-ai-08-forge-relisting.md` is the executable work order for the resubmission.
It needs two owner interactions and nothing else: the email OTP for `claude@three.ws`, and
the diff-card confirmation before the on-chain update.

---

## 2026-07-10, Work Order 07 (partial): RUNBOOK written, live re-verification, listing drift found

Ran the unfunded half of WO-07's Part 1 audit against production and wrote the missing
`prompts/finish/_context/okx-ai-RUNBOOK.md` deliverable. Every command in the RUNBOOK was executed; nothing
in it is written from imagination.

### Verified live (2026-07-10)

- `onchainos agent get-agents --agent-ids 2632` → `approvalDisplayStatus: 5`
  (`approvalLabel: "Listing rejected"`), `status: 2`, `soldCount: 0`, `role: 2`,
  `approvalRemark: ""`. **Unchanged.** Note the remark field is EMPTY, the 2026-07-04
  rejection reason arrived only by email, so never expect `approvalRemark` to carry it.
- Unpaid `POST /api/okx/3d/identity-studio` → **402** (challenge still spec-valid).
- `GET /api/okx/3d/catalog` → **11 services**, exactly 1:1 with `api/_lib/okx-catalog.js`.
- `GET /api/okx/3d/health` → `ok: true`, subsystems reporting (generation, render, storage,
  retarget).
- `onchainos agent search --query "3D avatar rigging GLB"` → 2 results, **agent 2632 absent**
  (correct: we are not listed).
- `onchainos agent feedback-list` exists ("Query Agent reviews"), the first-sale review path.

### ⚠️ NEW FINDING, the live listing is stale and shares ZERO service names with our catalog

`onchainos agent service-list --agent-id 2632` publishes **7** services; our catalog module
defines **11**; **not one name matches**.

| Live on the listing (7) | Our catalog (11) |
|---|---|
| Text & Image to 3D Model · Video to 3D Scene Capture · Auto-Rig Skeleton Builder · Universal Animation Retarget · Masked Texture Repaint · Mesh Repair & Format Export · Mesh Part Segmentation | Agent Identity Studio · Text to 3D Model (GLB) · Text to 3D Model (Pro) · Image to 3D Model · Auto-Rig a GLB · Text to Rigged Avatar · Animation Retarget · Pose Seed · FBX Export (rig-preserving) · 3D Studio Catalog (free) · 3D Studio Health (free) |

This is expected, not a defect: **WO-05 (relisting) has never run**, because it is hard-gated
on WO-04. It IS a trap for anyone reading the live listing as a description of what we sell.
Recorded in RUNBOOK §2. The catalog module is the source of truth until WO-05 executes.

### Docs correction (WO-07 Part 2)

`docs/okx-marketplace.md` headed its payment section "Payment semantics (**verified
behavior**)" while no funded settlement has ever occurred. WO-07 treats a doc promising what
WO-04 has not proven as a release blocker. Reworded: the guarantees are stated as the
contract enforced in code (`verify → dispatch → settle-on-success`) and covered by unit
tests, with an explicit note that no funded on-chain settlement has been observed and that
the first tx hash will be recorded here.

### Still owner-gated (unchanged)

Fund payer/seller `0x75d00a2713565171f33216e5aa2a375e076ecf69` on X Layer (chainId 196) with
~$5 of `0x779ded0c9e1022225f8e0630b35a9b54be713736` + OKB gas dust → unblocks WO-04's ≥3 real
settlements → unblocks WO-05 resubmission (which additionally needs an email-OTP login as
`claude@three.ws` for the on-chain write) → unblocks WO-06's dogfood avatar.

### Not done in this session

WO-07 Part 1's funded legs (real paid call, on-chain settlement check, replay spot-check
against a settled payment) remain blocked on the funding above. Part 4 (memory file) and the
approval-watch execution branch remain, since approval status is unchanged.

---
