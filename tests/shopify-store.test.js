// api/_lib/shopify/store.js against a real in-process Postgres (PGlite): the
// OAuth session upsert, media-job status transitions, billing state, the
// webhook delivery idempotency ledger, and shop/redact's real erase. No
// mocked SQL semantics: this is the real ON CONFLICT, the real CHECK
// constraint, the real FK cascade.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

const DDL = `
	create table shopify_shops (
		shop_domain    text primary key,
		access_token   text        not null,
		scope          text        not null,
		installed_at   timestamptz not null default now(),
		uninstalled_at timestamptz
	);
	create table shopify_media_jobs (
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
	create table shopify_webhook_deliveries (
		shop_domain text        not null,
		topic       text        not null,
		delivery_id text        not null,
		received_at timestamptz not null default now(),
		primary key (topic, delivery_id)
	);
	create table shopify_billing (
		shop_domain      text primary key references shopify_shops(shop_domain),
		subscription_id  text        not null,
		line_item_id     text        not null,
		test_mode        boolean     not null default true,
		status           text        not null default 'pending',
		created_at       timestamptz not null default now(),
		updated_at       timestamptz not null default now(),
		constraint shopify_billing_status_check check (status in ('pending', 'active', 'declined', 'cancelled'))
	);
`;

let store;

beforeAll(async () => {
	store = await import('../api/_lib/shopify/store.js');
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(DDL);
});

describe('shop session', () => {
	it('saves and reads back a shop session, nulling uninstalled_at on reinstall', async () => {
		const shop = 'example.myshopify.com';
		await store.saveShopSession(shop, 'token-1', 'read_products,write_products');
		let session = await store.getShopSession(shop);
		expect(session).toMatchObject({ shop_domain: shop, access_token: 'token-1', uninstalled_at: null });

		await store.markShopUninstalled(shop);
		session = await store.getShopSession(shop);
		expect(session.uninstalled_at).not.toBeNull();

		await store.saveShopSession(shop, 'token-2', 'read_products,write_products');
		session = await store.getShopSession(shop);
		expect(session).toMatchObject({ access_token: 'token-2', uninstalled_at: null });
	});

	it('returns null for a shop that never installed', async () => {
		expect(await store.getShopSession('nope.myshopify.com')).toBeNull();
	});
});

describe('webhook delivery ledger', () => {
	it('claims a delivery once and rejects a replay of the same id', async () => {
		const first = await store.claimWebhookDelivery('example.myshopify.com', 'APP_UNINSTALLED', 'delivery-1');
		const replay = await store.claimWebhookDelivery('example.myshopify.com', 'APP_UNINSTALLED', 'delivery-1');
		expect(first).toBe(true);
		expect(replay).toBe(false);
	});

	it('treats the same delivery id on a different topic as a separate claim', async () => {
		const a = await store.claimWebhookDelivery('example.myshopify.com', 'APP_UNINSTALLED', 'shared-id');
		const b = await store.claimWebhookDelivery('example.myshopify.com', 'SHOP_REDACT', 'shared-id');
		expect(a).toBe(true);
		expect(b).toBe(true);
	});
});

