-- agent_memories needs updated_at to support upsert-by-id from the client.
-- api/agent-memory.js writes this column in both INSERT branches and in the
-- ON CONFLICT DO UPDATE clause; without it, every POST returns 500.

alter table agent_memories
    add column if not exists updated_at timestamptz not null default now();

do $$ begin
    create trigger agent_memories_set_updated_at before update on agent_memories
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
