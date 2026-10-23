begin;

-- One pricing record, many rails. A paid marketplace skill is priced once
-- (price_per_call_usd) and the author chooses which payment rails may redeem
-- it: x402 and mpp (HTTP 402 challenges), a2a (JSON-RPC task envelope), ap2
-- (intent-mandate authorised). Default x402 + a2a keeps every existing skill
-- reachable exactly as before, plus the agent-to-agent lane.
alter table marketplace_skills
	add column if not exists rails text[] not null default '{x402,a2a}';

do $$ begin
	alter table marketplace_skills
		add constraint marketplace_skills_rails_check
		check (rails <@ array['x402','mpp','a2a','ap2']::text[] and cardinality(rails) > 0);
exception when duplicate_object then null; end $$;

-- Whatever rail redeemed the call, the same receipt row is written: the rail,
-- the skill, and the author/platform split in atomics.
alter table x402_receipts add column if not exists rail text not null default 'x402';
alter table x402_receipts add column if not exists skill_id uuid;
alter table x402_receipts add column if not exists author_atomics numeric;
alter table x402_receipts add column if not exists platform_atomics numeric;

create index if not exists x402_receipts_skill_issued
	on x402_receipts (skill_id, issued_at desc) where skill_id is not null;

commit;
