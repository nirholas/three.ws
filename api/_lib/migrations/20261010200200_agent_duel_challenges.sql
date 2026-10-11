-- Agent duel challenges: one agent calls out another to a head-to-head.
--
-- Trader duels (20260930150000_trader_duels.sql) were generated only by the
-- rivalry engine. A challenge lets an agent owner pick the opponent: the
-- challenged agent's owner accepts or declines, and an accepted challenge opens
-- a regular duel_markets row for the next day or week window, tagged
-- context.source = 'challenge' so the rivalry generator leaves that window to
-- it. Resolution, calls and points are the existing free-play duel engine;
-- no funds move anywhere. Pending challenges expire after 48 hours
-- (/api/cron/duels-tick). api/_lib/duel-challenges.js owns every read and write.
-- Idempotent.

create table if not exists agent_duel_challenges (
    id                uuid primary key default gen_random_uuid(),
    network           text not null default 'mainnet' check (network in ('mainnet','devnet')),
    window_kind       text not null default 'day' check (window_kind in ('day','week')),
    challenger_agent  uuid not null references agent_identities(id) on delete cascade,
    challenger_user   uuid not null references users(id) on delete cascade,
    challenged_agent  uuid not null references agent_identities(id) on delete cascade,
    challenged_user   uuid not null references users(id) on delete cascade,
    message           text check (message is null or char_length(message) <= 280),
    status            text not null default 'pending'
                      check (status in ('pending','accepted','declined','expired','cancelled')),
    market_id         uuid references duel_markets(id) on delete set null,
    expires_at        timestamptz not null default (now() + interval '48 hours'),
    created_at        timestamptz not null default now(),
    responded_at      timestamptz,
    check (challenger_agent <> challenged_agent)
);

-- One live challenge per ordered pair, network and window kind.
create unique index if not exists agent_duel_challenges_one_pending
    on agent_duel_challenges (network, window_kind, challenger_agent, challenged_agent)
    where status = 'pending';
create index if not exists agent_duel_challenges_challenged
    on agent_duel_challenges (challenged_user, status, created_at desc);
create index if not exists agent_duel_challenges_challenger
    on agent_duel_challenges (challenger_user, status, created_at desc);
create index if not exists agent_duel_challenges_market
    on agent_duel_challenges (market_id) where market_id is not null;
create index if not exists agent_duel_challenges_expiry
    on agent_duel_challenges (expires_at) where status = 'pending';
