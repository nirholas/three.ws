# Task: Link multiple wallets to one account — API + standalone page

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) and [api/CLAUDE.md](../../api/CLAUDE.md) first.

The `user_wallets` table (see [api/\_lib/schema.sql](../../api/_lib/schema.sql)) already supports many wallets per user, but there is no API for an authenticated user to link a new wallet to their existing account. Users who sign in with wallet A cannot later add wallet B.

The linking flow is: authenticated user requests a nonce → signs a SIWE-like message with the new wallet → server verifies the signature and inserts a `user_wallets` row. No new session is created (the user is already signed in).

## Files you own (exclusive — all new)

- `api/auth/wallets/index.js` — `GET` list wallets, `POST` link a new wallet (takes `{ address, message, signature }`).
- `api/auth/wallets/[address].js` — `DELETE` unlink (refuses to remove the last wallet if it's the primary auth method).
- `api/auth/wallets/nonce.js` — `POST` issue a link-nonce for the authenticated user. Separate from the login nonce because the threat model is different (caller is already authenticated, but we still need replay protection).
- `public/dashboard/wallets.html` — standalone page listing linked wallets + "Link another wallet" button. Uses MetaMask directly via `window.ethereum` — no Privy dependency. Reuses the color palette from [public/dashboard/index.html](../../public/dashboard/index.html).

**Do not edit** `dashboard.js`, `dashboard/index.html`, or any existing SIWE file.

## Conventions

- ESM, tabs, single quotes, 100-col. No TS.
- `sql` from `api/_lib/db.js`; `json()` / `error()` from `api/_lib/http.js`.
- Auth via `getSessionUser()` from `api/_lib/auth.js`.
- Signature verify via `ethers.verifyMessage` (already a dep).
- Nonce storage: reuse the existing `siwe_nonces` table with a `purpose` discriminator — check if column exists in schema file; if not, use a separate in-memory Map (TTL 5 min) and document the limitation in your report.

## Endpoints

### `POST /api/auth/wallets/nonce` (authenticated)

Input: `{}`. Output: `{ nonce, message }` — `message` is the exact string the wallet must sign. Include `issuedAt`, `domain`, `address: null` (filled by client), and a human-readable purpose line `Link this wallet to three.ws account <email>`.

### `GET /api/auth/wallets`

Output: `{ wallets: [{ address, chain_id, created_at, is_primary: bool }] }`. Primary = oldest row for this user, or whichever has `is_primary = true` if you want to add that column (don't — just derive).

### `POST /api/auth/wallets` (authenticated)

Input: `{ address, signature, nonce }`. Verify signature recovers `address`, nonce is unused and was issued to this user. Insert row (ignore conflict on `(user_id, address)`). Output: `{ wallet }`.

### `DELETE /api/auth/wallets/:address`

Refuse if it's the only wallet AND user has no other auth method (email+password). Else delete. Output: `{ removed: true }`.

## `public/dashboard/wallets.html`

- Auth check on load.
- Table: address (truncated + copy button), chain, linked at, primary pill, unlink button.
- "Link another wallet" button triggers MetaMask request → fetch nonce → sign → POST → reload list.
- No framework. Reuse the exact color tokens from `dashboard/index.html`.

## Out of scope

- Do not touch the login flow.
- Do not integrate into the dashboard sidebar (separate integration step).
- Do not handle WalletConnect — MetaMask-only for this task.

## Verification

```bash
node --check api/auth/wallets/index.js
node --check api/auth/wallets/[address].js
node --check api/auth/wallets/nonce.js
npx prettier --write api/auth/wallets/*.js public/dashboard/wallets.html
npm run build
```

Manually in a browser, visit `/dashboard/wallets.html` while logged in, link a second MetaMask account, confirm it appears.

## Report back

Files created, commands + output, whether you used `siwe_nonces` or in-memory nonces and why.
