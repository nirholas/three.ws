create table if not exists agent_actions (
    id             bigserial primary key,
    agent_id       uuid not null references agent_identities(id) on delete cascade,
    type           text not null,
    payload        jsonb not null default '{}'::jsonb,
    source_skill   text,
    signature      text,
    signer_address text,
    created_at     timestamptz not null default now()
);

create index if not exists agent_actions_agent_time
    on agent_actions(agent_id, created_at desc);

create index if not exists agent_actions_type_time
    on agent_actions(type, created_at desc);
