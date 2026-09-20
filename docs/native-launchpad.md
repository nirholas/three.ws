# The three.ws launchpad: a bonding curve priced in $THREE

three.ws has always been able to launch a coin for an agent. Until now, every one of those launches went out on pump.fun: their program, their curve, their fee schedule. That lane still exists and still matters, because that is where the buyers are.

This document covers the second lane: **the native launchpad**, a coin launch that runs on a bonding curve three.ws configures and owns, and that is **quoted in $THREE**. Same launch button, same 3D agent identity attached to the coin, different economics underneath. The public page is [three.ws/three-launchpad](https://three.ws/three-launchpad).

Related surfaces: [the pump.fun lane](./api-reference.md) (`/api/pump/*`), [agent wallets](./agent-wallets.md) (custody), and [the launch page](https://three.ws/launch).

---

## Why a second lane exists

A launchpad's revenue is a share of trading fees. On the pump.fun lane, three.ws only ever touches the creator-fee side of a launch, because the platform fee belongs to pump.fun. On the native lane, three.ws is the on-chain partner of the curve itself, so the platform earns a share of every trade on every coin launched through it, plus a share of the fees the pool keeps earning after graduation.

The tradeoff is honest and worth stating plainly: pump.fun brings order flow that a new curve does not have. Trading terminals and aggregators index pump.fun natively. So the two lanes are not a migration, they are a choice the launcher makes per coin: **reach, or economics.**

## Why the curve is priced in $THREE

A SOL-quoted curve makes three.ws one more launchpad. A $THREE-quoted curve makes every coin launched here part of $THREE's own economy:

- **Buying any coin is buying $THREE first.** The curve accepts nothing else, so every new buyer of every coin on the lane is a $THREE buyer.
- **Creators are paid in $THREE.** Half of every trade's fee goes to the agent's creator, in $THREE, for as long as the coin trades. Launching here makes you a $THREE holder with a reason to stay one.
- **Graduation locks $THREE away.** A coin that fills its curve moves to a Meteora pool against $THREE with all of its liquidity permanently locked: about 12.3M $THREE per graduated coin, roughly 1.2% of $THREE's supply, out of circulation for good.

SOL-quoted launches are what the pump.fun lane is for. This lane exists to put $THREE in the middle.

$THREE is a Token-2022 mint carrying only the metadata-pointer and token-metadata extensions, with no mint or freeze authority, and the DBC program accepts it as a quote mint. That is verified, not assumed: `node scripts/native-launchpad-create-config.mjs --simulate` creates the config and a $THREE-quoted pool against the live mainnet program in simulation, with no key and no spend.

## What the native lane does not do

Building our own bonding-curve program from scratch would mean writing, auditing, and maintaining custody-grade Solana code, and then bootstrapping liquidity for graduated coins with no venue to graduate into. We did not do that.

The native lane runs on **Meteora's Dynamic Bonding Curve (DBC)** program: an audited, permissionless launchpad-as-infrastructure program. three.ws creates a *partner config* on it once per network. That config encodes our curve shape, our fee split, and our graduation target, and every pool created under our config key is a three.ws launch. We own the product, the economics, and the brand; we do not own the risk of unaudited custody code, and graduated coins land in a real AMM pool with real routing.

---

## The curve

All of it lives in one file, [`api/_lib/native-launch/config.js`](../api/_lib/native-launch/config.js), so the numbers a user is shown can never drift from the numbers the chain enforces.

| Property | Value |
|---|---|
| Quote asset | $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) |
| Supply | 1,000,000,000 (6 decimals) |
| Metadata authority | Immutable at launch |
| Starting market cap | 4,000,000 $THREE |
| Graduation market cap | 60,000,000 $THREE (about 12.3M $THREE raised on the curve) |
| Trading fee | 1%, taken in $THREE, plus a volatility-scaled dynamic fee during spikes |
| Trading fee split | 50% coin creator / 50% three.ws |
| Migration fee | 1% of the raised $THREE, split 50/50 |
| Graduates into | A Meteora DAMM v2 pool against $THREE |
| LP at graduation | 100% permanently locked (50% creator / 50% platform) |

Two of these deserve emphasis:

**The metadata authority is immutable.** Nobody, including three.ws, can rewrite a launched coin's name, symbol, or image after the fact.

**All liquidity is permanently locked at graduation.** Neither the creator nor the platform can withdraw the pool. A graduated native coin cannot be rugged by liquidity removal, and both sides keep earning LP fees on it for as long as it trades.

The curve deliberately mirrors the shape traders already recognise from pump.fun (28 to 410 SOL of market cap, about 85 SOL raised), converted to $THREE at the price on 2026-09-20. The thresholds are fixed in the on-chain config. If $THREE's price moves far enough that they no longer fit, the fix is a new config and a re-pinned env key; coins already launched keep the curve they launched on.

### The quote-token-program patch

The DBC program takes the quote mint's token program as an ordinary account, so a Token-2022 quote is supported on-chain. SDK 1.5.x nevertheless hardcodes the legacy SPL Token program into `token_quote_program` when it builds a pool-initialize instruction, and with a Token-2022 quote the instruction fails with `IncorrectProgramId` as soon as the program creates the quote vault. `withQuoteTokenProgram` in [`dbc.js`](../api/_lib/native-launch/dbc.js) rewrites that one account, located by its position in the program's own IDL. Swaps are unaffected: the SDK reads the token program from the config for those. Remove the patch when the SDK is fixed upstream.

### Why `leftover: 1`

The DBC program requires that the tokens on the curve, the tokens reserved for migration, and the leftover reconcile *exactly* against the fixed supply. A leftover of `0` fails that check on-chain with `InvalidTokenSupply`. One base unit of dust satisfies it. This was found by simulating the real `create_config` instruction against devnet, and it is pinned by a test so nobody "cleans it up" later.

---

## How a launch works

The custody model is identical to the pump.fun lane: **the server never holds a user key.** It builds an unsigned transaction; the browser signs it with the launcher's wallet and the new mint's keypair; a confirm step verifies the landed transaction on-chain before anything is recorded.

```
POST /api/native-launch/launch-prep     → unsigned create-pool tx + mint keypair
   ↓  (browser signs with wallet + mint, submits to Solana)
POST /api/native-launch/launch-confirm  → verifies on-chain, records the launch
```

### `POST /api/native-launch/launch-prep`

Requires a session and a Solana wallet linked to that account.

```json
{
  "avatar_id": "e29028e5-dcdf-4359-8101-0fb8cbba5dc3",
  "wallet_address": "<your linked Solana wallet>",
  "name": "Native Coin",
  "symbol": "NTV",
  "uri": "https://three.ws/metadata.json",
  "three_buy_in": 50000,
  "network": "mainnet"
}
```

`agent_id` may be sent instead of `avatar_id`. `three_buy_in` is an optional first buy, in $THREE, bundled into the same transaction. The signing wallet must hold it. `mint_address` may carry a client-ground vanity mint; omit it and the server grinds one.

Returns `201` with the unsigned transaction and the deterministic pool address:

```json
{
  "prep_id": "…",
  "agent_id": "…",
  "lane": "native",
  "mint": "3ws…",
  "pool": "…",
  "config_key": "…",
  "mint_secret_key_b64": "…",
  "client_supplied_mint": false,
  "tx_base64": "…",
  "network": "mainnet",
  "expires_at": "2026-07-27T17:50:51.336Z"
}
```

Every three.ws coin's mint address carries the `3ws` mark, on both lanes. When the server stamps the mint it returns the secret so the browser can co-sign; when you supply your own ground vanity mint, the server never sees its key.

Errors: `401` not signed in, `403` wallet not linked to your account, `400 unbranded_mint` for a supplied mint without the mark, `503 lane_not_configured` when the curve is not deployed on that network.

### `POST /api/native-launch/launch-confirm`

```json
{ "prep_id": "…", "tx_signature": "…" }
```

Before recording anything, the server independently verifies the signature against the chain and applies two guards:

1. The prepped mint must appear in the transaction's account keys.
2. The transaction must actually have **invoked the bonding-curve program** (`422 not_a_native_launch` otherwise).

The second guard is the important one: without it, a confirmed memo or transfer that merely touches the new mint account could be recorded as a launch. Returns `201` with the recorded row, or `409` if that mint is already registered.

### Read endpoints

All public, no auth:

- `GET /api/native-launch/config[?network=]` — the lane's live economics and whether it is deployed. This is what the launch UI renders, so the fee story on the page always comes from the same source as the on-chain config.
- `GET /api/native-launch/pool?mint=…[&network=]`: pool address, curve progress (0..1), `quote_reserve_three` ($THREE held in the curve), `migration_quote_threshold_three`, migration status.
- `GET /api/native-launch/quote?mint=…&three_in=…[&network=]`: a live buy quote off the curve: tokens out, minimum out, and the fee breakdown in $THREE. Pass `tokens_in=…` instead for a sell quote (`three_out`, `min_three_out`).
- `GET /api/native-launch/launches[?network=&agent_id=&limit=&offset=]`: the native launch directory, each row carrying its agent and avatar thumbnail. `agent_id` must be a uuid: anything else answers `400 validation_error` instead of reaching the database. `limit` is clamped to 1..100 (default 24), `offset` to a non-negative integer.

### `POST /api/native-launch/swap-prep`

Public, no session: trading a curve needs only the trader's signature.

```json
{ "mint": "3ws…", "wallet_address": "<trader>", "side": "buy", "amount": 50000, "slippage_bps": 100, "network": "mainnet" }
```

A `buy` spends `amount` $THREE; a `sell` spends `amount` of the coin's tokens. The quote is taken in the same call, so the slippage floor inside the transaction is the one returned as `min_out`. Returns `tx_base64` (an unsigned v0 transaction for the trader's wallet), `expected_out`, `min_out`, and the pool address.

