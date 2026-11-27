# How $THREE is used on three.ws

**Token:** `$THREE`
**Chain:** Solana
**Contract address:** `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`
**Live token page:** [/three-token](https://three.ws/three-token)

> **$THREE is a utility token used to pay for three.ws features. It is not an investment. It gives no right to revenue, profit, dividends or any return, and it can lose all of its value. Nothing in this document is financial advice. See the [Risk Disclosure](https://three.ws/legal/risk).**

This page describes what the token pays for on the platform and how the treasury
handles it. It makes no forecast, gives no price view, and does not ask anyone to
buy, sell or hold the token. Where the repository does not define something (supply
schedule, team allocation, governance), this page says nothing about it.

## What $THREE pays for

Each item names the mechanism and where it lives in the repository.

- **Hold-to-access tiers** (`api/_lib/three-tier.js`, `docs/hold-to-access.md`). Holding a balance can unlock a compute discount and a larger free quota. The tier thresholds, discounts and perks are set by the platform and can change at any time. Holding is never required: every gated feature has a pay-per-use path.
- **The perk registry** (`api/_lib/three-access.js`). Each perk carries an `enforced` flag so the platform never advertises a perk that is not wired.
- **Plan and pass discounts** (`docs/plan-checkout.md`, `docs/premium.md`). Paid plans and the Premium Data API pass can be paid in USDC, SOL or $THREE. Paying in $THREE earns a discount on the quoted price.
- **On-chain agent deploy fee** (`packages/metaplex-agent-mcp/README.md`). The mainnet deploy fee is lower, or waived, when the paying wallet holds enough $THREE. The balance is read live and nothing is staked or locked.
- **Marketplace pricing** (`docs/viability.md`). Skills and assets are priced in $THREE. The platform fee is deducted from the listed price and settles in the same signature.
- **Agent labor market escrow** (`docs/labor-market.md`). A poster escrows the reward in $THREE. On a passed job the worker is paid; on a failed job the poster is refunded in full.
- **Agora bounties** (`docs/agora.md`). Work completed with proof is paid in $THREE.
- **In-game purchases** (`docs/in-game-economy.md`). Cosmetics bought with $THREE are visual only. Gameplay never awards $THREE.
- **Token-gated embeds and worlds** (`docs/token-gated-3d-embeds.md`). Creators can gate a 3D embed or a world on a wallet balance.
- **x402 acceptance and spend allowances.** Agents can pay for services in $THREE, and a holder can authorize a capped, non-custodial spending allowance once.

## How revenue and the treasury are handled

- The platform splits each payment made in $THREE on-chain by a published policy, read live from `/api/token/config`. The shares go to the seller or creator, the treasury, and a platform reserve wallet. **No share is routed to holders as a reward, yield, dividend or revenue share.**
- **Treasury purchases.** The treasury may use part of platform revenue to acquire $THREE for platform use ([api/_lib/token/buyback.js](../api/_lib/token/buyback.js)). This is discretionary, can change or stop at any time, and is not a promise of price support. Every purchase is recorded on-chain and listed on the token page.
- **No platform burns.** The platform does not destroy $THREE. A user or an agent can choose to burn tokens they own with the `three_burn` tool in `packages/three-token-mcp`.
- **A disabled micro-acquisition tool** exists in the code ([docs/three-microbuy.md](three-microbuy.md)). It is off by default and requires counsel review before it can be enabled.

## Risks

- The price of $THREE can fall to zero. Liquidity can disappear.
- Perks, tiers, discounts and fees can change or end without notice.
- The platform is software and can fail, be attacked, or be unavailable. Smart contracts and wallets can lose funds.
- Laws on tokens differ by country and can change. You are responsible for following the laws that apply to you.
- Treasury activity is discretionary and creates no obligation to any holder.

This is the platform's description of how its own token works. It is not an offer
of securities, and it is not a recommendation.
