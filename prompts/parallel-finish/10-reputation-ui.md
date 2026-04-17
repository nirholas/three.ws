# Task: Reputation viewing + feedback submission UI

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md), [src/CLAUDE.md](../../src/CLAUDE.md), and [contracts/CLAUDE.md](../../contracts/CLAUDE.md) first.

The ERC-8004 `ReputationRegistry` contract is deployed on 15 mainnet chains and the ethers-v6 client in [src/erc8004/reputation.js](../../src/erc8004/reputation.js) has `submitFeedback`, `getReputation`, `getRecentReviews` — but nothing in the UI surfaces these. We want a **standalone page** at `/reputation/?agent=<chainId>:<agentId>` that:

- Shows the agent's running score + review count.
- Lists the most recent 20 reviews (rating + optional text comment, reviewer address).
- Lets a connected wallet submit a rating (-100..+100) and a short comment. One per address per agent.

## Files you own (exclusive — all new)

- `public/reputation/index.html` — page shell.
- `public/reputation/reputation.js` — page logic. **Imports from `/src/erc8004/reputation.js` via the Vite bundle**, not via a raw `/src/...` URL (which won't resolve in production — see how `agent-home.html` wires its script).
- `src/reputation-page.js` — the Vite entry that `index.html` references. This file imports `reputation.js` and kicks it off.
- `public/reputation/styles.css` — inline in HTML is also fine.
- `vite.config.js` — add the page as a multi-page input. **This is the one shared file you may touch**; add exactly one line to `rollupOptions.input`. If `vite.config.js` doesn't already have a multi-page setup, check other prompts in this folder aren't also modifying it (they aren't — `08-artifact-bundle.md` uses a separate config file); add a `rollupOptions.input` block.

**Do not edit** any other file. Not `src/erc8004/reputation.js` (import only), not the dashboard, not `src/element.js`.

## UI

1. **Load** — parse `?agent=<chainId>:<agentId>` from URL, fetch `/api/agents/:id` if the agent has a backend record, else resolve on-chain only. Show agent name + avatar thumbnail if available.
2. **Score card** — big number (average rating), review count, sparkline of last 30 days.
3. **Review list** — 20 most recent. Each row: reviewer (ENS if resolvable, else truncated address), rating pill (color-coded: red < 0, gray ~0, green > 0), comment (if any), timestamp.
4. **Submit section** — "Connect wallet" button (MetaMask; use `window.ethereum` directly, no Privy). After connect, show a slider (-100..+100) + a 280-char comment box + Submit. Submission calls `submitFeedback` from `src/erc8004/reputation.js`. Disabled if the connected wallet already has a review for this agent (check with `getRecentReviews` filtered to address).

## Constraints

- Tabs, 4-wide, single quotes, ESM. Vanilla JS — no framework.
- Use the dashboard's color palette.
- Do not write a new reputation contract client. Reuse `src/erc8004/reputation.js` as-is.

## Out of scope

- Do not build a `/dashboard` tab for this — standalone page only.
- Do not add a web-component (`<reputation-for agent="...">` is nice but deferred).
- Do not implement validator attestations (that's `ValidationRegistry` — separate prompt `11`).
- Do not add pagination beyond the most-recent-20.

## Verification

```bash
node --check public/reputation/reputation.js
node --check src/reputation-page.js
npm run build
```

Manually: `npm run dev`, open `/reputation/?agent=8453:1` (or any real agent id on Base mainnet). Confirm score + reviews render. Connect MetaMask on Base and submit a review on a testnet agent.

## Report back

Files created, commands + output, your exact `vite.config.js` diff (paste the inserted lines), any RPC/CORS issue hit.
