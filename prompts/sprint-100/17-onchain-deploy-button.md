# 17 — On-chain deploy button module

## Why

The ERC-8004 scaffolding exists ([src/erc8004/](../../src/erc8004/)) but no user-facing "Deploy on-chain" button on the agent page. This is the band-6 unlock.

## Parallel-safety

New standalone module + CSS. No agent-page wiring — a later prompt or manual wiring mounts it.

## Files you own

- Create: `src/erc8004/deploy-button.js`
- Create: `src/erc8004/deploy-button.css`

## Read first

- [src/erc8004/abi.js](../../src/erc8004/abi.js) — `REGISTRY_DEPLOYMENTS`.
- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — existing `connectWallet`, `registerAgent`, `buildRegistrationJSON`.
- [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) — existing UI stub; may overlap — read it FIRST and note overlap.

## Deliverable

```js
export class DeployButton {
    constructor({ agent, container, preferredChainId = 84532 /* Base Sepolia */ })
    mount()
    unmount()
}
```

Behavior:

1. Render a button `⬢ Deploy on-chain` inside `container`.
2. If `agent.chainId` is already set (already deployed), replace the button with a chip `On-chain on Base Sepolia · view on explorer` linked to the appropriate explorer.
3. On click:
   - `connectWallet({ chainId: preferredChainId })`.
   - Show an inline progress panel: `Estimating gas... → Sign tx → Waiting confirmation → Done`.
   - Call `registerAgent({ signer, owner, agentURI })` with `agentURI` derived from the agent's manifest URL.
   - On confirmation: `POST /api/agents/:id/onchain` with `{ chainId, txHash, contractAddress }` to persist. If that endpoint doesn't exist, log a warning — the on-chain state is still authoritative.
   - Show success chip with explorer link.
4. Errors:
   - user rejected → reset silently.
   - wrong network → offer "Switch to Base Sepolia" action.
   - no contract deployed on chain → disable button with tooltip.
   - insufficient funds → show "Fund this wallet" with faucet link.

## CSS

Scoped under `.deploy-button-root`. Dark-theme by default; detect via `prefers-color-scheme`.

## Constraints

- No new deps (ethers already present).
- Never broadcast without user-signed tx.
- Never mutate chain-id mappings in `abi.js`.

## Acceptance

- `node --check` clean.
- `npm run build` clean.
- Scratch-mount with a Base Sepolia testnet wallet that has funds → flows end-to-end → tx hash shown, explorer link works.

## Report

- Overlap analysis with [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) — keep them parallel or should one subsume the other? Just note, don't refactor in this prompt.
- Gas-estimation output from a real Base Sepolia run.
