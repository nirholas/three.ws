import { describe, expect, it, vi } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import {
	BASE_URL,
	RobinhoodApiError,
	createCryptoClient,
	privateKeyFromBase64,
	publicKeyBase64,
	signRequest,
	signingMessage,
} from '../api/_lib/robinhood/crypto-client.js';
import { checkOrder, parseCaps } from '../api/_lib/robinhood/spend-caps.js';

// RFC 8032 section 7.1, test 2: seed, public key, one byte message "r", signature.
const RFC_SEED_B64 = Buffer.from('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', 'hex').toString('base64');
const RFC_PUB_B64 = Buffer.from('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c', 'hex').toString('base64');
const RFC_SIG_B64 = Buffer.from(
	'92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
	'hex',
).toString('base64');

const SEED = Buffer.alloc(32, 7).toString('base64');

function okFetch(payload, status = 200) {
	return vi.fn(async () => ({ ok: status < 400, status, json: async () => payload }));
}

describe('request signing', () => {
	it('builds the documented message: api key, timestamp, path with query, METHOD, body', () => {
		expect(signingMessage({ apiKey: 'K', timestamp: 1700000000, path: '/api/v1/crypto/trading/orders/', method: 'post', body: '{"a":1}' })).toBe(
			'K1700000000/api/v1/crypto/trading/orders/POST{"a":1}',
		);
	});

	it('reproduces the RFC 8032 Ed25519 test vector through signRequest', () => {
		const h = signRequest({ apiKey: 'r', privateKey: RFC_SEED_B64, method: '', path: '', body: '', timestamp: '' });
		expect(h['x-signature']).toBe(RFC_SIG_B64);
		expect(publicKeyBase64(privateKeyFromBase64(RFC_SEED_B64))).toBe(RFC_PUB_B64);
	});

	it('produces a signature the matching public key verifies over the sent request', () => {
		const path = '/api/v1/crypto/marketdata/best_bid_ask/?symbol=BTC-USD';
		const h = signRequest({ apiKey: 'rh-api-key', privateKey: SEED, method: 'GET', path, timestamp: 1700000000 });
		const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKeyBase64(privateKeyFromBase64(SEED)), 'base64').toString('base64url') }, format: 'jwk' });
		const message = Buffer.from(signingMessage({ apiKey: 'rh-api-key', timestamp: 1700000000, path, method: 'GET' }));
		expect(verify(null, message, pub, Buffer.from(h['x-signature'], 'base64'))).toBe(true);
		expect(h['x-timestamp']).toBe('1700000000');
		expect(h['x-api-key']).toBe('rh-api-key');
	});

	it('rejects a private key of the wrong length without echoing it', () => {
		const bad = Buffer.alloc(10, 1).toString('base64');
		try {
			privateKeyFromBase64(bad);
			throw new Error('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(RobinhoodApiError);
			expect(e.message).not.toContain(bad);
		}
	});
});

describe('client requests', () => {
	it('signs the exact path and sends the headers to the trading host', async () => {
		const fetchImpl = okFetch({ results: [{ symbol: 'BTC-USD', price: '60000' }] });
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl, now: () => 1700000000 });
		const quote = await c.bestBidAsk('BTC-USD');
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe(`${BASE_URL}/api/v1/crypto/marketdata/best_bid_ask/?symbol=BTC-USD`);
		expect(init.headers['x-api-key']).toBe('K');
		expect(init.headers['x-signature']).toBeTruthy();
		expect(quote.price).toBe('60000');
	});

	it('refuses a non-crypto symbol before any request', async () => {
		const fetchImpl = okFetch({});
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl });
		await expect(c.bestBidAsk('AAPL')).rejects.toMatchObject({ code: 'bad_request' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('follows holdings pagination', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [{ asset_code: 'BTC' }], next: `${BASE_URL}/api/v1/crypto/trading/holdings/?cursor=abc` }) })
			.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [{ asset_code: 'ETH' }], next: null }) });
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl });
		expect((await c.holdings()).map((h) => h.asset_code)).toEqual(['BTC', 'ETH']);
		expect(fetchImpl.mock.calls[1][0]).toContain('?cursor=abc');
	});

	it('retries a rate limited read and then succeeds', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
			.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [] }) });
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl, sleep: async () => {} });
		await expect(c.holdings()).resolves.toEqual([]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('never retries an order POST', async () => {
		const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl, sleep: async () => {} });
		await expect(c.placeOrder({ symbol: 'BTC-USD', side: 'buy', quantity: '0.001', notionalUsd: 10, maxNotionalUsd: 25 })).rejects.toMatchObject({ code: 'upstream_error' });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('maps a 401 to a credentials error that carries no secret', async () => {
		const c = createCryptoClient({ apiKey: 'SECRET-API-KEY', privateKey: SEED, fetchImpl: okFetch({}, 401) });
		const err = await c.getAccount().catch((e) => e);
		expect(err.code).toBe('credentials_rejected');
		expect(JSON.stringify({ m: err.message, s: err.stack })).not.toContain('SECRET-API-KEY');
		expect(JSON.stringify({ m: err.message })).not.toContain(SEED);
	});
});

