# Token due diligence

`token_due_diligence` scores a Solana token on who holds it, not only on its contract flags. Every field is computed from chain data we read ourselves (token accounts, signature history, funding transfers) plus our own tracked wallet history. No third-party labels are scraped.

- API: `GET /api/crypto/due-diligence?address=<mint>` and `GET /api/crypto/funding-graph?wallet=<address>`
- MCP tool: `token_due_diligence` (input `{ mint }`)
- Token page: the "Holder due diligence" panel on `/three` renders the fields and the two-hop funding force graph
- Cache: one report per mint for 300 seconds. Only successful reports are cached.

## Method

1. Find the launch: the oldest transaction of the mint's Metaplex metadata account (falling back to the mint's own history). Its slot is the launch slot and its fee payer is the creator.
2. Read the largest token accounts (up to `analyze_top`) and resolve each to its owner. Program-owned holders (pools, vaults) are not wallets and are excluded from wallet ratios.
3. For each wallet holder read its first receipt of the token, its first-ever transaction, and who funded it, up to two hops back.
4. Classify holders and aggregate by share of supply.

## Thresholds

Every threshold lives in `DD_THRESHOLDS` in `api/_lib/token-due-diligence.js` and is returned in each report.

| Key | Value | Meaning |
|---|---|---|
| `analyze_top` | 20 | Largest token accounts analysed per mint (the chain returns at most 20). |
| `sniper_slots` | 5 | A holder is a sniper when its first receipt landed within this many slots of launch. |
| `bundler_min_group` | 2 | Holders sharing a funder form a bundle from this group size up. |
| `same_slot_min_group` | 3 | Same-launch-slot grouping needs this many holders, because organic buyers share busy slots. |
| `funding_window_hours` | 6 | Wallets funded by one source within this window of each other form a cluster. |
| `fresh_wallet_max_age_hours` | 24 | A wallet is fresh when its first-ever transaction is younger than this at first receipt. |
| `smart_money_min_score` | 65 | `wallet_reputation.smart_money_score` at or above this bar. |
| `service_funder_min_sigs` | 2000 | A funder with this many signatures (or an incomplete history) is a service such as an exchange or router, not a coordinator, and never links holders. |
| `min_evidence_ratio` | 0.5 | A field is reported only when this share of analysed wallet holders yielded the evidence it needs. Below it the field is `null` with a "withheld" note, never a low number. |

## Definitions

### insider_pct

Insider hold rate. Percent of supply held by the creator wallet and by holders linked to it: funded by the creator, funding the creator, or funded from the same non-service source within two hops.

### sniper_pct

Sniper share. Percent of supply held by wallets whose first receipt of the token landed within `sniper_slots` slots of the mint's first transaction. The creator is excluded (counted as an insider).

### bundler_pct

Bundler exposure. Percent of supply held by wallets in a funding cluster (two or more holders funded by one non-service source within `funding_window_hours`, directly or through a shared second hop) or in a launch slot where `same_slot_min_group` or more holders first received the token.

### fresh_wallet_pct

Fresh-wallet share. Percent of supply held by wallets whose first-ever transaction was under `fresh_wallet_max_age_hours` before they first received the token.

### fresh_wallet_ratio

Fresh wallets divided by analysed wallet holders (0 to 1). Pools and other program-owned holders are excluded from both sides.

### smart_money_holders

Count of analysed holders whose own realized history in our tracked data (`wallet_reputation.smart_money_score`) is at least `smart_money_min_score`.

### smart_money_pct

Percent of supply held by the smart-money holders above.

## Funding graph

`traceFundingGraph(wallet)` follows who funded a wallet's first transaction, then who funded that funder, two hops in total, and returns `nodes` and `edges`. The token page renders it as a force graph with the creator, flagged holders and service funders distinguished in the legend.

## Guards

Four per-agent trade limits refuse a buy when the report exceeds them. All default to off (`null`).

| Limit | Refuses a buy when |
|---|---|
| `max_insider_pct` | `insider_pct` is above the limit |
| `max_sniper_pct` | `sniper_pct` is above the limit |
| `max_bundler_pct` | `bundler_pct` is above the limit |
| `max_fresh_wallet_pct` | `fresh_wallet_pct` is above the limit |

Set them through the agent trade limits endpoint. The report is loaded only when a limit is set, and applies to mainnet buys. If a limit is set but the report or the field cannot be read, the guard fails closed with `due_diligence_unavailable` rather than letting the trade through.

## Coverage caveat

Reads use the public RPC failover chain. Some lanes prune history, return empty lists or rate-limit, so a report states its coverage (`coverage`) and withholds any field below `min_evidence_ratio`. A withheld field means "not enough evidence", not "safe". Retry later or configure an archival RPC lane for fuller coverage.
