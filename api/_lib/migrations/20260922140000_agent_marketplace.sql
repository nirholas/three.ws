-- Whole-agent marketplace: listings, escrowed bids, settlement, custody rotation.
-- Apply: npm run db:status, then npm run db:migrate. Idempotent.
--
-- The skills marketplace sells capabilities; this sells the agent itself:
-- identity, persona, skills, history and the custodial wallet move to the buyer.
--
-- Money never moves on a database flag. A bid is only `open` once its USDC has
-- landed in the listing's escrow account, a Solana keypair derived per listing
-- from AGENT_MARKET_ESCROW_SECRET (api/_lib/agent-market/chain.js). The stored
-- escrow_address is re-derived and compared before every escrow signature, so a
-- changed secret fails closed instead of signing from the wrong account.
--
-- Bids live in agent_listing_bids: agent_bids already belongs to the labor
-- market (bounty bids, 20260623180000_agent_labor_market.sql).
--
-- Lifecycles:
--   listing   active -> settling -> sold
--                    \-> delisted | expired
--   bid       awaiting_funds -> open -> accepted
--                            \-> expired   \-> rejected | withdrawn | expired
--             every non-accepted funded bid carries refund_status
--             pending -> sent, driven by the marketplace-escrow-sweep cron.
--   transfer  one idempotent state machine (api/_lib/agent-market/settlement.js)
--             whose `step` column is the resume point after any failure.

begin;

