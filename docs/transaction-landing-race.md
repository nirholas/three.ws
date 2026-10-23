# Transaction landing race

Every signed Solana transaction that goes through `submitProtected` in [api/_lib/execution-engine.js](../api/_lib/execution-engine.js) is sent through several landing providers at once. The first provider to report a confirmed landing wins, the others are aborted, and the caller gets exactly one result. Solana dedupes by signature, so the lanes are one transaction with several doors: a duplicate send can never double-spend.

## Providers

The provider list is data: [api/_lib/landing-providers.js](../api/_lib/landing-providers.js).

| Provider | Kind | Enabled when | Tip |
|---|---|---|---|
| `rpc` | primary connection (protected send) | always | none |
| `jito` | Jito block-engine bundle | mainnet and tip mode `economy` or `turbo` | Jito tip account |
| `helius` | Helius staked RPC | `HELIUS_API_KEY` is set | none |
| `helius_sender` | Helius sender | `HELIUS_SENDER_TIP_ACCOUNT` is set (mainnet, tip mode not `off`, Jito lane not in use) | transfer to that account |
| `extra_rpc` | any additional JSON-RPC endpoint | `LANDING_EXTRA_RPC_URL` is set | none |

A provider whose credential is missing stays in the table with the env var that enables it. `LANDING_DISABLED_PROVIDERS` (comma separated names) switches providers off without a deploy. The primary `rpc` lane is never skipped: it is the guaranteed route.

## How a trade is raced

1. Build, sign and serialize the transaction once.
2. Start one lane per enabled, non-skipped provider, ordered by recent success.
3. RPC lanes `sendTransaction` to their endpoint and then poll that endpoint's own `getSignatureStatuses`, so a slow provider genuinely loses.
4. The first lane to confirm wins. Lanes still in flight are aborted and counted as outpaced. A hard on-chain revert from any lane ends the race for everyone.
5. The result carries `landedBy` (the winning provider) and `lanes` (per-provider outcome and latency).

## Stats and the failure streak

Per provider and network the table `landing_provider_stats` ([migration](../api/_lib/migrations/20261023190000_landing_provider_stats.sql)) keeps:

- `landed`: first to confirm
- `lost`: errored, or finished without landing
- `outpaced`: still racing when another lane landed (not a failure)
- `streak`: consecutive losses; `latency_ms`: moving average landing latency

Lanes are ordered by Laplace-smoothed success rate. After 3 consecutive losses a provider is skipped. While skipped it gets a health probe at most every 30 seconds (off the trade path); a passing probe clears the streak and the provider rejoins on the next trade. Stats persist when `DATABASE_URL` is set and fall back to per-instance memory otherwise.

## Tip budget

`opts.maxTipLamports` (or the `LANDING_MAX_TIP_LAMPORTS` default) is a per-trade tip ceiling. The tip is one instruction inside the one signed transaction, so the ceiling binds every tip-bearing provider at once. If the ceiling is below the smallest tip a provider accepts (1000 lamports), the trade skips the tipped lane and rides the untipped providers with `fallbackReason: 'tip_over_budget'`.

## Proof

- `npx vitest run tests/landing-race.test.js` runs real JSON-RPC over local HTTP servers: slow provider loses, failing provider is recorded lost, one confirmation is reported, the skip and probe cycle, SQL persistence, and the tip ceiling.
- `node scripts/landing-race-devnet.mjs` sends real self-transfers through the race on a non-mainnet cluster and prints the stats table. Pass `--primary` and `--extra` RPC URLs; pass `--db <postgres url>` to persist into a real database.
