-- Human tasks: settlement bookkeeping the first migration did not carry.
-- Apply: npm run db:status, then npm run db:migrate. Idempotent and additive.
--
--   human_tasks.escrow_closed_at / escrow_close_signature
--       When a finished task's empty escrow token account was closed and its
--       rent returned to the poster agent's wallet (the agent paid that rent
--       when it funded the escrow). The sweep closes an escrow once, after
--       every leg it owed (payout, fee or refund) has landed.
--
--   human_task_disputes.resolve_preview_*
--       The preview an admin must quote back to resolve a dispute. A
--       resolution moves escrowed USDC (to the worker, or back to the poster
--       agent), so it follows the same preview then confirm rule as every
--       other fund-moving action: the preview names recipient, amount, token
--       and chain, and expires after ten minutes.
--
--   human_task_uploads.bytes
--       The verified object size, read back from storage when the proof is
--       submitted, so a submission records what was actually stored.

begin;

alter table human_tasks add column if not exists escrow_closed_at timestamptz;
alter table human_tasks add column if not exists escrow_close_signature text;

create index if not exists human_tasks_escrow_close_due
    on human_tasks (updated_at)
    where escrow_closed_at is null and status in ('paid', 'cancelled', 'expired');

alter table human_task_disputes add column if not exists resolve_preview_id text;
alter table human_task_disputes add column if not exists resolve_preview_outcome text;
alter table human_task_disputes add column if not exists resolve_preview_by uuid;
alter table human_task_disputes add column if not exists resolve_preview_expires_at timestamptz;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'human_task_disputes_outcome_chk') then
        alter table human_task_disputes add constraint human_task_disputes_outcome_chk
            check (outcome is null or outcome in ('worker', 'poster'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'human_task_disputes_status_chk') then
        alter table human_task_disputes add constraint human_task_disputes_status_chk
            check (status in ('open', 'resolved'));
    end if;
end $$;

alter table human_task_uploads add column if not exists bytes integer;

commit;
