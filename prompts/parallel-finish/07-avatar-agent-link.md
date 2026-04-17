# Task: Auto-link a new avatar to the user's agent identity

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) and [api/CLAUDE.md](../../api/CLAUDE.md) first.

Today: a user saves a selfie-derived avatar → a row lands in `avatars`. Separately, `/api/agents/me` auto-creates a default `agent_identities` row. These two are **not linked** — `agent_identities.avatar_id` stays NULL, so the user's agent has no 3D body assigned. This breaks the "my agent" experience end-to-end.

We fix this with a single small endpoint + a tweak to the avatar-create hook.

## Files you own (exclusive)

- [api/avatars/index.js](../../api/avatars/index.js) — only the `POST` handler's success branch; do not refactor the rest.
- `api/onboarding/link-avatar.js` — new file. `POST /api/onboarding/link-avatar` with `{ avatarId }` sets `agent_identities.avatar_id` for the authenticated user's primary agent. Idempotent.

**Do not edit** any other file. Not `api/agents/*`, not `src/*`, not the dashboard.

## Logic

### `POST /api/avatars/:` (success branch hook)

After a successful INSERT, _if_ the caller is authenticated _and_ the request `source === 'avaturn'` or `'selfie'` _and_ the user has a primary agent with `avatar_id IS NULL`, UPDATE that agent to point at the new avatar. Fire-and-forget — if the UPDATE fails, the 201 still returns.

Do this inline; do not introduce a job queue or event bus.

### `POST /api/onboarding/link-avatar`

Explicit manual endpoint for clients (e.g., the forthcoming first-meet page) to set the link regardless of conditions. Input: `{ avatarId }`. Auth required. Ownership check: user must own the avatar. Output: `{ agent: { id, avatar_id, updated_at } }`. Returns 404 if the user has no agent. Returns 409 if the agent already has a different avatar and the caller didn't pass `force: true`.

## Conventions

- `sql` from `api/_lib/db.js`.
- `json()` / `error()` from `api/_lib/http.js`.
- Auth via `getSessionUser()`.
- Tagged-template SQL.
- ESM, tabs.
- Zod for input validation (matches sibling endpoints).
- Error codes: `unauthorized`, `not_found`, `already_linked`, `invalid_request`.

## Out of scope

- Do not change the `avatar_id` column itself — it exists in the schema.
- Do not build the UI for this (the client side is handled by `05-first-meet-flow.md`).
- Do not touch `api/agents/me.js` or `api/agents/[id].js`.
- Do not add a "history of avatar changes" log.

## Verification

```bash
node --check api/avatars/index.js
node --check api/onboarding/link-avatar.js
npx prettier --write api/avatars/index.js api/onboarding/link-avatar.js
npm run build
```

Manually: create an avatar with `source: 'selfie'`, check DB that `agent_identities.avatar_id` got set. Then call `/api/onboarding/link-avatar` with a different avatar id, confirm 409 `already_linked` without `force`, and success with `force: true`.

## Report back

Files edited/created, commands + output, the exact SQL you ran in the inline hook, any edge case where the hook might fire wrongly (e.g., multi-agent users).
