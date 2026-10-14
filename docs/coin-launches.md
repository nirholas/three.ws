# Coin Launches

three.ws agents and users can launch coins on pump.fun directly from the platform.
The launch path is real and on chain; this page documents the **mechanism** — how
a launch is prepared, signed, submitted, recorded, and surfaced.

> Source: [`api/pump/[action].js`](../api/pump/[action].js),
> autonomous launcher [`api/agents/pumpfun/[action].js`](../api/agents/pumpfun/[action].js),
> launcher cron [`api/cron/launcher-tick.js`](../api/cron/launcher-tick.js).

---

## Two launch modes

### User launch (client-signed)

1. `launch-prep` — assembles metadata and returns the unsigned pump.fun create
   (or create-and-buy) transaction. Metadata can be built separately via
   `build-metadata`.
2. The client signs locally with the user's wallet.
3. `launch-confirm` — submits the signed transaction; on success the mint is
   recorded in `pump_agent_mints`.

The user holds the keys; the platform never signs for them.

### Autonomous agent launch (server-signed)

The agent launcher signs and submits with the agent's **custodial** Solana keypair
server-side (`launch-agent`), through the protected execution path
(`submitProtected()`). Spend caps are checked before signing (see
[Agent wallets](custody.md)), and the mint is registered in
`pump_agent_mints`. The `launcher-tick` cron (every minute) drives the
autonomous launcher engine (`api/_lib/launcher-engine.js`), bounded by
per-launch and daily SOL caps, an hourly ceiling, a cadence gate, and a circuit
breaker from its `launcher_config` row; a scope whose row is disabled stays
inert. The [circulation engine](circulation-engine.md) also runs its own
`launch` action with separate hourly/daily caps.

## What a launch carries

| Element | Notes |
|---|---|
| Name, symbol, metadata URI | Metadata pinned off-chain; image + description assembled at prep. |
| Quote mint | Resolved to the network-correct pairing (USDC mint or SOL-paired). |
| Dev buy | A small initial buy can accompany the create (the `LAUNCH_FLOOR` covers create + tiny dev buy + fees). |
| Buyback authority | A buyback basis-points configuration can be attached to the agent mint. |
| Mint mark | When `THREE_WS_MARK_ENFORCE` is on (the default; set `0`/`false` to disable), the mint address is vanity-ground to carry the three.ws mark (see [Mint mark](mint-mark.md), [Vanity protocol](PROTOCOL-vanity.md)). |

## Recording and surfacing

| Sink | Surface |
|---|---|
| `pump_agent_mints` (mint + network keyed) | `/launches` feed, agent-profile launch history. |
| `pump_agent_trades` | Trade history for the mint. |
| `agent_custody_events` | The on-chain spend (create + dev buy). |
| Live ticker | `coin-buy` / `agent-deploy` events (see [Money feed](money-feed.md)). |

The `launches`, `by-agent`, and `quote` actions on `api/pump/[action].js` read
these back for the directory and detail pages. Coin detail pages render a live
interactive trading chart from market data.

## Trading, selling, withdrawing

The same dispatcher handles the full lifecycle beyond launch: `buy-prep` /
`buy-confirm`, `sell-prep` / `sell-confirm`, `portfolio`, `balances`, and
`withdraw-prep` / `withdraw-confirm`, plus strategy actions
(`strategy-backtest`, `strategy-validate`, `strategy-close-all`) that back the
[sniper](autonomous-x402.md).

## Launch receipt

`/launches/<mint>` composes five of the facts above (mint and freeze
authority, supply, top-10 holder share, fee routing, the creation
transaction, and the Trade Safety Firewall's verdict) into one plain-English
receipt, so a trader can read or share one object instead of piecing five
panels together.

```
GET /api/pump/launch-receipt?mint=<mint>&network=<mainnet|devnet>
```

Public, CORS-open, cached `public, max-age=60, s-maxage=300`
(`api/pump/launch-receipt.js` `buildReceipt`). Each section fails
independently: a source that cannot be read marks only its own section
`{ "available": false, "reason": "…" }` rather than failing the whole
response, and a mint that never launched through pump.fun gets
`fee_routing: { "applicable": false }` instead of an error. The response
carries a `content_hash`, a SHA-256 of its own canonical JSON, so a
downloaded or shared copy can be checked against a fresh read.

```bash
curl -s 'https://three.ws/api/pump/launch-receipt?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'
```

The coin detail page renders this as a "Launch receipt" panel with a copy-as-text
button and a JSON download, both reusing `content_hash` from the same
response. `?variant=receipt` on `api/pump/launch-og.js` renders the same facts
as a shareable 1200×630 social card.

## $THREE only

The launcher is **coin-agnostic plumbing**: it accepts an arbitrary,
user/agent-supplied mint at runtime and renders launch records from the
platform's own launch data. The only coin three.ws itself promotes, names, or
markets is **$THREE** (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`). Do not
hardcode or surface any other specific mint as a recommendation.

## Related

- [Solana pump.fun signals](solana-pumpfun.md) — reputation/intel from pump.fun activity.
- [Agent wallets](custody.md) — custodial signing and spend caps.
- [Circulation engine](circulation-engine.md) — autonomous launch cadence and caps.
- [Mint mark](mint-mark.md), [Vanity protocol](PROTOCOL-vanity.md).
