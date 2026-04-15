# 01-02 — Session recovery, logout UI, and /api/agents/me hardening

**Branch:** `feat/auth-session-recovery`
**Stack layer:** 1 (Wallet auth)
**Depends on:** nothing (runs in parallel with 01-01)
**Blocks:** every layer that relies on a stable signed-in session

## Why it matters

The SIWE flow works, but the user can't *leave* cleanly or recover a stale session. [/api/agents/me](../../api/agents.js) has been observed 500'ing (see project memory). Wallet auth is only "100% done" when sign-in, sign-out, and the `/me` round-trip are all green.

## Read these first

| File | Why |
|:---|:---|
| [api/auth/logout.js](../../api/auth/logout.js) | Exists but has no UI caller. |
| [api/auth/me.js](../../api/auth/me.js) (or equivalent in `api/auth/`) | The canonical "who am I" endpoint. |
| [api/agents.js](../../api/agents.js) | Contains the `/api/agents/me` handler and its auto-create-default-agent logic. This is where the 500 comes from. |
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) | Sign-in state read on page load. |
| [public/wallet-login.js](../../public/wallet-login.js) | The client session-issuer. |

## Build this

1. **Reproduce the 500.** Call `/api/agents/me` with a valid session cookie but no existing agent row. Capture the stack trace. Fix the underlying cause — likely a null `user_wallets` join or a missing column. Do *not* paper over with a try/catch that swallows errors.
2. **Logout button.** In [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js), add a "Sign out" item in the header user menu. POSTs `/api/auth/logout`, clears in-memory state, redirects to `/`.
3. **Session recovery.** On every authenticated page load (`/dashboard`, `/studio` when it ships), call `/api/auth/me` first. If 401, redirect to `/login?return=<current>`. If 500, show a banner "We couldn't load your account — try signing in again" with a logout link.
4. **Agent auto-create safety.** In [api/agents.js](../../api/agents.js), the `/api/agents/me` auto-create path must be idempotent: if a default agent already exists for the user, return it; if not, create it inside a transaction so two racing requests don't both insert.

## Out of scope

- Do not add multi-device session management.
- Do not add password reset.
- Do not touch the SIWE handshake.

## Acceptance

- [ ] `curl -i /api/agents/me` with a fresh-but-agentless user returns 200 with a newly-created default agent.
- [ ] Two concurrent requests for a user with no agent row do not produce two rows.
- [ ] Clicking "Sign out" clears the cookie, and `/api/auth/me` returns 401 immediately after.
- [ ] Revisiting `/dashboard` after logout redirects to `/login?return=/dashboard`.
- [ ] No 500s in the Vercel logs during the test plan below.

## Test plan

1. Fresh Neon row: `delete from agents where user_id=<me>` → visit `/dashboard` → default agent appears.
2. `ab -n 20 -c 10` against `/api/agents/me` with same cookie → exactly one agent row at the end.
3. Logout → `/api/auth/me` → 401.
4. Logout → visit `/dashboard` → redirected to `/login?return=/dashboard`.
