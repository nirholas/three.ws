-- Migration: server-issued challenges for agent self-signup (POST /api/auth/agent-signup).
-- An autonomous agent asks for a challenge for its Solana public key, signs the
-- server-built message, and posts the signature back. The challenge row is the
-- replay guard: it is consumed with a compare-and-set, so a nonce works exactly
-- once on every instance, and it is bound to the key it was issued for.
-- Idempotent.
--
--   nonce        random, server-chosen, single use
--   public_key   base58 ed25519 key the challenge was issued to
--   issued_at    exact timestamps that appear in the signed message, so the
--   expires_at   server rebuilds the message instead of trusting the client's copy
--   consumed_at  set when a valid signature redeems the challenge

create table if not exists agent_signup_challenges (
    nonce       text primary key,
    public_key  text not null,
    ip          text,
    issued_at   timestamptz not null,
    expires_at  timestamptz not null,
    consumed_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists agent_signup_challenges_key_idx on agent_signup_challenges(public_key, created_at desc);
create index if not exists agent_signup_challenges_expires_idx on agent_signup_challenges(expires_at);
