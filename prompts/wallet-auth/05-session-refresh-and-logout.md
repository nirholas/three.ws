# Task: Session cookie lifecycle, refresh, and "log out everywhere"

## Context

Repo: `/workspaces/3D`. Browser sessions are implemented in [api/_lib/auth.js](../../api/_lib/auth.js) (`createSession`, `sessionCookie`, `getSessionUser`, `destroySession`). The session cookie name is `__Host-sid` with a 30-day TTL (`SESSION_TTL_SEC = 60 * 60 * 24 * 30`). Sessions are stored in the `sessions` table (see [api/_lib/schema.sql](../../api/_lib/schema.sql) lines ~156–169) with `token_hash`, `user_agent`, `ip`, `expires_at`, `revoked_at`, `last_seen_at`.

Today:
- [api/auth/login.js](../../api/auth/login.js), [api/auth/register.js](../../api/auth/register.js), and [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) mint a new session.
- [api/auth/logout.js](../../api/auth/logout.js) revokes the current session and clears the cookie.
- [api/auth/me.js](../../api/auth/me.js) returns the session user or 401.

Gaps:
- **No rolling refresh.** A 30-day cookie that never rotates means a stolen cookie works for 30 days regardless of activity. Active users should have their session silently extended; inactive users should be forced to reauthenticate.
- **No "log out everywhere" endpoint.** A user who suspects a stolen device can't revoke all their sessions.
- **Wallet disconnect is not wired to session.** When a user disconnects their wallet in MetaMask, the site still treats them as signed in — which is correct (SIWE is proof at time-of-sign-in, not a continuous check) but there's no UX for "you disconnected, do you want to sign out of the site too?".
- **No surfacing of session list.** A user can't see "here are all the devices I'm signed in from" before choosing to nuke them.

## Goal

A documented session lifecycle: sessions rotate on activity, users can enumerate and revoke them, logout-everywhere works, and the client treats wallet-disconnect as a prompt (not a silent desync).

## Deliverable

1. Modified [api/_lib/auth.js](../../api/_lib/auth.js):
   - `getSessionUser(req, res?)` — if `res` is provided and the session is within the refresh window (see below), issue a rolled cookie via `sessionCookie(newToken)`. Otherwise unchanged behavior.
   - New `rotateSession({ oldToken, userAgent, ip })` — issues a new row, revokes the old, returns the new secret.
2. New endpoint `api/auth/sessions.js`:
   - `GET /api/auth/sessions` — returns the caller's non-revoked, non-expired sessions. Include `id`, `user_agent`, `ip`, `created_at`, `last_seen_at`, `expires_at`, `is_current`.
   - `DELETE /api/auth/sessions/:id` — revoke a single non-current session.
   - `DELETE /api/auth/sessions` — revoke **all** of the caller's sessions, then issue a fresh cookie for the current request (so the user stays signed in on this device). This is the "log out everywhere else" operation.
3. New endpoint `api/auth/logout-everywhere.js`:
   - `POST /api/auth/logout-everywhere` — revokes **every** session for the caller including the current one, clears the current cookie. Different from the above: this fully signs them out on every device including this one.
4. Route additions in [vercel.json](../../vercel.json) — follow the existing `/api/auth/*` wiring.
5. Client changes in [public/wallet-login.js](../../public/wallet-login.js) or a new `public/session-client.js`:
   - Listens for `accountsChanged` → if currently signed in via SIWE for that address and the wallet disconnects, show a small toast "MetaMask disconnected — you're still signed in. [Sign out]". Do not auto-sign-out.
6. Update [src/account.js](../../src/account.js) `getMe()` if the response shape changes — likely a no-op.

## Session refresh window — spec

- `SESSION_TTL_SEC = 60 * 60 * 24 * 30` (keep as-is — 30 days).
- `SESSION_REFRESH_WINDOW_SEC = 60 * 60 * 24 * 7` — if `last_seen_at` is older than now() minus 1 day **and** `expires_at - now() < 7 days`, rotate the session: insert a new row, revoke the old, set the new cookie.
- Rotation is best-effort on any authenticated request — never blocks the response. Failure to rotate just means the next request tries again.

## Audit checklist

**`getSessionUser` rotation**

- [ ] Signature `getSessionUser(req, res?)` is backwards-compatible — existing callers that pass only `req` still work.
- [ ] Rotation only fires if: `res` is truthy, `last_seen_at < now() - 1 day`, `expires_at - now() < 7 days`.
- [ ] Rotation does not fire on anonymous (no session) requests.
- [ ] Rotation errors are swallowed — auth must still succeed even if the insert fails.
- [ ] `set-cookie` header append uses the existing `sessionCookie()` helper.
- [ ] Updates `last_seen_at` either way (current behavior is a fire-and-forget update — keep it).

**`GET /api/auth/sessions`**

