-- pumpfun_graduations
--
-- Persisted record of every pump.fun → PumpAMM (or Raydium) migration we
-- observe via the PumpPortal websocket. The live SSE feed enriches each event
-- and stores it here so:
--   - new SSE clients can backfill across cold starts (in-process ring buffer
--     loses everything when the Vercel function recycles);
--   - a synchronous /api/pump/recent-graduations endpoint can answer
--     fast queries without keeping a WebSocket open;
--   - graduations remain queryable for analytics/reputation work.
--
-- The full enriched payload is stored as JSONB so renderer changes don't
-- require schema migrations. Promoted columns are the ones we filter / sort by.

create table if not exists pumpfun_graduations (
    tx_signature        text        primary key,
    mint                text        not null,
    name                text,
    symbol              text,
    creator             text,
    pool                text,                       -- pump-amm | raydium | …
    raydium_pool        text,
    pump_swap_pool      text,
    market_cap_usd      double precision,
    market_cap_usd_initial double precision,
    ath_market_cap      double precision,
    amount_sol          double precision,
    amount_usd          double precision,
    sol_price           double precision,
    image_uri           text,
    description         text,
    twitter             text,
    telegram            text,
    website             text,
    creator_launches    integer,
    creator_graduated   integer,
    payload             jsonb       not null default '{}'::jsonb,
    seen_at             timestamptz not null default now()
);

create index if not exists pumpfun_graduations_seen_at on pumpfun_graduations(seen_at desc);
create index if not exists pumpfun_graduations_mint on pumpfun_graduations(mint);
create index if not exists pumpfun_graduations_creator on pumpfun_graduations(creator) where creator is not null;
