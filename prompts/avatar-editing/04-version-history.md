# Task 04 — Version history and rollback

## Why this exists

Edits are destructive today — save overwrites the model. Users want to roll back a bad edit or compare before / after. Version history is the seatbelt that makes aggressive editing feel safe.

## Files you own

- Create: migration adding `avatar_versions` table.
- Edit: `api/_lib/schema.sql` — same DDL appended.
- Edit: `api/avatars/[id].js` — on save, insert a row into `avatar_versions` (keep existing behavior, add the version side-effect).
- Create: `api/avatars/[id]/versions.js` — `GET` list, `POST /rollback/:n`.
- Create: `src/editor/history-panel.js` — sidebar listing versions with previews.

## Deliverable

### Schema

```sql
CREATE TABLE IF NOT EXISTS avatar_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id uuid NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  version integer NOT NULL,              -- 1-based, monotonic per avatar
  model_url text NOT NULL,
  storage_key text NOT NULL,
  preview_image_url text,
  source text,                            -- 'editor' | 'selfie-regen' | 'initial'
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (avatar_id, version)
);

CREATE INDEX IF NOT EXISTS avatar_versions_avatar_idx ON avatar_versions (avatar_id, version DESC);
```

### API

- `GET /api/avatars/:id/versions` — owner-only. Returns `{ versions: [...] }` newest first. Include `preview_image_url` for thumbnails.
- `POST /api/avatars/:id/versions/rollback` with `{ version: N }` (owner-only): sets `avatars.model_url` to that version's URL and bumps a new row so rollback itself is a version (source: `'rollback'`). Returns `200 { avatar }`.

### Save-path integration

Whenever task-01's save runs, also `INSERT INTO avatar_versions` with `source='editor'`. Whenever regenerate (task 02) succeeds, `source='selfie-regen'`. On initial avatar creation, write `version=1, source='initial'`.

### Retention

- Default: keep the most recent 20 versions. Older versions get hard-deleted (row + R2 blob) by a background cleanup you do NOT build here — just tag them with a cleanup-eligible flag or enforce via a simple count query on write.
- Never prune the currently-live version. Never prune version 1.

### Editor UI

Panel toggle: `🕘` icon in the editor GUI. Opens a sidebar with:
- Scrollable list of versions, newest first.
- Each row: thumbnail, version number, source tag, relative time, "Restore" button.
- Clicking a row previews that version in the viewer without committing.
- "Restore" commits the rollback and refreshes the page.

## Constraints

- Generating `preview_image_url` is out of scope. Leave it null; a later task can populate it by rendering the GLB server-side.
- Rollback never deletes the version you came from — it creates a new version pointing at the old blob.
- Non-owners: no list, no rollback, no way to even enumerate versions.

## Acceptance test

1. Migration applies cleanly.
2. Edit → save → `GET versions` returns two rows (version 1 initial + version 2 editor).
3. Rollback to version 1 → avatar reverts; `versions` list shows three rows (version 3 is rollback).
4. 21st save triggers pruning of version 1 (document whether hard-delete happened or just a soft tag).
5. Non-owner `GET versions` → 403.

## Reporting

- Whether you hard-deleted or soft-tagged old versions.
- Your approach to thumbnails (if any).
- Any race where two saves collide on the same `version` number, and how you handled it (transaction? `SELECT FOR UPDATE`?).
