# Task 04 — Sign-in-with-wallet UI

## Why this exists

Tasks 01–03 built the backend. Without a visible button and a working client-side dance, none of it is reachable. This task makes the flow real for users.

## Files you own

- Create: `src/wallet-auth.js` — a tiny client module. No framework.
- Edit: `index.html` — add a button in the header nav.
- Edit: `public/dashboard/login.html` (or whatever the current login page is — locate it first) — add a second button: "Sign in with wallet".
- Edit: `src/erc8004/agent-registry.js` — **export** `connectWallet` if it isn't already; do not change its logic.

Do not edit `src/app.js` beyond a one-line import if strictly needed.

## Deliverable

### `src/wallet-auth.js`

Exports a single async function `signInWithWallet({ chainId } = {})` that:

1. Calls `connectWallet()` from `src/erc8004/agent-registry.js` → `{ provider, signer, address, chainId: connectedChainId }`.
2. `POST /api/auth/siwe/nonce` with `{ purpose: 'login', address }` — receives `{ nonce, expiresAt, domain, statement, version }`.
3. Builds the EIP-4361 message string client-side:
   ```
   ${domain} wants you to sign in with your Ethereum account:
   ${address}

   ${statement}

   URI: ${location.origin}
   Version: ${version}
   Chain ID: ${connectedChainId}
   Nonce: ${nonce}
   Issued At: ${new Date().toISOString()}
   ```
4. `signature = await signer.signMessage(message)`.
5. `POST /api/auth/siwe/verify` with `{ message, signature, purpose: 'login' }` and `credentials: 'include'`.
6. On success: `window.location.assign('/dashboard')`.
7. On any error, throw with a user-readable message; the caller renders it in the UI.

Also export `signOut()` that `POST /api/auth/logout` and reloads the page.

### Header button (`index.html`)

A single `<button id="btn-wallet-signin" class="btn-wallet">Sign in with wallet</button>` placed next to the existing nav items. When the user is already signed in (detect via `GET /api/auth/me` on load), hide it and show a small chip with the truncated wallet address + a "sign out" option.

Keep the styling minimal — reuse existing `--accent-*` tokens. No new font loads, no new color palette.

### Login page second option

Under the existing "email + password" form, a visual divider ("— or —") and the same "Sign in with wallet" button.

## Constraints

- Do **not** add Privy UI here if Privy isn't already invoked; task 05 covers Privy backend integration.
- Do not introduce a bundler config change. `src/wallet-auth.js` is imported lazily from the button click handler.
- On devices without injected ethereum and without Privy configured, surface a clear message: "No wallet detected. Install MetaMask or switch to a browser with wallet support."
- Do not `alert(...)`. Use a small inline status region under the button.

## Acceptance test

1. `node --check src/wallet-auth.js` passes.
2. `npx vite build` — no new warnings.
3. Manual (Chrome + MetaMask):
   - Click "Sign in with wallet" in the header → MetaMask opens with the SIWE message → approve → redirected to `/dashboard` as a signed-in user.
   - Refresh the page → stays signed in, chip shows truncated address.
   - Click sign out → cookie cleared, button returns.
4. Manual (no injected wallet): button shows a message instead of throwing.
5. DevTools Network tab shows exactly: `nonce` (POST), one `personal_sign` RPC to the wallet, `verify` (POST).

## Reporting

- Screenshots (or a recorded gif) of the signed message in MetaMask — the `statement` and `domain` should be clearly readable and trustworthy.
- Any friction moments (double-prompts, hanging promises, race conditions on fast clicks).
- How the signed-in state detection works (cookie? `me` fetch on load?) and the tradeoffs.
