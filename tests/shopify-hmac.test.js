// api/_lib/shopify/hmac.js: real HMAC-SHA256 sign/verify round trips for
// both of Shopify's schemes, unmocked. No fake/sample signatures: every
// "valid" case in this file is generated the same way Shopify generates one.

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyOAuthHmac, verifyWebhookHmac } from '../api/_lib/shopify/hmac.js';

const SECRET = 'test-shopify-client-secret';

function signOAuthParams(params, secret) {
	const pairs = [...params.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature');
	pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const message = pairs.map(([k, v]) => `${k}=${v}`).join('&');
	return createHmac('sha256', secret).update(message).digest('hex');
}

describe('shopify hmac: OAuth query string', () => {
	it('accepts a correctly signed install/callback redirect', () => {
		const params = new URLSearchParams({
			shop: 'example.myshopify.com',
			timestamp: '1700000000',
			code: 'abc123',
		});
		params.set('hmac', signOAuthParams(params, SECRET));
		expect(verifyOAuthHmac(params, SECRET)).toBe(true);
	});

	it('rejects a tampered query string', () => {
		const params = new URLSearchParams({
			shop: 'example.myshopify.com',
			timestamp: '1700000000',
			code: 'abc123',
		});
		params.set('hmac', signOAuthParams(params, SECRET));
		params.set('shop', 'attacker.myshopify.com');
		expect(verifyOAuthHmac(params, SECRET)).toBe(false);
	});

	it('rejects a redirect signed with the wrong secret', () => {
		const params = new URLSearchParams({ shop: 'example.myshopify.com', timestamp: '1700000000' });
		params.set('hmac', signOAuthParams(params, 'a-different-secret'));
		expect(verifyOAuthHmac(params, SECRET)).toBe(false);
	});

	it('rejects a missing hmac param or missing secret', () => {
		const params = new URLSearchParams({ shop: 'example.myshopify.com' });
		expect(verifyOAuthHmac(params, SECRET)).toBe(false);
		params.set('hmac', 'deadbeef');
		expect(verifyOAuthHmac(params, '')).toBe(false);
	});
});

describe('shopify hmac: webhook body', () => {
	it('accepts a correctly signed webhook delivery', () => {
		const raw = Buffer.from(JSON.stringify({ shop_id: 1, shop_domain: 'example.myshopify.com' }));
		const sig = createHmac('sha256', SECRET).update(raw).digest('base64');
		expect(verifyWebhookHmac(raw, sig, SECRET)).toBe(true);
	});

	it('rejects a body that does not match the signature', () => {
		const raw = Buffer.from(JSON.stringify({ shop_id: 1 }));
		const sig = createHmac('sha256', SECRET).update(Buffer.from('something else')).digest('base64');
		expect(verifyWebhookHmac(raw, sig, SECRET)).toBe(false);
	});

	it('rejects a missing header or missing secret', () => {
		const raw = Buffer.from('{}');
		expect(verifyWebhookHmac(raw, '', SECRET)).toBe(false);
		const sig = createHmac('sha256', SECRET).update(raw).digest('base64');
		expect(verifyWebhookHmac(raw, sig, '')).toBe(false);
	});
});
