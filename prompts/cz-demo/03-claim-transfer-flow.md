# Task 03 — Claim / transfer onchain ownership to CZ

## Why this exists

Pre-registration (task 01) creates the CZ agent with either `owner = 0x0` (claimable) or `owner = ops-eoa` (transferable). This task is the user-facing flow that flips ownership to CZ's wallet in one click.

The claim is the moment of **onchain handoff** — what makes the demo portable identity, not just a hosted page.

## Shared context

- Contract: [contracts/src/IdentityRegistry.sol](../../contracts/src/IdentityRegistry.sol). Read it to confirm the available ownership-change functions. If the interface is `transferOwner(uint256 agentId, address to)` gated to current `owner`, you have two patterns available (below).
- Pre-registered state from task 01 in `scripts/cz-demo/.state.json`.
- Client wallet flow: [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — `connectWallet()`, tx send patterns. Adapt; don't tangle with it.
- Wallet-auth SIWE session may or may not be live. This flow only needs an EIP-1193 provider (`window.ethereum`), not a SIWE session.

## What to build

Pick pattern A or B based on what `IdentityRegistry` actually supports — inspect the contract before starting.

### Pattern A — "Claimable" (if `owner = 0x0` is allowed and `claim(uint256 agentId)` or `setOwner(uint256 agentId)` exists)

User calls the claim function directly. CZ's wallet pays gas.

1. Read `agentId`, `chainId`, contract address from a new small endpoint `GET /api/cz/identity` that reads from `agent_identities` by `meta.demo = 'cz'` (use the row from task 01 step 4).
2. `window.claimAgent()` on the `/cz` page:
   - Require `window.ethereum`. Prompt `eth_requestAccounts`.
   - Prompt chain switch to `chainId` via `wallet_switchEthereumChain`. If unknown chain, use `wallet_addEthereumChain` with the Base Sepolia params.
   - Call `IdentityRegistry.claim(agentId)` via `viem`.
   - Wait for receipt, parse `OwnerSet` event, confirm `newOwner === caller`.
   - `localStorage.setItem('cz:claimed', 'true')`; reload.

### Pattern B — "Pre-authorized transfer" (if only `transferOwner(uint256, address)` exists, requires current owner signature)

The current owner (our ops EOA) signs a meta-tx / EIP-712 permit offline that CZ's wallet consumes.

Skip this unless the contract has a permit-style function — current contracts in this repo don't. Default to pattern A; if the contract doesn't support it, stop and report. Do not modify the contract in this task.

### Claim endpoint (both patterns)

`GET /api/cz/identity` → `{ agentId, chainId, contract, owner, cid, claimed: boolean }`. Read from the local `agent_identities` row + optionally cross-check onchain `ownerOf(agentId)`. Owner-only info (like raw metadata URI) is fine to expose — this is intentionally public.

### Error paths

- Wallet on wrong chain → chain-switch prompt with add-chain fallback.
- User rejects tx → reset button, no alert, console log only.
- Tx fails (owner is already set to someone else) → show "This agent has already been claimed by 0x…" with a link to view the passport.
- RPC timeout > 30s → "Network slow — your transaction may have succeeded. Check Basescan: {txHash}"

### Confetti / celebration UI

On successful claim, add a small canvas-confetti burst + change the agent's Empathy Layer emotion blend: emit a `skill-done` protocol event with `{ sentiment: 0.9 }` so the avatar visibly celebrates. (See [src/CLAUDE.md](../../src/CLAUDE.md) "The Empathy Layer.")

```js
window.VIEWER.agent_protocol.emit('skill-done', {
  skill: 'claim-onchain',
  result: { success: true, output: 'Claimed', sentiment: 0.9 }
});
```

## Files you own

- Create: `api/cz/identity.js`, `public/cz/claim.js` (exposes `window.claimAgent`), possibly `public/cz/confetti.js` (tiny canvas confetti, ~40 lines).
- Edit: `public/cz/index.html` (import the new `claim.js`; one `<script>` line). `vercel.json` — one route line for `/api/cz/identity`.

## Files off-limits

- `public/cz/index.html` layout — owned by task 02. You're adding one `<script>` tag; don't restyle.
- `public/cz/cz.js` — leave for task 02.
- Contracts + deployment — do not modify contracts.
- `src/erc8004/*` — read-only reference.

## Acceptance test

1. Load `/cz` with MetaMask on Base Sepolia, pre-registered agent from task 01, `owner = 0x0`.
2. Click "Claim your agent →" — MetaMask prompts; sign + send.
3. Tx confirms. UI flips to claimed state. Basescan shows `owner = your address`.
4. Reload. State persists (localStorage + server-side via `GET /api/cz/identity?refresh=1`).
5. From a different wallet, try to claim → "Already claimed by 0x…" + no tx sent.

## Reporting

Report: which pattern (A or B), contract function used, tx hash on Basescan, gas cost, whether the chain-add fallback was needed, the exact error messages shown for each failure path.
