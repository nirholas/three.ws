# Task 06 — Link a wallet to an existing email account

## Why this exists

Existing users signed up with email + password. They shouldn't have to create a second account to use wallet features. Conversely, a wallet-only user should be able to add an email for password recovery. This task builds the linking flow in both directions without breaking either.

## Files you own

- Create: `api/auth/wallet-link.js`.
- Create: `api/auth/wallet-unlink.js`.
- Create: `public/dashboard/settings-wallet.html` (or add a panel to the existing dashboard settings page if one exists — inspect `public/dashboard/` first).
- Edit: `vercel.json` — two route lines, adjacent to the SIWE routes.

Do not modify `api/auth/login.js` or `api/auth/register.js`.

## Deliverable

### `POST /api/auth/wallet/link`

Requires existing session (email or wallet).

Body: `{ message, signature, purpose: "link" }` (same shape as siwe-verify).

Steps:
1. `getSessionUser(req)` → user. 401 if missing.
2. Do the full SIWE verification (lift the verify helper from task 03 into `api/_lib/siwe.js` and import here — if the helper wasn't extracted in 03, extract it now but keep the 03 behavior byte-identical).
3. Require `purpose === 'link'` on the nonce; reject `'login'` nonces here.
4. If the recovered address already belongs to **another** user → 409 `{ error: "wallet already linked to another account" }`.
5. Otherwise: `UPDATE users SET wallet_address = $1, wallet_chain_id = $2, wallet_linked_at = now() WHERE id = $userId`.
6. Respond `200 { user }`.

### `POST /api/auth/wallet/unlink`

Requires existing session. Body: `{}`.

- Refuse if the user has NO email (otherwise they lose all access). Return 409 with a clear message.
- Otherwise clear the three wallet columns, respond 200.

### Settings UI

A simple panel:
- "Linked wallet: `0xABC…` (Base Mainnet) — *Unlink*"
- Or: "No wallet linked — [Link your wallet] button"
- The *Link* button triggers the client-side SIWE dance with `purpose: "link"`.
- The *Unlink* button hits the unlink endpoint.

Use the dashboard's existing CSS and layout. Do not introduce new global styles.

## Constraints

- Do not auto-link on sign-in. Users must explicitly click "link" from settings. This prevents session fixation / drive-by linking.
- The `wallet-link` endpoint requires BOTH a valid session AND a valid signature. Either alone is not enough.
- Preserve case-insensitive uniqueness — check with `lower(wallet_address)` in the 409 query.

## Acceptance test

1. Email user → settings → link wallet (SIWE) → success; `users.wallet_address` populated.
2. Try linking the same wallet from a second email user → 409.
3. Wallet-only user → settings → link wallet returns a sensible message (already linked).
4. Email+wallet user → unlink → success; wallet columns null.
5. Wallet-only user (no email) → unlink → 409, stays linked.
6. Replay the link message+signature → 400 (nonce consumed).

## Reporting

- Where the shared SIWE helper landed (`api/_lib/siwe.js`?) and its exported surface.
- Any UX gotchas when the user has to switch accounts in their wallet mid-flow.
- Confirmation that both directions (email → +wallet, wallet → +email) are reachable.
