# Fix: Missing parent_avatar_id Column — DB Migration Required

## Confirmed Issue

`api/_lib/schema.sql` adds `storage_mode` as an additive migration on line 59:
```sql
alter table avatars add column if not exists storage_mode jsonb;
```

But `parent_avatar_id` is **never added** anywhere in `schema.sql`, even though the code references it extensively.

## Affected code

- `api/_lib/avatars.js` line 31 — SELECTs `a.parent_avatar_id`
- `api/_lib/avatars.js` line 88 — INSERTs `parent_avatar_id`
- `api/_lib/avatars.js` line 95 — INSERT value `${input.parent_avatar_id ?? null}`
- `api/_lib/avatars.js` line 244 — maps `row.parent_avatar_id`
- `api/avatars/index.js` lines 84–110 — validates ownership, re-points agent identities on POST

Any call to `POST /api/avatars` with a `parent_avatar_id` body field, or any SELECT from `avatars` that reads the column, will throw a NeonDbError in production.

## Fix

**Step 1** — Add the migration to `api/_lib/schema.sql` after line 59:
```sql
alter table avatars add column if not exists parent_avatar_id uuid references avatars(id) on delete set null;
```

**Step 2** — Run this SQL against the production Neon database directly (the `schema.sql` file is the source of truth; running it again is idempotent due to `if not exists`).

**Step 3** — Verify by querying production:
```sql
select column_name from information_schema.columns
where table_name = 'avatars' and column_name = 'parent_avatar_id';
```

After the column exists, `POST /api/avatars` with `parent_avatar_id` and the avatar list query will stop erroring.
