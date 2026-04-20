# Task 07 — `GET /api/permissions/list`

## Why

The manage panel (task 11), the SDK (task 18), and the dashboard all need to enumerate delegations for a given agent or a given delegator wallet. One read endpoint with consistent filtering keeps those callers simple.

## Read first

- [00-README.md](./00-README.md) — canonical endpoint signature
- [api/CLAUDE.md](../../api/CLAUDE.md) — `json` / `error` / `wrap` / `cors`
- [api/\_lib/auth.js](../../api/_lib/auth.js) — session + bearer auth helpers
- Existing list endpoints in [api/agents.js](../../api/agents.js) or similar — pagination + filtering patterns

## Build this

Create `api/permissions/list.js` (GET only):

1. **Method gate** — GET, else 405.
2. **CORS + rate limit** — standard `limits.read` preset.
3. **Auth mode** — two paths:
    - `?agentId=<uuid>` — public view. Return only non-sensitive fields (no `delegation_json.signature`, no internal ids). Anyone can read — this is what the embed uses.
    - `?delegator=0x...` or no filter — **session required**. Only the logged-in user may list their own delegations. Optionally admins (if `isAdmin` helper exists) may list any delegator.
4. **Query params**:
    - `agentId` (uuid) OR `delegator` (address)
    - `status` (optional, `active|revoked|expired|all`, default `active`)
    - `chainId` (optional int)
    - `limit` (default 50, max 200), `offset` (default 0)
5. **SQL** — tagged-template via `sql` from `api/_lib/db.js`. Build a `WHERE` with the supplied filters. Order by `created_at DESC`. Use the indexes from task 05.
6. **Public view shape** (when agentId-only, no auth):
    ```jsonc
    {
    	"id": "...",
    	"chainId": 84532,
    	"delegator": "0x...",
    	"delegate": "0x...",
    	"delegationHash": "0x...",
    	"scope": {
    		/* from column */
    	},
    	"status": "active",
    	"expiresAt": "...",
    	"createdAt": "...",
    	"lastRedeemedAt": "...",
    	"redemptionCount": 3,
    }
    ```
    Never return `delegation_json` in the public view.
7. **Authenticated view** — same as public, plus `delegationJson` (full envelope including signature) so the owner can re-pin if needed.
8. **Response shape** — `{ ok: true, delegations: [...], nextOffset?: number }`. Include `nextOffset` if `result.length === limit`.
9. **Cache headers** on public agentId view: `Cache-Control: public, max-age=30, s-maxage=60`. Not on authenticated view.

## Don't do this

- Don't run unfiltered queries. `agentId` or `delegator` is required — return 400 `missing_filter` if neither is supplied.
- Don't return `delegation_json.signature` to anonymous callers.
- Don't support a global list (all delegations). Even admins must scope to one agent or one delegator.
- Don't paginate with cursors — offset is fine at our scale.

## Acceptance

- [ ] `api/permissions/list.js` wired per conventions.
- [ ] Public `agentId` path returns redacted entries without auth.
- [ ] `delegator` path returns 401 unauthenticated / 403 if someone else's address.
- [ ] Filters `status`, `chainId` work.
- [ ] Cache header present on public responses.
- [ ] `node --check` + `npm run build` pass.

## Reporting

- `curl` transcripts: public agent view, owner-authenticated delegator view, cross-user 403, bad-filter 400.
- Timing: `EXPLAIN ANALYZE` of the list query for a seeded agent.
