# Task 11 — Manage Permissions panel (`src/permissions/manage-panel.js`)

## Why

Owners need a single surface to see every active delegation, how much has been used against the scope, and revoke any of them with one click. This is the flip-side of task 10 — grant in, manage out.

## Read first

- [00-README.md](./00-README.md) — canonical `GET /api/permissions/list` + `POST /api/permissions/revoke` shapes
- [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) — owner-only surface pattern + wallet helpers
- [src/account.js](../../src/account.js) or the dashboard entry point — mount this panel where "on-chain" chip already lives
- [src/erc7710/abi.js](../../src/erc7710/abi.js) — need `DELEGATION_MANAGER_ABI` to call `disableDelegation` on-chain

## Build this

1. **Module**: `src/permissions/manage-panel.js`.
2. **Public API**: `mountManagePanel({ container, agentId })` — renders into the given element; returns an `unmount()` function.
3. **Data flow**:
    - On mount: `GET /api/permissions/list?agentId=...&status=all&limit=200`.
    - For each row, render a card with:
        - Scope in the same plain-English sentence as task 10 ("Up to 10 USDC per day on Uniswap V3 Router until Apr 18, 2026")
        - Badges: `active` (green), `revoked` (gray), `expired` (amber)
        - Chain chip (use existing chain chip from `src/erc8004/chain-meta.js`)
        - Usage line: `X redemptions · last used Y ago`
        - Actions: **Revoke** button (only if active and user is delegator or owner)
        - Explorer link to the delegator + delegate addresses
4. **Revoke action**:
    - Require connected wallet = delegator address (guard; prompt "Connect with <0xabc…> to revoke").
    - Call `DelegationManager.disableDelegation(delegationHash)` via ethers signer.
    - Show tx-pending state (spinner + explorer link to the pending tx).
    - On receipt: `POST /api/permissions/revoke` with `{ id, txHash }`.
    - On success: flip the card UI to `revoked` without a full refetch; optimistic plus background refetch.
    - On any error: surface verbatim, keep the card in the active state.
5. **Empty state**: "No permissions granted yet. [Grant permissions]" — the button opens the grant modal (task 10) via `window.openGrantPermissions` if available, else a static hint.
6. **Polling / refresh**: refetch on window focus (lightweight). No constant polling.
7. **Styling**: reuse existing card / button primitives. Match the dashboard.
8. **Wire-up point**: add a mount call on the agent page (`src/agent-home.js` or the dashboard — grep for where the on-chain chip renders today; add the panel directly below it). Guard with the same owner gate already in use.

## Don't do this

- Do not revoke via server first. On-chain is the source of truth; server mirrors. Doing it server-first creates desync.
- Do not silently skip cards when the hash is unknown to the indexer — show them anyway with a "pending indexer" sub-label.
- Do not show the full signature or `delegation_json`; just hash + scope + status.
- Do not add pagination yet. Cap at 200; if a user hits that we'll deal with it.

## Acceptance

- [ ] Panel mounts on agent page for owners only.
- [ ] Lists active + revoked + expired correctly.
- [ ] Revoke submits real tx → server mirror flips status → UI updates.
- [ ] Disconnected wallet path guides user to connect (no crash).
- [ ] `node --check` + `npm run build` pass.

## Reporting

- Screenshots: full panel, revoke pending state, post-revoke state.
- The happy-path `POST /api/permissions/revoke` transcript.
