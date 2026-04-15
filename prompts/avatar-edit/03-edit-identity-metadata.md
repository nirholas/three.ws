# Task: Edit agent identity metadata (name, bio, skills, service endpoints) with debounced autosave

## Context

Repo: `/workspaces/3D`. The agent identity record lives in `agent_identities` (see [api/CLAUDE.md](../../api/CLAUDE.md) table list) and is mirrored to the browser via [src/agent-identity.js](../../src/agent-identity.js). The client-side getters expose `id`, `name`, `description`, `avatarId`, `skills`, `meta`, `walletAddress`, `chainId`, etc.

Today there is no UI to edit any of this after creation. The user can see their avatars in [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) but the only writable field surfaced is avatar name via `PATCH /api/avatars/:id`. The agent-level fields (bio, skills, service endpoints for the manifest) are invisible.

Service endpoints are consumed by [src/manifest.js](../../src/manifest.js) which parses `agent-manifest/0.1` and by ERC-8004 registration JSON. They belong in `agent_identities.meta.service_endpoints` as a list of `{ name, url, protocol }` entries.

## Goal

Add an "Identity" edit panel to the dashboard. The user can change:
- **name** (required, 1–120 chars, validated for uniqueness per user)
- **description** / bio (optional, ≤ 2000 chars)
- **skills** (multi-select from the registry; read the built-in skill names from [src/agent-skills.js](../../src/agent-skills.js))
- **service endpoints** (editable list of `{ name, url, protocol }` with URL + protocol validation)

Changes autosave after a 600 ms debounce. The agent's id, avatar link, wallet link, and on-chain registration are untouched.

## Deliverable

1. **Backend**
   - Ensure `PUT /api/agents/:id` (the endpoint `src/agent-identity.js` already calls via `save()`) accepts `name`, `description`, `skills`, `meta`. If the endpoint does not yet exist or doesn't accept all four, add/extend it under `api/agents/[id].js`. Validate with a new zod schema in [_lib/validate.js](../../api/_lib/validate.js).
   - Enforce name uniqueness per `user_id`: a `UNIQUE (user_id, lower(name)) WHERE deleted_at is null` partial index. If adding the index, include the migration SQL in the reporting section.
   - On conflict return 409 `conflict` with `{ error_description: 'name already in use' }`.
   - Validate each service endpoint:
     - `name`: non-empty, ≤ 60 chars.
     - `url`: must parse via `new URL()`; scheme must be one of `https`, `http` (localhost only), `ipfs`, `ar`.
     - `protocol`: enum of `mcp`, `a2a`, `http`, `websocket`.
   - Cap service endpoints at 10 per agent. Dedupe by `name` (case-insensitive).

2. **Frontend — dashboard identity panel**
   - New route: `#edit/<agentId>/identity` routed from the existing hash-router in [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) (the router already splits `#edit/<id>` in `navigate()`).
   - Form fields (native DOM):
     - `<input>` for name — inline uniqueness-check on blur (GET a new tiny endpoint `GET /api/agents/check-name?name=...` that returns `{ available: boolean }`; scoped to the caller's user_id).
     - `<textarea>` for description.
     - Multi-select for skills — checkbox list populated from [src/agent-skills.js](../../src/agent-skills.js)'s built-in list. Do not hard-code the list in the dashboard file; import or fetch it.
     - Service endpoints: repeater with add / remove rows, each row having name + url + protocol (select).
   - Debounced autosave: 600 ms after the last input event. Send a `PATCH /api/agents/:id` (or `PUT`, matching whatever [src/agent-identity.js](../../src/agent-identity.js) already uses — keep one verb).
   - Show a subtle "Saved" indicator near the form (checkmark fades after 1.5 s) and "Saving…" while inflight.
   - Show inline validation errors next to the offending field. Do not block typing.

3. **Client-side integration**
   - Extend [src/agent-identity.js](../../src/agent-identity.js) so `update(patch)` correctly maps `serviceEndpoints` to `meta.service_endpoints` in the outgoing body. Today the method Object.assigns over `_record`; verify that camelCase → snake_case is respected by the backend (see `_normalise` in that file).
   - If the user is currently viewing their own agent via `<agent-3d>`, the element should pick up name/description changes live. Two options — pick one and document:
     - Soft: next load re-fetches. Acceptable.
     - Live: emit a `protocol.emit('identity-updated', { record })` event and have `agent-home.js` re-render. Only do this if trivially cheap.

## Audit checklist

- `agent_identities.id` (agentId) is unchanged across every edit.
- `agent_identities.wallet_address` and `user_wallets` are untouched.
- `agent_identities.erc8004_agent_id` is untouched. The UI shows a subtle "on-chain record will drift from local until you re-register" note if `isRegistered` is true.
- Uniqueness check is server-enforced, not only client-side.
- Autosave is debounced — no more than one in-flight PATCH per field at a time. Cancel/overwrite stale requests.
- Service endpoint `url` is validated against the scheme list.
- Skills list is sourced from the skill registry, not hard-coded in the dashboard.
- Form disables itself while an auth error is in flight (401 → redirect to login).
- 409 conflict on name surfaces as an inline error on the name field, not a page-level toast.

## Constraints

- No new runtime dependencies. The debounce is a 10-line helper; do not pull in lodash.
- Keep the dashboard native-DOM. No framework.
- Do not change the shape of `/api/agents/me` response — downstream consumers rely on it.
- Do not move the identity-edit UI to a separate page outside the dashboard.
- Rate-limit the PATCH endpoint at `limits.authIp(clientIp(req))` at minimum — autosave will hammer it.
- Do not log field values at info level on the backend (privacy).

## Verification

1. `node --check` every modified JS file.
2. `npx vite build`.
3. Manual:
   - Sign in, open `#edit/<agentId>/identity`.
   - Edit name → after 600 ms the "Saving…" indicator flips to "Saved". Reload — value persists.
   - Try to rename to another of your agents' names — inline 409 error.
   - Add a service endpoint with scheme `ftp://…` — rejected.
   - Toggle a skill on/off — round-trips cleanly.
   - Confirm `agent_identities.id` is unchanged before/after.
   - Confirm wallet link is unchanged.
   - Confirm ERC-8004 warning shows when `isRegistered` is true.
4. As a second user, attempt `PATCH /api/agents/<other user's agentId>` — expect 404 `not_found`.
5. Hit `check-name` 50 times rapidly — rate limit holds.

## Scope boundaries — do NOT do these

- Do not add avatar image editing to this panel. That is tasks 01/02.
- Do not add skill installation from external bundles. That is a separate surface; only enable/disable from built-in skills here.
- Do not add ENS / human-readable handle lookup for uniqueness. Per-user uniqueness is enough.
- Do not write `agent_identities.user_id` — ownership transfer is not in scope.
- Do not refactor [src/agent-identity.js](../../src/agent-identity.js) beyond what this task needs.

## Reporting

- Files created / edited.
- Migration SQL for the unique index (if added).
- Whether `PUT` or `PATCH` was used (and why — the client currently calls `PUT`).
- How debounce cancellation is implemented.
- Output of `npx vite build`.
- Any field whose validation you deferred or loosened.
