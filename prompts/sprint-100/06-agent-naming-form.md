# 06 — Agent naming form module

## Why

After a GLB is produced, the user names the agent. Needs uniqueness check + denylist. Isolated module; a later prompt mounts it in the onboarding flow.

## Parallel-safety

One new JS module + one new server endpoint for uniqueness check. No route wiring, no edits to `src/app.js`.

## Files you own

- Create: `src/agent-naming.js`
- Create: `api/agents/check-name.js` (if [api/agents/check-name.js](../../api/agents/check-name.js) already exists — read it first and extend only if your needs aren't met; otherwise stub a client-side check and note it).

## Read first

- [api/agents/check-name.js](../../api/agents/check-name.js) — if present, understand the existing shape.
- [api/_lib/db.js](../../api/_lib/db.js) — `sql`.

## Deliverable

### `src/agent-naming.js`

```js
export class AgentNaming {
    constructor({ container, initialName = '', onSubmit })
    mount()    // renders form
    unmount()  // cleanup
}
```

Form fields:
- **Name** — required, 3–32 chars, `[a-zA-Z0-9_-]+`, must not match denylist (see below), must pass server uniqueness check.
- **Description** — optional, ≤280 chars.
- **Submit** button → calls `onSubmit({ name, description })`.

Behavior:
- Debounce uniqueness check 400ms on name input. Show ✓ / ✗ / loading indicator inline.
- Disable submit while check is pending or name invalid.
- On submit, re-run the uniqueness check synchronously to avoid races.

Denylist (hardcode array in the module): `['admin', 'root', 'system', 'anthropic', 'claude', 'openai', 'null', 'undefined', 'test']`.

### `GET /api/agents/check-name?name=<n>`

Response: `{ available: boolean, reason?: 'taken' | 'invalid' | 'denylisted' }`.
- Case-insensitive uniqueness against the `agents` (or whichever holds agent names — read the actual schema) table.
- Rate limit: `60/min per IP`.
- If the endpoint already exists and returns a compatible shape, do nothing server-side; cite the file in your report.

## Constraints

- No framework. Minimal inline styles.
- No new deps.

## Acceptance

- `node --check` clean on all files you touched.
- `npm run build` clean.
- Manually: mount the module in a scratch page, type a known-taken name → sees ✗; type a unique valid name → ✓, submit fires with the `{ name, description }` payload.

## Report

- Whether you created or extended `check-name.js`, with the exact diff.
- What table you queried for uniqueness.
