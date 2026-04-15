# Task: Reputation — display on /agent/:id and let non-owners submit a review

## Context

Repo: `/workspaces/3D`. ERC-8004 Reputation Registry helpers already exist in [src/erc8004/reputation.js](../../src/erc8004/reputation.js):

- `submitReputation({ agentId, score, comment, signer, chainId })` → tx hash
- `getReputation({ agentId, runner, chainId })` → `{ total, count, average }`
- `getRecentReviews({ agentId, runner, chainId, fromBlock })` → event-log read

There is **no UI** for any of this yet. The `/agent/:id` page (the agent-home surface — see [src/agent-home.js](../../src/agent-home.js)) shows the avatar + identity card but no reputation.

**Gotcha:** the canonical contract's `getReputation` **reverts** when `count === 0` on some deployments (the "no reviews yet" case). The helper in [reputation.js](../../src/erc8004/reputation.js) does not guard this. You must handle the revert cleanly.

## Goal

On `/agent/:id`, show aggregate reputation + a capped list of recent reviews; let any connected wallet that is **not** the agent's owner submit a review (score 1–100, optional comment) with a clean signing UX.

## Deliverable

1. New file [src/erc8004/reputation-ui.js](../../src/erc8004/reputation-ui.js) exporting class `ReputationPanel`:
   - Constructor: `new ReputationPanel(containerEl, { agentId, chainId, ownerAddress, provider, signer? })`
   - Renders into `containerEl`:
     - Top strip: `★ 84 · 12 reviews` (average score + count). If no reviews → `"Be the first to review"`.
     - A bar chart of the score distribution (bins of 10) — pure CSS bars, no chart lib.
     - Up to 10 most-recent reviews, each showing: submitter address (truncated 0x1234…abcd), score, comment, block number, link to explorer.
     - A "Write a review" form (score slider 1–100, comment textarea maxlength 500, submit button) visible **only** when a wallet is connected AND the connected address !== `ownerAddress`.
   - Handles the "no reviews yet" revert:
     - Wrap `getReputation` in a try/catch. On revert or on `count === 0`, show the empty state. Don't log an error to console.
     - In [reputation.js](../../src/erc8004/reputation.js), update `getReputation` to swallow the revert and return `{ total: 0, count: 0, average: 0 }` so it's uniform — document this behavior in a JSDoc comment. Do this in a single helper `_tryReadReputation(contract, agentId)` internal to the file.
   - On submit:
     - Validate `Number.isInteger(score) && score >= 1 && score <= 100` (UI enforces but guard anyway).
     - Call `submitReputation`. Use structured `onStatus` consistent with [03](./03-register-flow-polish.md) if that lands: steps `estimating → signing → mining → done`.
     - On success, optimistically prepend the new review to the list and re-fetch aggregate; don't full-reload.
     - On error, reuse `classifyTxError` if available, otherwise show a dismissible error card.
2. Wire `ReputationPanel` into [src/agent-home.js](../../src/agent-home.js):
   - Mount only when `AgentIdentity.isRegistered === true` AND `meta.onchain.chainId` is known.
   - Sits below the existing identity card + action timeline, not above.
   - Provider: use a read-only `JsonRpcProvider` with `DEFAULT_RPCS[chainId]` from [manifest.js](../../src/manifest.js) by default. If the user has connected a wallet, swap in that signer for submit-time only.
3. CSS: add styles inside an injected `<style>` tag the module appends once to `document.head`. Keep classes namespaced (`.rep-panel-*`). No Tailwind, no new global stylesheet.

## Audit checklist

- No error spewed when an agent has 0 reviews.
- Owner cannot submit. Submit form is hidden for owner. Also server-side check would be nice but the contract doesn't enforce, so only UI hides.
- Disconnected user sees "Connect wallet to review" CTA, not a broken form.
- Score slider default 50. Submit disabled if score < 1 (shouldn't happen given slider bounds) or comment > 500 chars.
- Submitter address comparison is case-insensitive checksummed.
- `getRecentReviews` uses a bounded block range. Default `fromBlock = latest - 500_000` with chunking (reuse the same chunk/retry pattern from [02](./02-wallet-to-agents.md)). If ancient history is needed, add a "Load earlier reviews" button.
- Links to explorers use the shared `explorerTxURL` helper from [03](./03-register-flow-polish.md) (create an `explorerAddressURL` companion if needed; put both in [src/erc8004/explorers.js](../../src/erc8004/explorers.js)).
- `score` stored on-chain is `uint8` (0–255). Document this. We use 1–100; treat anything > 100 read back from chain as "legacy, display as is, don't normalize".
- Optimistic append uses a fake `pending: true` flag; when the next full read arrives, reconcile by `txHash`.

## Constraints

- No new dependencies.
- No framework. vanilla DOM consistent with [register-ui.js](../../src/erc8004/register-ui.js) style.
- No changes to the contract ABIs or addresses.
- Do not add a backend endpoint for reviews. This is a direct chain read/write.
- Keep the panel under ~400 lines; split `submit-form.js` and `reviews-list.js` if needed.

## Verification

1. `node --check` all new/modified JS files.
2. `npx vite build` passes.
3. Manual on Base Sepolia:
   - Load `/agent/:id` for an agent with **zero** reviews → panel shows "Be the first to review"; no console errors.
   - Connect a wallet that is NOT the owner → form appears. Submit a 73 with comment "Very smooth wave." → tx lands → review appears at top; aggregate updates to 73 / 1.
   - Submit a second review from a different wallet. Bar chart updates.
   - Load `/agent/:id` as the owner — form is hidden; only aggregate + list shown.
   - Disconnect wallet; form disappears, "Connect wallet to review" CTA shows.
4. Throttle the RPC (DevTools network) — panel should degrade to spinners, never crash.

## Scope boundaries — do NOT do these

- Do not build a moderation / flag-as-abuse flow. On-chain is permanent.
- Do not implement ReputationValidator contract interactions (that's the Validation Registry, separate concern; and mainnet address is empty).
- Do not aggregate cross-chain reputation. A review is for `(chainId, agentId)` only.
- Do not implement reply threads.
- Do not gate the form behind an NFT / holding — any connected non-owner wallet can review.
- Do not change the ABI's `uint8` score to larger; we live with the existing contract.

## Reporting

- Files created / edited.
- How you implemented the "no reviews yet" revert guard.
- Block range strategy for `getRecentReviews` and any RPC that struggled.
- Screenshot-worthy notes: empty state, populated state, owner view.
- `npx vite build` status.
