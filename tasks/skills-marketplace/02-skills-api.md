# Task 02 — API: Skills Marketplace Endpoints

## Goal
Build the REST API for the skills marketplace. When done, the chat frontend can list skills,
search/filter them, install/uninstall them, publish new ones, and fetch install state.

## Prerequisites
Task 01 (DB schema) must be merged first. The `marketplace_skills`, `skill_installs`, and
`skill_ratings` tables must exist.

## Context
- Project: `/workspaces/3D-Agent`
- API layer: Vercel serverless functions in `/api/` (ESM, Node 24)
- Shared libs in `/api/_lib/`:
  - `db.js` — Neon client, tagged-template `sql`. Read it to see exact export shape.
  - `auth.js` — `requireAuth(req)` throws on failure, returns `{ userId }`. Also `optionalAuth(req)`.
    Read it — the actual export names may differ slightly.
  - `http.js` — `json(res, data, status?)`, `error(res, msg, status?)`, CORS headers. Read it.
  - `rate-limit.js` — pre-built limiters. Read it for available exports.
  - `validate.js` — Zod helpers. Read it.
- Existing similar endpoint to study: `/api/marketplace/[action].js` — read it for patterns.
- Auth cookies: `credentials: 'include'` from the browser.

## Endpoints to build

Create `/api/skills/index.js` (handles `/api/skills` GET + POST) and
`/api/skills/[id].js` (handles `/api/skills/:id` GET/PUT/DELETE) and
`/api/skills/[id]/install.js` (POST to install, DELETE to uninstall) and
`/api/skills/[id]/rate.js` (POST to rate).

### GET /api/skills
Query params: `?q=`, `?category=`, `?sort=popular|new|az`, `?cursor=` (uuid for keyset pagination),
`?limit=` (default 20, max 50), `?installed=true` (filter to skills installed by authed user).

Response:
```json
{
  "skills": [
    {
      "id": "uuid",
      "name": "TradingView Charts",
      "slug": "tradingview-charts",
      "description": "...",
      "category": "finance",
      "tags": ["charts", "trading"],
      "install_count": 42,
      "avg_rating": 4.5,
      "rating_count": 12,
      "author": { "id": "uuid", "display_name": "Alice" },
      "installed": true,
      "created_at": "iso8601"
    }
  ],
  "next_cursor": "uuid-or-null"
}
```

`installed` field: true/false if user is authenticated, omitted if not.
`author` is null for system skills (author_id IS NULL).

### POST /api/skills
Requires auth. Publish a new skill.

Request body:
```json
{
  "name": "My Tool",
  "slug": "my-tool",
  "description": "Does X",
  "category": "utility",
  "tags": ["tag1"],
  "schema_json": [...],
  "is_public": true
}
```

Validate: name 2–80 chars, slug matches `/^[a-z0-9-]+$/` max 60 chars, unique slug,
description max 500 chars, schema_json is an array with at least 1 item, each item has
`function.name` (string) and `function.parameters` (object).

Response: `{ skill: { ...full row, author: {...} } }` with 201.

### GET /api/skills/:id
Returns full skill including `schema_json`. `installed` field present if authed.

### PUT /api/skills/:id
Requires auth. Only the author (or admin) can edit. Updates name/description/tags/is_public/schema_json.
Slug is immutable after publish.

### DELETE /api/skills/:id
Requires auth. Only the author can delete. Also deletes all installs for that skill.
Returns 204.

### POST /api/skills/:id/install
Requires auth. Installs skill for the current user. Increments `install_count` atomically.
Idempotent (409 → treat as success, or just upsert). Returns `{ installed: true }`.

### DELETE /api/skills/:id/install
Requires auth. Uninstalls. Decrements `install_count` (floor at 0). Returns `{ installed: false }`.

### POST /api/skills/:id/rate
Requires auth. Upserts a rating (1–5). Returns `{ avg_rating, rating_count }`.

## Implementation notes
- All endpoints must set CORS headers via the shared `http.js` helper — look at how other
  endpoints do it.
- Use keyset pagination (cursor = last seen id) not offset.
- The `avg_rating` field is computed via a JOIN or subquery against `skill_ratings`, not stored.
- Apply `rate-limit.js` to POST endpoints (use the lightest available limiter for authenticated
  users — read the file to pick the right one).
- Do not write any UI code.
- Do not modify existing files other than adding the new `/api/skills/` files.

## Verification
1. Read each file back and confirm there are no syntax errors.
2. Confirm all SQL uses the tagged-template `sql` from `db.js` (no raw string concatenation).
3. Confirm auth is checked on every mutating endpoint.
4. Confirm pagination is correct (cursor-based, not offset).
