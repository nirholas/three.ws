-- Migration: flag direct-to-seller sales as already settled to the seller's wallet.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261008150000_revenue_direct_settle_backfill.sql
-- Idempotent.
--
-- Skill purchases (intent_id 'sp_<purchase id>'), bundle purchases
-- ('bundle_<purchase id>') and agent x402 skill calls (intent_id = an
-- agent_payment_intents id) all settle the buyer's payment straight into the
-- seller's own payout wallet. Their revenue rows were written with
-- settled_to_wallet = false, so the withdrawal ledger counted each sale as money
-- the treasury owed the seller and the payout cron paid it a second time. The
-- write paths now set the flag; this marks the rows written before that.
-- Rows stay in place (they are real income for every earnings view); only
-- their treasury-liability meaning changes.

update agent_revenue_events re
set settled_to_wallet = true
where re.settled_to_wallet = false
  and (
    re.intent_id like 'sp\_%' escape '\'
    or re.intent_id like 'bundle\_%' escape '\'
    or exists (select 1 from agent_payment_intents pi where pi.id::text = re.intent_id)
  );
