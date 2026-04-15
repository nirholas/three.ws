---
mode: agent
description: "Register agent identity on ERC-8004 contract with IPFS manifest CID"
---

# Stack Layer 6: ERC-8004 On-Chain Registration

## Problem

For agents to be portable into ANY host app directly from chain, each agent needs an on-chain record mapping a stable ID to the latest manifest CID. ERC-8004 identity contracts are already deployed (per [src/erc8004/abi.js](src/erc8004/abi.js)); wire up registration + updates.

## Implementation

### Contract interaction

Use the deployed contract addresses in [src/erc8004/abi.js:61-69](src/erc8004/abi.js#L61-L69). Confirm the contract's public ABI includes:
- `register(address owner, string manifestURI) returns (uint256 agentId)`
- `updateManifest(uint256 agentId, string manifestURI)`
- `getAgent(uint256 agentId) returns (address owner, string manifestURI, uint256 updatedAt)`

If the deployed contract differs, work with the deployed ABI.

### Register flow

After publishing to IPFS (stack-23), the owner can register on-chain:

1. UI: "Register on-chain" button on the edit page Identity tab (stack-10).
2. Confirm gas prompt — shows estimated cost.
3. Owner wallet signs the tx calling `register(owner, "ipfs://<cid>")`.
4. Listen for `AgentRegistered` event → extract `agentId` → store in `avatars.onchain_agent_id` + `avatars.onchain_chain_id`.
5. Show tx link on Basescan.

### Update flow

For subsequent publishes, call `updateManifest(agentId, newCid)`. Same UX.

### Gasless option

Support meta-transactions if the deployed contract has them. Otherwise sponsor gas via Biconomy / Gelato (v2 concern — don't add dep now, just log as a todo).

### Client code

New module `src/onchain/register.js`:
- `registerAgent(signer, cid) => { agentId, txHash }`
- `updateManifest(signer, agentId, cid) => { txHash }`
- `getAgent(agentId, provider) => { owner, manifestURI, updatedAt }`

### DB

`avatars` table: add `onchain_agent_id` (bigint, nullable), `onchain_chain_id` (int, nullable), `onchain_tx_hash` (text), `onchain_updated_at`.

### Public verification

The public agent page (stack-15) shows a "Verified on-chain" badge if `onchain_agent_id` is set, linking to the Basescan tx.

## Validation

- Register an agent on-chain (Base Sepolia) → tx confirms, agentId stored.
- Call `getAgent(agentId)` from a script → returns correct owner + manifest URI.
- Edit avatar, publish new manifest, call `updateManifest` → tx confirms, latest CID on chain.
- Non-owner tries to update → reverts.
- `npm run build` passes.

## Do not do this

- Do NOT hardcode Basescan URL — derive from chain id.
- Do NOT re-register if the agent is already registered — call `updateManifest` instead.
