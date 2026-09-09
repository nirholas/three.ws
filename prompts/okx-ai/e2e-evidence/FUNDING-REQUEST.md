# Work Order 04: funding request (re-verified 2026-09-09)

Every leg of the gauntlet that does not move money is finished and green against production.
The paid legs are blocked on one owner action. Amounts below are computed from the live
catalog and today's gas price, not padded.

## Re-verified 2026-09-09, and one blocker cleared itself

- **Every gauntlet case that can run without funding passes.** `node
  scripts/okx-e2e-gauntlet.mjs --dry-run` reads `4/4 cases exercised passed, 10 skipped`
  (1, 1d, 5d, 7), and a separate real run closes two more (see the 5b/5c section below), so
  six of the fourteen are green. The eight that remain are the paid legs this file unblocks.
- **Case 1d is GREEN in production.** The discovery paywall the 2026-09-02 version of this
  file called out as "one thing funding will NOT fix" shipped since. A spec-compliant MCP
  client (`Accept: text/event-stream` + `MCP-Protocol-Version`) now gets 200 on `initialize`
  and `tools/list` on all four paid rows, so a reviewer can read the tool schema without
  paying. That section is deleted from this file rather than carried forward stale.
- **All three pre-resubmission gates pass**, including OKX's own validator:
  `okx-compliance-probe.mjs` PASS 20 probes, `okx-payment-leg-probe.mjs` PASS 4 rows,
  and `onchainos agent x402-check` reads `valid: true` on all four rows with the rail
  resolved exactly as registered. Captures: `90-`, `91-`, `92-2026-09-09-*.json`.
- **Delivery is healthy again.** A storage-credential fault (R2 `SignatureDoesNotMatch`) was
  failing generation earlier today; Cloud Run revision `three-ws-api-00420-ljh` (05:39 UTC)
  cleared it. `/api/okx/3d/health` now reads `ok: true` on all six subsystems, and a fresh
  free-lane job delivered a 3,281,092-byte GLB that parses with real geometry
  (1 mesh, 17,603 vertices, 30,000 triangles). A paid buyer would receive a real artifact.

## What changed since the 2026-08-01 version of this file

- **The wallet is logged in.** `onchainos wallet status` returns `loggedIn: true` as
  `claude@three.ws`, and the buyer address is confirmed unchanged
  (`0x75d00a2713565171f33216e5aa2a375e076ecf69`). The OTP ask in the previous version of
  this file is discharged; funding is now the only owner action.
- **The listing is a different product.** The 2026-08-22 rebuild replaced 11 REST rows with
  7 A2MCP forge rows, submitted on-chain 2026-08-27 and currently
  `approvalLabel: "Listing under review"`. The old ask was priced against `text-to-3d`,
  `avatar` and `fbx-export`; the gauntlet now buys the rows OKX actually lists.
- **The ask is smaller.** $1.08 covers a clean run, against $3.00 before.

## Live balances (X Layer RPC, direct `eth_call`, block 70162898, 2026-09-09)

| Wallet | Role | USD₮0 | OKB |
| --- | --- | --- | --- |
| `0x75d00a2713565171f33216e5aa2a375e076ecf69` | Buyer (onchainos TEE) | **0.000000** | 0.000000 |
| `0x4022de2D36C334E73C7a108805Cea11C0564f402` | Seller / payTo | 2.427731 | 0.839596 |
| `0xe81DE501Dd5D9299E2bA8964498858d3fAD0415B` | Relayer (gas) | 0.000000 | 0.020000 |

Every figure is unchanged from 2026-09-02, 2026-08-01 and 2026-07-23: nothing has moved on
this rail in six weeks, so no funding story explains any listing rejection.

`payTo` re-probed off the live 402 today (2026-09-09) and unchanged. Gas is a non-issue: X Layer prices at
0.02 gwei, so one `transferWithAuthorization` costs 0.000002 OKB and the relayer's 0.02 OKB
covers roughly 10,000 settlements. The buyer needs no OKB at all: it signs an EIP-3009
authorization off-chain and the relayer broadcasts.

## The ask: 5.0 USD₮0, one transfer

