# Robinhood Chain on three.ws

`/markets/robinhood` is three.ws's home for [Robinhood Chain](https://docs.robinhood.com/chain/) —
a permissionless Arbitrum Orbit L2 (chain ID `4663`, settles to Ethereum, ETH gas, ~100ms blocks)
that hosts ~95 tokenized US equities ("Stock Tokens") trading 24/7 alongside a live memecoin
ecosystem. Nothing else offers a clean market-data view of it: GeckoTerminal doesn't index the
chain, and general aggregators have no equity semantics (Chainlink NAV vs. DEX price, corporate
actions). This page — and the API behind it — is that missing layer.

## What's on the page

**`/markets/robinhood`** has three tabs:

- **Stocks** — the 24/7 tokenized-equity board. For every Stock Token: the Chainlink NAV price
  (read live on-chain), the deepest Uniswap DEX price, the premium/discount between them, 24h DEX
  volume, and liquidity. Sortable and searchable.
- **Coins** — a memecoin screener across the chain's two launchpads (**NOXA**, an instant
  Uniswap v3 launcher, and **The Odyssey**, a pump.fun-style bonding curve), split into CoinGecko's
  "Robinhood Chain Meme" / "Robinhood Chain Stocks Ecosystem" / "Robinhood Ecosystem" categories,
  plus a live feed of recent launches read directly from on-chain logs.
- **Chain** — block height, gas, transaction/address counts, and 90 days of chain TVL (DefiLlama).

Every coin and Stock Token links to its own detail page —
`/markets/robinhood/stock/:symbol` (e.g. `/markets/robinhood/stock/AAPL`) and
`/markets/robinhood/coin/:address` — with a price history chart, a full stats grid, holders,
recent transfers, and contract links (Blockscout).

## The buy flow

