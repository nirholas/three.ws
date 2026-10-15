-- Hire fulfillment attestations: one signed row per settled a2a-hire recording
-- whether the provider actually delivered. Signed off-chain with the same
-- platform attestation key api/_lib/attest-event.js uses for on-chain memos
-- (ATTEST_AGENT_SECRET_KEY), but this table never touches the chain: it is the
-- real-data input the free agent reputation score (hireFulfillmentRate in
-- src/shared/agent-financial-reputation.js) reads, recency-weighted by
-- created_at. outcome is 'disputed' whenever delivery is ambiguous (a payment
-- timeout where settlement state is unknown), never inferred as 'delivered'.
--
-- One attestation per hire: a hire's terminal status never flips twice, so a
-- retried write (e.g. a replayed executeApprovedA2aHire) is a no-op here.

create table if not exists hire_attestations (
    id                 bigserial primary key,
    hire_id            uuid not null references agent_hires(id) on delete cascade,
    payment_signature  text,
    outcome            text not null check (outcome in ('delivered', 'failed', 'disputed')),
    evidence_hash      text not null,
    signed_by          text not null,
    signature          text not null,
    payload            jsonb not null,
    created_at         timestamptz not null default now(),
    unique (hire_id)
);

-- Fulfillment-rate reads join agent_hires (filtered by provider_agent_id) to
-- this table by hire_id, already covered by the unique constraint above.

-- Per-service opt-in for the x402 reputation discount (task 3). Off by default:
-- a provider must explicitly price in a discount for well-reputed hirers.
alter table agent_paid_services
    add column if not exists reputation_discount_enabled boolean not null default false;
