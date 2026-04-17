# Task: Sessions API + "sign out everywhere" page

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) and [api/CLAUDE.md](../../api/CLAUDE.md) first.

The `sessions` table (see [api/\_lib/schema.sql](../../api/_lib/schema.sql)) tracks each logged-in session with `last_seen_at`, `user_agent`, `ip`. There is currently no way for a user to list or revoke their sessions. We need a "sign out everywhere" path and a per-session revoke.

## Files you own (exclusive — create all as new files)

- `api/auth/sessions/index.js` — `GET /api/auth/sessions` lists current user's sessions, `DELETE /api/auth/sessions` revokes all except the current one.
- `api/auth/sessions/[id].js` — `DELETE /api/auth/sessions/:id` revokes a single session (must belong to caller).
- `public/dashboard/sessions.html` — standalone page that renders the session list, each with user-agent + IP + last-seen + a revoke button. "Sign out of all other devices" button at top. Uses fetch + vanilla JS, no framework. Style with inline `<style>` that matches the existing dashboard aesthetic (see [public/dashboard/index.html](../../public/dashboard/index.html) for color tokens: `--accent: #6a5cff`, `--border: #22222e`, `--bg: #0b0b10`, `--panel: #14141c`).

**Do not edit anything else.** No changes to `dashboard.js`, `dashboard/index.html`, or the sidebar. The page is reachable at `/dashboard/sessions.html` directly.

## Conventions (from api/CLAUDE.md)

- Import `sql` from `api/_lib/db.js` — never `new Pool()`.
- Use `json()` / `error()` / `wrap()` from `api/_lib/http.js`.
- Use `getSessionUser()` from `api/_lib/auth.js` for auth. Return `401 unauthorized` if absent.
- Tagged-template SQL only — no concat.
- ESM, tabs (4-wide), single quotes.

## Deliverable details

### `api/auth/sessions/index.js`

```
GET  → { sessions: [{ id, user_agent, ip, created_at, last_seen_at, current: bool }], ... }
DELETE → { revoked: N } — deletes all sessions for the user except the one matching the current cookie.
```

Identify "current" by the token cookie's session id (expose via `getSessionUser` extended return, or read cookie directly with the existing helper in `api/_lib/auth.js`).

### `api/auth/sessions/[id].js`

```
DELETE → { revoked: 1 | 0 }
```

Must 404 if the session doesn't belong to the user. Must 400 if `id` is not a UUID.

### `public/dashboard/sessions.html`

- Auth check on load (`fetch('/api/auth/me')` — redirect to `/login?next=/dashboard/sessions.html` on 401).
- Table: user-agent (truncated), IP, last seen (relative time), created (absolute), actions.
- Current session row marked with a `This device` pill; revoke disabled.
- "Sign out everywhere else" button fires `DELETE /api/auth/sessions`.
- Per-row revoke fires `DELETE /api/auth/sessions/:id`.
- On revoke, remove row optimistically + show a toast. Error path restores row.

## Out of scope

- Do not add a link from the main dashboard sidebar — that's a later integration step.
- Do not change the schema (the `sessions` table already has all needed columns).
- Do not implement a "name this device" feature.

## Verification

```bash
node --check api/auth/sessions/index.js
node --check api/auth/sessions/[id].js
npx prettier --write api/auth/sessions/index.js api/auth/sessions/[id].js public/dashboard/sessions.html
npm run build
```

Manually: visit `/dashboard/sessions.html`, confirm your current session appears and "sign out everywhere" revokes others.

## Report back

Files created, commands run, any assumption made about the current-session identifier mechanism.