create table if not exists agent_listings (
    id                    uuid primary key default gen_random_uuid(),
    agent_id              uuid not null references agent_identities(id),
    seller_user_id        uuid not null references users(id),
    status                text not null default 'active',
    -- Buy-now price in USDC atomics (6dp). Null means auction only.
    ask_usdc_atomics      bigint,
    -- Optional buy-now price in $THREE atomics.
    ask_three_atomics     numeric,
    -- Floor for bids, USDC atomics.
    min_bid_usdc_atomics  bigint not null,
    expires_at            timestamptz not null,
    -- true: the agent wallet's balance goes to the buyer with the agent.
    -- false: the balance is swept to the seller's payout address first.
    include_balance       boolean not null default false,
    -- true: memories, chat and activity history transfer. false: they are
    -- detached from the agent before the buyer takes ownership.
    include_history       boolean not null default true,
    -- Seller's Solana address for sale proceeds and (when excluded) the balance.
    payout_address        text not null,
    escrow_address        text not null,
    note                  text,
    -- What the listing advertised at creation: skills, persona summary, wallet
    -- balance, so a buyer can compare it with what actually transferred.
    snapshot              jsonb not null default '{}'::jsonb,
    sold_bid_id           uuid,
    -- Set once the escrow token accounts are closed and their rent returned.
    escrow_closed_at      timestamptz,
    closed_at             timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'agent_listings_status_chk') then
        alter table agent_listings add constraint agent_listings_status_chk
            check (status in ('active', 'settling', 'sold', 'delisted', 'expired'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agent_listings_price_chk') then
        alter table agent_listings add constraint agent_listings_price_chk
            check (min_bid_usdc_atomics > 0
                   and (ask_usdc_atomics is null or ask_usdc_atomics >= min_bid_usdc_atomics)
                   and (ask_three_atomics is null or ask_three_atomics > 0));
    end if;
end $$;

-- One live listing per agent: a second would let two buyers win the same agent.
create unique index if not exists agent_listings_one_live
    on agent_listings (agent_id)
    where status in ('active', 'settling');
create index if not exists agent_listings_browse
    on agent_listings (status, created_at desc);
create index if not exists agent_listings_seller
    on agent_listings (seller_user_id, created_at desc);
create index if not exists agent_listings_expiry
    on agent_listings (expires_at)
    where status = 'active';

create table if not exists agent_listing_bids (
    id                  uuid primary key default gen_random_uuid(),
    listing_id          uuid not null references agent_listings(id),
    bidder_user_id      uuid not null references users(id),
    kind                text not null default 'bid',          -- bid | buy_now
    currency            text not null default 'USDC',         -- USDC | THREE
    amount_atomics      numeric not null,
    status              text not null default 'awaiting_funds',
    -- agent_wallet: escrowed by the platform from one of the bidder's agents.
    -- connected_wallet: the bidder signed the escrow transfer in their wallet.
    funding_source      text not null,
    funding_agent_id    uuid references agent_identities(id),
    -- Where the escrowed funds came from, and so where a refund goes.
    funding_address     text not null,
    -- Solana Pay reference key riding the escrow transfer (connected wallet).
    escrow_reference    text,
    escrow_signature    text,
    funded_at           timestamptz,
    -- Unfunded bids lapse; a signed-but-unsent wallet transaction expires with
    -- its blockhash long before this.
    fund_by             timestamptz,
    decided_at          timestamptz,
    refund_status       text,
    refund_signature    text,
    refund_error        text,
    refund_attempts     integer not null default 0,
    -- Exactly-once record of the refund transaction ({signature,
    -- lastValidBlockHeight}), written before broadcast (chain.js sendLeg).
    refund_leg          jsonb,
    -- Lease: an inline refund and the sweep cron never send the same refund.
    refund_locked_until timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'agent_listing_bids_status_chk') then
        alter table agent_listing_bids add constraint agent_listing_bids_status_chk
            check (status in ('awaiting_funds', 'open', 'accepted', 'rejected', 'withdrawn', 'expired'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agent_listing_bids_refund_chk') then
        alter table agent_listing_bids add constraint agent_listing_bids_refund_chk
            check (refund_status is null or refund_status in ('pending', 'sent', 'failed'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agent_listing_bids_shape_chk') then
        alter table agent_listing_bids add constraint agent_listing_bids_shape_chk
            check (amount_atomics > 0
                   and kind in ('bid', 'buy_now')
                   and currency in ('USDC', 'THREE')
                   and funding_source in ('agent_wallet', 'connected_wallet'));
    end if;
end $$;

-- An escrow transfer funds exactly one bid.
create unique index if not exists agent_listing_bids_escrow_signature_key
    on agent_listing_bids (escrow_signature) where escrow_signature is not null;
create unique index if not exists agent_listing_bids_escrow_reference_key
    on agent_listing_bids (escrow_reference) where escrow_reference is not null;
create index if not exists agent_listing_bids_listing
    on agent_listing_bids (listing_id, status, amount_atomics desc);
create index if not exists agent_listing_bids_bidder
    on agent_listing_bids (bidder_user_id, created_at desc);
create index if not exists agent_listing_bids_refund_due
    on agent_listing_bids (updated_at) where refund_status in ('pending', 'failed');

create table if not exists agent_transfers (
    id                   uuid primary key default gen_random_uuid(),
    listing_id           uuid not null unique references agent_listings(id),
    bid_id               uuid not null unique references agent_listing_bids(id),
    agent_id             uuid not null references agent_identities(id),
    buyer_user_id        uuid not null references users(id),
    seller_user_id       uuid not null references users(id),
    currency             text not null,
    amount_atomics       numeric not null,
    fee_atomics          numeric not null,
    seller_net_atomics   numeric not null,
    -- The state machine's resume point (see settlement.js STEPS).
    step                 text not null default 'pay_seller',
    status               text not null default 'in_progress',   -- in_progress | completed | failed
    payout_signature     text,
    fee_signature        text,
    old_wallet_address   text,
    new_wallet_address   text,
    -- The custody rotation record: every step, its time, and its signatures.
    -- The pending new key sits here encrypted (secret-box) only between key
    -- generation and the ownership swap, then is cleared.
    rotation             jsonb not null default '{}'::jsonb,
    -- Exactly-once records of every on-chain leg, keyed by leg id.
    legs                 jsonb not null default '{}'::jsonb,
    attempts             integer not null default 0,
    last_error           text,
    -- Lease so two workers never drive the same transfer at once.
    locked_until         timestamptz,
    completed_at         timestamptz,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

create index if not exists agent_transfers_open
    on agent_transfers (updated_at) where status <> 'completed';
create index if not exists agent_transfers_buyer
    on agent_transfers (buyer_user_id, created_at desc);
create index if not exists agent_transfers_seller
    on agent_transfers (seller_user_id, created_at desc);

create table if not exists agent_marketplace_history (
    id              bigserial primary key,
    agent_id        uuid not null,
    listing_id      uuid,
    bid_id          uuid,
    transfer_id     uuid,
    actor_user_id   uuid,
    event           text not null,
    currency        text,
    amount_atomics  numeric,
    signature       text,
    meta            jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index if not exists agent_marketplace_history_agent
    on agent_marketplace_history (agent_id, created_at desc);
create index if not exists agent_marketplace_history_listing
    on agent_marketplace_history (listing_id, created_at desc);

-- Preview records for the financial MCP tools: each commit must cite a preview
-- the same user produced for the same action and arguments in the last ten
-- minutes, so a model can never skip showing the user what it is about to do.
create table if not exists agent_market_previews (
    id            text primary key,
    user_id       uuid not null,
    action        text not null,
    params_hash   text not null,
    payload       jsonb not null,
    consumed_at   timestamptz,
    created_at    timestamptz not null default now()
);

create index if not exists agent_market_previews_user
    on agent_market_previews (user_id, created_at desc);

-- Revenue follows the owner who earned it. Earnings balances join revenue to
-- the agent's CURRENT owner, so without this a sale would hand the seller's
-- unwithdrawn earnings to the buyer. Settlement stamps every pre-sale row with
-- the seller; rows written after the sale stay null and follow the new owner.
alter table agent_revenue_events add column if not exists owner_user_id uuid;

commit;
