# Step 2 — API: support `content` in validation, responses, install

Working directory: `/workspaces/3D-Agent`. Read `/workspaces/3D-Agent/api/CLAUDE.md` first.

## Prerequisite

Step 1 (`01-db-migration.md`) must be applied. Verify:

```bash
psql "$DATABASE_URL" -c "\d marketplace_skills" | grep -E "content|schema_json"
```

`content text` must exist; `schema_json` must be nullable.

## Files to modify

1. `api/skills/index.js` — list endpoint + publish (POST).
2. `api/skills/[id].js` — get-by-id + update (PUT).
3. `api/skills/[id]/install.js` — install endpoint that returns the payload to the client.
4. `api/skills/categories.js` — only if it touches schema; otherwise leave it.

## Required changes

### `api/skills/index.js`

Current `publishSchema` (lines ~20-39) requires `schema_json` with `min(1)`. Change to:

- Add `content: z.string().trim().min(1).max(200000).optional()` to `publishSchema`.
- Make `schema_json` `.optional()` (remove `.min(1)` floor or replace with `.array(...).min(1).optional()`).
- After `parse()`, enforce in JS: at least one of `schema_json` or `content` must be present; otherwise return `error(res, 400, 'validation_error', 'skill must have schema_json or content')`.
- In the `INSERT INTO marketplace_skills (...)` statement, add `content` column and bind `${body.content ?? null}`. If `schema_json` is absent, bind `NULL` (not `'[]'::jsonb`).
- In `handleList`, include `ms.content` in the SELECT and in the `toSkill(...)` shape (or its inline equivalent in this file). For the **list response**, return only a boolean `has_content` and the first ~280 chars of content as `content_preview` to keep payloads small. Full content is fetched via the detail endpoint.

### `api/skills/[id].js`

- Add `content` to `updateSchema` (`z.string().trim().max(200000).optional()`).
- In `toSkill(row, ...)` (lines ~49-67), add `content: row.content ?? null` to the returned shape. Detail endpoint always returns full content.
- In `handleUpdate`, when `body.content !== undefined`, push `sql\`content = ${body.content}\`` into `updates`.

### `api/skills/[id]/install.js`

- Change the SELECT to include `content`: `SELECT id, schema_json, content FROM marketplace_skills WHERE ...`.
- On POST success, return `{ installed: true, schema_json: skill.schema_json, content: skill.content }` so the client can decide whether to register tools or inject system-prompt content.

## Hard rules

- No mocks. Test against the real Neon DB.
- Use `sql` tagged template, never string-concat.
- Don't change response shapes beyond what's specified above. The existing modal still consumes `schema_json` for tool-pack skills.
- Don't add new endpoints. Don't add new auth modes.

## Verification

Run real curl against the dev server (or whatever the project's dev command is — check `package.json`). Examples assume the API is at `http://localhost:3000`:

1. **List** returns the new `has_content` flag and `content_preview` for content rows (will be empty until step 3 seeds data — that's fine; the field should still serialize).

   ```bash
   curl -s 'http://localhost:3000/api/skills?limit=1' | jq '.skills[0] | keys'
   ```

   Expect `has_content` and `content_preview` in the keys.

2. **Detail** for a tool-pack skill (any existing row) still returns its `schema_json`.

   ```bash
   curl -s "http://localhost:3000/api/skills/<existing-id>" | jq '.skill | {schema_json: (.schema_json|type), content}'
   ```

3. **Constraint enforcement** — try posting a skill with neither `schema_json` nor `content`:

   ```bash
   curl -s -X POST http://localhost:3000/api/skills \
     -H 'content-type: application/json' --cookie "<session>" \
     -d '{"name":"x","slug":"x-test","description":"x"}'
   ```

   MUST return 400 `validation_error`.

## Done means

- All four endpoints accept and return `content` per spec.
- Existing tool-pack skills behavior is unchanged (regression check: install one, confirm `schema_json` still flows through).
- 400 on payload-less publish.
