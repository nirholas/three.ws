# Task 01 — ERC-8004 write flow

## Why

Owners must be able to deploy their agent on-chain with a single click and end up with a verifiable identity record: `{ owner, agentURI }` committed to the ERC-8004 IdentityRegistry.

## Read first

- [src/erc8004/abi.js](../../src/erc8004/abi.js) — `REGISTRY_DEPLOYMENTS` map, the ABIs. Verify what's actually deployed on Base Sepolia / Sepolia today (grep the file).
- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — existing helpers (`connectWallet`, `registerAgent`, `buildRegistrationJSON`, `pinToIPFS`)
- [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) — existing UI stub
- [contracts/](../../contracts/) — Foundry project. Run `forge test` if possible; look at the `IdentityRegistry.sol` signature.

## Build this

### 1. Confirm contract state

- Read `REGISTRY_DEPLOYMENTS` from `abi.js`.
- For each chainId listed, make an `eth_getCode` RPC call to confirm the contract is actually deployed (not just a TODO).
- Produce a table in the PR description: chainId | address | status | explorer link.
- If **no chain** has a deployed contract, stop. Bubble up: "Needs `.github/prompts/deploy-erc8004-contracts.md` to run first."

### 2. `/agent/:id` "Deploy on-chain" button

On the agent page, if `agent.owner_user_id === current_user.id` **and** `agent.chain_id` is null, show a button:

```
[ ⬢ Deploy on-chain ]
```

Click flow:
1. Open modal: "Choose network" — radio list of deployed chains (from step 1). Default to Base Sepolia.
2. Load network for their wallet; prompt to switch if needed.
3. Build the `agentURI` metadata JSON (`buildRegistrationJSON`):
   ```json
   {
     "name": "…",
     "description": "…",
     "avatar": { "uri": "ipfs://<cid>", "mimeType": "model/gltf-binary" },
     "skills": [...],
     "schema": "agent-manifest/0.1"
   }
   ```
4. Pin that JSON to IPFS (task 02 wires the pinning; here just call the helper with a clear error if pinning fails).
5. Estimate gas. Show fee preview. Require explicit confirm.
6. Call `IdentityRegistry.register(agentURI)` via ethers.
7. On `TransactionReceipt`, extract the `agentId` from the emitted event.
8. `POST /api/agents/:id/chain` with `{ chainId, agentId, txHash, agentURI }`.
9. Server updates the DB row with those fields; responds with the updated record.
10. UI replaces the button with "On-chain ✓ · `0xabcd…ef12`" linking to the explorer.

### 3. Server endpoint

`POST /api/agents/:id/chain` (auth + owner gate):
- Validates `chainId` is a known deployment.
- Validates `agentId` by reading the chain (`IdentityRegistry.getAgent(agentId) == caller`).
- Updates `agent_identities` row.
- Returns the full record.

### 4. Status surface

Anywhere the agent is rendered (dashboard, /agent/:id, embed), if `chain_id` is set, show the on-chain chip. Use a shared component — don't copy-paste.

## Don't do this

- Do not default to mainnet. Base Sepolia / Sepolia only until user explicitly approves mainnet.
- Do not hand-roll contract calls — use the ABIs in `abi.js`.
- Do not store the private key anywhere. User's wallet signs, server only records.
- Do not swallow revert reasons — surface them verbatim in the UI.

## Acceptance

- [ ] "Deploy on-chain" button visible only to owners of unregistered agents.
- [ ] Click → wallet prompt → after confirm, agent record shows on-chain chip.
- [ ] Explorer link opens the IdentityRegistry contract page on the block explorer.
- [ ] A second registration attempt on the same agent is blocked client-side + server-side (409 Conflict).
- [ ] `npm run build` passes.

## Reporting

- Contract deployment table
- Screenshots of the register flow, including a revert case (low balance)
- The updated `agent_identities` row after success
