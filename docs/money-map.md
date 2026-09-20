# Money map

The single source of truth for **where every dollar flows** in three.ws: which
wallet receives each kind of payment, what share the platform keeps, and which
treasury pays it forward. If you're adding a paid surface or auditing revenue,
start here.

Companion docs: [x402 endpoints](x402-endpoints.md) (the paid endpoint catalog),
[Financial controls](financial-controls.md) (how settlements are recorded),
[Solana signers runbook](../api/_lib/solana-signers.js) (the
signer/funder wallets and how to fund them).

---

## 1. The wallets

Money-routing is deliberately **config-driven** — no receiver is hardcoded, so an
unset receiver fails closed rather than silently routing real USDC to a baked-in
address (the `X402_PAY_TO_*` getters in [env.js](../api/_lib/env.js)).

### Receivers (inbound USDC)
| Env var | Role | Value |
| ------- | ---- | ----- |
| `X402_PAY_TO_SOLANA` | Primary x402 receiver (all generic paid calls) | `wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU` |
| `X402_PAY_TO_BASE` | x402 receiver on Base (EVM) | `0x4022…f402` |
| `X402_PAY_TO_BSC` | x402 receiver on BSC | (config) |
| `X402_ASSET_MINT_SOLANA` | USDC mint accepted | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (default constant) |

### $THREE split receivers (inbound $THREE)
Every $THREE-priced purchase (Forge paid tiers, paid spins, token-priced
marketplace sales, scarcity mints, copy-trading performance fees) is split by a
named policy in [token/config.js](../api/_lib/token/config.js) and paid straight
to these two wallets by the buyer's own transaction. Both are **required in
production and fail closed**: unset, `/api/token/quote` answers `503
treasury_unavailable` and no purchase can be priced at all.