- [ ] Auth via `getSessionUser(req)` — 401 if not signed in.
- [ ] Returns only this caller's sessions. `user_id = ${auth.userId}`.
- [ ] Filters `revoked_at is null and expires_at > now()`.
- [ ] `is_current = true` for the row whose hash matches the request's cookie token hash. Client needs this to grey-out the delete button for the current session.
- [ ] IPs are returned as-is. (We store `inet` — `JSON.stringify` handles it; double-check in dev.)
- [ ] Rate-limited with `limits.authIp(ip)`.

**`DELETE /api/auth/sessions/:id`**

- [ ] Auth required.
- [ ] 404 if session id doesn't belong to caller.
- [ ] 409 `cannot_revoke_current` if the id matches the current session — they should use `POST /api/auth/logout` instead.
- [ ] Sets `revoked_at = now()` — does not delete the row (audit trail).

**`DELETE /api/auth/sessions` (all-except-current)**

- [ ] `update sessions set revoked_at = now() where user_id = ${uid} and revoked_at is null and token_hash != ${currentHash}`.
- [ ] Then rotates the current session so the user_agent/ip get a fresh row and cookie.
- [ ] Returns `{ revoked: N }`.

**`POST /api/auth/logout-everywhere`**

- [ ] Revokes every session for the user including current.
- [ ] Returns fresh cookie with `Max-Age=0` via `sessionCookie('', { clear: true })`.
- [ ] Returns `{ revoked: N, ok: true }`.

**Wallet-disconnect UX**

- [ ] On pages that show sign-in state, wire `window.ethereum.on('accountsChanged', ...)`.
- [ ] If accounts array becomes empty and current session user was signed in via SIWE for one of the previously-connected addresses, show a non-blocking toast/banner with a "Sign out" link that POSTs `/api/auth/logout`.
- [ ] Do **not** auto-sign-out. SIWE proved ownership at sign-in time; the user may intentionally disconnect for privacy.
- [ ] Tear down the listener on page unload.

**Schema check — no new columns needed**

- [ ] `sessions` table already has everything: `id`, `user_id`, `token_hash`, `user_agent`, `ip`, `expires_at`, `revoked_at`, `last_seen_at`. Confirm; don't add columns.

## Constraints

- **No new runtime dependencies.**
- Keep the `__Host-sid` cookie name. Don't rename. Don't change `SameSite=Lax`, `HttpOnly`, `Secure`, `Path=/`.
- Keep the 30-day TTL. The point of rotation is not a shorter TTL; it's defense against long-lived token theft for inactive cookies.
- Do not break the legacy `sid` cookie read path in [api/_lib/auth.js](../../api/_lib/auth.js) — it's there for a deploy-cycle compat and should still be honored on read.
- Do not touch the OAuth refresh-token code in the same file. That's a different grant type; the concerns don't overlap.
- Stick to [api/CLAUDE.md](../../api/CLAUDE.md) helpers: `wrap`, `json`, `error`, `method`, `cors`, `limits`.

## Verification

1. `node --check api/_lib/auth.js api/auth/sessions.js api/auth/logout-everywhere.js public/session-client.js` (or wherever the client code lives).
2. `npx vite build` — passes.
3. Manual rotation test:
   ```bash
   # sign in; capture cookie
   curl -c j.txt -X POST /api/auth/login -d '{"email":"…","password":"…"}'
   # force last_seen_at old via psql
   psql "$DATABASE_URL" -c "update sessions set last_seen_at = now() - interval '2 days', expires_at = now() + interval '6 days' where token_hash = '…'"
   # next request should roll
   curl -b j.txt -c j2.txt /api/auth/me -i | grep -i '^set-cookie'
   # confirm new __Host-sid value
   ```
4. List sessions:
   ```bash
   curl -b j.txt /api/auth/sessions
   ```
   Sign in on a second browser, refresh list — new entry appears with `is_current: false`.
5. Revoke other sessions:
   ```bash
   curl -b j.txt -X DELETE /api/auth/sessions
   ```
   Second browser's `/api/auth/me` now returns 401.
6. Logout everywhere:
   ```bash
   curl -b j.txt -X POST /api/auth/logout-everywhere
   curl -b j.txt /api/auth/me   # → 401
   ```
7. Wallet-disconnect UX — open `/dashboard/`, disconnect MetaMask → toast appears; clicking "Sign out" logs out. Not clicking leaves the session intact.

## Scope boundaries — do NOT do these

- Do not change the SIWE flow (task 02).
- Do not touch wallet-linking (task 03).
- Do not redesign the Connect-wallet button (task 04).
- Do not add device fingerprinting beyond the existing `user_agent` + `ip` columns.
- Do not add email notifications on new-device sign-in.
- Do not add CAPTCHA.
- Do not rename or re-prefix the session cookie.

## Reporting

- Files created + edited with line counts.
- Refresh-window values chosen and rationale.
- Curl output for each verification step.
- Any listener you wired in `public/` — note where it gets included (which page template).
- Any unrelated bug noticed (don't fix).
