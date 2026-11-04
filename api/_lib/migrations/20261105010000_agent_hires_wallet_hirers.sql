begin;

-- Wallet hirers: a hire paid straight from a Solana wallet through the hire
-- Blink (api/actions/agent-hire.js) has no hiring agent and no three.ws
-- account behind it, only the wallet that paid. Until now every agent_hires row
-- came from an agent-to-agent hire, so hirer_agent_id was required.
--
-- Relax that, but keep every row attributable: a hire must name either the
-- hiring agent or the paying wallet. Existing rows all carry hirer_agent_id, so
-- the check holds for them and the migration is backward-compatible.
-- hirer_user_id was already made nullable by the account purge migration.

alter table agent_hires alter column hirer_agent_id drop not null;
alter table agent_hires alter column hirer_user_id drop not null;

alter table agent_hires drop constraint if exists agent_hires_hirer_chk;
alter table agent_hires add constraint agent_hires_hirer_chk
    check (hirer_agent_id is not null or payer_address is not null);

-- A Blink checkout the wallet never paid is closed as 'expired', not 'failed':
-- no money moved and the provider did nothing wrong, so it must not count
-- against the provider's completion rate the way a paid, undelivered hire does.
alter table agent_hires drop constraint if exists agent_hires_status_chk;
alter table agent_hires add constraint agent_hires_status_chk
    check (status in ('pending', 'completed', 'refunded', 'failed', 'disputed', 'expired'));

-- The confirm callback and the settlement sweep find open Blink hires by age.
create index if not exists agent_hires_blink_pending
    on agent_hires (created_at)
    where status = 'pending' and hirer_agent_id is null;

commit;