Coin detail pages carry a real buy panel: connect an injected EVM wallet (MetaMask etc.), switch
to Robinhood Chain (4663) via `wallet_switchEthereumChain` (falling back to
`wallet_addEthereumChain` if the wallet has never seen the chain), get a live Uniswap v3 quote from
`QuoterV2` across all four fee tiers, and swap through `SwapRouter02`'s `exactInputSingle` with a
user-set slippage tolerance. Wallets with no ETH on 4663 yet get a bridge deep-link
([LI.FI](https://jumper.exchange/)) instead of a dead end.

**Stock Tokens are display-only.** They're tokenized debt securities issued by Robinhood Assets
(Jersey) Ltd and may not be offered, sold, or delivered to US persons (additional limits: Canada,
UK, Switzerland) — a legal restriction enforced at front-ends, not the contract level. Their detail
page carries the disclosure and an outbound "Trade on DEX" link instead of an in-house swap; the
buy path is cleanly ready to enable once an operator affirms eligibility (swap
`mountStockEligibilityGate` for `mountBuyPanel` in `src/robinhood-stock.js` — no other wiring
changes).

## The Hood Desk

**`/markets/robinhood/desk`** is the wallet-first view of the same chain: paste any Robinhood Chain
address (or connect an injected wallet, or link to `?address=0x…`) and the desk loads that wallet's
whole book. Nothing is signed to read it, no key is needed, and any address can be inspected, so a
link to the desk is a shareable, reproducible view of a wallet.

What it shows:

- **Desk vitals** - book value in USD (native ETH plus every priced ERC-20), the native balance and
  its change over the window, position count, and a chain gate tile with block height, gas ladder
  and block time.
- **Balance history** - the wallet's real native balance curve. The public sequencer RPC is not an
  archive node (`eth_getBalance` at a past block answers `metadata is not found`), so the curve is
  rebuilt from Blockscout's two balance feeds: daily closes for the older shape, per-transaction
  points for the live edge, stitched into one series. USD points are the native balance marked at
  the current ETH price, and the panel says so rather than implying a marked-to-time curve.
- **Activity tape** - transactions folded together with the token transfers they emitted, so a swap
  prints once with its legs instead of three times. Classified into swap / send / receive / mint /
  burn / approve / claim / deploy, newest first, refreshed every 20s.
- **NAV premium ridge** - the distribution of Stock Token DEX premium against the Chainlink NAV,
  redrawn once per liquidity floor. Each layer back is a deeper pool floor, so a spread that
  survives to the back rows is one you could actually size into. The shaded strip is the "at NAV"
  band (within 0.5%); the table under it ranks the widest dislocation that still has a tradeable
  pool behind it.
- **Position ladder** - every ERC-20 the wallet holds, priced from the Chainlink NAV when it is a
  Stock Token (ERC-8056 multiplier applied to the balance, never to the price) and from the deepest
  Uniswap pool otherwise. A token the desk cannot price is shown as `unpriced` and is never counted
  into the book at zero. Tokens the indexer has no metadata for get their decimals and symbol read
  from the contract in one multicall, because a balance divided by a guessed `1e18` is a wrong
  number on the screen.
- **Counterparty flow** - who this wallet actually crosses with (routers, pools, launchpads,
  people), ranked by legs.
- **Movers** - the Robinhood Chain meme category by absolute 24h move, with a 7-day sparkline.

Each position and each row on the arb board opens a trade ticket: the same Uniswap v3 quote-and-swap
panel the coin pages use for memecoins, and the eligibility gate (never a swap) for Stock Tokens.

## API — `/api/v1/robinhood/*`

Free, keyless, real data only:

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/robinhood/chain` | Block height, gas, tx/address counts, chain TVL + 90-day history |
| `GET /api/v1/robinhood/stocks` | Every Stock Token: NAV, DEX price, premium, volume, liquidity (`?q=`; `sort`: `symbol` \| `volume` \| `liquidity` \| `premium` \| `price`; `dir`: `asc` \| `desc`, numeric columns default highest-first, symbol A-Z; rows with no value for the column sort last either way) |
| `GET /api/v1/robinhood/stocks-detail?symbol=AAPL` | One Stock Token in depth: NAV history, all DEX pairs, holders, transfers, links |
| `GET /api/v1/robinhood/coins?category=meme` | Memecoin screener (`category`: `meme` \| `stocks-ecosystem` \| `ecosystem`; `sort`: `market_cap` \| `volume` \| `gainers` \| `losers`) |
| `GET /api/v1/robinhood/coins-detail?address=0x…` | One coin: pools, market stats, holders, transfers, links |
| `GET /api/v1/robinhood/launches` | Recent launches from NOXA + The Odyssey, newest first |
| `GET /api/v1/robinhood/desk` | The desk's market side in one read: chain vitals, the premium ridge (bins, liquidity layers, percentiles), the widest tradeable dislocations, memecoin movers, recent launches |
| `GET /api/v1/robinhood/wallet?address=0x…` | The desk's wallet side in one read: native balance, priced ERC-20 positions, book totals, balance history (daily + per-transaction, merged), the activity tape and counterparty flow |

Paid via x402 ($0.002 USDC, Base or Solana):

| Endpoint | Returns |
| --- | --- |
| `GET /api/x402/robinhood-portfolio?address=0x…` | Multiplier-correct Stock Token portfolio: every held symbol's true position (raw balance × ERC-8056 `uiMultiplier`) priced at the live Chainlink NAV, plus a total USD value |

Every response carries `source` and `asOf` fields. A miss is a structured error, never a bare 500. An unknown `sort` (or `category`) falls back to the default instead of 400ing a screener read, and the response echoes the `sort` (and `dir`) that actually ran, never the caller's unknown value.

### Why the multiplier matters

Stock Tokens implement **ERC-8056** (`uiMultiplier()`): corporate actions (splits, dividends) are
applied by adjusting the multiplier, not by rebasing balances. `raw balance × uiMultiplier / 1e18
= true position` — reading the raw ERC-20 balance alone misstates a holding after any corporate
action. The portfolio endpoint (and the stocks board's `uiMultiplier` column) always does this
math; Chainlink feed prices are already multiplier-adjusted, so they're never re-multiplied.

## Data sources

- **Chainlink NAV** — read live on-chain via one multicall across every feed-backed Stock Token
  (`latestRoundData` + `uiMultiplier` + `totalSupply`), cached 20s. Never 95 separate RPC calls.
- **DEX price / liquidity / volume** — [DexScreener](https://dexscreener.com) (`chainId: "robinhood"`),
  batched 30 addresses per call for the board.
- **Holders, transfers, token stats, chain stats, wallet balances and balance history**:
  [Blockscout](https://robinhoodchain.blockscout.com) Pro API. Two operational notes, both learned
  the hard way: it sits behind Cloudflare bot protection that answers any non-browser User-Agent
  with a 403 interstitial (so `api/_lib/robinhood.js` attaches a browser UA for that host only), and
  its address endpoints intermittently answer a bare 500 under load (so the shared fetch retries
  twice inside the cache callback, and only a persistent outage is ever cached).
- **Chain TVL** — [DefiLlama](https://defillama.com/chain/robinhood-chain).
- **Memecoin screener** — CoinGecko categories `robinhood-chain-meme`, `robinhood-chain-stocks-ecosystem`, `robinhood-ecosystem`.
- **Recent launches** — decoded on-chain logs from the NOXA and Odyssey launchpad factories
  (Blockscout's log API, filtered by event topic — the public RPC's `eth_getLogs` caps at 10k
  matched logs and can't reliably answer "what's newest").

## Related surfaces

- [Market Data API](./market-data-api.md) — the same paid-endpoint pattern (x402, `priceFor`,
  service-catalog descriptor) applied to the rest of three.ws's market data.
- [Trust primitives](./trust-primitives.md) — score a Robinhood Chain wallet's cross-chain
  reputation before transacting with it.
- [x402 distribution](./x402-distribution.md) — how the paid portfolio endpoint gets discovered
  across the x402 ecosystem.
