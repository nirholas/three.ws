# 02 — Session refresh + logout-all endpoints

## Why

Long-lived sessions need rotation and a "log out everywhere" escape hatch. Today [api/auth/logout.js](../../api/auth/logout.js) only kills the current cookie.

## Parallel-safety

You only create NEW files under `api/auth/session/`. You do NOT edit `login.js`, `logout.js`, or `me.js`. If the existing `createSession()` helper in [api/_lib/auth.js](../../api/_lib/auth.js) already exposes what you need, import it. If it doesn't, stub a local helper in your endpoint and note the gap in the report — do not edit `_lib/auth.js`.

## Files you own

- Create: `api/auth/session/refresh.js`
- Create: `api/auth/session/list.js`
- Create: `api/auth/session/revoke.js`

## Read first

- [api/_lib/auth.js](../../api/_lib/auth.js) — inspect `getSessionUser`, `createSession`, and the sessions table name.
- [api/_lib/http.js](../../api/_lib/http.js) — `wrap`, `json`, `error`, `cors`, `method`.
- [api/_lib/db.js](../../api/_lib/db.js) — `sql` tagged template.
- [api/auth/logout.js](../../api/auth/logout.js) — reference pattern.

## Deliverable

### `POST /api/auth/session/refresh`

- Requires current session cookie.
- Rotates: invalidate old session row (`revoked_at = now()`), issue a new `__Host-sid` cookie bound to the same user.
- Response `{ ok: true, rotatedAt }`.
- Rate limit: `10/10min per user` via the existing `limits.*` presets if available; otherwise inline `rateLimit(req, { key: 'session-refresh:'+user.id, max: 10, windowMs: 600000 })` — if the helper isn't present, skip and note it.

### `GET /api/auth/session/list`

- Requires current session cookie.
- Returns array of `{ id, createdAt, lastUsedAt, userAgent, ipHash, current: boolean }` for all non-revoked sessions of the user.
- `ipHash` is the first 8 hex chars of a sha256 of the IP — never return raw IP.

### `POST /api/auth/session/revoke`

- Body `{ sessionId }` OR `{ all: true }`.
- `sessionId` → revoke that row (must belong to the caller's user).
- `all: true` → revoke every session of the user, INCLUDING the current one; clear the `__Host-sid` cookie on the response.
- Response `{ ok: true, revoked: N }`.

## Constraints

- Use `sql` tagged template; NO string-concat.
- Use `json()` / `error()` / `wrap()`; NO `res.end(JSON.stringify(...))`.
- CORS + method gate on every handler.
- Never return a session token or secret in any response.

## Acceptance

- `node --check` on all three files passes.
- `npm run build` clean.
- With an authenticated cookie, `curl /api/auth/session/list` returns the session array; `/refresh` rotates and a subsequent `/list` shows a new `createdAt`; `/revoke {all:true}` returns 401 on the next `/me`.

## Report

- Schema assumptions (which columns you queried; confirm they exist or note the gap).
- If `createSession()` needed something you had to stub, list it.
- curl session transcripts.
