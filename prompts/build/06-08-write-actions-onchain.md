# 06-08 — Onchain: signed agent actions to chain (audit log)

**Branch:** `feat/onchain-actions`
**Stack layer:** 6 (Onchain portability)
**Depends on:** 06-05 (deploy automation), 06-06 (indexer)

## Why it matters

Today every agent action goes to the in-memory protocol bus and an off-chain audit table. The differentiator is portable, verifiable history: an agent's wallet signs each significant action and the proof can be settled on-chain (Merkle root per epoch) so any host can verify "this agent really did X on date Y."

## Read these first

| File | Why |
|:---|:---|
| [src/agent-protocol.js](../../src/agent-protocol.js) | Bus emits `sign` actions today — reuse. |
| [src/agent-identity.js](../../src/agent-identity.js) | Where the agent's wallet lives. |
| [api/agent-actions.js](../../api/agent-actions.js) | Off-chain action store; will receive Merkle batching. |
| [contracts/src/](../../contracts/src/) | Existing registries; you may add a small `ActionAnchor.sol`. |

## Build this

1. **Sign every action** at the boundary: when the protocol bus emits a `sign-eligible` action (configurable per skill), wrap the payload in EIP-712 and sign with the agent's wallet (Privy or local key). Persist `{action, signature, signer, ts}` to `agent_actions`.
2. **Anchor in epochs.** Add `contracts/src/ActionAnchor.sol`:
   ```solidity
   contract ActionAnchor {
     event AnchorPosted(uint256 indexed tokenId, bytes32 root, uint256 epoch);
     mapping(uint256 => mapping(uint256 => bytes32)) public roots; // tokenId => epoch => root
     function anchor(uint256 tokenId, uint256 epoch, bytes32 root) external { /* ... */ }
   }
   ```
3. **Batcher cron** at `api/cron/anchor-actions.js`:
   - Once per hour (configurable), per agent with new actions:
   - Build a Merkle tree of action hashes.
   - Call `anchor(tokenId, epoch, root)` from a relayer wallet (gas-only key, scoped to ActionAnchor).
   - Persist the root + epoch into `agent_actions_anchor` table.
4. **Verifier helper** in [src/erc8004/](../../src/erc8004/) — given an action + Merkle proof + on-chain root, return `{ valid, anchoredAt }`.
5. **UI** in [src/agent-home.js](../../src/agent-home.js) timeline: green "anchored" pip on actions whose epoch root has been settled; tooltip shows tx hash + block.

## Out of scope

- Do not push every action on-chain individually. Batched only.
- Do not require user signature for every action — agent wallet signs.
- Do not implement zk proofs — Merkle is enough.
- Do not deploy ActionAnchor in this PR; ship the contract + script and stop.

## Acceptance

- [ ] EIP-712 signed payloads stored in `agent_actions` for sign-eligible actions.
- [ ] Local fork test: anchor cron posts a root and the verifier confirms a sample action.
- [ ] Timeline shows the anchored pip after settlement.
- [ ] No double-anchoring (idempotent on epoch + tokenId).

## Test plan

1. Anvil + 06-05 deploy + 06-06 indexer.
2. Drive a few agent actions through the protocol bus.
3. Run `api/cron/anchor-actions` once. Verify on-chain root + db row.
4. Use the verifier helper on one action — expect `valid: true`.