describe('media jobs', () => {
	async function seedShop(shop = 'example.myshopify.com') {
		await store.saveShopSession(shop, 'token-1', 'read_products,write_products');
		return shop;
	}

	it('walks a job through generating -> ready_to_attach -> attached', async () => {
		const shop = await seedShop();
		const id = await store.createMediaJob({
			shop,
			productId: 'gid://shopify/Product/1',
			productTitle: 'Test Product',
			imageUrl: 'https://cdn.example.com/photo.jpg',
			forgeJobId: null,
		});

		let job = await store.getMediaJob(shop, id);
		expect(job.status).toBe('generating');

		await store.setMediaJobForgeId(id, 'forge-job-1');
		job = await store.getMediaJob(shop, id);
		expect(job.forge_job_id).toBe('forge-job-1');

		await store.setMediaJobReadyToAttach(id, {
			glbUrl: 'https://forge.example.com/model.glb',
			stagedResourceUrl: 'https://shopify-staged.example.com/upload',
		});
		job = await store.getMediaJob(shop, id);
		expect(job.status).toBe('ready_to_attach');
		expect(job.glb_url).toBe('https://forge.example.com/model.glb');

		await store.setMediaJobAttached(id, 'gid://shopify/MediaImage/9');
		job = await store.getMediaJob(shop, id);
		expect(job.status).toBe('attached');
		expect(job.media_id).toBe('gid://shopify/MediaImage/9');
	});

	it('records a failure with its error message', async () => {
		const shop = await seedShop();
		const id = await store.createMediaJob({
			shop,
			productId: 'gid://shopify/Product/2',
			productTitle: null,
			imageUrl: 'https://cdn.example.com/photo2.jpg',
			forgeJobId: null,
		});
		await store.setMediaJobFailed(id, 'forge generation failed: timeout');
		const job = await store.getMediaJob(shop, id);
		expect(job.status).toBe('failed');
		expect(job.error).toBe('forge generation failed: timeout');
	});

	it('rejects an invalid status at the database layer', async () => {
		const shop = await seedShop();
		await expect(
			holder.db.sql`insert into shopify_media_jobs (shop_domain, product_id, image_url, status) values (${shop}, 'p1', 'https://x', 'not-a-real-status')`
		).rejects.toThrow();
	});
});

describe('billing', () => {
	it('saves, reads, and transitions a billing subscription', async () => {
		const shop = 'example.myshopify.com';
		await store.saveShopSession(shop, 'token-1', 'read_products,write_products');

		await store.saveBillingSubscription(shop, {
			subscriptionId: 'gid://shopify/AppSubscription/1',
			lineItemId: 'gid://shopify/AppSubscriptionLineItem/1',
			testMode: true,
			status: 'pending',
		});
		let billing = await store.getBillingSubscription(shop);
		expect(billing).toMatchObject({ status: 'pending', test_mode: true });

		await store.setBillingStatus(shop, 'active');
		billing = await store.getBillingSubscription(shop);
		expect(billing.status).toBe('active');
	});

	it('returns null when no subscription exists yet', async () => {
		await store.saveShopSession('fresh.myshopify.com', 'token-1', 'read_products,write_products');
		expect(await store.getBillingSubscription('fresh.myshopify.com')).toBeNull();
	});
});

describe('eraseShopData (shop/redact)', () => {
	it('deletes media jobs, billing, and the session row for the shop', async () => {
		const shop = 'erase-me.myshopify.com';
		await store.saveShopSession(shop, 'token-1', 'read_products,write_products');
		await store.createMediaJob({ shop, productId: 'p1', productTitle: 't', imageUrl: 'https://x', forgeJobId: null });
		await store.saveBillingSubscription(shop, {
			subscriptionId: 'sub-1',
			lineItemId: 'li-1',
			testMode: true,
			status: 'active',
		});

		await store.eraseShopData(shop);

		expect(await store.getShopSession(shop)).toBeNull();
		expect(await store.getBillingSubscription(shop)).toBeNull();
		const jobs = await holder.db.sql`select id from shopify_media_jobs where shop_domain = ${shop}`;
		expect(jobs).toHaveLength(0);
	});

	it('leaves other shops untouched', async () => {
		await store.saveShopSession('keep-me.myshopify.com', 'token-1', 'read_products,write_products');
		await store.saveShopSession('erase-me-2.myshopify.com', 'token-1', 'read_products,write_products');

		await store.eraseShopData('erase-me-2.myshopify.com');

		expect(await store.getShopSession('keep-me.myshopify.com')).not.toBeNull();
		expect(await store.getShopSession('erase-me-2.myshopify.com')).toBeNull();
	});
});
