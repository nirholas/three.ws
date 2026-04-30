# Task 01 — DB Schema: Skills Marketplace Tables

## Goal
Add the database tables required to back a community skills marketplace. When done, the schema
should support: publishing skills, browsing/searching them, installing them per-user, and basic
ratings. This is a migration-only task — no API or UI changes.

## Context
- Project: `/workspaces/3D-Agent`
- DB: Neon serverless PostgreSQL
- Migration files live in `/api/_lib/migrations/` as dated SQL files (e.g. `2026-04-30-chat-admin-key.sql`)
- The existing schema is at `/api/_lib/schema.sql` (~900 lines). Read it first to understand conventions
  (id format, timestamps, foreign keys, naming style).
- Auth/user table is `users(id uuid pk, email, display_name, ...)`.
- Today's date: 2026-04-30.

## What to build

### 1. Migration file
Create `/api/_lib/migrations/2026-04-30-skills-marketplace.sql` with the following tables:

**`marketplace_skills`**
```
id          uuid primary key default gen_random_uuid()
author_id   uuid references users(id) on delete set null
name        text not null
slug        text not null unique  -- url-safe, e.g. "tradingview-charts"
description text not null
category    text not null default 'general'
-- JSON array matching the existing ToolPack schema used in /chat/src/tools.js:
-- each element: { clientDefinition: {...}, type, function: { name, description, parameters } }
schema_json jsonb not null
tags        text[] not null default '{}'
is_public   boolean not null default true
install_count integer not null default 0
created_at  timestamptz not null default now()
updated_at  timestamptz not null default now()
```

**`skill_installs`**  — tracks which users have installed which skills
```
id          uuid primary key default gen_random_uuid()
user_id     uuid references users(id) on delete cascade
skill_id    uuid references marketplace_skills(id) on delete cascade
installed_at timestamptz not null default now()
unique(user_id, skill_id)
```

**`skill_ratings`**
```
id         uuid primary key default gen_random_uuid()
user_id    uuid references users(id) on delete cascade
skill_id   uuid references marketplace_skills(id) on delete cascade
rating     smallint not null check (rating between 1 and 5)
created_at timestamptz not null default now()
unique(user_id, skill_id)
```

### 2. Indexes
Add indexes for the common query patterns:
- `marketplace_skills(category)`
- `marketplace_skills(author_id)`
- `marketplace_skills(install_count desc)` (for "popular" sort)
- `marketplace_skills(created_at desc)` (for "new" sort)
- `skill_installs(user_id)`

### 3. Update /api/_lib/schema.sql
Append the same table definitions (without `IF NOT EXISTS` guards — the schema.sql is the
canonical reference, not a runnable migration) to the bottom of `/api/_lib/schema.sql`.
Keep the same formatting style as the rest of the file.

### 4. Seed data
Add 5 seed rows to `marketplace_skills` in the migration file so there's something to browse.
Re-use the skill schemas from `/chat/src/tools.js` `curatedToolPacks` — translate each pack's
`schema` array directly into the `schema_json` column value. The 5 packs in tools.js are:
`tradingview`, `web-search`, `calculator`, `qr-code`, and any others present in that file.
Set `author_id = null` (system skills), `is_public = true`.

Use `ON CONFLICT (slug) DO NOTHING` so the seeds are idempotent.

## Verification
After writing the files:
1. Read both files back and confirm the SQL is syntactically correct.
2. Confirm foreign key references match actual table/column names in schema.sql.
3. Confirm the jsonb seed data is valid JSON (no JS template literals or unquoted strings).
