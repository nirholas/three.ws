# Launch a coin on Robinhood Chain (Pons)

A three.ws agent can launch its own coin on [Robinhood Chain](robinhood-chain-markets.md)
through [Pons](https://ponsfamily.com), the chain's busiest launchpad. The agent's own wallet
signs the launch, so the coin's creator is the agent. Creator fees go to the agent, and so does
the opening buy.

There are three ways in, and all of them run the same server path:

| Who | How |
| --- | --- |
| An owner, by hand | [three.ws/launch/robinhood](https://three.ws/launch/robinhood) |
| A bot or script | `POST /api/agents/:id/pons/quote`, then `POST /api/agents/:id/pons/launch` |
| The agent itself | the `pons-launch` agent skill |

## What a launch does

Pons V2 mints a fixed 1,000,000,000 supply onto a bonding curve priced in ETH. Trading starts
in the same block. When 4.2 ETH of real buys has gone into the curve, the coin graduates into a
full-range Uniswap V4 pool whose liquidity is locked permanently. These figures are Pons's live
launch config, and the quote reads them from the factory every time, so they are never stale.

The launch is one transaction from the agent's wallet:

- **With an opening buy:** the transaction goes to Pons's `PonsV2LaunchAndBuy` router. It deploys
  the token and curve and buys in the same transaction, so no sniper can trade ahead of the agent.
  The agent's address is recorded as the deployer and is exempt from Pons's anti-snipe tax.
- **Without one:** it calls `PonsV2LaunchFactory.launchToken` directly.

Either way, the transaction pins the economics it was quoted, so a change Pons makes to its
fees or curve in between reverts the launch instead of silently repricing it.

Contracts (MIT, verified source at
[ponsdotdev/pons-labs](https://github.com/ponsdotdev/pons-labs)):

| Contract | Address |
| --- | --- |
| `PonsV2LaunchFactory` | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| `PonsV2LaunchAndBuy` | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` |

## Funding the agent wallet

Every three.ws agent has one EVM address. It is the same address on Base and on Robinhood Chain.
The quote names that address and its balance on Robinhood Chain. Send it native ETH on Robinhood
Chain (chain ID 4663) to cover the following:

- **Pons launch fee:** a flat fee, currently 0.0005 ETH.
- **Opening buy:** whatever you choose, from 0 up to 4 ETH.
- **Gas:** a launch uses about 3.5 to 3.7 million gas.

The quote tells you exactly how much more the wallet needs.

## API

Both endpoints take the same JSON body. Authenticate either with the owner's session (from the
browser, same origin) or with an API key that is allowed to spend:
`Authorization: Bearer <key>`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string, required | Up to 64 bytes. |
| `symbol` | string, required | Letters and digits, up to 16. A leading `$` is dropped. |
| `description` | string | Up to 2048 bytes. |
| `image_url` | string | `https://`, `ipfs://` or `ar://`, up to 512 bytes. Defaults to the agent's avatar when the avatar is public. |
| `socials` | object | Any of `twitter`, `telegram`, `discord`, `website`, `farcaster`, each an `https://` URL. |
| `buy_eth` | number | Opening buy in ETH, 0 to 4. Default 0. |
| `creator_tax_bps` | integer | Extra trade tax paid to the agent, 0 to 1000 (10%). Default 0. |
| `buyback` | boolean | Route the buyback share of fees into Pons's five-year locked buyback. Default false. |

### `POST /api/agents/:id/pons/quote`

Signs nothing. Returns the live terms, the full cost, the tokens the opening buy will receive,
the agent wallet and its balance, the agent's spend policy, and `blockers`, which lists anything
that would stop a launch right now (an unfunded wallet, a spend-limit breach, launches paused).
`ready` is true when `blockers` is empty.

```bash
curl -X POST https://three.ws/api/agents/$AGENT_ID/pons/quote \
  -H "authorization: Bearer $THREEWS_API_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"My Coin","symbol":"MINE","buy_eth":0.01,"creator_tax_bps":100}'
```

```json
{
	"data": {
		"chain": "robinhood",
		"chain_id": 4663,
		"venue": "pons",
		"wallet": { "address": "0x694D1afeDbBb2C1aE6546641C604c5a7aF014EF0", "balance_eth": "0" },
		"terms": {
			"launch_fee_eth": "0.0005",
			"curve_fee_bps": 100,
			"max_creator_tax_bps": 1000,
			"graduation_threshold_eth": "4.2",
			"total_supply": "1000000000"
		},
		"cost": {
			"launch_fee_eth": "0.0005",
			"opening_buy_eth": "0.01",
			"gas_eth": "0.00010171434",
			"gas_estimated": false,
			"total_eth": "0.01060171434",
			"total_usd": 27.18,
			"eth_usd": 2564.12
		},
		"opening_buy": { "tokens": "5799502.899751449875724937", "pct_of_supply": 0.5799 },
		"ready": false,
		"blockers": ["Fund 0x694D…4EF0 with at least 0.01060171434 more ETH on Robinhood Chain."],
		"policy": { "per_tx_usd": null, "daily_usd": null, "spent_today_usd": 0 }
	}
}
```

`gas_estimated` is true when the wallet could cover the launch, so the node simulated the exact
transaction. When it is false, the gas figure is the gas measured on real Pons launches.

### `POST /api/agents/:id/pons/launch`

Sends the same transaction the quote priced. The call answers once the transaction is mined,
which takes about a second on Robinhood Chain.

```json
{
	"data": {
		"chain": "robinhood",
		"venue": "pons",
		"token": "0x…",
		"curve": "0x…",
		"name": "My Coin",
		"symbol": "MINE",
		"tx_hash": "0x…",
		"block": 83042365,
		"spent_eth": "0.0106",
		"spent_usd": 26.92,
		"opening_buy": { "eth": "0.01", "tokens": "5799502.89" },
		"urls": {
			"pons": "https://ponsfamily.com/launchpad/0x…",
			"explorer": "https://robinhoodchain.blockscout.com/tx/0x…",
			"coin": "/markets/robinhood/coin/0x…"
		}
	}
}
```

### Errors

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `validation_error`, `symbol_invalid`, `logo_invalid`, `social_invalid`, `field_too_long`, `tax_too_high` | Fix the request. Nothing was sent. |
| 401 | `unauthorized` | No session and no API key. |
| 403 | `forbidden` | Not your agent, or a cross-site request. |
| 403 | `risk_ack_required` | Sign the real-funds agreements at [/legal/agreements](https://three.ws/legal/agreements) first. |
| 409 | `launch_blocked` | The wallet cannot cover the launch, or Pons has paused launches. `detail.blockers` says which. |
| 409 | `platform_signing_disabled` | The agent is in external or session signing mode, so three.ws will not sign for it. |
| 422 | `per_tx_limit`, `daily_limit`, `unpriced_spend` | The agent's spend policy refused the launch. |
| 422 | `simulation_failed` | Pons would revert this exact transaction. The message carries the reason. |
| 423 | `wallet_frozen` | The agent wallet is frozen. |
| 502 | `send_failed`, `launch_reverted` | The node refused the transaction, or it reverted on chain (only gas was spent). |
| 503 | `pons_router_rotated` | Pons moved its launch router. three.ws refuses rather than send to the old one. |

## Safety rails

A launch spends real ETH, so it runs through every rail a custodial spend on three.ws runs through:

- The caller must own the agent.
- The agent must be in platform-signing mode.
- The owner must have signed the real-funds agreements.
- The launch fee and opening buy are priced in USD and checked against the agent's per-transaction
  and daily ceilings for Robinhood Chain. These are metered separately from Solana and Base (see
  [custody](custody.md)).
- The spend is written to the custody ledger as pending before the transaction is sent, so two
  launches at once cannot both slip under the daily ceiling.
- The key decrypt is audited.

The owner page always shows a confirmation with the wallet, destination, chain and amount before
it launches. The `pons-launch` skill quotes first, and only launches when it is called again with
`confirm: true`.

## Where launched coins show up

A launched coin is recorded in three.ws's launch directory with chain `robinhood` and venue `pons`:

- It appears on [/launches](https://three.ws/launches) with a Robinhood Chain badge, a Pons trade
  link and an explorer link.
- It appears in the agent's launch history on its profile.
- It opens on its Robinhood coin page at `/markets/robinhood/coin/<address>`.

Every Pons launch, from three.ws or anywhere else, also appears in the Recent Launches feed on
[/markets/robinhood](https://three.ws/markets/robinhood) and in
`GET /api/v1/robinhood/launches`. That feed shows curve price, market cap and graduation progress.

## For developers

- Calldata and curve math live in `api/_lib/pons.js`.
- The custodial launch lives in `api/_lib/evm-leg/pons-launch.js`.
- The HTTP door is `api/agents/pons/[action].js`.
- `tests/pons.test.js` rebuilds real mainnet Pons launches byte-for-byte from
  `tests/fixtures/pons-v2-launches.json`. It also checks that the opening-buy quote matches the
  tokens the curve actually paid out.
