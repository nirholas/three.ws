// api/_lib/shopify/webhook-verify.js: the shared verify-then-claim path
// every /api/shopify/webhooks/* receiver runs before any handler logic,
// against a real HMAC and a real (PGlite) delivery-id ledger.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.SHOPIFY_API_SECRET = 'test-api-secret';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

const DDL = `
	create table shopify_webhook_deliveries (
		shop_domain text        not null,
		topic       text        not null,
		delivery_id text        not null,
		received_at timestamptz not null default now(),
		primary key (topic, delivery_id)
	);
`;

let verifyAndClaim, WebhookAuthError;

beforeAll(async () => {
	({ verifyAndClaim, WebhookAuthError } = await import('../api/_lib/shopify/webhook-verify.js'));
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(DDL);
});

function fakeReq(bodyObj, { shop = 'example.myshopify.com', topic = 'APP_UNINSTALLED', deliveryId = 'delivery-1', secret = process.env.SHOPIFY_API_SECRET } = {}) {
	const raw = Buffer.from(JSON.stringify(bodyObj));
	const sig = createHmac('sha256', secret).update(raw).digest('base64');
	return {
		headers: {
			'x-shopify-hmac-sha256': sig,
			'x-shopify-shop-domain': shop,
			'x-shopify-webhook-id': deliveryId,
		},
		rawBody: raw,
	};
}

describe('verifyAndClaim', () => {
	it('accepts a correctly signed, fresh delivery and parses the body', async () => {
		const req = fakeReq({ shop_id: 1, shop_domain: 'example.myshopify.com' });
		const result = await verifyAndClaim(req, 'APP_UNINSTALLED');
		expect(result.shop).toBe('example.myshopify.com');
		expect(result.body).toEqual({ shop_id: 1, shop_domain: 'example.myshopify.com' });
		expect(result.fresh).toBe(true);
	});

	it('marks a replayed delivery id as not fresh without re-throwing', async () => {
		const req1 = fakeReq({ a: 1 }, { deliveryId: 'dup-1' });
		const req2 = fakeReq({ a: 1 }, { deliveryId: 'dup-1' });
		await verifyAndClaim(req1, 'SHOP_REDACT');
		const second = await verifyAndClaim(req2, 'SHOP_REDACT');
		expect(second.fresh).toBe(false);
	});

	it('throws WebhookAuthError on an invalid signature', async () => {
		const req = fakeReq({ a: 1 }, { secret: 'wrong-secret' });
		await expect(verifyAndClaim(req, 'APP_UNINSTALLED')).rejects.toBeInstanceOf(WebhookAuthError);
	});
});
