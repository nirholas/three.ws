# Step 1 — DB migration: add `content`, make `schema_json` nullable

Working directory: `/workspaces/3D-Agent`. Read `/workspaces/3D-Agent/CLAUDE.md` and `/workspaces/3D-Agent/api/CLAUDE.md` first.

## Context

The `marketplace_skills` table is defined in `api/_lib/schema.sql:724-740`. Today every skill must have `schema_json` (an array of OpenAI tool definitions). We are introducing **content skills** (markdown knowledge injected into system prompt) which have no tool schema, only markdown content.

Existing migrations live in `api/_lib/migrations/` with the convention `YYYY-MM-DD-<topic>.sql`. Today is 2026-05-01.

## Task

Create exactly one migration file that:

1. Adds a nullable `content text` column to `marketplace_skills`.
2. Makes `schema_json` nullable (`alter column schema_json drop not null`).
3. Adds a check constraint enforcing that **every row has at least one of**: `schema_json` or `content`. Constraint name: `marketplace_skills_has_payload`.
4. Updates the canonical schema at `api/_lib/schema.sql` so the `create table` block reflects the new shape, and the check constraint is included. Keep the existing comment block above the table; update it to mention content skills.

Migration file path: `api/_lib/migrations/2026-05-01-skills-content-column.sql`.

Use `if not exists` / `if exists` guards so the migration is idempotent. Do not drop or rewrite anything else.

## Apply migration

The repo uses Neon. Migrations are applied via whatever runner is wired up in this project — check `package.json`, `scripts/migrations/`, or a README to find the existing command. **Do not invent a new runner.** If you cannot find a runner, run the SQL directly via `psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-01-skills-content-column.sql` and note this in your report.

## Verification

Run against the real DB (no mocks):

```bash
psql "$DATABASE_URL" -c "\d marketplace_skills"
```

Confirm:
- `content` column present, type `text`, nullable.
- `schema_json` is nullable.
- Constraint `marketplace_skills_has_payload` listed.

Then sanity-check the constraint:

```bash
psql "$DATABASE_URL" -c "INSERT INTO marketplace_skills (name, slug, description) VALUES ('t','t-test','t');"
```

This MUST fail with the check-constraint violation. Then `DELETE FROM marketplace_skills WHERE slug = 't-test';` (it shouldn't have been inserted, but make sure).

## Done means

- Migration file exists and applied.
- Schema matches in `api/_lib/schema.sql`.
- `\d marketplace_skills` shows the new shape.
- Constraint blocks rows that have neither `schema_json` nor `content`.
