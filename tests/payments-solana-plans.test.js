// GET /api/payments/solana/plans is what /pricing reads to decide which
// payment assets it offers. It advertised USDC, SOL and $THREE (and a 20% $THREE
// discount) unconditionally, while POST /api/payments/solana/checkout answers
// 503 not_configured whenever PAYMENT_RECIPIENT_SOLANA is unset, which is the
// production state on 2026-11-04. Buyers picked an asset, pressed Continue and
// got "checkout failed". The plans response now carries checkout_ready per
// asset, computed from the same recipient lookup checkout uses, so the page can
// only offer what checkout will actually accept.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import handler from '../api/payments/solana/[action].js';

const RECIPIENT = 'THREEsynthetic1111111111111111111111111111';
const prior = process.env.PAYMENT_RECIPIENT_SOLANA;

afterAll(() => {
	if (prior === undefined) delete process.env.PAYMENT_RECIPIENT_SOLANA;
	else process.env.PAYMENT_RECIPIENT_SOLANA = prior;
});

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => {
		r._h[k.toLowerCase()] = v;
	};
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => {
		r._b = b;
	};
	return r;
}

async function getPlans() {
	const res = makeRes();
	await handler(
		{
			method: 'GET',
			url: '/api/payments/solana/plans',
			query: { action: 'plans' },
			headers: { origin: 'https://three.ws' },
			socket: { remoteAddress: '127.0.0.1' },
		},
		res,
	);
	return { status: res.statusCode, body: JSON.parse(res._b) };
}

describe('GET /api/payments/solana/plans checkout readiness', () => {
	beforeEach(() => {
		delete process.env.PAYMENT_RECIPIENT_SOLANA;
	});

	it('reports every asset as not ready when no Solana recipient is configured', async () => {
		const { status, body } = await getPlans();
		expect(status).toBe(200);
		expect(body.checkout_ready).toEqual({ USDC: false, SOL: false, THREE: false });
		expect(body.assets).toEqual(['USDC', 'SOL', 'THREE']);
	});

	it('reports every asset as ready once the recipient is set', async () => {
		process.env.PAYMENT_RECIPIENT_SOLANA = RECIPIENT;
		const { status, body } = await getPlans();
		expect(status).toBe(200);
		expect(body.checkout_ready).toEqual({ USDC: true, SOL: true, THREE: true });
		expect(body.three_mint).toBe('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
	});

	it('keys checkout_ready by exactly the advertised assets', async () => {
		const { body } = await getPlans();
		expect(Object.keys(body.checkout_ready).sort()).toEqual([...body.assets].sort());
	});
});