| Env var | Role | Value |
| ------- | ---- | ----- |
| `THREE_TREASURY_WALLET` | Platform cut of every split; the pot the buyback lane buys into | `wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU` (the x402 receiver, `holdsTokens`) |
| `THREE_REWARDS_WALLET` | Holder reflections pool, distributed pro-rata by the `rewards-distribute` cron | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` (the economy master, which `REWARDS_DISTRIBUTOR_SECRET` signs as) |
| `THREE_QUOTE_SECRET` | HMAC key that seals a quote's amount, split and destinations | Secret Manager (`three-quote-secret`) |

The rewards pool **must** be the wallet `REWARDS_DISTRIBUTOR_SECRET` resolves to,
or the pool accrues into an address the distribution cron cannot sign for. The
two receivers must also stay **distinct**: `rewards-distribute` reads the rewards
wallet's whole $THREE balance as the distributable pool, so pointing it at the
treasury would plan to hand out the treasury itself. Readiness is reported live
by the `three_token_rail` subsystem in `/api/healthz`.

No platform split routes to the burn sink. Supply is never destroyed; the
treasury funds buybacks instead ([token/config.js](../api/_lib/token/config.js)).

### Payout treasuries (outbound — pay third parties out-of-band)
| Env var (secret) | Pays | Network |
| ---------------- | ---- | ------- |
| `CLUB_SOLANA_TREASURY_SECRET_KEY_B64` | dancers (tip sweep) + vanity-bounty fallback | Solana |
| `CLUB_EVM_TREASURY_PRIVATE_KEY` | dancers on Base | Base |
| `COSMETIC_SPLIT_TREASURY_SECRET_KEY_B64` | cosmetic creators (their split) | Solana |
| `VANITY_BOUNTY_PAYOUT_KEY` | vanity-bounty winners (→ club treasury fallback) | Solana |
| `PLATFORM_TREASURY_KEYPAIR` (→ `TREASURY_KEYPAIR`) | withdrawal gas, marketplace/pump fee sink, tops up other hot wallets | Solana |

### Fee sink wallets (platform's cut)
| Env var | Fills from | Default rate |
| ------- | ---------- | ------------ |
| `MARKETPLACE_PLATFORM_FEE_WALLET` (→ platform treasury pubkey) | marketplace skill sales | `MARKETPLACE_PLATFORM_FEE_BPS` = **0** (off), ≤10% |
| `PUMP_PLATFORM_FEE_WALLET` (→ platform treasury pubkey) | pump trades + coin launches | `PUMP_PLATFORM_FEE_BPS` = **100 (1%)**, ≤5%; `PUMP_LAUNCH_FEE_BPS` = **100 (1%)** on the dev buy, ≤5% |

### Signer / funder wallets
Every engine signs from its **own** keypair; a single **funding root** tops those
signers up with SOL when they run low, and does nothing else. Documented in full —
encodings, minimum balances, guards, funding tool — in the
[Solana signers runbook](../api/_lib/solana-signers.js) and the
[economy master](economy-master.md) subsystem doc.

| Wallet | Role |
| ------ | ---- |
| `WwwuGbqHrwF5…T3WwW` (capital `W`) | **Economy master / funding root** (`ECONOMY_MASTER_SECRET_BASE58`) — funder-only; never trades, tips, or settles. The `treasury-topup` cron refills every engine signer from it every 30 min, allowlist-guarded (can only pay a registry pubkey). |
| `wwwww…ccrU` | x402 **receiver** (`X402_PAY_TO_SOLANA`) + closed-loop spender |
| `wwwqv…HGUn` | a funded **engine signer** wallet |
| `PLATFORM_TREASURY_KEYPAIR`, `LAUNCHER_MASTER_*`, `CIRCULATION_TREASURY_*`, … | per-engine signers, each its own keypair, funded by the master |

---

## 2. Where each payment lands

| Paid surface | Receiving wallet | Platform cut | Downstream |
| ------------ | ---------------- | ------------ | ---------- |
| Generic x402 endpoints | `X402_PAY_TO_SOLANA/BASE/BSC` | 100% | platform revenue (`x402_audit_log`) |
| `skill-call` | skill author `author_payto_*` | 0% | direct to author (payTo override) |
| `service/<slug>` | provider `payout_address` | 0% | proxied to provider API (payTo override) |
| `asset-download`, `animation-download` | creator `creator_payto_*` | 0% | direct to creator (payTo override) |
| `pay-by-name` | buyer-named recipient | 0% | direct SPL transfer |
| `dance-tip` | platform receiver → dancer | 0% net | swept by `club-payouts` from `CLUB_SOLANA_TREASURY_*` |
| `club-cover` | platform receiver (kept) | 100% | funds the club float; issues a door pass |
| `cosmetic-purchase` | platform receiver → split | 50% | creator 50% (≤90%) from `COSMETIC_SPLIT_TREASURY_*` |
| marketplace skill sale | agent owner `payout_address` | 0–10% fee | atomic split; fee → fee wallet |
| labor skill (escrow) | worker + author | author 10% royalty | paid from escrow ([labor-settle.js:97](../api/_lib/labor-settle.js#L97)) |
| pump trade | counterparty | **1%** | fee transfer appended to the trader's own tx (SOL, or USDC on a USDC-paired coin) |
| coin launch dev buy (`/launch`) | the bonding curve | **1%** of the dev buy | fee transfer inside the launch tx; no dev buy, no fee |
| `pump-launch` | `X402_PAY_TO_SOLANA/BASE` | 100% of $5 | pump.fun creator rewards accrue on-chain to nominated wallet |
| `ring-settle` (internal) | `X402_PAY_TO_SOLANA` | 100% | recirculates (dogfood volume) |
| $THREE purchase (Forge High, spin, scarcity mint) | `THREE_TREASURY_WALLET` + `THREE_REWARDS_WALLET` | 70-80% treasury | remainder reflects to holders; no seller leg |
| $THREE marketplace sale | seller + the two receivers above | 5% treasury | seller keeps 90%, 5% reflects to holders |
| vanity bounty | worker | escrow-based | from `VANITY_BOUNTY_PAYOUT_KEY` (→ club treasury fallback) |

Two mechanisms above are easy to confuse — see the [split explainer](x402-endpoints.md#where-payments-land):
a **`payTo` override** settles USDC straight to a third party (skill-call, service,
asset/animation download, pay-by-name); a **post-settlement split** lands the USDC
in the platform receiver first, then a separate treasury forwards a share
(cosmetics, dance tips).

---

## 3. Fee & split rates

| Flow | Rate | Config | Default |
| ---- | ---- | ------ | ------- |
| Cosmetic creator split | creator share | `cosmetics-economy.js` `DEFAULT_CREATOR_BPS` | **50%** (cap 90%) |
| Labor skill royalty | author royalty | `LABOR_SKILL_ROYALTY_BPS` | **10%** (cap 50%) |
| Marketplace platform fee | platform cut | `MARKETPLACE_PLATFORM_FEE_BPS` | **0%** (cap 10%) |
| Pump trade fee | platform cut | `PUMP_PLATFORM_FEE_BPS` | **1%** (cap 5%) |
| Coin launch fee | platform cut on the dev buy | `PUMP_LAUNCH_FEE_BPS` | **1%** (cap 5%) |
| Club tip | dancer share | — | **100%** to dancer (platform nets 0) |
| Club cover | platform share | — | **100%** (club float) |

The trade and launch fees are live at 1% (owner decision, 2026-09-16): every
customer trade three.ws builds or signs pays it in the same transaction, and
platform-owned agents are exempt. The rest are a low/off demo curve; production
deployments tune them to real unit economics. Detail, surfaces and disclosure:
[pump platform fee](pump-platform-fee.md).

---

## 4. Services catalog (what three.ws sells)

- **x402 HTTP endpoints**: 86 distinct paid routes in the
  [ring catalog](../api/_lib/x402/ring-catalog.js), the single source of truth,
  across intel/oracle, agent/reputation, generation/3D, launch/naming/utility,
  club, avatar shop, and bazaars. Full list and prices:
  [x402 endpoints](x402-endpoints.md).
- **Paid MCP tools** —
  - Main MCP ([api/mcp.js](../api/mcp.js), pricing `api/_lib/pump-pricing.js`):
    `mint_3d_asset` $0.25, `retexture_model` $0.10, `optimize_model` $0.05,
    `segment_model` $0.04, `retexture_region` $0.03, `apply_animation` $0.02,
    `inspect_model`/`validate_model` $0.01, `render_avatar` $0.005,
    `search_public_avatars`/`solana_agent_reputation` $0.001.
  - 3D Studio MCP ([api/mcp-3d.js](../api/mcp-3d.js), pricing `api/_mcp3d/pricing.js`):
    15 priced tools: `text_to_3d`/`image_to_3d` tiered (draft/standard/high),
    `auto_rig_model`/`capture_scene`/`retexture_model`/`retexture_region`/`anchor_provenance` $0.05,
    `stylize_model`/`remesh_model`/`segment_model` $0.02,
    `remove_background`/`pose_model`/`apply_animation`/`direct_prompt`/`generate_material` $0.01.
- **OKX.AI ASP #2632 "three.ws 3D Studio"** — the same 3D pipeline listed on OKX.AI
  (ERC-8004 / XLayer) as an Agent Service Provider, endpoint `https://three.ws/api/mcp-3d`,
  serviceType `A2MCP`. The 7 registered services (fees $0.01–$0.15 USDC): Text &
  Image-to-3D, Video-to-3D Scene Capture, Auto-Rig, Universal Animation Retarget,
  Masked Texture Repaint, Mesh Repair/Export, Mesh Segmentation. **This list lives
  in the on-chain ASP record, not in repo code** — update it here if the ASP
  registration changes.
