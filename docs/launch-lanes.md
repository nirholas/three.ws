# Launch lanes

A lane is one way to launch a coin from three.ws. Solana is the default lane and is unchanged. The EVM lanes
(a Uniswap V3 pool on Base, and a paired coin on Robinhood Chain) sign from the agent's own wallet.

The wizard at [/launch](https://three.ws/launch) links to a comparison of every lane, and each EVM wizard
([/launch/uniswap](https://three.ws/launch/uniswap), [/launch/paired](https://three.ws/launch/paired)) shows it
too. All of it reads `GET /api/launches/lanes`, which reads the launchers themselves, so a fee changed on a
contract shows up without a deploy.

## Compared

The tables below are generated from that config. Do not edit between the markers; run
`npm run docs:launch-lanes` instead (`-- --check` fails when the doc is stale).

<!-- lanes:start -->

### Lane comparison

| Lane | Chain | Signs with | Supply | Creator share | Graduation | Liquidity |
| --- | --- | --- | --- | --- | --- | --- |
| **pump.fun** (default) | Solana | Your wallet, or your agent's wallet | 1,000,000,000 | Creator rewards on every trade, claimable on three.ws | Trades on a bonding curve until it fills, then moves to an open AMM pool on Solana. | Held by pump.fun's program |
| **three.ws launchpad** | Solana | Your wallet | 1,000,000,000 | 50%: Share of every trading fee and of the migration fee | Starts at a 4,000,000 $THREE market cap and graduates at 60,000,000 $THREE into a pool with 100% of liquidity permanently locked. | Permanently locked at graduation, half creator and half platform. Lock: Permanent lock |
| **Uniswap V3 pool** | Base (8453) | Your agent's wallet | 1,000,000,000 | n/a | There is no graduation. The whole supply goes into one Uniswap V3 pool from the first block and trades openly against WETH. | One position holds the whole supply, single-sided. Lock: No lock, Timelock, Permanent lock |
| **Paired coin** | Robinhood Chain (4663) | Your agent's wallet | 1,000,000,000 | 70%: Share of every swap fee, in every pool | There is no graduation. The coin trades on its bonding curves for good, up to five at once, and liquidity never migrates. | Held by the launchpad contract. Nobody can withdraw it.. Lock: Permanent (built in) |

### pump.fun: every fee

| Fee | When | Paid by | Amount | Note |
| --- | --- | --- | --- | --- |
| three.ws launch fee | launch | creator | 1% | Charged on the opening buy only. A launch with no opening buy pays nothing. |
| pump.fun protocol fees | launch and trade | creator and traders | Set by pump.fun | Account rent, creation cost and trade fees are pump.fun's and shown in the wallet prompt. |
| Network fee | launch | creator | SOL, a fraction of a cent | Paid to Solana validators. |

### three.ws launchpad: every fee

| Fee | When | Paid by | Amount | Note |
| --- | --- | --- | --- | --- |
| Trading fee | trade | traders | 1% | Paid in $THREE. |
| Migration fee | graduation | raised liquidity | 1% | Taken from the quote raised when the coin graduates. |
| Network fee | launch | creator | SOL, a fraction of a cent | Paid to Solana validators. |

### Uniswap V3 pool: every fee

Not available right now: The launcher contract is not deployed on Base yet. The lane opens as soon as its address is configured.

### Paired coin: every fee

| Fee | When | Paid by | Amount | Note |
| --- | --- | --- | --- | --- |
| Launch fee | launch | creator | 0.0005 ETH | Flat, paid in ETH. |
| Swap fee | trade | traders | 1% | Charged in each pool's quote asset. |
| Gas | launch | creator | Estimated in the quote | Paid to the chain, in ETH. |

Contract: `0x6a546350f79DE0Fc83ADfCe99233183aA090fa15`

<!-- lanes:end -->

## The Uniswap lane

The whole supply (one billion, fixed at deploy) goes into a single-sided Uniswap V3 position against WETH from
the first block, so the pool needs no ETH to open. The launch is one transaction on the launcher contract
([contracts/src/ThreeWsUniswapLauncher.sol](../contracts/src/ThreeWsUniswapLauncher.sol)): create the token,
create the pool, mint the position and apply the lock.

| Option | Values |
| --- | --- |
| Pool fee tier | 0.01%, 0.05%, 0.3%, 1% (default 1%) |
| Starting market cap | 0.01 to 100,000 ETH (default 4 ETH), rounded to the tier's tick spacing and quoted as the rounded value |
| Lock | `none` (position stays in the agent wallet), `timelock` (1 to 3650 days), `permanent` |
| Fee recipient | The agent wallet by default. Another address must be on the agent's EVM allowlist and needs a lock |

With a lock, the launcher holds the position and routes collected pool fees: the platform share is taken, the
rest goes to the fee recipient. With no lock the position is the agent's and its fees never touch the launcher.

The launcher is deployed by the owner. Until `UNISWAP_LAUNCHER_ADDRESS` names a deployed launcher the lane
reports `available: false` with the reason, and the wizard shows it as not open yet.

## Quote, then launch

```bash
# Every fee, the wallet balance and anything blocking. Signs nothing.
curl -X POST https://three.ws/api/agents/$AGENT_ID/uniswap/quote \
  -H "authorization: Bearer $THREEWS_API_KEY" -H "content-type: application/json" \
  -d '{"name":"Chip Stack","symbol":"CHIPS","fee_tier":10000,"lock":{"mode":"permanent"}}'

# The same body to /launch signs and sends it.
curl -X POST https://three.ws/api/agents/$AGENT_ID/uniswap/launch \
  -H "authorization: Bearer $THREEWS_API_KEY" -H "idempotency-key: $(uuidgen)" \
  -H "content-type: application/json" \
  -d '{"name":"Chip Stack","symbol":"CHIPS","fee_tier":10000,"lock":{"mode":"permanent"}}'
```

The paired lane is `POST /api/agents/:id/paired/quote` and `/paired/launch` (see [paired-coins.md](./paired-coins.md)).
Launching needs a signed real-funds agreement on the account. The wizard shows a confirmation table with
sender, launcher, chain, amount and every fee, and signs only after an explicit yes. MCP clients get the same
steps as `uniswap_launch_quote`, `uniswap_launch`, `paired_launch_quote`, `paired_launch`, `launch_lanes` and
`launch_status`, and the tool descriptions say that a launch spends funds.

## Idempotency and status

Both EVM lanes persist a launch record before anything is signed.

- Send an `Idempotency-Key` header (8 to 128 printable ASCII characters). The key is scoped to your account.
- A retry with the same key and the same body returns the same launch: HTTP 200 with `idempotent-replay: true`
  once it finished, 202 while it is in flight. Nothing is signed twice.
- The same key with a different body (or agent) is refused with 422 `idempotency_key_reused`.
- A launch that failed is closed (HTTP 409 with the error). Retrying needs a new key, because the failure may
  have been a refusal you should change something about.
- Without a header the launch still gets a record you can follow, but retries are not deduplicated.
- If the connection drops after the transaction was sent, the record stays `submitted` and is settled from the
  transaction receipt the next time you read it.

`GET /api/launches/:id` (owner only) returns the record:

```json
{
  "data": {
    "id": "7f0c…",
    "lane": "uniswap",
    "chain": "base",
    "status": "finalized",
    "finalized": true,
    "stages": [{ "stage": "accepted", "at": "…" }, { "stage": "policy_checked", "at": "…" }],
    "tx_hash": "0x…",
    "token": "0x…",
    "result": { "token": "0x…", "pool": "0x…", "urls": {} },
    "error": null
  }
}
```

`status` moves `pending`, `submitted`, `confirmed`, `finalized`, or ends at `failed`. Poll until `finalized` is
true or the status is `failed`. A record with no transaction that nobody finished is failed after 10 minutes.

## Related

- [Paired coins](./paired-coins.md)
- [MCP server](./mcp.md)
- [STRUCTURE.md](../STRUCTURE.md)
