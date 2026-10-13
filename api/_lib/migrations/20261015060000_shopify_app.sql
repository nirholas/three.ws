-- Shopify product-media app (work order 091-partners-08): OAuth sessions,
-- per-image media-generation jobs, webhook delivery idempotency, and the
-- one Billing API subscription a shop activates.
--
-- access_token is the OFFLINE token from the token exchange (api/shopify/callback.js):
-- it never expires on its own and is scoped to the app's whole install, which
-- is what every background job (bulk mode, the status poller) needs to keep
-- working without a merchant's browser tab open. Shopify does not support
-- rotating it server-side, so uninstalling and reinstalling is the only way a
-- shop gets a new one; `uninstalled_at` marks a session dead without deleting
-- the row, so a reinstall's callback can reuse the primary key cleanly.
create table if not exists shopify_shops (
	shop_domain    text primary key,
	access_token   text        not null,
	scope          text        not null,
	installed_at   timestamptz not null default now(),
	uninstalled_at timestamptz
);

-- One row per "generate a 3D model for this product's image" action, whether
-- fired from the single-product flow or bulk mode. Bulk mode is just N of
-- these inserted together; the embedded UI polls each by id for real
-- per-item status instead of one opaque batch spinner.
create table if not exists shopify_media_jobs (
	id             uuid primary key default gen_random_uuid(),
	shop_domain    text        not null references shopify_shops(shop_domain),
	product_id     text        not null,
	product_title  text,
	image_url      text        not null,
	forge_job_id   text,
	status         text        not null default 'generating',
	glb_url        text,
	staged_resource_url text,
	media_id       text,
	error          text,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now(),
	constraint shopify_media_jobs_status_check check (
		status in ('generating', 'ready_to_attach', 'attaching', 'attached', 'failed')
	)
);

create index if not exists shopify_media_jobs_shop_idx
	on shopify_media_jobs (shop_domain, created_at desc);

-- Idempotency ledger for the three mandatory privacy webhooks plus
-- app/uninstalled, mirroring forge_webhook_deliveries
-- (20261015040000_forge_webhook_deliveries.sql): Shopify retries a webhook
-- delivery that doesn't 200 fast enough, and a replayed shop/redact or
-- customers/redact must not re-run its handler a second time.
create table if not exists shopify_webhook_deliveries (
	shop_domain text        not null,
	topic       text        not null,
	delivery_id text        not null,
	received_at timestamptz not null default now(),
	primary key (topic, delivery_id)
);

-- One usage-pricing AppSubscription per shop. `test_mode` records whether the
-- activated subscription carried `test: true` (Shopify never charges a test
-- subscription's usage records), so the app can show the merchant an honest
-- "test mode, no charge" badge instead of silently billing nothing and
-- looking broken.
create table if not exists shopify_billing (
	shop_domain      text primary key references shopify_shops(shop_domain),
	subscription_id  text        not null,
	line_item_id     text        not null,
	test_mode        boolean     not null default true,
	status           text        not null default 'pending',
	created_at       timestamptz not null default now(),
	updated_at       timestamptz not null default now(),
	constraint shopify_billing_status_check check (status in ('pending', 'active', 'declined', 'cancelled'))
);
