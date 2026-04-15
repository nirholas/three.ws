---
mode: agent
description: "Ensure email/password signup has parity with SIWE: session, user row, agent bootstrap"
---

# 01-02 · Email/password auth parity

## Why it matters

Wallet is the primary path, but email/password must still work for users without a wallet. If the two paths diverge (e.g. one creates an agent, the other doesn't), the dashboard breaks for half the users. Small gap to close, high blast radius if skipped.

## Prerequisites

- 01-01 verified the SIWE path is working end-to-end.

## Read these first

- [api/auth/register.js](../../api/auth/register.js)
- [api/auth/login.js](../../api/auth/login.js)
- [api/auth/logout.js](../../api/auth/logout.js)
- [api/auth/me.js](../../api/auth/me.js)
- [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) — canonical session-issue pattern; email path should mirror this.
- [public/register.html](../../public/register.html), [public/login.html](../../public/login.html)

## Build this

1. **Audit the three code paths side-by-side** (register, password login, SIWE verify) and list what each does:
   - `users` row creation / lookup
   - `user_wallets` row (SIWE only)
   - `destroySession()` before `createSession()`
   - cookie flags (`HttpOnly`, `Secure`, `SameSite`)
   - response shape (`{ user: {...} }`)
2. **Normalize** any field that differs without reason. Pick SIWE's shape as canonical — it's the newest and reviewed.
3. **Agent bootstrap parity** — after a new user registers with email, hitting `GET /api/agents/me` auto-creates the default agent (already true for SIWE because the endpoint is shared). Verify by registering a fresh email and hitting `/dashboard/` — the client-side `AgentIdentity.load()` should succeed.
4. **Logout** — `POST /api/auth/logout` clears the cookie and destroys the session row. Verify `Set-Cookie` has `Max-Age=0` and `sessions.revoked_at` is set.
5. **Session fixation check** — logging out then logging back in rotates the session id. Confirm in `sessions` table.

## Out of scope

- Password reset flow.
- Email verification / magic links.
- 2FA.
- Merging a password account with a later-linked wallet (that's 01-05).

## Deliverables

- A side-by-side audit result (3–5 bullets) in the PR description.
- Minimal diffs where the three paths diverged.

## Acceptance

- New email registration → dashboard → agent visible in one flow.
- Password login and SIWE login produce cookies with identical flags.
- Logout clears everything.
- `node --check` + `npm run build` pass.
