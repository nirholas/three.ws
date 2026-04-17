# 10 — Avatar version history (schema + API)

## Why

Editor save-back needs rollback. This prompt adds the `avatar_versions` table and a minimal list/rollback API.

## Parallel-safety

Pure schema + two new endpoints. No client wiring.

## Files you own

- Create: `scripts/migrations/add-avatar-versions.sql`
- Create: `api/avatars/[id]/versions.js` (GET list)
- Create: `api/avatars/[id]/rollback.js` (POST)

## Read first

- [api/avatars/[id].js](../../api/avatars/[id].js) — the base avatar route + ownership pattern.
- [api/_lib/db.js](../../api/_lib/db.js) — `sql`.
- [scripts/](../../scripts/) — any existing migration conventions.

## Deliverable

### Migration

```sql
create table if not exists avatar_versions (
    id            bigserial primary key,
    avatar_id     uuid not null references avatars(id) on delete cascade,
    glb_url       text not null,
    metadata      jsonb,
    created_at    timestamptz not null default now(),
    created_by    uuid references users(id)
);

create index if not exists avatar_versions_avatar_id_idx on avatar_versions(avatar_id, created_at desc);
```

If `avatars` doesn't exist with a `uuid` id (or the id is `text`), adapt the FK type — read the real schema first and note any adaptation in the report.

### `GET /api/avatars/:id/versions`

- Auth required; ownership check.
- Returns `{ versions: [{ id, glbUrl, createdAt, metadata }...] }`, newest first, limit 50.

### `POST /api/avatars/:id/rollback`

- Auth required; ownership check.
- Body: `{ versionId }`.
- Look up the version row (must belong to this avatar), set `avatars.current_glb_url = versions.glb_url`, insert a new `avatar_versions` row noting this was a rollback (metadata `{ rollback_of: versionId }`).
- Response `{ ok: true, avatar: {...} }`.
- Rate limit: `10/hour per user`.

## Constraints

- Migration must be idempotent (uses `if not exists`).
- All SQL via tagged template.
- No new deps.

## Acceptance

- `psql -f scripts/migrations/add-avatar-versions.sql` runs clean against a dev db (you can skip actually running it — just show the SQL parses via `psql --dry-run` or syntax-check it).
- `node --check` clean on both endpoints.
- `npm run build` clean.

## Report

- Actual `avatars.id` type and any FK adaptation.
- Confirm whether a migration-runner convention already exists in this repo and how to invoke it.