---

## Deploying the lane on a network

The partner config is created once per network and then pinned in the environment. Until it is pinned, the lane reports itself unavailable, the launch UI hides the lane toggle entirely, and every launch stays on pump.fun. There is no half-configured state.

```bash
# mainnet dry run: no key, no spend. Creates the config and a $THREE-quoted pool in simulation.
node scripts/native-launchpad-create-config.mjs --simulate

# devnet: $THREE exists on mainnet only, so this first mints a Token-2022 stand-in
# shaped like it, then creates the config against that
node scripts/native-launchpad-create-config.mjs --network devnet --create-quote-mint --airdrop

# mainnet: spends about 0.006 SOL of rent from the partner wallet. Owner-approved only.
node scripts/native-launchpad-create-config.mjs --network mainnet
```

The script prints the config pubkey (and on devnet the stand-in quote mint). Pin them:

| Variable | Meaning |
|---|---|
| `NATIVE_LAUNCH_CONFIG_KEY` | Mainnet partner config pubkey |
| `NATIVE_LAUNCH_CONFIG_KEY_DEVNET` | Devnet partner config pubkey |
| `NATIVE_LAUNCH_QUOTE_MINT_DEVNET` | Devnet stand-in for $THREE, the mint the devnet config is quoted in |
| `NATIVE_LAUNCH_FEE_WALLET` | Platform fee claimer + leftover receiver (defaults to the treasury wallet) |
| `NATIVE_LAUNCH_PARTNER_SECRET_BASE58` | Signer that creates the config (falls back to the treasury secret) |

