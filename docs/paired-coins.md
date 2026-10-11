# Paired coins on Robinhood Chain

A paired coin is a coin on [Robinhood Chain](robinhood-chain-markets.md) (chain ID 4663) that
trades against one to five assets at once instead of a single gas token. A coin paired with
NVDA, TSLA and SPY trades in three independent bonding curves, one per pairing, and its creator
earns swap fees in all three. The assets a coin can pair with (tokenized stocks, WETH,
stablecoins, chain coins) are whatever the launchpad's on-chain quote registry has enabled.

On three.ws you can browse every paired coin, trade one from your own wallet, and have one of
your agents launch one from its own custodial EVM wallet. There are four ways to launch, and all
of them run the same server path:

| Who | How |
| --- | --- |
| An owner, by hand | [three.ws/launch/paired](https://three.ws/launch/paired) |
| A bot or script | `POST /api/agents/:id/paired/quote`, then `POST /api/agents/:id/paired/launch` |
| The agent itself | the `paired-launch` agent skill |
| An MCP client | `paired_launch_quote`, then `paired_launch`, on `https://three.ws/api/mcp` |

For the single-quote ETH launchpad on the same chain, see
[Launch a coin on Robinhood Chain (Pons)](pons-launch.md).

## What a paired coin is

The contracts are the paired.exchange launchpad, vendored with tests and a bytecode check at
[contracts/paired-launchpad/](../contracts/paired-launchpad/README.md). Two contracts, no proxy:

| Contract | Address |
| --- | --- |
| `PairedLaunchpad` | `0x6a546350f79DE0Fc83ADfCe99233183aA090fa15` |
| `PairedToken` | one per coin, deployed by the launchpad |

three.ws reads the launchpad address from `PAIRED_LAUNCHPAD` and falls back to the deployment
above. The launchpad is the only source of truth: which coins exist, which assets they pair with,
prices and reserves are all read from it, so three.ws can never show a coin or a market the chain
does not have.

- **Fixed supply.** Every coin is a `PairedToken` with exactly 1,000,000,000 tokens (18 decimals)
  and no admin surface: no mint, no owner, no pause.
- **One curve per pairing.** The launch splits the supply across one to five quote assets by
  weight, in basis points that must total exactly 10,000. The last market absorbs the integer
  division dust, so the pools always add up to the full supply. Each curve is an independent
  constant-product market. The curves do not arbitrage each other and they are not a basket.
- **Virtual quote reserves.** Each curve opens on a virtual quote balance, so nothing is deposited
  on the quote side. The creator can launch against NVDA or WETH without holding either. The only
  mandatory cost is the flat launch fee in ETH, plus gas.
- **No migration, no ceiling.** Tokens leave a curve asymptotically, so there is no graduation
  event where liquidity moves. Liquidity never migrates and nobody can withdraw it.
- **Content-addressed descriptor.** The coin's descriptor (description, logo, links) lives off
  chain, but the coin commits `keccak256` of its exact bytes at launch (`PairedToken.metadataHash`).
  three.ws only marks a descriptor `verified` when the bytes it fetched hash to that commitment, so
  the host serving it does not matter.

### How a pool's price is set

The registry stores one `virtualQuote` per quote asset, sized for a pool that holds 100% of the
supply. A pool with weight `w` opens with `virtualQuote × w` of virtual quote against `1B × w`
tokens. The weight cancels, so every pool in a coin opens at the same price in its own asset:

```
opening price  = virtualQuote / 1,000,000,000   (quote units per coin)
opening value  = virtualQuote                   (whole supply, in the quote asset)
```

That is why `virtualQuote` is the coin's opening market cap in that asset, and why each quote has
to be calibrated to a comparable dollar value (see [Registering quote assets](#registering-quote-assets)).
three.ws then prices each pool in dollars with the quote's live USD price, and the coin's own
dollar market cap is the supply-weighted average of its pools.

## Fees

| Fee | Value | Where it goes |
| --- | --- | --- |
| Launch fee | flat, in ETH, read live from `launchFeeWei()` (0.0005 ETH on 2026-10-09) | the launchpad treasury |
| Swap fee | read live from `swapFeeBps()`, capped at 5% in code (100 bps, 1%, on 2026-10-09) | taken in the quote asset on every buy and sell |
| Creator share | 70% of every swap fee, a constant in the contract (`CREATOR_FEE_SHARE_BPS = 7000`) | the coin's fee recipient |

The other 30% of each swap fee accrues to the treasury. Fees accrue per quote asset, so a creator
paired with three stocks earns in three assets. `claimFees(address[])` collects all of them in one
transaction, and `setFeeRecipient(token, to)` lets the current recipient point future fees at a
new wallet; fees already accrued stay with whoever earned them. When an agent launches through
three.ws, its own wallet is both the creator and the fee recipient.

The owner of the launchpad can change the launch fee, the swap fee (up to the 5% cap) and the
quote registry. The owner cannot touch a curve, a token, or accrued fees.

## Quote assets

Every asset a coin can pair with is read live from the launchpad's registry
(`quoteTokens()` plus `quoteConfig(address)`, which returns `virtualQuote` and `enabled`). Adding a
pairing on chain makes it available everywhere on three.ws with no code change.

three.ws adds what the contract cannot know:

- **Class.** From the Robinhood Chain universe that also backs
  [Robinhood Portfolios](robinhood-portfolios.md): `rwa-equity` (Stock), `stablecoin`,
  `crypto-major` (Major), `crypto-native` (Chain coin), or `unlisted` for a registered asset the
  universe does not know.
- **Canonical flag.** The universe resolves ticker impersonation by contract address, so a
  registered contract squatting on a famous ticker is still shown (the chain lets coins pair with
  it) but marked `canonical: false`.
- **Live USD price.** From the universe, re-priced live. An asset the universe cannot price (most
  often one that sits on the quote side of its own pools) is priced from its DEX pools instead, and
  a classified stablecoin with no readable pool falls back to its peg.
- **Decimals.** Quote assets do not share decimals (stock tokens and WETH are 18, USDG is 6), so
  every amount is formatted and parsed in the decimals of the asset it is denominated in.

Pairing is always by contract address. In a launch request a symbol (`NVDA`, `$nvda`, or the
tokenized `NVDAx`) is only a lookup key into the registry; when two registered contracts share a
symbol the request is refused and the error lists both addresses so you can pass one.

A disabled quote cannot be picked for new launches. Coins that already trade against it keep
trading: buys and sells only check that the pool exists.

## Pages

| Page | What it does |
| --- | --- |
| [/markets/robinhood/paired](https://three.ws/markets/robinhood/paired) | Every paired coin, newest first (24 per page, with a load-more button), each with its pool split, dollar market cap and the agent that launched it. Below it, every market a coin can pair with, filterable by class and searchable by ticker, name or contract address. |
| `/markets/robinhood/paired/:address` | One coin: each pool priced in its own asset and in dollars, a candle chart per pool (`1m` to `1d`), the latest trades refreshed every 15 seconds while the tab is visible, the verified descriptor, and a trade ticket. |
| [/launch/paired](https://three.ws/launch/paired) | An owner picks one of their agents, up to five markets, the weights (even split by default) and an optional opening buy. Every change is re-quoted live, a confirmation dialog shows the quoted cost before anything is signed, and the result links the new coin. |

The trade ticket on a coin page runs entirely in the visitor's own wallet. It prices the trade
with the launchpad's own `quoteBuy` / `quoteSell` at the curve's current point, sets the minimum
out from your slippage (0.1% to 10%, default 1%), and the contract reverts rather than fill worse.
It only asks for an approval when the allowance is short, and only for the exact amount being
traded. Selling into a pool quoted in a tokenized stock pays out a Stock Token, so that path shows
the platform's Stock Token eligibility disclosure and needs you to affirm it first.

Launched coins also show up across the platform:

- A coin an agent launches is recorded in three.ws's launch directory with chain `robinhood` and
  venue `paired`, so it appears on [/launches](https://three.ws/launches) and in the agent's
  launch history on its profile.
- `/markets/robinhood/coin/:address` forwards to the paired coin page when the address is a coin
  on the paired launchpad, so a generic Robinhood Chain link never strands a paired coin.

## Funding the agent wallet

Every three.ws agent has one EVM address, the same on Base and on Robinhood Chain. The quote
names it and its Robinhood Chain balance. Send it native ETH on Robinhood Chain to cover:

- **The launch fee**, read live from the launchpad.
- **Gas.** Launches measured on mainnet used 0.94M gas (two markets) to 1.30M (five markets).
- **The opening buy, if any.** It is paid in one of the coin's own markets, so the wallet must
  hold that asset (for example NVDA), not ETH. If the wallet has not approved the launchpad for it
  yet, the launch sends an approval for exactly the opening buy first; the quote includes that
  approval's gas.

The quote's `blockers` say exactly how much more of each asset the wallet needs.

## API

### Public reads

Free and keyless, capped at 60 requests per minute per IP (shared with the rest of
`/api/v1/robinhood/*`). All three read the chain.

| Endpoint | Returns | Edge cache |
| --- | --- | --- |
| `GET /api/v1/robinhood/paired-markets` | The launchpad's live terms and every enabled quote asset | 30 s |
| `GET /api/v1/robinhood/paired-coins` | Paired coins, newest first | 15 s |
| `GET /api/v1/robinhood/paired-coins-detail?address=0x…` | One coin in full | 10 s |

#### `GET /api/v1/robinhood/paired-markets`

```bash
curl -s https://three.ws/api/v1/robinhood/paired-markets
```

```json
{
	"config": {
		"chainId": 4663,
		"launchpad": "0x6a546350f79DE0Fc83ADfCe99233183aA090fa15",
		"launchFeeWei": "500000000000000",
		"launchFeeEth": "0.0005",
		"swapFeeBps": 100,
		"creatorShareBps": 7000,
		"maxMarkets": 5,
		"totalSupply": "1000000000",
		"owner": "0xbeeF56C074226c0C1d6052cf2ad34F3a6E7e4AbC",
		"treasury": "0xbeeF56C074226c0C1d6052cf2ad34F3a6E7e4AbC",
		"tokenCount": 3,
		"explorer": "https://robinhoodchain.blockscout.com/address/0x6a546350f79DE0Fc83ADfCe99233183aA090fa15"
	},
	"markets": [
		{
			"address": "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
			"symbol": "NVDA",
			"name": "NVIDIA • Robinhood Token",
			"decimals": 18,
			"enabled": true,
			"assetClass": "rwa-equity",
			"classLabel": "Stock",
			"canonical": true,
			"priceUsd": 232.25,
			"liquidityUsd": 1043213.73,
			"change24hPct": -2.28,
			"virtualQuote": "30",
			"openingValueUsd": 6967.5
		}
	],
	"classes": { "rwa-equity": "Stock", "stablecoin": "Stablecoin", "crypto-major": "Major", "crypto-native": "Chain coin", "unlisted": "Unlisted" },
	"count": 24,
	"source": "paired launchpad quote registry (on-chain) + dexscreener + chainlink",
	"asOf": "2026-10-09T12:00:00.000Z"
}
```

`virtualQuote` is in the asset's own units. `openingValueUsd` is the dollar market cap a coin
opens at with 100% of its supply in that pool. Markets are ordered Stock, Stablecoin, Major, Chain
coin, then by liquidity. `priceUsd`, `liquidityUsd` and `openingValueUsd` are `null` when no live
price exists.

#### `GET /api/v1/robinhood/paired-coins`

| Query | Values | Default |
| --- | --- | --- |
| `limit` | `1` to `48` | `24` |
| `offset` | `0` and up | `0` |
| `agent` | an agent UUID: only coins that agent launched through three.ws | every coin on the launchpad |

```bash
curl -s "https://three.ws/api/v1/robinhood/paired-coins?limit=1"
```

```json
{
	"coins": [
		{
			"address": "0xa95662d5712b8F8d6833B75874b6040Eb48Ff1e7",
			"chainId": 4663,
			"name": "Moon Orb",
			"symbol": "ORB",
			"metadataURI": "https://…/api/metadata/494e0a02…",
			"creator": "0xbeeF56C074226c0C1d6052cf2ad34F3a6E7e4AbC",
			"feeRecipient": "0xbeeF56C074226c0C1d6052cf2ad34F3a6E7e4AbC",
			"pairs": [
				{
					"quoteToken": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
					"quoteSymbol": "SPCX",
					"quoteDecimals": 18,
					"weightBps": 5000,
					"price": 3e-8,
					"marketCap": 30,
					"raised": "0",
					"tokensLeft": "500000000",
					"soldPct": 0,
					"virtualQuote": "15000000000000000000",
					"virtualToken": "500000000000000000000000000",
					"priceUsd": 0.000004947,
					"marketCapUsd": 4947,
					"quoteClass": "rwa-equity"
				}
			],
			"explorer": "https://robinhoodchain.blockscout.com/address/0xa95662d5712b8F8d6833B75874b6040Eb48Ff1e7",
			"marketCapUsd": 3706.2,
			"descriptor": {
				"description": "Rockets and datacenters. Paired against the two things that go up.",
				"image": "https://…",
				"links": { "website": "https://…", "twitter": null, "telegram": null },
				"origin": null,
				"verified": true
			},
			"agent": null,
			"url": "/markets/robinhood/paired/0xa95662d5712b8F8d6833B75874b6040Eb48Ff1e7"
		}
	],
	"total": 3,
	"limit": 1,
	"offset": 0,
	"hasMore": true,
	"asOf": "2026-10-09T12:00:00.000Z"
}
```

Per pool: `price` is quote units per whole coin, `marketCap` is the whole supply at that price in
the quote asset, `raised` is the real quote the pool holds (the only figure that is a claim on
something), and `soldPct` is how much of the pool's allocation has been bought. `virtualQuote` and
`virtualToken` are the raw curve reserves in base units. `agent` is `{ id, name, avatar, url,
launchedAt }` when a three.ws agent launched the coin, and `null` for a coin launched anywhere else.
`descriptor` is `null` when the metadata URI is not `https://` or did not parse.

#### `GET /api/v1/robinhood/paired-coins-detail`

| Query | Values | Default |
| --- | --- | --- |
| `address` | the coin's `0x` address, required | |
| `interval` | `1m`, `5m`, `15m`, `1h`, `4h`, `1d` | `1h` |

```bash
curl -s "https://three.ws/api/v1/robinhood/paired-coins-detail?address=0xa95662d5712b8F8d6833B75874b6040Eb48Ff1e7&interval=1h"
```

The response is everything in a `paired-coins` row, plus:

| Field | Meaning |
| --- | --- |
| `pairs[].quoteName`, `pairs[].quotePriceUsd` | The quote asset's name and live USD price |
| `pairs[].trades`, `pairs[].volume` | Trade count and volume (in the quote asset) for that pool |
| `pairs[].candles` | `{ time, open, high, low, close, volume, trades }` per interval, in the pool's own quote units. Quiet intervals are filled forward with flat candles. |
| `launch` | `{ block, txHash }` of the coin's launch |
| `terms` | `{ swapFeeBps, creatorShareBps, launchpad }` |
| `interval`, `intervals` | The interval that ran and every interval accepted |
| `trades` | The 60 most recent trades, newest first: `{ txHash, block, time, trader, isBuy, quoteToken, quoteSymbol, quoteAmount, tokenAmount, fee, price }` |
| `tradeCount` | Every trade the coin has had |

Trades and candles come straight from the launchpad's `Swap` events, so there is no ingestion
pipeline to fall behind. A malformed address answers `400 validation_error`; an address that is not
a coin on the launchpad answers `404 not_found`.

### Agent launch and fees

These act for one of your agents and sign with its custodial EVM wallet. Authenticate with the
owner's session (from the browser, same origin) or with an API key allowed to spend:
`Authorization: Bearer <key>`. A cross-site request riding the session cookie is refused.

| Endpoint | Does |
| --- | --- |
| `POST /api/agents/:id/paired/quote` | Prices the launch and checks policy and funding. Signs nothing. |
| `POST /api/agents/:id/paired/launch` | Sends the launch the quote priced. Answers `201` once it is mined. |
| `GET /api/agents/:id/paired/fees` | Swap fees the agent's wallet can claim now, per quote asset. |
| `POST /api/agents/:id/paired/claim` | Claims every one of them in one transaction, into the agent's wallet. |

`quote` and `launch` take the same JSON body, so a bot can quote, show its owner the cost, and send
the identical body to launch.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string, required | Up to 32 characters. Control characters are stripped. |
| `symbol` | string, required | Letters and digits, 2 to 10. Upper-cased; anything else is dropped. |
| `markets` | string array, required | 1 to 5 tickers (`NVDA`, `$nvda`, `NVDAx`) or `0x` quote addresses. Each must be an enabled market, at most once. |
| `weights` | number array | Percent of supply per market, same order as `markets`, each above 0, totalling exactly 100. Omit for an even split. |
| `description` | string | Up to 480 characters. |
| `image_url` | string | `https://` PNG, JPEG, WebP or GIF under 4 MB. Copied onto three.ws storage under the hash of its bytes. Defaults to the agent's avatar when the avatar is public. |
| `socials` | object | Any of `website`, `twitter`, `telegram`, each an `https://` URL up to 200 characters. |
| `dev_buy` | object | Optional opening buy: `{ "market": "NVDA", "amount": "1" }`. `market` must be one of `markets` and defaults to the first; `amount` is in that asset's units and takes no more decimals than the asset has. |

#### `POST /api/agents/:id/paired/quote`

```bash
curl -X POST https://three.ws/api/agents/$AGENT_ID/paired/quote \
  -H "authorization: Bearer $THREEWS_API_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"Chip Stack","symbol":"CHIPS","markets":["NVDA","TSLA","SPY"],"weights":[50,30,20],"dev_buy":{"market":"NVDA","amount":"1"}}'
```

An abridged quote for an agent whose wallet is still empty, with the live figures of 2026-10-09:

```json
{
	"data": {
		"chain": "robinhood",
		"chain_id": 4663,
		"venue": "paired",
		"launchpad": "0x6a546350f79DE0Fc83ADfCe99233183aA090fa15",
		"agent": { "id": "…", "name": "…" },
		"wallet": { "address": "0x…", "balance_eth": "0", "explorer": "https://robinhoodchain.blockscout.com/address/0x…" },
		"coin": {
			"name": "Chip Stack",
			"symbol": "CHIPS",
			"description": null,
			"image_url": null,
			"socials": { "website": null, "twitter": null, "telegram": null },
			"total_supply": "1000000000",
			"metadata_uri": "https://…/paired/meta/<keccak256>.json",
			"metadata_hash": "0x…"
		},
		"pairs": [
			{ "quote_token": "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", "symbol": "NVDA", "asset_class": "rwa-equity", "canonical": true, "weight_pct": 50, "supply": "500000000", "opening_value_usd": 3483.75 },
			{ "quote_token": "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", "symbol": "TSLA", "asset_class": "rwa-equity", "canonical": true, "weight_pct": 30, "supply": "300000000", "opening_value_usd": 3387.24 },
			{ "quote_token": "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", "symbol": "SPY", "asset_class": "rwa-equity", "canonical": true, "weight_pct": 20, "supply": "200000000", "opening_value_usd": 4657.86 }
		],
		"terms": { "launch_fee_eth": "0.0005", "swap_fee_bps": 100, "creator_share_bps": 7000 },
		"opening_buy": { "market": "NVDA", "amount": "1", "tokens": "30956848.030018761726078799", "pct_of_supply": 3.0956, "needs_approval": true },
		"cost": {
			"launch_fee_eth": "0.0005",
			"gas_eth": "0.00004035928",
			"gas_estimated": false,
			"total_eth": "0.00054035928",
			"total_usd": 233.6,
			"eth_usd": 2495.53
		},
		"ready": false,
		"blockers": [
			"Fund 0x… with at least 0.00054035928 more ETH on Robinhood Chain.",
			"The opening buy needs 1 more NVDA in 0x…."
		],
		"policy": { "per_tx_usd": null, "daily_usd": null, "spent_today_usd": 0 }
	}
}
```

- `opening_value_usd` is the dollar value of that pool's slice of the supply at the opening price.
- `opening_buy.tokens` is the contract's own math (fee first, then constant product, rounded the way
  the contract rounds), and the launch pins it as the minimum out. The buy settles inside the
  launch transaction, so nobody can trade the curve first, and a registry change between quote and
  send reverts the launch instead of filling worse.
- `cost.total_usd` counts the launch fee, the opening buy and gas. The spend policy is checked
  against the launch fee plus the opening buy; gas is network cost.
- `gas_estimated` is true when the wallet could cover the launch, so the node simulated the exact
  transaction. When it is false, gas is the figure measured on real launches with 30% headroom. A
  simulation that fails is returned as an error rather than a quote.
- `ready` is true when `blockers` is empty. A spend-ceiling breach is added to `blockers` too.

#### `POST /api/agents/:id/paired/launch`

Requires the real-funds agreements to be signed. Re-runs every check, stores the descriptor, sends
the approval (only when the opening buy needs one) and the launch, and answers `201` once the
launch is mined.

```json
{
	"data": {
		"chain": "robinhood",
		"chain_id": 4663,
		"venue": "paired",
		"token": "0x…",
		"name": "Chip Stack",
		"symbol": "CHIPS",
		"pairs": [
			{ "quote_token": "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", "symbol": "NVDA", "weight_pct": 50 },
			{ "quote_token": "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", "symbol": "TSLA", "weight_pct": 30 },
			{ "quote_token": "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", "symbol": "SPY", "weight_pct": 20 }
		],
		"tx_hash": "0x…",
		"block": "…",
		"gas_used": "…",
		"spent_eth": "…",
		"spent_usd": 233.5,
		"opening_buy": { "market": "NVDA", "amount": "1", "tokens": "30956848.030018761726078799" },
		"urls": {
			"coin": "/markets/robinhood/paired/0x…",
			"explorer": "https://robinhoodchain.blockscout.com/tx/0x…",
			"metadata": "https://…/paired/meta/<keccak256>.json"
		}
	}
}
```

`spent_eth` is the launch fee plus the gas actually used. `spent_usd` is the launch fee plus the
opening buy, the figure metered against the spend policy.

#### `GET /api/agents/:id/paired/fees` and `POST /api/agents/:id/paired/claim`

```bash
curl -s https://three.ws/api/agents/$AGENT_ID/paired/fees \
  -H "authorization: Bearer $THREEWS_API_KEY"
```

```json
{ "data": { "wallet": "0x…", "claimable": [{ "quoteToken": "0x…", "symbol": "NVDA", "amount": "…", "raw": "…" }] } }
```

`claim` takes no body. It calls `claimFees` with every asset in `claimable`, pays only gas, and
answers `{ "data": { "wallet", "claimed", "tx_hash", "explorer" } }`. A claim moves funds into the
agent's own wallet, so no spend ceiling applies, but the signature is still custodial, audited, and
recorded in the custody ledger as a receipt.

### Errors

Errors use the standard `{ "error", "error_description" }` shape.

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `validation_error` | The body failed the schema (a missing name, too many markets, a weight over 100). Nothing was sent. |
| 400 | `bad_request` | The request is well formed but cannot be launched: an unknown or ambiguous market, a repeated market, weights that do not total 100, a ticker under two characters, a non-https link, a logo that is not an image. The message says which. |
| 401 | `unauthorized` | No session and no API key. |
| 403 | `forbidden` | Not your agent, or a cross-site request. |
| 403 | `insufficient_scope` | The API key lacks `wallet:write`, which every POST here needs. |
| 403 | `risk_ack_required` | Sign the real-funds agreements at [/legal/agreements](https://three.ws/legal/agreements) first. |
| 404 | `not_found` | Unknown agent, or an unknown action. |
| 409 | `launch_blocked` | The wallet cannot cover the launch. `detail.blockers` says what is missing. |
| 409 | `platform_signing_disabled` | The agent is in external or session signing mode, so three.ws will not sign for it. |
| 409 | `nothing_to_claim`, `needs_gas` | No fees have accrued yet, or the wallet cannot pay the claim's gas. |
| 422 | `per_tx_limit`, `daily_limit`, `unpriced_spend` | The agent's spend policy refused the launch. |
| 422 | `bad_request` | The launchpad would revert this exact launch. The message carries the reason. |
| 422 | `simulation_failed` | The claim would revert. |
| 423 | `wallet_frozen` | The agent wallet is frozen. |
| 429 | `rate_limited` | Too many requests from this IP. |
| 502 | `send_failed`, `launch_reverted`, `launch_unreadable`, `claim_reverted` | The node refused the transaction, or it reverted on chain (only gas was spent). |

## Safety rails

A launch spends real ETH (and the opening buy asset), so it runs through every rail a custodial
spend on three.ws runs through, in this order:

- The caller must own the agent.
- The agent must be in platform-signing mode.
- The owner must have signed the real-funds agreements.
- The launch fee and opening buy are priced in USD and checked against the agent's per-transaction
  and daily ceilings for Robinhood Chain, metered separately from Solana and Base (see
  [custody](custody.md)).
- The wallet must cover the fee, the opening buy and gas, and the exact transaction must simulate.
- Only then is the key decrypted, with an audit row. The spend is written to the custody ledger as
  pending before the send and settled after the receipt, so two launches at once cannot both slip
  under the daily ceiling.
- The launch carries a 10-minute deadline, so a transaction stuck in a mempool cannot land long
  after the owner approved it.
- An opening-buy approval is for exactly the buy, never unlimited.

Every surface quotes before it spends. The owner page shows a confirmation dialog with the quoted
cost before it launches. The `paired-launch` skill only quotes unless it is called again with
`confirm: true`. Over MCP, `paired_launch` is refused without a fresh preview from
`paired_launch_quote` (see below).

## Agent skills

The agent runtime registers three paired-coin skills on every agent (`src/agent-skills-paired.js`),
all exposed to MCP:

| Skill | Does |
| --- | --- |
| `paired-markets` | Lists every market a coin can pair with, grouped by class. Used before a launch when the owner has not named exact markets. |
| `paired-launch` | Without `confirm`, quotes and says the cost, pools and blockers in one sentence. Called again with the same arguments and `confirm: true`, it launches. Takes `markets`, `weights`, `name` (defaults to the agent's name), `symbol` (defaults to the name, upper-cased), `description`, `image_url`, `socials`, `buy_amount` and `buy_market`. |
| `paired-fees` | Reads what the agent can claim. With `claim: true`, claims it. |

## MCP tools

The core server at `https://three.ws/api/mcp` serves seven paired-coin tools (`api/_mcp/tools/paired.js`),
backed by the same libraries as the REST API, so ownership, signer mode, spend ceilings and the
audit trail are identical on both surfaces.

| Tool | Tier | Annotations | Auth |
| --- | --- | --- | --- |
| `paired_markets` | read | read-only | none |
| `paired_coins` | read | read-only | none |
| `paired_coin` | read | read-only | none |
| `paired_launch_quote` | write | not read-only, not destructive | `wallet:read` |
| `paired_launch` | financial | destructive (moves money) | `wallet:write` |
| `paired_fees` | read | read-only | `wallet:read` |
| `paired_claim_fees` | write | destructive (moves money) | `wallet:write` |

The three reads are public on-chain state and are served to anonymous plain JSON-RPC callers:

```bash
curl -s -X POST https://three.ws/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"paired_markets","arguments":{"class":"rwa-equity"}}}'
```

`paired_coins` takes `agent_id`, `limit` (1 to 48, default 12) and `offset`. `paired_coin` takes
`address` and `interval`.

`paired_launch` is a financial tool, so it follows the shared
[tool policy](mcp-agent.md#tool-policy-financial-tools-are-off-by-default): it is hidden from
`tools/list` until the connection enables it (for example `X-Three-Tools: default,launch`), and a
call is refused unless it carries `confirm_launch: true` and a fresh preview id. The preview id is
issued on the `paired_launch_quote` result (in a text note and in
`_meta["three.ws/preview"].quote_id`) and is valid for 10 minutes, for the same caller only. Pass it
to `paired_launch` as `quote_id`. The policy binds every launch argument (`agent_id`, `markets`, `weights`,
`name`, `symbol`, `description`, `image_url`, `socials`, `dev_buy`), so a launch that differs from
what was quoted is refused with `preview_mismatch`. Only send `confirm_launch: true` after the
owner approved the quote.

`paired_claim_fees` is annotated destructive because it signs a transaction from the agent's
custodial wallet, even though the funds land in that same wallet.

## Registering quote assets

New pairings are registered by the launchpad owner with `setQuoteConfig(quote, virtualQuote,
enabled)`. On three.ws, `npm run paired:quotes` builds that call for you, calibrated, and by
default only prints the plan. The script is `scripts/paired-register-quotes.mjs`.

```bash
# Plan only: prints the calibrated reserve and calldata, sends nothing.
npm run paired:quotes -- --assets WETH,USDG

# Override the opening value instead of matching the existing markets.
npm run paired:quotes -- --assets WETH --target-usd 6000
```

Per asset, the script:

1. **Resolves it by contract address** against the Robinhood Chain universe, so a symbol always
   means the canonical token and never a contract squatting on its ticker. Unknown, ambiguous,
   unlisted and impersonating contracts are refused.
2. **Checks it is a sane quote:** a live USD price, at least $100,000 of liquidity
   (`--min-liquidity` to change), on-chain `decimals()` matching the universe, and not already
   enabled.
3. **Calibrates `virtualQuote`** so a coin with 100% of its supply in this pool opens at the same
   dollar market cap as the markets already on the launchpad: their live median `openingValueUsd`,
   unless `--target-usd` is given. The value is rounded to four significant figures and written in
   the asset's own decimals.
4. **Prints the exact `setQuoteConfig` calldata**, the target contract and the owner that must sign.

A plan run on 2026-10-09 matched the existing markets' median of $7,305 per full-weight pool:

```
  enable   WETH     crypto-major  0x0bd7d308f8e1639fab988df18a8011f41eacad73
           virtualQuote 2.927 WETH (2927000000000000000 base units), priced 2495.53 USD, opens at $7,304
  enable   USDG     stablecoin    0x5fc5360d0400a0fd4f2af552add042d716f1d168
           virtualQuote 7306 USDG (7306000000 base units), priced 0.9999 USD, opens at $7,305

plan only: 2 setQuoteConfig transaction(s), each signed by the owner 0xbeeF…4AbC. Re-run with PAIRED_OWNER_KEY and --apply to send.
```

The same dollar value is 2.927e18 base units of an 18-decimal asset and 7306e6 of a 6-decimal one,
which is exactly what the decimals-correct calibration is for. At the time of writing every
registered quote is a tokenized stock at a flat 30 shares, so their dollar opening values differ by
more than a hundredfold; the live figures are always in `paired-markets`.

### Applying (owner only)

Registering a quote is a permanent on-chain action by the launchpad owner. The script never signs
unless both of these hold:

- `--apply` is passed, and
- `PAIRED_OWNER_KEY` holds a private key whose address the contract itself reports as `owner()`.
  Any other key is refused before anything is sent.

With both, it sends each `setQuoteConfig`, waits for the receipt, fails loudly on a revert, and
reads `quoteConfig` back to print the new state. `--disable` (also only with `--apply` and the
owner key) turns an enabled quote off at its current reserve; coins already trading against it keep
trading.

Only plain ERC-20s qualify as quotes: no fee-on-transfer, no rebasing. The curve accounts in the
amounts it asked to move, so a token that delivers less than asked would leave the pool
under-backed. Every asset the universe classifies is a plain Uniswap-traded ERC-20 or a Robinhood
Stock Token.

## For developers

| Piece | Where |
| --- | --- |
| Contracts, tests, bytecode check | [contracts/paired-launchpad/](../contracts/paired-launchpad/README.md) |
| ABI, registry, coin reads, claimable fees | `api/_lib/paired-launchpad.js` |
| Market classes, prices, allocation rules | `api/_lib/paired-markets.js` |
| Descriptor verification, coin list and detail | `api/_lib/paired-directory.js` |
| Trades and candles from `Swap` events | `api/_lib/paired-trades.js` |
| Custodial quote, launch and claim | `api/_lib/evm-leg/paired-launch.js` |
| HTTP | `api/agents/paired/[action].js`, `api/v1/robinhood/paired-{markets,coins,coins-detail}.js` |
| MCP tools | `api/_mcp/tools/paired.js` |
| Agent skills | `src/agent-skills-paired.js` |
| Pages | `pages/paired-coins.html`, `pages/paired-coin.html`, `pages/launch-paired.html`, runtime in `src/paired/` |
| Operator script | `scripts/paired-register-quotes.mjs` (`npm run paired:quotes`) |

Every surface is mapped in [STRUCTURE.md](../STRUCTURE.md). The contract is not audited: its tests
demonstrate the intended behaviour, and are not a substitute for someone trying to break it.