- **Marketplace skills** — agent skill marketplace over Solana Pay
  ([api/marketplace/](../api/marketplace/)); see [marketplace skills](ux-flows/06-marketplace-skills.md).
- **Labor market** — bounty/escrow jobs with worker + author-royalty settlement; see
  [labor market](labor-market.md).
- **Other** — vanity bounties, forge REST ([api/x402/forge.js](../api/x402/forge.js)),
  subscriptions, credit deposits.

---

## 5. Autonomous money movement

Engines that move money on their own (cron/worker driven) draw from the signer
wallets, not the receivers — and each signer is kept funded by the
[economy master](economy-master.md) via the `treasury-topup` cron (every 30 min,
allowlist-guarded, reserve/per-engine/per-run caps). Which wallet funds which
engine and minimum balances are in the
[Solana signers runbook](../api/_lib/solana-signers.js). The
recurring payout crons that forward the flows above:

| Cron | Moves | From |
| ---- | ----- | ---- |
| `treasury-topup` | SOL refill → every low engine signer | `ECONOMY_MASTER_SECRET_BASE58` (funding root) |
| `club-payouts` | tip sweeps → dancers | `CLUB_SOLANA_TREASURY_*` / `CLUB_EVM_TREASURY_*` |
| `cosmetic-splits-sweep` | creator USDC payouts | `COSMETIC_SPLIT_TREASURY_*` |
| `run-buyback` / `run-three-buyback` | coin/$THREE buybacks | `PUMP_CRON_RELAYER_*` / `THREE_BUYBACK_*` |
| `run-distribute-payments` | coin creator/holder payouts | `PUMP_CRON_RELAYER_*` |
| `process-withdrawals` | user withdrawals | `PLATFORM_TREASURY_KEYPAIR` + `EVM_TREASURY_PRIVATE_KEY` |
| `x402-autonomous-loop` / `x402-seed-cron` | x402 self-spend (closed loop) | `X402_SEED_SOLANA_SECRET_BASE58` |

