# 24 — `@agent` suggest endpoint

## Why

Host surfaces (LobeHub chat, future web chat) need `@`-mention autocomplete: type `@cz` → see matching agents. Currently no suggest endpoint.

## Parallel-safety

New endpoint, no edits elsewhere.

## Files you own

- Create: `api/agents/suggest.js`

## Read first

- [api/agents/check-name.js](../../api/agents/check-name.js) — schema used.
- [api/_lib/http.js](../../api/_lib/http.js), [api/_lib/db.js](../../api/_lib/db.js).

## Deliverable

### `GET /api/agents/suggest`

- Query: `q` (string, 1–32 chars), `limit` (default 8, max 20).
- Public, rate-limited `120/min per IP`.
- Ranks:
  1. Exact name match (case-insensitive)
  2. Prefix match on name
  3. Prefix match on slug
  4. Fuzzy match (trigram if available; otherwise `ILIKE '%q%'`)
- Returns `{ agents: [{ id, name, slug, thumbnailUrl, chainId?: number, onChain: boolean }] }`.
- Excludes agents marked `private = true` or `hidden = true` if such columns exist.
- 60s response cache (CDN header `cache-control: public, max-age=60`).

## Constraints

- SQL via tagged template — no string concat.
- `q` sanitized (strip anything outside `[a-zA-Z0-9_-]`; then apply).
- No new deps.

## Acceptance

- `node --check` clean.
- `npm run build` clean.
- curl `/api/agents/suggest?q=cz` returns matching agents.
- SQL injection attempts (quotes, semicolons) return empty results, not errors.

## Report

- Which columns exist on the agents table for `private`/`hidden` (if any).
- Whether pg_trgm is installed; if not, what fallback you used.
