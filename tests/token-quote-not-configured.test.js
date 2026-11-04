// POST /api/token/quote answers 503 treasury_unavailable / rewards_unavailable
// when production has no THREE_TREASURY_WALLET / THREE_REWARDS_WALLET set (the
// production state on 2026-11-04), and quote_signing_unavailable when
// THREE_QUOTE_SECRET is unset. Each is a deploy-time configuration gap, not
// an outage: retrying in 15 seconds can never succeed. The route used to call it
// "briefly unavailable. Try again shortly." with a retry-after header, so the
// Forge pay sheet sent holders round a retry loop that could not end. The
// response now says the rail is not switched on yet and carries no retry hint,
// while genuinely transient codes (price feed, RPC) keep their back-off.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const price = vi.hoisted(() => ({ fail: null }));

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getSessionUser: async () => ({ id: 'user-quote-test' }),
}));

vi.mock('../api/_lib/rate-limit.js', async (orig) => {
	const real = await orig();
	return {
		...real,
		limits: new Proxy(real.limits, {
			get: (t, k) => (k === 'tokenQuote' ? async () => ({ success: true }) : t[k]),
		}),
	};
});

// The live price read is the network boundary; everything after it (split
// resolution, the treasury/rewards guards, the HTTP mapping) runs for real.
vi.mock('../api/_lib/token/price.js', async (orig) => ({
	...(await orig()),
	quoteTokenForUsd: async (usd) => {
		if (price.fail) throw price.fail;
		return { usd, priceUsd: 0.0005, source: 'test', atomics: 2_000_000_000n };
	},
}));

const { default: handler } = await import('../api/token/[action].js');

const saved = {
	NODE_ENV: process.env.NODE_ENV,
	THREE_TREASURY_WALLET: process.env.THREE_TREASURY_WALLET,
	THREE_REWARDS_WALLET: process.env.THREE_REWARDS_WALLET,
	THREE_QUOTE_SECRET: process.env.THREE_QUOTE_SECRET,
};

afterAll(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null, headersSent: false };
	r.setHeader = (k, v) => {
		r._h[k.toLowerCase()] = v;
	};
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => {
		r._b = b;
		r.headersSent = true;
	};
	return r;
}

async function quote(body = { purpose: 'consumption', usd: 1 }) {
	const raw = Buffer.from(JSON.stringify(body));
	const res = makeRes();
	await handler(
		{
			method: 'POST',
			url: '/api/token/quote',
			query: { action: 'quote' },
			headers: { origin: 'https://three.ws', 'content-type': 'application/json' },
			rawBody: raw,
			body,
			socket: { remoteAddress: '127.0.0.1' },
		},
		res,
	);
	return { status: res.statusCode, headers: res._h, body: JSON.parse(res._b) };
}

describe('POST /api/token/quote when the $THREE rail is not configured', () => {
	beforeEach(() => {
		price.fail = null;
		process.env.NODE_ENV = 'production';
		process.env.THREE_TREASURY_WALLET = 'THREEsynthetic1111111111111111111111111111';
		process.env.THREE_REWARDS_WALLET = 'THREEsynthetic2222222222222222222222222222';
		process.env.THREE_QUOTE_SECRET = 'quote-secret-for-tests-only-0123456789abcdef';
	});

	it('says the rail is not switched on yet, with no retry hint, when the treasury is unset', async () => {
		delete process.env.THREE_TREASURY_WALLET;
		const { status, headers, body } = await quote();
		expect(status).toBe(503);
		expect(body.error).toBe('treasury_unavailable');
		expect(body.error_description).toMatch(/not switched on yet/i);
		expect(body.error_description).toMatch(/nothing was charged/i);
		expect(body.error_description).not.toMatch(/briefly|try again/i);
		expect(headers['retry-after']).toBeUndefined();
		expect(body.retry_after).toBeUndefined();
	});

	it('says the same when only the holder-rewards wallet is unset', async () => {
		delete process.env.THREE_REWARDS_WALLET;
		const { status, headers, body } = await quote();
		expect(status).toBe(503);
		expect(body.error).toBe('rewards_unavailable');
		expect(body.error_description).toMatch(/not switched on yet/i);
		expect(headers['retry-after']).toBeUndefined();
	});

	it('says the same when the quote signing secret is unset', async () => {
		delete process.env.THREE_QUOTE_SECRET;
		const { status, headers, body } = await quote();
		expect(status).toBe(503);
		expect(body.error).toBe('quote_signing_unavailable');
		expect(body.error_description).toMatch(/not switched on yet/i);
		expect(headers['retry-after']).toBeUndefined();
	});

	it('keeps the retry back-off for a transient price feed outage', async () => {
		price.fail = Object.assign(new Error('price feed down'), { code: 'price_unavailable', status: 503 });
		const { status, headers, body } = await quote();
		expect(status).toBe(503);
		expect(body.error).toBe('price_unavailable');
		expect(headers['retry-after']).toBe('15');
		expect(body.retry_after).toBe(15);
	});

	it('issues a quote once both wallets are configured', async () => {
		const { status, body } = await quote();
		expect(status).toBe(201);
		expect(body.legs.map((l) => l.role)).toEqual(['treasury', 'rewards']);
	});
});
