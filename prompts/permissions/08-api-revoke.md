# Task 08 — `POST /api/permissions/revoke`

## Why

Revocation is the trust anchor of the whole system. On-chain truth is `DelegationManager.disableDelegation(hash)`, but we must mirror that off-chain so the UI + indexer + metadata endpoint reflect it instantly. The client calls the contract; the server records the tx hash and flips `status='revoked'` after verifying the on-chain state.

## Read first

- [00-README.md](./00-README.md) — canonical endpoint shape + error codes
- [src/erc7710/abi.js](../../src/erc7710/abi.js) — `DELEGATION_MANAGER_ABI` (has `isDelegationDisabled`)
- [api/CLAUDE.md](../../api/CLAUDE.md) — conventions
- [api/\_lib/chain.js](../../api/_lib/chain.js) if present, or wherever read-only RPC calls are made; otherwise use `ethers.JsonRpcProvider` directly with a public RPC URL from `src/erc8004/chain-meta.js`

## Build this

Create `api/permissions/revoke.js` (POST only):

1. Standard gates: POST, CORS, `limits.write`, `getSessionUser` (401 on absent).
2. **Body**: `{ id: uuid, txHash: '0x...' }` — both required.
3. **Lookup**: `SELECT * FROM agent_delegations WHERE id = $1`. 404 `delegation_not_found` if missing.
4. **Authorization**: Only the delegator (the wallet that signed the grant) or the agent owner may revoke. Verify by joining `agents.owner_user_id == user.id` OR `row.delegator_address == user.linked_wallet`. Else 403.
5. **On-chain verification (the key step)**:
    - Build a read-only provider for `row.chain_id`.
    - Fetch the receipt for `txHash`. If null → 400 `tx_not_found`.
    - Decode the `DelegationDisabled` event from the receipt's logs; compare its `delegationHash` to `row.delegation_hash`. Mismatch → 400 `tx_mismatch`.
    - Call `DelegationManager.isDelegationDisabled(row.delegation_hash)` as a second confirmation. Must return `true`. Else 400 `not_yet_disabled` (receipt may be pending on the indexed chain replica).
6. **Persist**: `UPDATE agent_delegations SET status='revoked', revoked_at=NOW(), tx_hash_revoke=$1 WHERE id=$2 AND status='active'`. If 0 rows updated → 409 `already_revoked`.
7. **Response**: `{ ok: true, status: 'revoked', revokedAt }`.
8. **Usage event**: emit `permissions.revoke`.

## Don't do this

- Don't trust `txHash` without fetching the receipt and decoding the event. Anyone could post a random hash otherwise.
- Don't run the revocation on-chain from the server side. The user initiates the on-chain write from the UI with their wallet; the server only mirrors.
- Don't allow status transitions other than `active → revoked` here.
- Don't hammer the RPC. One `getTransactionReceipt` + one `eth_call` per request is fine; if you add retries, cap to 3.

## Acceptance

- [ ] Happy path: row flips to `revoked` with `tx_hash_revoke` stored.
- [ ] Non-owner/non-delegator → 403.
- [ ] Bad tx hash → 400.
- [ ] Tx doesn't actually revoke this delegation → 400 `tx_mismatch`.
- [ ] Already revoked → 409.
- [ ] `node --check` + `npm run build` pass.

## Reporting

- Receipt-decoding snippet you used.
- `curl` transcript of happy path with a real Base Sepolia revocation tx.
- Explorer link for the tx.