describe('orders and caps', () => {
	it('refuses an order above the ceiling before any request is built', async () => {
		const fetchImpl = okFetch({});
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl });
		await expect(c.placeOrder({ symbol: 'BTC-USD', side: 'buy', quantity: '1', notionalUsd: 60000, maxNotionalUsd: 25 })).rejects.toMatchObject({ code: 'over_cap' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('refuses an order that carries no cap context', async () => {
		const fetchImpl = okFetch({});
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl });
		await expect(c.placeOrder({ symbol: 'BTC-USD', side: 'buy', quantity: '1' })).rejects.toMatchObject({ code: 'cap_required' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('posts a market order in the documented body shape', async () => {
		const fetchImpl = okFetch({ id: 'o1', state: 'queued' });
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl });
		await c.placeOrder({ symbol: 'BTC-USD', side: 'buy', quantity: '0.0005', notionalUsd: 30, maxNotionalUsd: 50, clientOrderId: 'cid-1' });
		const [, init] = fetchImpl.mock.calls[0];
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ client_order_id: 'cid-1', side: 'buy', type: 'market', symbol: 'BTC-USD', market_order_config: { asset_quantity: '0.0005' } });
	});

	it('posts a limit order with its price and time in force', async () => {
		const fetchImpl = okFetch({ id: 'o2' });
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl });
		await c.placeOrder({ symbol: 'ETH-USD', side: 'sell', type: 'limit', quantity: '0.1', limitPrice: '3500', notionalUsd: 350, maxNotionalUsd: 1000, clientOrderId: 'cid-2' });
		expect(JSON.parse(fetchImpl.mock.calls[0][1].body).limit_order_config).toEqual({ asset_quantity: '0.1', limit_price: '3500', time_in_force: 'gtc' });
	});

	it('rejects a non-positive or malformed quantity', async () => {
		const c = createCryptoClient({ apiKey: 'K', privateKey: SEED, fetchImpl: okFetch({}) });
		await expect(c.placeOrder({ symbol: 'BTC-USD', side: 'buy', quantity: '-1', notionalUsd: 1, maxNotionalUsd: 5 })).rejects.toMatchObject({ code: 'bad_request' });
		await expect(c.placeOrder({ symbol: 'BTC-USD', side: 'buy', quantity: '1e3', notionalUsd: 1, maxNotionalUsd: 5 })).rejects.toMatchObject({ code: 'bad_request' });
	});
});

describe('spend caps', () => {
	const base = { side: 'buy', perOrderCapUsd: 25, dailyCapUsd: 100, spentTodayUsd: 0 };
	it('allows an order inside both caps and reports what is left', () => {
		expect(checkOrder({ ...base, notionalUsd: 20, spentTodayUsd: 30 })).toEqual({ ok: true, remainingAfterUsd: 50 });
	});
	it('blocks above the per-order cap', () => {
		expect(checkOrder({ ...base, notionalUsd: 25.01 })).toMatchObject({ ok: false, code: 'over_per_order_cap' });
	});
	it('blocks when the day has too little left', () => {
		expect(checkOrder({ ...base, notionalUsd: 20, spentTodayUsd: 90 })).toMatchObject({ ok: false, code: 'over_daily_cap' });
	});
	it('does not cap sells', () => {
		expect(checkOrder({ ...base, side: 'sell', notionalUsd: 5000 })).toMatchObject({ ok: true });
	});
	it('blocks an order that cannot be priced', () => {
		expect(checkOrder({ ...base, notionalUsd: NaN })).toMatchObject({ ok: false });
	});
	it('validates owner caps', () => {
		expect(parseCaps({ per_order_cap_usd: 50, daily_cap_usd: 20 })).toMatchObject({ ok: false });
		expect(parseCaps({ per_order_cap_usd: -1, daily_cap_usd: 20 })).toMatchObject({ ok: false });
		expect(parseCaps({ per_order_cap_usd: 10, daily_cap_usd: 40 })).toEqual({ ok: true, perOrder: 10, daily: 40 });
		expect(parseCaps({})).toMatchObject({ ok: true, perOrder: 25, daily: 100 });
	});
});
