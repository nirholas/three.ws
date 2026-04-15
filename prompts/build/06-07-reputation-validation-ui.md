# 06-07 — Onchain: reputation + validation UI

**Branch:** `feat/reputation-ui`
**Stack layer:** 6 (Onchain portability)
**Depends on:** 06-06 (indexer)

## Why it matters

The on-chain reputation score is meaningless if no one sees it. Surface the score on the agent's public page, the dashboard agent list, and the embed identity card. Add a "leave feedback" path that walks a viewer through `submitFeedback`.

## Read these first

| File | Why |
|:---|:---|
| [src/erc8004/reputation.js](../../src/erc8004/reputation.js) | `submitFeedback`, `getReputation`, `getRecentReviews`. |
| [src/agent-home.js](../../src/agent-home.js) | Identity card mount point. |
| [public/agent/index.html](../../public/agent/index.html) | Public agent page. |
| [api/onchain/agent/[chainId]/[tokenId].js](../../api/onchain/agent/[chainId]/[tokenId].js) | Read endpoint from 06-06. |

## Build this

1. In [src/agent-home.js](../../src/agent-home.js), add a `<reputation-card>` block:
   - Star rating (5-star, derived from `score_x100 / 20`).
   - Total feedback count.
   - "View on chain" link → block explorer for the registry contract.
2. On the public agent page, add a "Leave feedback" button → opens a modal:
   - Connect wallet (reuse [public/wallet-login.js](../../public/wallet-login.js) flow).
   - Slider: −100 to +100, default 0.
   - Optional 280-char comment (stored in IPFS, hash submitted on-chain).
   - Submit → `submitFeedback(chainId, tokenId, score, ipfsHash)`.
3. Show a small "verified ✓" badge if `count >= 5` and `score_x100 >= 4000` (i.e. avg ≥ +40). Otherwise show neutral.
4. Cache the read in the client for 60s to avoid hammering the indexer.
5. If the agent has no on-chain twin, hide the entire reputation block (don't show "0 reviews" — looks broken).

## Out of scope

- Do not implement reply/threaded feedback.
- Do not let agent owner delete reviews.
- Do not show ValidationRegistry data yet (separate prompt).
- Do not add notifications on new feedback.

## Acceptance

- [ ] Public agent page renders the reputation card when `onchain` data is present.
- [ ] "Leave feedback" walks through wallet connect → sign → submit on-chain.
- [ ] Verified badge logic correct for known fixture data.
- [ ] No flash of empty state for off-chain-only agents.

## Test plan

1. Use indexer fixtures from 06-06 test plan.
2. Open `/agent/<id>` for an on-chain agent — confirm card.
3. Submit feedback from a different wallet — confirm tx, then refresh — score updates after the next indexer cycle.
4. Open an off-chain-only agent — confirm reputation card hidden.
