-- pump_fee_claims (work order 506-integrate-07): real-time persisted index of
-- GitHub social-fee-PDA withdrawals on the PumpFees program, written by the
-- services/pump-claims listener as they happen on-chain. Lets
-- api/_lib/pump-claims.js's scanFirstClaims answer from this table instead of
-- an RPC scan: no indexer, no PUMPFUN_BOT_URL dependency, no per-request
-- GitHub/pump.fun lookups for a claim the listener already resolved.
--
-- Only the fields the read path needs back are promoted to columns; the
-- listener re-derives headline/explanation text for `label` from the fixed
-- lookup in pump-claims-attribution.js's attributionInfoForLabel rather than
-- persisting that text twice.

create table if not exists pump_fee_claims (
    signature      text        primary key,
    mint           text,
    claimer        text        not null,
    github_user_id text,
    lamports       bigint      not null default 0,
    label          text,
    held           boolean     not null default false,
    slot           bigint,
    created_at     timestamptz not null default now()
);

create index if not exists pump_fee_claims_mint on pump_fee_claims(mint) where mint is not null;
create index if not exists pump_fee_claims_claimer on pump_fee_claims(claimer);
create index if not exists pump_fee_claims_created_at on pump_fee_claims(created_at desc);
