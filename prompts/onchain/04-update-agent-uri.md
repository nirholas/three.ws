# Task: Propagate avatar edits on-chain via setAgentURI

## Context

Repo: `/workspaces/3D`. The canonical identity ABI exposes:

```solidity
function setAgentURI(uint256 agentId, string newURI) external;
```

See [src/erc8004/abi.js](../../src/erc8004/abi.js). [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) already calls it at the end of `registerAgent` once. What's missing: after the **avatar-edit** flow (priority 3, prompts/avatar-edit/) produces a new GLB, we pin it, rebuild the registration JSON, pin that, and should then call `setAgentURI(agentId, newURI)` so the chain reflects the updated avatar. Today that last step is skipped — on-chain data goes stale.

## Goal

Add an idempotent, resumable "update agent URI" flow that runs after avatar-edit and optionally as a standalone "republish on-chain" action in the dashboard / agent home page.

## Deliverable

1. New file [src/erc8004/update-agent.js](../../src/erc8004/update-agent.js) exporting:

   ```
   async function updateAgentURI({
     agentId,         // number | bigint | string
     chainId,
     newGLB?,         // File | Blob — optional; if absent, only re-pin metadata
     nextRecord,      // merged patch: { name?, description?, image?, services?, supportedTrust?, ... }
     apiToken,
     signer,
     onStatus,        // structured step emitter, same shape as 03
   })
   ```

   Flow:
   1. If `newGLB` is provided → `pinToIPFS(newGLB)` → new `imageCID`.
   2. Fetch the current `tokenURI(agentId)` from chain; resolve + fetch the current registration JSON (reuse [src/ipfs.js](../../src/ipfs.js) fallback).
   3. Deep-merge the existing JSON with `nextRecord`, replacing `image` with `ipfs://<imageCID>` when a new GLB was pinned. **Preserve** `registrations[]` exactly — do not rewrite the `agentId`/`agentRegistry` fields.
   4. Pin the merged JSON → new `registrationCID`.
   5. Connect contract with `signer`; call `setAgentURI(agentId, 'ipfs://<registrationCID>')`. Return `{ imageCID?, registrationCID, txHash }`.
2. **Idempotence key.** Write to `localStorage` under key `erc8004:update-in-flight:{chainId}:{agentId}` a JSON blob `{ step, imageCID?, registrationCID?, newTokenURI, startedAt }` as the flow progresses. On re-entry with the same `(chainId, agentId)`, the flow:
   - If `step === 'pinning-glb'` and no `imageCID` yet → re-pin.
   - If `step === 'pinning-json'` but `imageCID` already set → skip re-pin of GLB, rebuild & re-pin JSON (OK to re-pin JSON; deterministic content would yield the same CID anyway).
   - If `step === 'sending-tx'` → check if `tokenURI(agentId)` already equals the in-flight `newTokenURI`. If yes → clear the localStorage key, return the record; if no → resend the tx.
   - On terminal success → clear the key.
3. **Ownership guard.** Before step 5, call `ownerOf(agentId)` and compare to `signer.getAddress()` (case-insensitive checksum). If mismatch, throw `new Error('not-owner')`.
4. Integration point in the avatar-edit flow:
   - In [src/avatar-creator.js](../../src/avatar-creator.js) (or wherever avatar-edit's "save" handler lives — search for the save/confirm callback) add a post-save hook that, **only if** `AgentIdentity.isRegistered === true` and `meta.onchain.chainId` is set, calls `updateAgentURI`. Gate this behind an explicit user confirmation dialog: "Publish changes on-chain? This requires a signature and ~0.0003 ETH."
   - If the user cancels, local/backend state is still updated (unchanged behavior); only the on-chain step is skipped.
5. Standalone surface: add a button "Republish on-chain" to [src/agent-home.js](../../src/agent-home.js) that appears only for owners of registered agents; clicking invokes `updateAgentURI` with no `newGLB`, forcing a metadata-only refresh (useful for renaming or editing description).

## Audit checklist

- Re-entrant: kill the tab mid-flow, reload, the pending `setAgentURI` tx re-submits (or is detected as already-landed via `tokenURI` read).
- If `setAgentURI` reverts → keep the localStorage key so user can retry; surface the error via `onStatus({ step: 'sending-tx', state: 'failed', error })`.
- Never rewrites `registrations[]`. Existing `agentRegistry` eip155 string must pass through byte-for-byte.
- Deep merge is JSON-safe (no prototype pollution; merge only plain objects, replace arrays).
- Read-only fields never end up mutated: `type`, `registrations[]`, `x402Support` pass through.
- Owner check uses `getAddress()` on both sides.
- "Republish on-chain" button hidden when `walletAddress !== ownerAddress`.

## Constraints

- No new dependencies.
- `ethers` only.
- Reuse `pinToIPFS` from [agent-registry.js](../../src/erc8004/agent-registry.js) — do not duplicate it.
- Reuse `classifyTxError` from [03-register-flow-polish.md](./03-register-flow-polish.md) if that task has shipped; otherwise fall back to raw error message.
- Do not change the deployed ABIs or addresses.
- Do not touch the priority-3 avatar-edit prompts' own deliverables; only add the save-hook integration.

## Verification

1. `node --check` each modified / new JS file.
2. `npx vite build` passes.
3. Manual:
   - Register an agent on Base Sepolia (uses [03](./03-register-flow-polish.md)).
   - Open avatar-edit, swap a hair, save → confirm "Publish changes on-chain?" dialog → accept → tx lands → `tokenURI(agentId)` now resolves to a new registration JSON with updated `image`.
   - Console-kill the tab between step 4 (pin JSON) and step 5 (tx). Reload. Trigger save again — flow resumes, tx sends once.
   - Without a wallet, call `updateAgentURI` → fails with `not-owner` or `no-signer`.
   - Rename the agent locally, click "Republish on-chain" → only step 3-5 run; no new GLB pinned.
4. Read the final on-chain `tokenURI` and confirm `registrations[0]` is unchanged from before the update.

## Scope boundaries — do NOT do these

- Do not change how the agent was originally registered.
- Do not auto-publish on every local save — require the confirmation dialog.
- Do not introduce a queue/workers system. The localStorage in-flight key is enough.
- Do not add an "undo" path that calls `setAgentURI` to a previous version. Users can just edit again.
- Do not migrate any data off IPFS.
- Do not add cross-chain replication — each agent lives on one chain.

## Reporting

- Files created / edited.
- Exact merge strategy diff from naive `Object.assign` (e.g., arrays, `services[]`).
- Any manifest JSONs in the wild whose shape broke the merge — list them, do not "fix" them upstream in this task.
- A sample before/after `tokenURI` JSON diff from your manual test.
- `npx vite build` status.
