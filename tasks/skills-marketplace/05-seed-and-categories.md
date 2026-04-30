# Task 05 — Seed Skills & Category Taxonomy

## Goal
Populate the skills marketplace with a rich set of seed skills so it is immediately useful when
users open it. Also standardise the category list and add a categories endpoint. This task is
primarily data + a small API addition.

## Prerequisites
Tasks 01 and 02 must be complete.

## Part A — Expanded seed data migration

Create `/api/_lib/migrations/2026-04-30-skills-seed.sql`.

This migration inserts ready-to-use skills into `marketplace_skills`. All rows: `author_id = null`,
`is_public = true`. Use `ON CONFLICT (slug) DO NOTHING` for idempotency.

### Canonical categories (use exactly these strings)
`finance`, `productivity`, `developer`, `data`, `media`, `utility`, `ai`

### Skills to seed (build full valid `schema_json` for each)

The `schema_json` must be a valid JSON array of tool definitions. Each element shape:
```json
{
  "clientDefinition": {
    "id": "unique-string",
    "name": "ToolName",
    "description": "...",
    "arguments": [{ "name": "arg", "type": "string", "description": "..." }],
    "body": "// JavaScript that returns { contentType, content } or a JSON-serialisable value"
  },
  "type": "function",
  "function": {
    "name": "ToolName",
    "description": "When to use this tool — written for the LLM",
    "parameters": {
      "type": "object",
      "properties": { "arg": { "type": "string", "description": "..." } },
      "required": ["arg"]
    }
  }
}
```

**Skills to create:**

1. **tradingview-charts** (finance) — interactive TradingView price chart iframe
2. **web-search** (utility) — DuckDuckGo search returning abstract + top topics
3. **qr-code** (utility) — renders a QR code image via `api.qrserver.com`
4. **calculator** (utility) — safe `eval`-less expression evaluator (use Function constructor)
5. **markdown-preview** (productivity) — renders user-supplied markdown as styled HTML in an iframe
6. **color-palette** (media) — given a theme description, generates a 5-colour palette as swatches
7. **json-formatter** (developer) — pretty-prints and validates JSON input
8. **regex-tester** (developer) — tests a regex against input, highlights matches
9. **unit-converter** (utility) — converts between common units (length, weight, temperature, etc.)
10. **mermaid-diagram** (developer) — renders a Mermaid.js diagram in an iframe using the CDN build
11. **csv-table** (data) — renders CSV input as an HTML table with sorting
12. **world-clock** (utility) — shows current time in N timezones side-by-side
13. **image-from-url** (media) — renders an image URL in a resizable preview iframe
14. **base64-codec** (developer) — encodes/decodes base64
15. **word-counter** (productivity) — counts words, chars, sentences, reading time

For each skill's `body`: write actual working JavaScript (not pseudocode). The body runs in the
browser sandbox and returns a value. For HTML-rendering tools, return `{ contentType: 'text/html', content: htmlString }`.

## Part B — Categories API endpoint

Create `/api/skills/categories.js` handling `GET /api/skills/categories`.

No auth required.

Response:
```json
{
  "categories": [
    { "slug": "finance", "label": "Finance", "count": 4 },
    { "slug": "productivity", "label": "Productivity", "count": 3 },
    ...
  ]
}
```

Query: count of `is_public = true` skills per category, ordered by count desc.
Include only categories with at least 1 public skill.

Derive `label` from `slug` by title-casing.

Cache-Control: `public, max-age=60` (categories change rarely).

## Part C — Update SkillsMarketplaceModal to use categories API

In `/chat/src/SkillsMarketplaceModal.svelte` (created in Task 03):

Replace the client-side category derivation with a fetch to `/api/skills/categories` when the
modal opens. This gives accurate counts even before skills are loaded.

Change the existing `onMount` (or `$: if (open)` reactive block) to also fetch categories in
parallel with the skills list fetch.

## Verification
1. Confirm the migration file is valid SQL (no JS syntax, proper JSON escaping in string literals).
2. Confirm all 15 seed skills have valid `schema_json` — parse each manually.
3. Run `cd /workspaces/3D-Agent/chat && npm run build` — must pass.
4. Confirm categories endpoint returns correct structure.
