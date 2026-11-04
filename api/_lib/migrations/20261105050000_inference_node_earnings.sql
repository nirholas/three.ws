-- Verified inference earnings per node, one row per settled job.
create table if not exists inference_node_earnings (
	id bigserial primary key,
	node_public_key text not null,
	job_id text not null unique,
	capability text not null,
	model text,
	amount_atomics bigint not null,
	asset text,
	payer_signature text,
	verified_at timestamptz not null default now(),
	payout_status text not null default 'accrued',
	payout_signature text
);
create index if not exists inference_node_earnings_node_idx on inference_node_earnings (node_public_key, verified_at desc);
