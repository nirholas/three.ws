-- Idempotency ledger for signed Tripo generation webhooks (work order
-- 084-partners-01, task 2): a delivery is claimed by inserting its id here
-- before the body is ever parsed, so a provider retry of the same delivery is
-- a 200 no-op rather than a second materialize/markFailed call. Mirrors
-- print_webhook_deliveries (20260902130000_print_orders_fulfillment.sql);
-- job_id is text, not a forge_creations uuid FK, since the webhook arrives
-- keyed on the provider's own task id before the row is looked up.
create table if not exists forge_webhook_deliveries (
	provider    text        not null,
	delivery_id text        not null,
	job_id      text,
	applied     boolean     not null default false,
	received_at timestamptz not null default now(),
	primary key (provider, delivery_id)
);

create index if not exists forge_webhook_deliveries_job_idx
	on forge_webhook_deliveries (job_id, received_at desc);
