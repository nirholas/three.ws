---
mode: agent
description: "Wallet-signed agent actions with on-chain anchoring for reputation"
---

# Stack Layer 6: Signed Action Log

## Problem

Agents emit actions continuously (skill runs, memory writes, interactions). For reputation to be portable and verifiable, significant actions should be signable by the owner's wallet and optionally anchored on-chain. Without this, reputation is just a DB row we control.

## Implementation

### Action signing

For opt-in "significant" actions (configurable per skill), the agent protocol captures the action payload and:
1. Hashes it (`keccak256(canonicalJSON(action))`).
2. Optionally prompts the owner to sign it via EIP-712 typed data.
3. Stores `{action, hash, signature, signer}` in the `agent_actions` table.

### Batch anchoring

Every N actions or daily, compute a Merkle root of new action hashes → write the root on-chain via ERC-8004 reputation registry (`submitActionRoot(agentId, merkleRoot)`).

### Verification

Public action log endpoint `GET /api/agents/:id/actions/verified` returns actions with:
- `signature` (EIP-712, verifiable client-side).
- `merkleProof` (Merkle path to the on-chain root, if anchored).

Any consumer can independently verify:
- Signature → action was approved by the owner at the time.
- Merkle proof + on-chain root → action existed by block time X.

### Background mode

For high-frequency actions (emotion drift, idle skills), skip signing — just log.
For user-initiated or remote-initiated skills (summon from Claude, invoke via MCP), sign by default.
Configurable per-skill in the manifest: `"signing": "required" | "optional" | "never"`.

### Tools

CLI helper: `npm run verify-action -- <actionId>` → checks signature + merkle proof.

### Replay attack prevention

Sign includes nonce + timestamp. Server rejects signatures older than 10 min for newly-submitted actions.

## Validation

- Invoke a signed-by-default skill → owner wallet prompts for signature → action stored with sig.
- Fetch verified log → signature verifies against owner address.
- Wait for next batch anchor → on-chain root written; merkle proof returned.
- Third-party verifier script: takes an action + root → confirms inclusion.
- `npm run build` passes.

## Do not do this

- Do NOT sign every emotion frame. Limit to meaningful actions.
- Do NOT write every individual action on-chain. Merkle-batch.
