# 09 — API Keys page: real list / create / revoke flow

## Problem
[pump-dashboard.html](../../pump-dashboard.html) lines ~844–877 are **static documentation only** — a hardcoded table of endpoints and a description of how to authenticate. There is no list of the user's keys, no way to create a key, and no way to revoke. The `api-endpoint-display` is the only dynamic element. This is a half-finished feature — the user cannot actually obtain or manage credentials.

## Outcome
The API Keys page, in addition to keeping the endpoint reference table, gains a real **Your Keys** section showing the signed-in user's API keys with: name, prefix, scopes, created-at, last-used-at, and a Revoke button. A **Create New Key** form (name + scope checkboxes + optional expiry) calls `POST /api/api-keys`, then opens a modal that displays the plaintext token **once** with a Copy button and a clear "you won't see this again" note.

## Endpoints (already exist)
- List: `GET /api/api-keys` — see [api/api-keys.js](../../api/api-keys.js).
- Create: `POST /api/api-keys` with `{ name, scope, expires_at? }`. Returns `{ data: { ..., token } }` with the plaintext token (never persisted).
- Revoke: `DELETE /api/api-keys/<id>` — see [api/api-keys/[id].js](../../api/api-keys/[id].js).
- Allowed scopes per [api/api-keys.js](../../api/api-keys.js): `avatars:read`, `avatars:write`, `avatars:delete`, `profile`.

## Implementation
1. Add a `Your Keys` panel above the existing Available Endpoints table on `#page-api`.
2. Render keys in a real table: Name, Prefix (masked, e.g. `sk_live_abc123…`), Scopes (comma list), Created, Last Used (relative time, "never" when null), Expires (real date or `—`), Actions (Revoke).
3. Revoke flow:
   - Click → `confirm(...)` → `DELETE /api/api-keys/<id>` → on 200, refresh the list. On error, surface upstream error string via `toast`.
4. Create flow:
   - Form with: Name (required, ≤80 chars), Scope checkboxes (all four allowed scopes from the API), Expiry (optional `<input type="datetime-local">`, converted to ISO 8601 UTC for the request).
   - On submit → `POST /api/api-keys` → on 201, open a modal that displays the plaintext `token` returned by the server, with Copy-to-Clipboard. Closing the modal refreshes the list. On error, surface upstream error.
5. Real states:
   - 401: render "Sign in to manage keys" + `/login.html` link instead of the table.
   - 429: surface "Too many requests, try again shortly" — do not retry automatically.
   - Empty list: "You haven't created any API keys yet." — no fake row.
6. **Never** display or log the plaintext token after the create-modal is closed. The list view must use only `prefix`.

## Definition of done
- Create a key in the UI; copy it; `curl -H "X-API-Key: <token>" http://localhost:3000/api/v1/status` succeeds and the key's `last_used_at` updates on next list refresh.
- Revoke the key; the same `curl` returns 401.
- Refresh the page → the plaintext token is gone (only the prefix remains).
- `npm test` green; **completionist** subagent run on changed files.
