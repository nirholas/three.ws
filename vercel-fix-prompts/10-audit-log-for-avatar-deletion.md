# Fix: Missing Audit Log for MCP Avatar Deletion

## Confirmed Issue

`api/_mcp/tools/avatars.js` line 239:
```js
const result = await deleteAvatar({ id: args.id, userId: auth.userId });
if (!result) throw new Error('avatar not found or not yours');
// TODO: audit_log table needed — INSERT (user_id, action='delete_avatar', resource_id, created_at)
return { content: [{ type: 'text', text: `Deleted avatar ${args.id}.` }] };
```

Avatar deletions triggered through the MCP `delete_avatar` tool are not logged. If a user's avatar is deleted through an MCP client, there is no record of who deleted it or when.

## Fix

**Step 1** — Create an `audit_log` table migration. Add a new file `api/_lib/migrations/2026-05-01-audit-log.sql`:

```sql
-- Migration: audit log for sensitive operations.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-01-audit-log.sql
-- Idempotent.

create table if not exists audit_log (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references users(id) on delete set null,
    action      text not null,
    resource_id text,
    meta        jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists audit_log_user_idx on audit_log(user_id, created_at desc);
create index if not exists audit_log_action_idx on audit_log(action, created_at desc);
```

Apply against production: `psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-01-audit-log.sql`

**Step 2** — Replace the TODO comment in `api/_mcp/tools/avatars.js` line 239 with the actual INSERT, using `queueMicrotask` so it doesn't block the response:

```js
const result = await deleteAvatar({ id: args.id, userId: auth.userId });
if (!result) throw new Error('avatar not found or not yours');
queueMicrotask(async () => {
    try {
        await sql`
            INSERT INTO audit_log (user_id, action, resource_id)
            VALUES (${auth.userId}, 'delete_avatar', ${args.id})
        `;
    } catch { /* non-fatal */ }
});
return { content: [{ type: 'text', text: `Deleted avatar ${args.id}.` }] };
```

Follow the same fire-and-forget pattern used in `api/avatars/index.js` line 115.
