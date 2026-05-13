-- Add avatar_id to agent_identities so the pump.fun launch flow can resolve
-- an existing agent from an avatar without querying avatars separately.
-- resolveLaunchAgentId in api/pump/[action].js depends on this column.

alter table agent_identities
    add column if not exists avatar_id uuid references avatars(id) on delete set null;

create index if not exists agent_identities_avatar
    on agent_identities(avatar_id) where avatar_id is not null;