| | |
| --- | --- |
| To | `0x75d00a2713565171f33216e5aa2a375e076ecf69` (buyer, onchainos TEE wallet) |
| Chain | X Layer mainnet, chainId **196** (`eip155:196`) |
| Token | USD₮0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` (6 decimals) |
| Amount | **5.0 USD₮0** (5,000,000 atomic) |

### How the number was computed

`node scripts/okx-e2e-gauntlet.mjs --budget` prints this live off the catalog module:

| Case | Service | Price | Settles? |
| --- | --- | --- | --- |
| 2 | forge-draft | $0.01 | yes |
| 2b | forge-standard | $0.05 | yes |
| 3 | forge-hd | $0.25 | yes |
| 3i | forge-image | $0.25 | yes |
| 3r | avatar (rigged, back burner) | $0.50 | yes |
| 5a | forge-draft | $0.01 | yes |
| 5b | forge-draft | $0.01 | no, rejected on amount before redemption |
| 5c | forge-draft | $0.01 | no, authorization expired |
| 6 | forge-draft | $0.01 | no, that is the assertion |
| 7 | forge-draft | $0.01 | no, and it pays a different rail (see below) |

One clean run settles **$1.07**. The binding constraint is not that sum but the **balance
floor**: verify refuses any authorization whose value exceeds `balanceOf(buyer)`, including
the ones designed to be rejected, so the wallet must still hold the price of the last case
that signs. A single clean run therefore needs a starting float of **$1.08**, which the
gauntlet checks before it signs anything and refuses to start below.

$1.08 covers one clean run. The rest is the fix loop: phase 3 re-runs the failed case plus
cases 2 and 5a as its regression floor, and the two dearest cases are the ones most likely to
need iterating (the HD lane hold-gates, the image lane depends on an upstream painter).
Budgeting five iterations at the worst case adds ~$2.6. **$1.08 + $2.6 = $3.7, rounded to
5.0** so the run is never the thing that runs out. Anything unspent stays in the buyer wallet
for WO-05 and for retests during OKX's review.

**Note this money largely comes back.** The buyer pays `payTo`
(`0x4022de2D…f402`), which is our own merchant wallet, so each settlement moves float from one
platform wallet to another. Net platform cost for a full run is the gas only (~0.00002 OKB).
If it is easier to fund from `payTo` (2.427731 USD₮0, enough for a clean run plus two
iterations) than from an exchange, that works and needs no external transfer. That key is in
Secret Manager and this session cannot read it, so it has to be you either way.

## Two cases came off this ask entirely (2026-09-09, later session)

`5b` and `5c` do not need funding and never did. The CLI signs an EIP-3009 authorization
off-chain regardless of balance, and the server rejects both before any balance or settlement
check, so `node scripts/okx-e2e-gauntlet.mjs --yes --only 5b,5c` reads `2/2 cases passed.
Settlements: 0` with the buyer at 0.000000. Three of the four adversarial cases (5b, 5c, 5d)
are now closed. Only 5a still needs money, because replaying a VALID authorization first
requires a real settlement to replay.

## Correction made 2026-09-09 (later session): case 6 was testing the wrong side of the line

The earlier version of this file priced case 6 at $0.25 on `forge-image`, forcing the failure
with an image URL that 404s. Measured against production today, that input does not fail at
acceptance: `POST /api/forge` with a 404 `image_urls` entry answers `200 queued`, because
validation there is format-only and never fetches the image. The job would have been accepted,
settled, and only failed later in generation, which is the CHARGED side of the acceptance line
we document. Case 6 would have spent $0.25 to assert the opposite of our own promise.

Case 6 now signs `forge-draft` ($0.01) with a whitespace-only prompt: it clears the tool's
JSON schema (minLength counts the spaces, so the buyer still gets a real, payable 402) and is
then refused inside the handler with `invalid_input` before the lane is asked for any work.
Covered by a unit test in `tests/api/okx-forge.test.js` that asserts both hops, so the premise
cannot rot silently. This is why the float floor above dropped from $1.32 to $1.08.

## Optional second leg: make case 7 a real paid legacy settlement

Case 7 currently proves the pre-OKX rails are still advertised at the right price, which
passes with no funding. The gauntlet is wired to also *pay* one, which turns it into a real
regression test that adding X Layer did not break the rails the platform already sells on.
The cheapest is the Solana USDC rail, whose accept carries a `feePayer`, so it needs **no SOL**:

| | |
| --- | --- |
| To | `9PirGw9wVLLNFgVyjgAt5jvuFQwJ3pYUBWt9n3vZfnyc` (same TEE wallet, Solana account) |
| Chain | Solana mainnet |
| Token | the USDC mint named in the live challenge's Solana accept (`asset`, read it fresh, do not trust a copy) |
| Amount | **0.10 USDC** (ten draft calls' worth of headroom) |

The same challenge also advertises a **$THREE** rail
(`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`, 10 THREE for a draft call). Funding that
instead, or as well, would let the gauntlet prove an agent can buy three.ws compute with
$THREE. Say which you prefer; the run defaults to the USDC rail and skips the paid leg
cleanly if the wallet is empty.

Read both `asset` fields live before sending anything:

```bash
curl -s -X POST https://three.ws/api/okx/3d/forge-draft \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"forge_3d","arguments":{"prompt":"a teapot"}}}' \
  -D - -o /dev/null | grep -i '^payment-required:' | cut -d' ' -f2 | base64 -d | python3 -m json.tool
```

## What runs the moment the funding lands

```bash
node scripts/okx-e2e-gauntlet.mjs --budget    # confirms the float arrived
node scripts/okx-e2e-gauntlet.mjs --yes       # the full gauntlet
```

Cases 1, 1d, 2, 2b, 3, 3i, 3r, 5a, 5b, 5c, 5d, 6, 7, then case 4 (on-chain settlement
verification of every payment the run produced), writing evidence for each into this
directory.

## The wallet is already logged in

`onchainos wallet status` reads `loggedIn: true` as `claude@three.ws` (verified 2026-09-09),
so no OTP is needed for this work order. Funding is the single remaining owner action.
