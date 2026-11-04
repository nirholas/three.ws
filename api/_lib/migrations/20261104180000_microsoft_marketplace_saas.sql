-- Migration: Microsoft Marketplace SaaS offer (subscriptions, webhook operations, metered usage).
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261104180000_microsoft_marketplace_saas.sql
-- Idempotent.
--
-- A buyer who purchases the three.ws SaaS offer on Microsoft Marketplace lands
-- on /microsoft/activate with a purchase token. api/_lib/microsoft-marketplace.js
-- resolves it, the buyer signs in with Microsoft Entra ID, and the subscription
-- row below is linked to a three.ws user. users.plan is then recomputed from
-- every entitlement the user holds, so a Microsoft subscription grants exactly
-- the plan an on-chain payment would.
--
--   microsoft_saas_subscriptions  Microsoft's copy of each subscription (the
--                                 Fulfillment API is the source of truth; we
--                                 refresh from it on every webhook) plus the
--                                 three.ws user it is linked to.
--   microsoft_saas_operations     one row per webhook operation id, so a
--                                 redelivered webhook is applied once.
--   microsoft_saas_usage_events   one row per subscription, dimension and hour
--                                 reported to the Metering API. The unique key
--                                 matches Microsoft's own duplicate rule.
--
-- user_identities gains 'microsoft' (subject is '<tenant id>:<object id>').
-- The constraint is rebuilt as a superset of every provider earlier migrations
-- allowed (20261011003000 telegram, 20261011210000 x).

begin;

alter table user_identities drop constraint if exists user_identities_provider_check;
alter table user_identities add constraint user_identities_provider_check
	check (provider in ('google', 'x', 'telegram', 'microsoft'));

create table if not exists microsoft_saas_subscriptions (
	id                     text primary key,
	user_id                uuid references users(id) on delete set null,
	name                   text,
	offer_id               text,
	plan_id                text,
	quantity               integer,
	saas_status            text not null default 'PendingFulfillmentStart'
		check (saas_status in ('PendingFulfillmentStart', 'Subscribed', 'Suspended', 'Unsubscribed')),
	purchaser_email        text,
	purchaser_oid          text,
	purchaser_tenant_id    text,
	beneficiary_email      text,
	beneficiary_oid        text,
	beneficiary_tenant_id  text,
	term_start             timestamptz,
	term_end               timestamptz,
	auto_renew             boolean not null default false,
	is_test                boolean not null default false,
	activated_at           timestamptz,
	metered_through        timestamptz,
	raw                    jsonb not null default '{}'::jsonb,
	created_at             timestamptz not null default now(),
	updated_at             timestamptz not null default now()
);

create index if not exists microsoft_saas_subscriptions_user_idx
	on microsoft_saas_subscriptions (user_id) where user_id is not null;
create index if not exists microsoft_saas_subscriptions_metering_idx
	on microsoft_saas_subscriptions (metered_through) where saas_status = 'Subscribed' and user_id is not null;

create table if not exists microsoft_saas_operations (
	id               text primary key,
	subscription_id  text not null,
	action           text not null,
	plan_id          text,
	quantity         integer,
	status           text,
	outcome          text not null default 'received'
		check (outcome in ('received', 'applied', 'acknowledged_success', 'acknowledged_failure', 'failed')),
	error            text,
	raw              jsonb not null default '{}'::jsonb,
	received_at      timestamptz not null default now(),
	processed_at     timestamptz
);

create index if not exists microsoft_saas_operations_subscription_idx
	on microsoft_saas_operations (subscription_id, received_at desc);

create table if not exists microsoft_saas_usage_events (
	id                    uuid primary key default gen_random_uuid(),
	subscription_id       text not null references microsoft_saas_subscriptions(id) on delete cascade,
	plan_id               text not null,
	dimension             text not null,
	effective_start_time  timestamptz not null,
	quantity              numeric(18,6) not null check (quantity > 0),
	status                text not null default 'pending'
		check (status in ('pending', 'accepted', 'expired', 'rejected')),
	usage_event_id        text,
	message               text,
	attempts              integer not null default 0,
	created_at            timestamptz not null default now(),
	updated_at            timestamptz not null default now(),
	unique (subscription_id, dimension, effective_start_time)
);

create index if not exists microsoft_saas_usage_events_pending_idx
	on microsoft_saas_usage_events (created_at) where status = 'pending';

commit;
