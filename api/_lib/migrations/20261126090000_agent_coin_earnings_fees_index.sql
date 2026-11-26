-- Per-coin creator earnings now come from pump.fun's creator-fee index
-- filtered to one mint (GET frontend-api-v3.pump.fun/fees/creator/<wallet>
-- ?mint=<mint>). The distribution timeline the 'timeline' source named
-- (swap-api /v1/coins/<mint>/timeline) answers 404 for every mint since
-- 2026-11-25. Allow the new source label beside the old one, so rows written
-- before this change stay valid until the next snapshot rewrites them.
-- Apply: npm run db:migrate
-- Idempotent.

begin;

alter table agent_coin_earnings drop constraint if exists agent_coin_earnings_coin_earnings_source_check;
alter table agent_coin_earnings
	add constraint agent_coin_earnings_coin_earnings_source_check
	check (coin_earnings_source is null or coin_earnings_source in ('timeline', 'fees_index'));

commit;
