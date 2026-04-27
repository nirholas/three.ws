# 05 — Reputation dashboard UI

## Why

[src/erc8004/reputation.js](../../src/erc8004/reputation.js) exposes `submitFeedback()`, `getReputation()`, `getRecentReviews()` — the contract glue is done. But there's no UI for a user to read reviews or post one. Band 6 audit flagged "reputation UI minimal."

Ship a standalone dashboard at `/reputation/` that works against **any** agent id on **any** supported chain.

## What to build

### 1. Page

Create `public/reputation/index.html` — a self-contained page with:

- Header: agent avatar (pulled via `<agent-three.ws="{id}">` small inline), name, chain + agentId.
- Stats row: total reviews, avg rating, last-review timestamp.
- Review list: paginated, newest-first, shows reviewer address (truncated), rating, comment, tx link to the chain's explorer.
- Submit form: star rating (1–5), comment textarea, submit button. Gated on wallet connection (reuse [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) `connectWallet()`).
- URL params: `?agent=<id>&chain=<chainId>` (default chain from [src/erc8004/abi.js](../../src/erc8004/abi.js) `REGISTRY_DEPLOYMENTS` — pick Base Sepolia).

### 2. Controller module

Create `src/reputation-ui.js` — the JS that powers the page. Public API:

```js
export class ReputationDashboard {
  constructor(container, { agentId, chainId })
  async load()       // fetches getReputation + getRecentReviews
  async submit({ rating, comment })  // calls submitFeedback after wallet connect
  onReviewAdded(fn)  // subscribe to new reviews (polls every 30s while tab visible)
}
```

Use:

- `getReputation`, `getRecentReviews`, `submitFeedback` from [src/erc8004/reputation.js](../../src/erc8004/reputation.js).
- `connectWallet` from [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js).
- vhtml JSX for templates (file ends `.jsx` if you write JSX; or plain template strings if not).

### 3. Styling

Inline `<style>` in `index.html` matching the dark-theme palette used in [public/widgets-gallery/index.html](../../public/widgets-gallery/index.html). Don't import the main app's stylesheet — keep the page tiny and independent.

### 4. Error states

- Wallet not connected → "Connect wallet to leave a review" CTA.
- Unsupported chain → banner with "switch to Base Sepolia" button (standard EIP-3326 call).
- Agent not found on chain → show "This agent isn't registered on chain `<name>`" with a link to `/register`.
- RPC failure → graceful "couldn't reach chain" message with retry.

## Files you own

- Create: `public/reputation/index.html`
- Create: `public/reputation/boot.js` (if you'd rather extract the bootstrapping)
- Create: `src/reputation-ui.js`

## Files off-limits

- `src/erc8004/reputation.js`, `src/erc8004/abi.js`, `src/erc8004/agent-registry.js` — consume as-is. If missing a function, stop and report.

## Acceptance

- Navigating to `http://localhost:3000/reputation/?agent=1&chain=84532` loads without JS errors.
- Review list renders (even if empty).
- Submit flow prompts wallet, sends tx, optimistically appends review on tx hash.
- `node --check src/reputation-ui.js` passes.
- `npm run build` passes.

## Reporting

Functions consumed from `src/erc8004/reputation.js`, any behavior mismatch against the contract, screenshots (or descriptions) of empty / full / error states.
