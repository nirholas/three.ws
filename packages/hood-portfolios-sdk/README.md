# @three-ws/hood-portfolios-sdk

Client for **Robinhood Chain portfolios**: read the holdable universe, generate a basket from a
sentence, backtest it, and canonicalise a manifest to the exact bytes its on-chain hash commits.

Zero dependencies. Every endpoint it calls is free and keyless.

- Product: [three.ws/markets/robinhood/portfolios](https://three.ws/markets/robinhood/portfolios)
- Protocol: [docs/robinhood-portfolios.md](../../docs/robinhood-portfolios.md)
- Contracts: [contracts/hood-portfolios](../../contracts/hood-portfolios)

## Install

```bash
npm install @three-ws/hood-portfolios-sdk
```

Node 18+ or any browser (it uses the global `fetch`; pass your own with `{ fetch }` if you need to).

## Quickstart

```js
import { HoodPortfolios } from '@three-ws/hood-portfolios-sdk';

const hood = new HoodPortfolios();

// 1. What can a portfolio actually hold right now?
const universe = await hood.universe({ assetClass: 'rwa-equity', limit: 5 });
for (const t of universe.tokens) {
  console.log(`${t.symbol.padEnd(6)} $${t.priceUsd}  liquidity $${Math.round(t.liquidityUsd).toLocaleString()}`);
}
// NVDA   $232.07  liquidity $6,863,835
// GLD    $410.43  liquidity $4,631,035
// ...

// 2. Turn a sentence into a basket.
const { screen, manifest, manifestHash } = await hood.generate(
  'AI infrastructure: chip makers plus the crypto compute tokens',
);
console.log(screen.name, screen.symbol, manifestHash);
for (const c of screen.constituents) {
  console.log(`${(c.weightBps / 100).toFixed(2)}%  ${c.symbol}  ${c.rationale}`);
}

// 3. What would it have done, and did the rebalancing help?
const bt = await hood.backtest({
  constituents: screen.constituents.map((c) => ({ address: c.address, weightBps: c.weightBps })),
  rebalanceDays: screen.rebalanceDays,
});
if (bt.ok) {
  console.log(`${bt.from} to ${bt.to}: ${bt.rebalanced.totalReturnPct.toFixed(2)}% rebalanced`);
  console.log(`rebalancing added ${bt.rebalancingAddedPct.toFixed(3)} percentage points`);
}
```

## API

### `new HoodPortfolios(options?)`

| Option | Default | Meaning |
|---|---|---|
| `baseUrl` | `https://three.ws` | Point at another deployment. |
| `fetch` | `globalThis.fetch` | Supply a transport (a proxy, a test double). |
| `timeoutMs` | `60000` | Per-request timeout. |

### `universe(options?)`

Every token a portfolio may hold, re-priced live on each call.

| Option | Meaning |
|---|---|
| `assetClass` | One class or an array: `rwa-equity`, `crypto-major`, `crypto-native`, `stablecoin` |
| `minLiquidityUsd` | Floor on live on-chain liquidity |
| `limit` | Cap the rows returned |
| `selectableOnly` | Only what a portfolio may actually hold |

Each token carries `canonical`. It is `false` when another contract is the real holder of that
ticker, which matters more here than it sounds: **13 separate contracts on this chain call
themselves USDG**, and five of them are deeper than the real one. Filter on it, or use
`selectableOnly`, which does.

### `generate(prompt)`

Screens the universe and returns `{ screen, manifest, manifestHash, deployment }`. Weights are
integers summing to exactly `10000`. `manifestHash` is the value
`PortfolioRegistry.publish` commits on-chain.

Rate limited to 10 per minute per caller, because each call runs a real model.

### `backtest({ constituents, rebalanceDays?, days? })`

Runs the basket twice, once on its schedule and once never rebalanced, and reports the difference
as `rebalancingAddedPct`. That number goes both ways: rebalancing harvests swings in a basket that
oscillates and gives up upside in one that trends.

Coverage is explicit. A constituent with no price history is excluded and listed in `uncovered`
with the reason, the rest are renormalised, and `coveredWeightBps` says how much of the portfolio
the answer describes. Nothing is interpolated to close a gap.

### `manifestHash(manifest)`

Canonicalises server-side and returns `{ manifestHash, canonical, canonicalBytes }`. Use it to
check a manifest you were handed against what is on-chain.

### `canonicalise(value)`

The same canonicalisation, locally and offline: keys sorted at every depth, no insignificant
whitespace. `JSON.stringify` follows insertion order, so a document that has been round-tripped
through a file, a URL or a database serialises differently and would hash to a different
commitment. To hash it yourself:

```js
import { canonicalise } from '@three-ws/hood-portfolios-sdk';
import { keccak256, toHex } from 'viem';

const hash = keccak256(toHex(canonicalise(manifest))); // identical to what the API returns
```

The package's test suite asserts this canonicaliser is byte-identical to the server's.

### `health()`

Whether the chain is answering, and how fresh the universe snapshot is.

## Errors

Every non-2xx throws `HoodPortfoliosError` carrying `status` and the API's own `code`
(`screen_failed`, `screen_unavailable`, `universe_unavailable`, `unknown_constituents`, ...), so a
caller can branch on the cause rather than parse a message.

```js
import { HoodPortfoliosError } from '@three-ws/hood-portfolios-sdk';

try {
  await hood.generate('...');
} catch (err) {
  if (err instanceof HoodPortfoliosError && err.code === 'screen_unavailable') {
    // every model provider is busy; retry shortly
  }
}
```

## Tests

```bash
npx vitest run packages/hood-portfolios-sdk/tests
```
