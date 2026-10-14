# @three-ws/wallet-linkage

Answers one question: are these two Solana wallets the same person? Ported
from the owner's proprietary `wallet-sleuth`, trimmed to the signals a launch
platform needs (Solana first; EVM signals are out of scope), with the
upstream license header preserved in [LICENSE](./LICENSE).

## What it does

Given 2 to 10 addresses, `analyzeLinkage` collects each one's recent Solana
activity through an **injected RPC client** (never a hardcoded endpoint, so
the caller's own failover chain is used) and scores every pair with six
signals, combined by noisy-OR into one 0-100 score:

| Signal | Weight | What it catches |
|---|---|---|
| `solana-account-control` | 1.0 | One address is an SPL token account owned by the other, or paid to create it (rent payer). |
| `solana-fee-payer` | 0.9 | Both addresses have transactions signed and fee-paid by the same key. |
| `peer-first-funding` | 0.9 | One address's very first inbound transfer came from the other. |
| `common-first-funder` | 0.8 | Both addresses' first inbound transfer came from the same third account. |
| `direct-transfer` | 0.75 | Value moved directly between the two addresses (dust filtered, recency-discounted). |
| `funding-burst` | 0.6 | The same funder sent both addresses similar amounts within a short window. |

A third-party address that funds three or more of the addresses under
analysis (or appears in the runtime exclusion list) is treated as a shared
service/exchange wallet, not evidence of a link, see "Exclusions" below.

## Usage

```js
import { analyzeLinkage } from '@three-ws/wallet-linkage';
import { solanaConnection } from '../../api/_lib/solana/connection.js';

const connection = solanaConnection({ network: 'mainnet' });
const result = await analyzeLinkage(connection, [addressA, addressB]);
// result.pairs[0] => { a, b, score, band, topSignal, signals, evidence }
```

The `connection` argument is duck-typed: anything exposing
`getSignaturesForAddress`, `getParsedTransaction`, and `getAccountInfo` with
`@solana/web3.js`-shaped return values works, so a caller can inject a mock
in tests or a different failover chain entirely.

### Score bands

| Score | Band |
|---|---|
| 85-100 | `confirmed` |
| 65-84 | `strong` |
| 40-64 | `moderate` |
| 20-39 | `weak` |
| 0-19 | `none` |

### Bounded by design

Each collector call is capped by a signature count AND a wall-clock budget
(`signatureLimit`, `budgetMs` in `opts`). A slow RPC lane or a wallet with
years of history degrades to a partial answer (`complete: false`) instead of
hanging a request.

### Exclusions

Known service/exchange accounts are never hardcoded in this package (a real
third-party address in committed code would need the CLAUDE.md
crypto-project commit gate). Supply them at runtime instead:

- `WALLET_LINKAGE_EXCLUDED_ACCOUNTS`: comma-separated address list.
- `WALLET_LINKAGE_EXCLUSIONS_PATH`: path to a JSON array of addresses.

## Used by

- `GET /api/crypto/linkage`: the public pairwise-linkage endpoint.
- `wallet_linkage` in `packages/intel-mcp`: the MCP tool.
- `api/_lib/trade-firewall.js`: flags early buyers linked to a coin's creator.
- `api/_lib/copy-eligibility.js`: refuses a copy-trade leader linked to the
  creator of the coin being copied.

## License

Proprietary, ported from `wallet-sleuth` under the owner's own permission as
author of both repositories. See [LICENSE](./LICENSE). This does not change
the license of the rest of the three.ws monorepo.
