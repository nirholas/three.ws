create table agent_skill_prices (
    id serial primary key,
    agent_id integer not null references agents(id) on delete cascade,
    skill_name varchar(255) not null,
    amount bigint not null,
    currency_mint varchar(255) not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (agent_id, skill_name)
);