On production these live on the Cloud Run service, not in a file.

### Verifying a deployment end to end

`scripts/native-launchpad-e2e-devnet.mjs` drives the real modules the API uses: it builds a create-pool transaction with a first buy in the stand-in $THREE, signs and lands it on devnet, reads the pool back, then builds, signs and lands a buy and a sell through `buildSwapTx`, asserting after each that the curve and its $THREE reserve moved the right way.

```bash
node scripts/native-launchpad-e2e-devnet.mjs
```

The SOL-quoted v1 of this lane was proven end to end on devnet (config `FK3HQrWG5y6rh3SC8ew5WVUfo31bfmkm2Z1nwuZaKcam`). The $THREE-quoted v2 has been proven against **mainnet in simulation** (config plus pool creation succeed against the live program with the real $THREE mint). Its devnet run was not possible on the day it shipped because the devnet faucet was dry, so the buy and sell transactions have not yet landed on any chain. Run the devnet script before opening the lane on mainnet.

---

## Where it lives

| Piece | Path |
|---|---|
| Curve economics (single source of truth) | [`api/_lib/native-launch/config.js`](../api/_lib/native-launch/config.js) |
| DBC wrapper (build launch and swap txs, read pool, quote) | [`api/_lib/native-launch/dbc.js`](../api/_lib/native-launch/dbc.js) |
| Public page (lane facts, coin directory, buy and sell, launch) | [`pages/three-launchpad.html`](../pages/three-launchpad.html) + [`src/three-launchpad/`](../src/three-launchpad) `→ /three-launchpad` |
| HTTP dispatcher | [`api/native-launch/[action].js`](../api/native-launch/%5Baction%5D.js) |
| Launch table | `native_launches` (migration `20260726100000_native_launchpad.sql`) |
| Launch UI (lane toggle) | [`public/studio/launch-panel.js`](../public/studio/launch-panel.js) |
| Config creation | [`scripts/native-launchpad-create-config.mjs`](../scripts/native-launchpad-create-config.mjs) |
| Devnet end-to-end | [`scripts/native-launchpad-e2e-devnet.mjs`](../scripts/native-launchpad-e2e-devnet.mjs) |
| Tests | `tests/native-launch-curve.test.js`, `tests/native-launch-endpoint.test.js` |

Note the namespace: this lane is `/api/native-launch/*`. The unrelated `/api/launchpad/*` endpoints belong to Launchpad Studio, the page builder.

---

## Current limits

Stated plainly, because a half-built feature that claims to be finished is worse than one that names its edges:

- **No custodial launch path.** The pump.fun lane can launch from an agent's own server-signed wallet; the native lane is always signed by the launcher's connected wallet. The lane toggle switches the signer back to the connected wallet automatically rather than offering an option that would fail.
- **No coin-detail page yet.** `/launches/<mint>` reads price history, trades, safety, and smart-money data from pump-specific endpoints, so it cannot render a native coin. The launch success screen links to Solscan and the agent page instead of a link that would 404.
- **No coin variants.** Mayhem, USDC pairing, buyback binding, and delegated reward splits are pump.fun program features. The native lane is $THREE-quoted and variant-free, so that picker is withheld on this lane rather than shown with dead options.
- **No one-click buy from SOL.** A buyer who holds only SOL swaps to $THREE first (the page links to [/three-token](https://three.ws/three-token)). Bundling a Jupiter SOL to $THREE swap in front of the curve buy is the obvious next step.
- **Thin $THREE liquidity cuts both ways.** A graduation needs about 12.3M $THREE bought through the curve. That is the point, and it also means early curves fill slowly until $THREE's own liquidity deepens.
