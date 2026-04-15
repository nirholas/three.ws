# Task 05 — Signed action provenance

## Why

Each agent action ("I said X", "I did Y") should be signed by the agent's wallet. Anyone with the public key can verify the log is tamper-proof. This is what turns an agent from "a chat with nice graphics" into "an auditable participant."

## Depends on

- Band 1 wallet auth (specifically task 06 — agent wallet binding) must be shipped.
- This task assumes `agent_identities.wallet_address` is verified, not just self-declared.

## Read first

- [api/agent-actions.js](../../api/agent-actions.js) — existing action recorder
- [src/agent-identity.js](../../src/agent-identity.js) — client-side identity + action log
- [src/agent-protocol.js](../../src/agent-protocol.js) — which events get recorded
- EIP-191 signing via `signer.signMessage`

## Build this

### 1. Action envelope

Every action sent to `/api/agent-actions` becomes a canonical JSON:

```json
{
  "agentId":   "agt_…",
  "type":      "speak|remember|sign|skill-done|validate|load-end",
  "payload":   { … },
  "timestamp": 1713139200000,
  "prevHash":  "sha256(prev action canonical JSON)",
  "nonce":     12345
}
```

- Canonicalize with RFC 8785 (JCS) or plain sorted-keys JSON.
- Hash with SHA-256 to get `actionHash`.
- Client signs the hash with the wallet (EIP-191: `signer.signMessage(hashBytes)`).
- Server stores the action with `action_hash`, `prev_hash`, `signature`, `signer_address`.

### 2. Hash chain

Each action's `prevHash` references the previous action's `actionHash`. The chain:
- Is per-agent.
- Genesis action's `prevHash = 0x00…00`.
- A broken chain means tampering — server rejects.

### 3. Server endpoint

`POST /api/agent-actions`:
- Verify `signer_address` matches `agents.wallet_address`.
- Verify `prevHash` matches last stored action's `action_hash`.
- Recompute `actionHash` server-side from the canonical JSON; ensure match.
- Insert row.
- Return `{ ok: true, actionHash, index }`.

Reject with `{ ok: false, error: 'signature_invalid' | 'chain_mismatch' | 'stale_prev' }`.

### 4. Client batch

Many events per second (speak + emote + think). Batch every 300ms:
- Collect actions in a queue.
- Build a single Merkle root over the batch; sign the root.
- Send `/api/agent-actions/batch` with `{ items: […], merkleRoot, signature }`.
- Server unfolds, verifies each against its prevHash, stores.

### 5. Public audit endpoint

`GET /api/agent-actions/:agentId/verify?from=<n>&to=<m>`:
- Returns a proof bundle (all actions + sigs + Merkle paths).
- Client-side verifier at `/agent/:id/audit` re-verifies every sig + chain link in-browser and shows ✓ / ✗ per link.

### 6. UI

On `/agent/:id`, the Timeline already exists. Add a small green/red chip per entry:
- ✓ = signature verified locally
- ✗ = signature invalid (should only happen if someone tampered)
- hover → shows signer address

### 7. Gas considerations

Do NOT put every action on-chain. Store signatures off-chain (our DB + pinned to IPFS in rolling snapshots every 1000 actions or 1 hour). Snapshot Merkle root CAN be committed on-chain via `ValidationRegistry.recordValidation(agentId, rootHash)` — gas-cheap, once per snapshot.

## Don't do this

- Do not put raw actions on-chain. Only snapshot roots.
- Do not use the session JWT to authorize action signing. Use the wallet signature itself.
- Do not trust `signer_address` in the client request — always recover from signature server-side.
- Do not break backward compat — existing rows without `action_hash` / `signature` are marked `unverified` and render grayed out.

## Acceptance

- [ ] New actions have signatures + chain hashes.
- [ ] `/api/agent-actions/:id/verify` returns proofs; browser verifier shows all ✓.
- [ ] Manually tamper with one row in DB → verifier shows ✗ at that index.
- [ ] Snapshot Merkle root is committed on-chain hourly (or manually triggerable).
- [ ] `npm run build` passes.

## Reporting

- Canonicalization choice (JCS vs sorted-keys) + why
- Latency overhead on action emission
- Snapshot committing frequency + gas cost estimate
- A screenshot of the audit page showing the verification chain
