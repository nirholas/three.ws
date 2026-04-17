# Task 01 — Merge `embed_policy` schema migration into the canonical schema

## Why this exists

The `/api/agents/:id/embed-policy` endpoint (see [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js)) reads and writes a JSONB column `embed_policy` on the `agent_identities` table. The endpoint and the dashboard UI ship today, but the column itself was never merged into the canonical schema at [api/_lib/schema.sql](../../api/_lib/schema.sql) — it lives in a stranded one-off file at [specs/schema/embed-policy.sql](../../specs/schema/embed-policy.sql).

Consequence: any fresh database (CI, local dev, a new Vercel preview branch with a fresh Neon DB) that runs `node scripts/apply-schema.mjs` does **not** get the column. The endpoint then 500s on its first read. This is the boring foundational fix that unblocks the other four prompts in [00-README.md](00-README.md).

## What you're building

A two-line `ALTER TABLE` added to [api/_lib/schema.sql](../../api/_lib/schema.sql)'s additive-migrations block (currently lines 260–266), plus a header note in [specs/schema/embed-policy.sql](../../specs/schema/embed-policy.sql) marking it merged. Then run [scripts/apply-schema.mjs](../../scripts/apply-schema.mjs) against your local DB to confirm idempotency.

## Read first (in this order)

1. [api/_lib/schema.sql](../../api/_lib/schema.sql) — focus on the `agent_identities` block at lines 235–266. Note the existing pattern for additive migrations (`alter table agent_identities add column if not exists ...`).
2. [specs/schema/embed-policy.sql](../../specs/schema/embed-policy.sql) — 19 lines, the source of truth for the migration that needs merging.
3. [scripts/apply-schema.mjs](../../scripts/apply-schema.mjs) — the one-shot applier; reads `DATABASE_URL` from `.env.local` → `.env` → environment.
4. [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) — confirms the column name (`embed_policy`) and type (`jsonb`).

## What to change

### 1. Append the migration to `api/_lib/schema.sql`

Find the additive-migrations block under the `agent_identities` table (currently lines 260–266 — the run of `alter table agent_identities add column if not exists ...` lines). At the end of that block, add **one** new line:

```sql
alter table agent_identities add column if not exists embed_policy    jsonb;
```

Match the surrounding indentation (spaces vs tabs, column alignment). Do not modify any other line. Do not reorder existing lines.

### 2. Mark the stranded migration file as merged

Edit [specs/schema/embed-policy.sql](../../specs/schema/embed-policy.sql). Replace the existing header comment (lines 1–16) with:

```sql
-- Task 03 — Per-agent embed referrer allowlist
--
-- MERGED into api/_lib/schema.sql on <YYYY-MM-DD>. This file is kept for
-- historical reference and as a one-shot ALTER for any database that was
-- provisioned before the canonical schema picked up this column.
--
-- Adds an `embed_policy` JSONB column to `agent_identities`. NULL means
-- "no policy" — preserves the legacy "embed anywhere" behaviour.
--
-- Apply once against any pre-existing database that wasn't reset:
--   psql "$DATABASE_URL" -f specs/schema/embed-policy.sql
-- Or just re-run `node scripts/apply-schema.mjs` (idempotent).
```

Leave the `ALTER TABLE` itself (lines 17–18 in the original) unchanged. Replace `<YYYY-MM-DD>` with today's date in ISO form.

### 3. Verify idempotency by applying

Run `node scripts/apply-schema.mjs` against your local `DATABASE_URL`. It should print no errors. Run it a second time. It should still print no errors. Capture both outputs for the reporting block.

If you don't have a local Postgres / Neon connection, say so explicitly in your report — do not skip the run. The script reads `.env.local` automatically; check `cat .env.example` if you need to know what env vars are expected (you do not need to populate them — just confirm the script's check for `DATABASE_URL` fails cleanly).

## Files you own (create / edit)

- Edit: [api/_lib/schema.sql](../../api/_lib/schema.sql) — one line added under the `agent_identities` additive-migrations block.
- Edit: [specs/schema/embed-policy.sql](../../specs/schema/embed-policy.sql) — header comment replaced; ALTER unchanged.

## Files off-limits (other prompts edit these)

- [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) — owned by prompt 02
- [api/_lib/embed-policy.js](../../api/_lib/embed-policy.js) (if it exists) — owned by prompt 02
- [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) — owned by prompt 02
- Anything under [src/](../../src/) — owned by prompt 03
- [src/runtime/providers.js](../../src/runtime/providers.js) and any new `api/llm/*` — owned by prompt 04
- The `avatars` table schema and any new `storage_mode` column — owned by prompt 05

## Idempotency / parallel-safety notes

- Prompts 02 and 05 may also append `ALTER TABLE` lines to the same migration block. That's fine — `add column if not exists` is idempotent. Resolve any merge conflict by keeping all three lines in any order.
- Do not attempt to coalesce multiple ALTERs into one; keep them as separate lines for git-blame readability.

## Acceptance test

1. `git diff api/_lib/schema.sql` shows exactly one added line in the additive-migrations block, no other changes.
2. `git diff specs/schema/embed-policy.sql` shows only the header comment replaced; the `ALTER TABLE` body unchanged.
3. `npx prettier --check api/_lib/schema.sql specs/schema/embed-policy.sql` passes (or write `--write` and commit the formatted version).
4. `node scripts/apply-schema.mjs` runs without error against your local DB. Run it twice. Capture both outputs.
5. `node --check` is N/A (only SQL changed) — note this in the report.
6. `npx vite build` passes — confirms nothing in the JS world broke.

## Reporting

Output at the end of your PR / commit:

- **Files changed:** with line counts.
- **Commands run + output:**
  - `node scripts/apply-schema.mjs` (first run + second run, full output).
  - `npx prettier --check ...` result.
  - `npx vite build` result (just last 5 lines + total time).
- **Skipped:** anything you couldn't run (e.g. no local DB), with reason.
- **Unrelated bugs noticed:** list anything off in nearby code that you did NOT fix.
- **Confirmation of scope:** that you did not edit any file in the off-limits list above.
