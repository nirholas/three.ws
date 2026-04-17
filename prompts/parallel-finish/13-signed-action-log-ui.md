# Task: Signed action log viewer (standalone page)

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md), [api/CLAUDE.md](../../api/CLAUDE.md), and [src/CLAUDE.md](../../src/CLAUDE.md) first.

The agent has a signed action log: every `speak`, `remember`, `sign`, `skill-done`, `validate`, `load-end` event goes through `POST /api/agent-actions` (fire-and-forget from `agent-identity.js`). The `/api/agents/[id]/sign.js` endpoint produces EIP-191 signatures over each entry. Rows live in `agent_actions`.

There is **no UI** to view this log. We need one — the timeline is the most honest "what has my agent been doing" surface and is a CZ-demo win.

## Files you own (exclusive — new only)

- `public/dashboard/actions.html` — standalone page at `/dashboard/actions.html?agent=<id>`. Renders the action log for one agent with signature verification badges.
- `api/agents/[id]/actions.js` — `GET /api/agents/:id/actions?limit=100&cursor=<ts>` — paginated list of actions. Returns `{ actions: [{ id, type, payload, timestamp, signature, signer, verified: bool }], nextCursor }`.

**Do not edit** `api/agent-actions.js`, `api/agents/[id]/sign.js`, `agent-identity.js`, or the dashboard sidebar.

## Server

### `GET /api/agents/:id/actions`

- Auth required. Caller must own the agent OR the agent must be `visibility = 'public'`.
- Query `agent_actions WHERE agent_id = :id ORDER BY timestamp DESC LIMIT :limit`.
- Cursor is a timestamp (ISO string). Encode/decode as-is — no opaque cursors needed for this volume.
- `verified` is a derived field: check `signature` against `signer` for EIP-191 signed `JSON.stringify(payload) + timestamp`. Use `ethers.verifyMessage`. If no signature stored, `verified: null`.
- Cache-Control: `private, max-age=10`.

## Client

- Auth check on load. `401` → `/login?next=/dashboard/actions.html?agent=<id>`.
- Header: agent name + verified-signer pill (the EOA that signed these actions).
- Filter chips: All, speak, remember, sign, skill-done, validate, load-end.
- Timeline: newest first. Each row has an icon per type, a 1-line summary (type + first 80 chars of payload), a verified checkmark (green) / unverified (gray) / unsigned (dash), a timestamp (relative + absolute on hover), and a click-to-expand JSON payload.
- Infinite scroll via `IntersectionObserver` on the last row.
- Export button: "Download JSON" dumps the current filtered list.

## Constraints

- Vanilla JS. Reuse dashboard color tokens.
- No new runtime deps.
- Use `fetch` with `credentials: 'include'`.

## Out of scope

- Do not add a "re-sign all" button.
- Do not integrate into the dashboard sidebar.
- Do not implement action *replay* (playing back a speak/gesture in the viewer).
- Do not add time-range picker beyond the infinite-scroll.
- Do not add CSV export — JSON is enough.

## Verification

```bash
node --check api/agents/[id]/actions.js
npx prettier --write api/agents/[id]/actions.js public/dashboard/actions.html
npm run build
```

Manually: use an agent with stored actions, open `/dashboard/actions.html?agent=<id>`, confirm rows appear with correct verified badges. Flip one signature in the DB and confirm it shows as unverified.

## Report back

Files created, commands + output, your verification logic (exact string you sign/verify), behavior when the DB has no actions yet (should show an empty state, not an error).
