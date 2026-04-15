# 03-05 — Avatar version history and rollback

## Why it matters

Layer 3 lets users regenerate the GLB without breaking their `agentId` — but every regenerate today clobbers the previous avatar. A user who prefers the v2 look over v3 has no recovery path, which makes them afraid to experiment. Version history turns the "edit avatar" flow from destructive into safe.

## Context

- Avatar table: `avatars` in [api/_lib/schema.sql](../../api/_lib/schema.sql) — already has `version int not null default 1` and `checksum_sha256`.
- Agent record: `agents.avatar_id` in the same schema.
- Swap endpoint: scoped in `03-01-avatar-swap.md` / `03-02-swap-avatar-on-agent.md`. This prompt assumes one of them is merged.
- R2 helper: [api/_lib/r2.js](../../api/_lib/r2.js).

## What to build

### Schema

```sql
create table if not exists agent_avatar_versions (
    id              uuid primary key default gen_random_uuid(),
    agent_id        uuid not null references agents(id) on delete cascade,
    avatar_id       uuid not null references avatars(id) on delete restrict,
    version         int  not null,
    source          text not null,                     -- 'upload' | 'regenerated' | 'swap'
    source_meta     jsonb not null default '{}'::jsonb,
    created_by      uuid not null references users(id) on delete set null,
    created_at      timestamptz not null default now(),
    active          boolean not null default false,
    unique (agent_id, version)
);
create unique index if not exists agent_avatar_active_per_agent
    on agent_avatar_versions(agent_id) where active;
```

### Write path

Every time `agents.avatar_id` changes (swap, regenerate, cosmetic):

- Insert a new `agent_avatar_versions` row with the new `avatar_id` and incremented `version`.
- Flip `active = false` on the prior row, `true` on the new row, inside one transaction.
- **Do not delete the prior avatar row or R2 object.**

### Endpoints — `api/agents/[id]/versions.js`

- `GET` — owner-only. Returns the array sorted desc by version, each item including a thumbnail URL.
- `POST { version }` — owner-only. Makes the specified version active (flip `active` + update `agents.avatar_id`). Returns the new active record.

### Retention policy

- Keep the last 10 versions per agent. Prune older ones on each new version insert: mark `avatar_id` for soft-delete in `avatars` (set `deleted_at`) and schedule R2 deletion via a simple cleanup column. Never prune the currently-active version.

### Dashboard UI

- On the agent detail page, a "History" panel lists versions with thumbnail, date, and a "Restore" button.
- Restoring prompts with a non-modal inline confirm ("This will replace your current avatar. You can restore back any time.") and calls the POST endpoint.

## Out of scope

- Branching / non-linear history.
- Diffing avatars (no visual diff tool).
- Per-version annotations or notes.
- Version history for animation sets or metadata (avatar GLB only).

## Acceptance

1. Regenerate an agent's avatar 3 times. `GET /versions` returns 4 entries (original + 3). The latest is `active: true`.
2. Restore to v2 → active flips; page reload shows v2.
3. Regenerate again after restore → becomes v5 (monotonic version numbers).
4. 11th regenerate: oldest (non-active) version is soft-deleted; the R2 object is queued for cleanup.
5. Direct DB edit to delete the active version row returns 409 from the restore endpoint (integrity guard).
6. `node --check` passes on new files.
