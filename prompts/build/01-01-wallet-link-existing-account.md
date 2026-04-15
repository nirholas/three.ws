---
mode: agent
description: "Let an email/password user link a wallet to their existing account without creating a new one"
---

# 01-01 · Link wallet to existing account

## Why it matters

Today a returning user who signed up with email+password cannot attach a wallet without creating a *second* account. That fragments ownership of agents across two users and breaks the onchain pillar (layer 6) — you want one user → many wallets → many agents. The SIWE verify endpoint already supports a linked branch ([api/auth/siwe/verify.js:114](../../api/auth/siwe/verify.js#L114)); the client just doesn't drive it.

## Prerequisites

- SIWE endpoints shipped ([api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js), [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js)).
- Session cookie flow working (confirm with `/api/auth/me`).

## Read these first

| File | Why |
|:---|:---|
| [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) | The `link=1` branch — an authenticated caller that signs a nonce should have the wallet attached to the current `userId` instead of creating a new user. Verify the handler already supports this; if not, extend. |
| [public/wallet-login.js](../../public/wallet-login.js) | Where `completeSignIn(provider)` lives — you'll add a `linkWallet(provider)` sibling. |
| [api/_lib/auth.js](../../api/_lib/auth.js) | `getSessionUser(req)` — used to know this is a link, not a sign-in. |
| [api/_lib/schema.sql](../../api/_lib/schema.sql) | `user_wallets` table (line ~143) — linked wallets go here. |

## Build this

1. **Confirm or add the link branch in `siwe/verify.js`**:
   - If the request arrives with a valid session cookie AND the signed address is **not already bound to another user**, insert into `user_wallets(user_id, address)` and return `{ linked: true, address }`. Do NOT rotate the session.
   - If the address is already bound to a **different** user, return 409 with a clear error message.
   - If no session, fall through to the existing sign-in/create flow.
2. **Client helper** in [public/wallet-login.js](../../public/wallet-login.js):
   - Export `linkWallet(provider)` that runs the same EIP-4361 flow as `completeSignIn` but marks the nonce request with `{ intent: 'link' }` and posts to `/api/auth/siwe/verify?intent=link`.
   - On success, dispatch a `wallet:linked` custom event with `{ address, provider }`.
3. **Wire from the account/settings page** (see `01-02` for that page) — a "Link a wallet" button that calls `linkWallet('metamask')` or `linkWallet('privy')`.

## Out of scope

- UI polish on the account page (that's 01-02).
- Unlinking a wallet (the DELETE side of `user_wallets`).
- Primary-wallet selection (that's `01-03-primary-wallet-selection.md`).
- Session rotation on link — the user is already signed in; don't log them out.

## Deliverables

- Handler update in [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) (only if the link branch isn't already there).
- New export `linkWallet` in [public/wallet-login.js](../../public/wallet-login.js).
- One tiny `fetch` helper if the link intent requires a differently-shaped request.

## Acceptance

- [ ] Signed in as email-user `a@x.com` with no wallets → click "Link MetaMask" → sign → `GET /api/auth/me` still returns the same userId, and `user_wallets` has a new row.
- [ ] Signing the same address from a **different** session returns 409, not a new user.
- [ ] Existing sign-in-with-wallet flow unchanged (unauth'd callers still create accounts).
- [ ] `npm run build` passes.

## Reporting

- Confirm whether the `link` branch already existed or had to be added.
- Note what `intent` marker you used (query string vs. body vs. header).
- Any 409 cases you discovered (address already linked to another user).
