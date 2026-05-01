# Fix: Missing Columns on avatars Table

## Problem

`/api/avatars` returns 500 errors due to missing columns in the `avatars` table:

```
column "parent_avatar_id" of relation "avatars" does not exist
column "storage_mode" of relation "avatars" does not exist
```

## What to investigate

1. Find the migration or schema file that should have added `parent_avatar_id` and `storage_mode` to the `avatars` table.
2. Confirm whether this migration was applied to production. Check the migration history table in the database.
3. Review the `avatars` table schema to understand the full expected structure including types and constraints for these columns.

## Expected fix

- Write and run a migration to add the two missing columns:
  - `parent_avatar_id` (likely a UUID foreign key referencing `avatars.id`, nullable)
  - `storage_mode` (likely a varchar/enum, check the codebase for what values are expected)
- After migration, confirm `/api/avatars` returns 200 without column errors.
