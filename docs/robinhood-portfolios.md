# Robinhood Portfolios

**Describe a portfolio in a sentence. Hold it on-chain, in kind, rebalanced on a published schedule.**

Robinhood Chain (`eip155:4663`) is the one chain where tokenized equities, crypto majors and
memecoins trade against each other in the same pools. A basket that holds NVDA, WETH and a
launchpad token is not a cross-chain integration problem there; it is three ERC-20s in one vault.

Robinhood Portfolios is the protocol that turns a sentence into that vault.

- **[Generate one](/markets/robinhood/portfolios)** the product surface
- **[The universe](/markets/robinhood/portfolios/universe)** every asset a portfolio may hold, priced live
- Contracts: [`contracts/hood-portfolios`](https://github.com/nirholas/three.ws/tree/main/contracts/hood-portfolios)

---

## The shape of it

```
  a sentence
      │
      ▼
  ┌─────────────────┐   ranks 700+ holdable assets, off-chain
  │  the screen     │   output is checked back against the universe
  └────────┬────────┘
           ▼
  ┌─────────────────┐   constituents, weights, schedule, the prompt,
  │  the manifest   │   the universe snapshot. Hashed, signed, immutable.
  └────────┬────────┘
           ▼ keccak256 committed on-chain
  ┌─────────────────┐   PortfolioRegistry.publish(hash, uri, parent, sig)
  │    registry     │   parent pointer = the lineage tree
  └────────┬────────┘
           ▼
  ┌─────────────────┐   ERC-20 shares. In-kind issue and redeem.
  │    the vault    │   Scheduled rebalance as a public descending-price offer.
  └─────────────────┘
```

Four contracts, no more: `PortfolioRegistry`, `Portfolio`, `PortfolioFactory`, and the
`IStockToken` interface describing what Robinhood's tokenized equities add to a plain ERC-20.

## Three decisions do most of the work

### 1. Backing is derived, never tracked

How much of each constituent backs one share is recomputed from the vault's own balances on every
call:

```
units_i = balance_i * 1e18 / totalSupply
```

There is no stored "units" number that could drift from reality, no accounting to reconcile after a
donation or an airdrop, and no path that mints a share before the assets backing it arrive.
Deliveries round **up** and payouts round **down**, so every rounding error is the vault's gain.
The solvency property

```
balance_i * 1e18  >=  units_i * totalSupply
```

therefore holds as a consequence of the arithmetic rather than as an assertion somebody has to
remember to write. It is asserted anyway, as a stateful invariant, over thousands of randomised
call sequences.

### 2. Everything is in kind, so nothing needs a price

To mint you deliver every constituent in the ratio the vault already holds. To redeem you receive
every constituent pro rata. The vault never sells anything to let somebody in or out, so it eats no
slippage, needs no liquid market in its own share token, and **needs no price oracle to operate**.

That last point is not an elegance argument, it is what makes the product buildable here at all.
Robinhood Chain has Chainlink feeds for 34 of its 95 registry equities and none for its memecoins.
A design that priced the basket on-chain to let people in and out would be unbuildable for most of
the universe. Prices are a display concern, computed off-chain and shown in the UI. They are never
load-bearing.

### 3. Nobody can trade the fund's assets

There is no function on `Portfolio` that lets a manager route the vault's holdings through a DEX.
A rebalance is:

1. **Proposed** by the manifest's creator, and only once the published schedule comes due. The
   proposal names target units per share. It moves nothing.
2. **Timelocked** for `rebalanceDelay` (24h by default), during which the creator may cancel and
   anyone may inspect what was proposed.
3. **Opened** as a descending-price offer that *any* address may fill: deliver the tokens the vault
   is short, receive the tokens it is long. The payout walks linearly from `startPayoutBps`
   (9700 by default, so the vault demands a 3% premium) to `endPayoutBps` (10000, par) across the
   auction window.

The first filler is whoever needs the smallest edge, and the vault keeps whatever premium was left
when they took it. `endPayoutBps` is capped at `MAX_END_PAYOUT_BPS` (10100) in the constructor, so
the most a rebalance can ever cost holders is a property of the deployed vault rather than a
parameter anyone can raise later.

The delta is recomputed from live balances at fill time rather than snapshotted when the auction
opened. That is what lets issuance and redemption stay open throughout an auction: they change the
vault's size, the delta scales with it, and no stored number goes stale.

> **Prior art, and what this is not.** It is not Set Protocol's or Enzyme's manager-executed trade,
> where a privileged key routes the fund's assets and the fund wears whatever it gets. It is not a
> keeper network, which would need one. It is closest to a Dutch-auction rebalance, with one
> deliberate simplification: the auction walks a single scalar payout over the whole delta basket
> rather than pricing each leg, so it needs no per-leg reference price and cannot be filled
> leg-by-leg to leave the vault holding the unwanted half.

## Halts are a state, not an edge case

Every tokenized equity on Robinhood Chain can be paused by its issuer, and while it is, `transfer`
reverts. This is verified against the live chain, not assumed: all 254 tokenized equities are beacon
proxies onto one shared implementation at `0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2`.

Robinhood Portfolios does not try to work around a halt, because it cannot be worked around: a
halted token cannot move at any price. Issuance, redemption and rebalancing all revert while any
constituent is halted, exactly as creation and redemption of a physical ETF stop when its underlying
stops. `haltedConstituent()` reports which one, so the UI can say so instead of showing a failed
transaction.

Redemption stopping is the uncomfortable one, and it is deliberate. A pro-rata payout of a halted
token cannot be transferred, and paying out only the legs that happen to be transferable would hand
the redeemer the liquid assets and leave everyone still holding shares backing the frozen one.
Redemption waits, and nobody is diluted.

## Refinement mints a new version

Elsewhere, refining an index with a follow-up prompt changes the index you already hold. On-chain
that is not a feature, it is the definition of a rug: the manifest is the only thing a holder relies
on, and an editable manifest means the constituents can become anything after the money arrives.

`PortfolioRegistry` has no edit path by construction: `manifestHash` is written once in `publish`
and no function assigns to it again. A refinement publishes a **new id** whose `parent` points at
the old one. Holders of the original keep exactly what they bought and are never migrated.

### Lineage fees, and why sybils have nothing to farm

A fork pays its ancestors out of its own fee, and the whole sybil answer is that the amount paid up
the tree is a **fixed budget**, not a per-hop rule:

| Constant | Value | Meaning |
|---|---|---|
| `LINEAGE_BUDGET_BPS` | 2000 | the share of the fee reserved for the whole lineage |
| `LINEAGE_DECAY_BPS` | 5000 | each hop takes half of what is still in the budget |
| `MAX_LINEAGE_DEPTH` | 8 | ancestors paid before the walk stops |

A direct parent receives 1000bps of the fee, a grandparent 500, and so on. Because the budget is
fixed no matter how deep the tree is, forking your own portfolio fifty times cannot increase what
the tree pays out. It only splits the same slice into smaller pieces, and every extra hop dilutes
the forker's own ancestors, including themselves. There is nothing to farm, so nothing needs to be
policed. `feeSplit()` returns shares that sum to exactly 10000 for any tree shape, which is fuzzed.

## What stops a manifest whose weights don't match its prompt

Nothing on-chain can read English, so any design claiming to bind the prompt to the weights is
lying. The honest position, encoded in the type system rather than in a disclaimer:

**The weights are binding. The prompt is provenance.**

The weights are committed, attested and enforced by the vault, which will only ever hold the
constituents it was deployed with. The prompt is published alongside them so a reader can judge
whether the screen did what it said.

The alternatives were considered and rejected. A challenge period cannot resolve "does this basket
match this sentence" without an oracle for taste. Attestation staking prices a subjective dispute
and hands the outcome to whoever adjudicates it. A multi-attester quorum makes collusion harder
without making the question decidable. What *is* decidable is whether a screen, re-run against its
recorded inputs, reproduces its recorded output, and that needs no bond: the manifest records the
universe snapshot and every constituent's price and liquidity at selection time, so anyone can
re-run it and publish the diff.

## Backtesting

Every backtest runs the same basket **twice**: once rebalanced on the schedule its manifest
published, and once never rebalanced at all. The difference, `rebalancingAddedPct`, is the only
number that judges a schedule, and it goes both ways. Rebalancing harvests the swings in a basket
whose legs move against each other, and gives up upside in one where a single leg keeps winning.
A backtest that could not produce the second result would not be measuring anything.

### Where the history comes from

This chain has no price history API. DexScreener serves only current state, GeckoTerminal does not
index chain 4663, and the public RPC is pruned, so historical `eth_call` is unavailable.

Reconstructing prices from Uniswap swap logs is the obvious next idea and it does not survive
contact with the chain's block rate. Robinhood Chain produces roughly **864,000 blocks a day** at
~100ms each, and the RPC caps `eth_getLogs` at a 500k-block span or 10,000 results. One month of
history for *one* token is 50+ archival queries before any block-timestamp reads. That is not
something an API request can do, for any number of constituents.

So history comes from the two sources that are actually cheap here:

| Source | Covers | Reach |
|---|---|---|
| Chainlink round history | the 34 registry equities with a feed | weeks, today |
| Daily snapshot (`/api/cron/hood-portfolio-snapshot`) | every token, memecoins included | from the day it first ran, compounding |

Rounds are addressed by id and read at head state, so a pruned node serves them fine.
`feedRoundHistory` batches them into multicalls of **40**, which is load-bearing: this RPC silently
*drops* calls out of a larger multicall rather than failing it, so before chunking, asking for more
history returned less of it. Measured against NVDA's feed on 2026-09-08: 80 rounds at depth 80, only
8 at depth 120, and none at 160. That partial result was the dangerous failure, because it reads as
a short-but-successful history rather than an error, and intersecting several of them produced an
empty backtest window with nothing to explain it. Chunked, 300 rounds costs about two seconds a feed.

### Coverage is reported, never assumed

A constituent with no history is **excluded and named**, the remaining weights are renormalised, and
`coveredWeightBps` says how much of the portfolio the answer actually describes. The window is the
**intersection** of the days on which every covered leg has a real observation, not the union with
gaps carried forward, because carrying a price forward manufactures flat stretches for a token that
simply was not being recorded, and those read as stability rather than as missing data.

Trading costs are not modelled, and the response says so in `costModel`.

## The permalink

A generated portfolio is shared by putting the **manifest itself** in the URL (`?p=`), deflate
compressed to about a kilobyte. Sharing the prompt instead (`?q=`, still supported) does not
reproduce a portfolio: the screen is a language model, so the same sentence returns a different
basket tomorrow, and a link that silently resolves to something else is worse than no link.

The hash is never read from the link. It is re-derived from the document through
`POST /manifest`, so a tampered link shows a different hash rather than a borrowed one.

## The universe

A token is selectable when it has a live pool and a readable price. Classification is either
authoritative or measured, never a curated list that rots:

| Class | Rule |
|---|---|
| `rwa-equity` | the contract answers `uiMultiplier()`, which only Robinhood tokenized equities do (on-chain, authoritative) |
| `stablecoin` | a known USD peg contract on this chain (authoritative) |
| `crypto-major` | at least $5M of on-chain liquidity (measured) |
| `crypto-native` | everything else: chain-native tokens and the long tail (measured) |

Rebuild the snapshot from live sources:

```bash
npm run hood:universe
```

It enumerates from Blockscout's token index in market-cap order, unions in the pinned Stock Token
registry, asks the chain which candidates are tokenized equities, then fills in price, liquidity and
volume from DexScreener and drops anything with no live pool.

## The API

Free and keyless. Base: `https://three.ws/api/v1/hood-portfolios`.

### `GET /universe`

Every holdable asset, re-priced live on each request.

```bash
curl -s 'https://three.ws/api/v1/hood-portfolios/universe?class=rwa-equity&limit=5'
```

| Query | Meaning |
|---|---|
| `class` | comma-separated asset classes to include |
| `minLiquidity` | floor on live USD liquidity |
| `limit` | cap the rows returned |
| `selectable=1` | only what a portfolio may actually hold |

### `POST /generate`

Runs the screen and returns a validated basket plus the full manifest and its hash.

```bash
curl -s -X POST https://three.ws/api/v1/hood-portfolios/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"AI infrastructure across stocks and crypto"}'
```

```jsonc
{
  "data": {
    "screen": {
      "name": "AI Infrastructure",
      "symbol": "AIINF",
      "thesis": "...",
      "rebalanceDays": 30,
      "constituents": [
        { "address": "0x…", "symbol": "NVDA", "assetClass": "rwa-equity", "weightBps": 2500, "rationale": "…" }
      ]
    },
    "manifest": { /* the full document */ },
    "manifestHash": "0x…",   // exactly what PortfolioRegistry.publish commits
    "deployment": { "chainId": 4663, "constituents": ["0x…"], "weightsBps": [2500] }
  }
}
```

Capped at 10 requests per minute per caller, because each one is a real model call. A token the
model invents is dropped rather than repaired; weights are renormalised to sum to exactly 10000,
because that is arithmetic rather than judgement.

### `POST /backtest`

```bash
curl -s -X POST https://three.ws/api/v1/hood-portfolios/backtest \
  -H 'content-type: application/json' \
  -d '{"constituents":[{"address":"0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec","weightBps":5000},
                       {"address":"0x117cc2133c37b721f49de2a7a74833232b3b4c0c","weightBps":5000}],
       "rebalanceDays":7}'
```

```jsonc
{
  "data": {
    "ok": true,
    "from": "2026-08-07", "to": "2026-09-08", "windowDays": 32,
    "rebalanced":              { "totalReturnPct": 1.42, "maxDrawdownPct": 3.39, "rebalances": 4 },
    "heldWithoutRebalancing":  { "totalReturnPct": 1.418 },
    "rebalancingAddedPct": 0.002,
    "coveredWeightBps": 10000, "totalWeightBps": 10000,
    "uncovered": [], "unknown": [], "costModel": "none"
  }
}
```

An address the universe does not know is returned in `unknown` rather than quietly skipped:
silently backtesting two legs of a three-leg basket produces a number that looks complete and
describes something the caller never asked for.

### `POST /manifest`

Canonicalises a manifest and returns the hash it commits to, plus the exact bytes that were hashed.
Pure: no storage, no chain reads.

```bash
curl -s -X POST https://three.ws/api/v1/hood-portfolios/manifest \
  -H 'content-type: application/json' -d '{"manifest":{"b":2,"a":1}}'
```

### `GET /health`

Whether the chain is answering and how fresh the universe snapshot is.

## Manifest hashing

The hash committed on-chain is `keccak256` of the **canonical** serialisation: object keys sorted at
every depth, no insignificant whitespace. `JSON.stringify` follows insertion order, which differs
between the generator and a client that round-tripped the document, so ordering is imposed rather
than assumed.

```js
import { canonicalise, manifestHash } from './api/_lib/hood-portfolios.js';

manifestHash(manifest); // 0x… the value passed to PortfolioRegistry.publish
```

## The SDK

[`@three-ws/hood-portfolios-sdk`](../packages/hood-portfolios-sdk) wraps all five endpoints and
ships the canonicaliser, so a client can verify a manifest hash without a server:

```js
import { HoodPortfolios, canonicalise } from '@three-ws/hood-portfolios-sdk';
import { keccak256, toHex } from 'viem';

const hood = new HoodPortfolios();
const { screen, manifest, manifestHash } = await hood.generate('AI infrastructure across stocks and crypto');

keccak256(toHex(canonicalise(manifest))) === manifestHash; // true, checked offline
```

Its test suite asserts that canonicaliser is byte-identical to the server's, because a divergence
would only ever surface as an on-chain commitment that does not match the document it came from.

## Contracts

```bash
cd contracts/hood-portfolios
forge test                                                        # 38 offline tests
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test   # + 5 against the live chain
```

The fork suite is skipped rather than failed when no RPC is configured, so the default run stays
hermetic. It proves the assumptions the rest of the suite takes for granted: that the tokenized
equities really are transferable ERC-20s a vault can custody, that they really do carry the halt
switch, and that a basket spanning an equity, a major and a memecoin can be issued and redeemed on
chain 4663 as deployed.

### The invariants

| Invariant | What it rules out |
|---|---|
| `backingAlwaysCoversOutstandingShares` | NAV extraction through mint/redeem asymmetry |
| `minimumLiquidityStaysLocked` | first-depositor share-price manipulation |
| `legsOnlyEmptyWhenTheirTargetIsZero` | a rebalance draining a position the manifest still wants |
| `feeSplitSumsToWhole` | lineage fees exceeding the fees collected |

## Limits, stated plainly

- **A halted equity leg suspends redemption for everyone** until its issuer resumes it.
- **Tokenized equities are tokenized debt securities** issued by Robinhood Assets (Jersey) Ltd and
  may not be offered, sold or delivered to US persons. The surfaces here are display and tooling;
  any acquisition flow carries its own eligibility gate.
- **A portfolio holding chain-native tokens can go to zero.** The screen ranks liquidity and
  recorded market data. It has no view on whether a token is a fraud.
- **The prompt is not enforceable.** Only the weights are.
- **Nothing here is investment advice**, and a generated basket is not a recommendation.