---

## Monitoring coverage

Every wallet that moves money is watched on-chain, and every always-active loop is
watched for silence. One board rolls it all up.

| Layer | What it watches | Where |
|---|---|---|
| **All-wallet leak scan** | Every mainnet `SOLANA_SIGNERS` wallet (masters, all treasuries, ring wallets) — any SOL/token debit to an address outside the controlled set, or an SPL Approve | `api/cron/wallets-leak-scan.js` (`*/15`), verdict source `wallets_onchain` |
| **Ring leak scan** | The x402 ring role wallets specifically | `api/cron/x402-ring-leak-scan.js` (`*/10`), source `x402_ring_onchain` |
| **Economy-master breach/tamper** | Unrecorded outbound + hash-chain integrity of the funding root | `api/cron/economy-reconcile.js` (`*/30`) |
| **Zero-activity tripwire** | Enabled-but-silent money loops (the alarm the ring outage lacked) | `api/_lib/financial-tripwire.js`, wired for `x402_autonomous_loop` in the leak-scan cron |
| **Reconciliation** | Ring settlements/sweeps + revenue vs chain | `ring-reconciliation.js`, `revenue-reconciliation.js` |
| **Unified board** | Per-subsystem open critical/warn verdicts + last activity, one call | `GET /api/ops/money-health` (admin session, or `x-ops-secret: $OPS_SECRET`) |

Guardrails on outflow: the economy master is funder-only with reserve/per-transfer/
per-run caps and a registry allowlist; the ring can only settle to allowlisted
wallets (anti-drain gate); the sniper auto-funder moves money only for strategies
that set `auto_fund_enabled = true` (default off). See
[financial-controls.md](financial-controls.md) for the full register.

## Related

- [Financial controls & audit register](financial-controls.md) — every ledger's integrity, reconciliation, retention, monitoring, and the ranked gap list.
- [x402 endpoints](x402-endpoints.md) — the paid endpoint catalog and price overrides.
- [x402 ring economy](x402-ring-economy.md) — the internal recirculation loop.
- [Pump platform fee](pump-platform-fee.md) — the pump trade fee detail.
- [Coin-launch wallets](ux-flows/08-coin-launch-wallets.md) — launch-time wallet flow.
- [Creator revenue splits](../api/_lib/cosmetics-economy.js) — `recordSaleAndSplit`: the cosmetic split math and its real USDC payout.
- [Agent wallet custody](agent-wallets.md) — how custodial keys are held.
- [Solana signers runbook](../api/_lib/solana-signers.js) — signer/funder wallets + funding.
