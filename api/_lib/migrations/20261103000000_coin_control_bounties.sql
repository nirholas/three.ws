-- 20261103000000_coin_control_bounties.sql
--
-- Coin Control bounties: a bounty a creator posts for their own coin and pays
-- from their agent's wallet, instead of by hand.
--
--   agent_id              the agent whose wallet pays the reward (null for an
--                         ordinary /go board bounty, which the poster pays by hand)
--   network               the network the reward is paid on
--   payout_submission_id  the submission the owner chose to pay
--   payout_approval_id    the approval request when the owner's policy asked for
--                         a yes before the payment; the bounty sits in
--                         'resolving' until that request settles
--   payout_signature      the payment transaction, once it landed
--
-- Every column is nullable and additive, so the /go board and its API read the
-- table exactly as before.

alter table bounties add column if not exists agent_id uuid references agent_identities(id) on delete set null;
alter table bounties add column if not exists network text check (network is null or network in ('mainnet', 'devnet'));
alter table bounties add column if not exists payout_submission_id uuid;
alter table bounties add column if not exists payout_approval_id uuid;
alter table bounties add column if not exists payout_signature text;

create index if not exists bounties_agent_idx on bounties(agent_id) where agent_id is not null and deleted_at is null;
create index if not exists bounties_payout_pending_idx on bounties(payout_approval_id) where status = 'resolving' and payout_approval_id is not null;
