# 06-05 — Transfer agent controller (keep `onchain_id`)

## Why it matters

Users change wallets — lose a seed, switch from hot to hardware, migrate custodians. If changing the controller means minting a new onchain id and losing reputation, the identity isn't really portable. The IdentityRegistry supports controller transfer; this prompt wires the client + server to drive it safely.

## Context

- IdentityRegistry: [contracts/src/IdentityRegistry.sol](../../contracts/src/IdentityRegistry.sol).
- Requires: 06-01 merged.
- Primary wallet (01-03) determines the current controller from our side.

## What to build

### Endpoint — `POST /api/agents/:id/transfer-controller`

- Owner-authed (session user). Body: `{ new_controller: '0x…' }`.
- Validates that `new_controller` is linked to the same user in `user_wallets`. (Disallow transfer to a wallet the user doesn't own — use a separate "gift" flow if we ever need it.)
- Returns calldata for the registry's `transferController(onchain_id, new_controller)` method, plus the chain and expected gas.
- Client signs with the **current** controller wallet and submits.

### Confirmation — `POST /api/agents/:id/transfer-controller/confirm`

- Body `{ tx_hash }`. Server waits for receipt, parses `ControllerTransferred(onchain_id, old, new)`, updates:
  - `user_wallets`: flip `is_primary` (only if `new_controller` is on the caller's wallet list and becomes the new primary).
  - `agents`: no column change — controller is derived from onchain state, not cached in DB. If any cached column exists (e.g. `agents.onchain_controller`), update it.
- Emits an `agent_actions` row with type `controller_transferred` (audited).

### Post-transfer UX

- Dashboard shows a banner on the agent page: "Controller is now 0x…. Future onchain actions (update manifest, anchor) will be signed by this wallet."
- If the new controller isn't the user's *primary* wallet, offer a one-click "Make primary" that calls the 01-03 endpoint.

### Edge cases

- Transfer initiated but tx reverted or dropped: the confirm endpoint returns `{ status: 'dropped' }` and the UI clears the in-flight state.
- Transfer to a wallet the user doesn't own: 400 `unauthorized_target`. This is a guardrail; the registry itself allows any target.
- Manifest updates pending mid-transfer: block "Update onchain" until the transfer confirms.

### Spec update

Append to [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md): a note that `controller` in the manifest is authoritative only via the chain — manifest field is advisory.

## Out of scope

- Multi-sig controllers.
- Timelocked transfers.
- Allowing transfer to a wallet not owned by the caller (could be added with a signed acceptance from the recipient; not now).
- Changing the underlying ERC-8004 contract — transfer behavior must match what IdentityRegistry already supports.

## Acceptance

1. User with two linked wallets (A primary, B secondary) initiates transfer from A → B.
2. Wallet A signs, tx confirms, `ControllerTransferred` event parsed.
3. Future "Update onchain" clicks on the same agent prompt wallet B.
4. Attempt to transfer to a wallet not in `user_wallets` → 400.
5. Attempt to update onchain mid-transfer → UI blocks until the transfer resolves.
6. `node --check` passes on new files.
