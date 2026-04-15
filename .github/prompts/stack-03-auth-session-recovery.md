---
mode: agent
description: "Make auth sessions survive refresh, new tab, wallet disconnect, token near-expiry"
---

# Stack Layer 1: Session Recovery & Refresh

## Problem

Wallet auth must *stay* authenticated across page refresh, new tabs, wallet disconnect, and token near-expiry. Today the session cookie works on refresh but we have no:
- Silent refresh before token expiry
- Cross-tab auth state sync
- Graceful handling when wallet disconnects but session is still valid (session should persist — wallet is not session)

## Implementation

### Refresh endpoint

`POST /api/auth/refresh`:
- Reads existing `auth` cookie.
- If token is valid and within the last 7 days of its 30d TTL, issue a new cookie with fresh 30d TTL.
- If expired, return 401.
- Rate-limit 1/min per user.

### Client refresh scheduler ([src/account.js](src/account.js))

- On app boot, decode JWT `exp` client-side (non-trusting, just for scheduling).
- `setTimeout` to call `/api/auth/refresh` when the token is 7 days from expiry.
- Exponential backoff on failure.

### Cross-tab sync

- On successful login/logout, `localStorage.setItem('auth-change', Date.now())`.
- Listen for `storage` events → re-fetch `/api/auth/me` and update UI.

### Wallet-vs-session separation

- A disconnected wallet does NOT log the user out. The server cookie is the source of truth.
- Show a "Wallet disconnected — reconnect to sign actions" banner, but keep the session alive.
- Only `/api/auth/logout` (which clears the cookie) ends the session.

### Error boundary

- If any authenticated API call returns 401, redirect to `/login.html?next=<current>`.
- Preserve query params on the `next` redirect.

## Validation

- Sign in, refresh page 10× → still authenticated, no re-sign needed.
- Sign in in tab A, open tab B → tab B is authenticated without page reload.
- Sign out in tab A → tab B shows logged-out state within 2s.
- Disconnect wallet in MetaMask → session still valid, banner shows.
- Manually set cookie expiry to 7 days from now → next API call triggers refresh, new 30d cookie issued.
- `npm run build` passes.
