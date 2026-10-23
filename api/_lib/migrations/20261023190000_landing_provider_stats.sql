-- Per-provider transaction landing stats for the execution engine's landing race.
--
-- Every signed Solana transaction is sent through several providers at once.
-- This table keeps, per (provider, network), how often each one landed the
-- transaction first (landed), errored or finished without landing (lost) and was
-- still racing when another lane landed (outpaced), plus a moving-average
-- latency and the current failure streak. The race orders providers by recent
-- success and skips one on a streak until a health probe passes.

create table if not exists landing_provider_stats (
	provider text not null,
	network text not null,
	landed bigint not null default 0,
	lost bigint not null default 0,
	outpaced bigint not null default 0,
	streak integer not null default 0,
	latency_ms integer,
	last_error text,
	last_landed_at timestamptz,
	updated_at timestamptz not null default now(),
	primary key (provider, network)
);
