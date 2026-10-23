// POST /api/billing/agent-upgrade: the dispatcher authenticates, quotes, and only
// then delegates to a settle-then-handler paidEndpoint priced for that account.
// paidEndpoint itself is covered by its own suites; here it is replaced by a
// recorder so the price handed to it and the handler it is given are observable.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = { specs: [], receipts: [], keys: [] };

vi.mock('../api/_lib/x402-paid-endpoint.js', () => ({
	paidEndpoint: (spec) => {
		calls.specs.push(spec);
		return async (req, res) => {
			const out = await spec.handler({
				req,
				res,
				requirement: { payTo: 'PayToAddr', amount: spec.priceAtomics },
				payer: 'PayerAddr',
				settled: { transaction: 'SettledTxSig' },
			});
			return out;
		};
	},
}));

const auth = { bearer: null };
vi.mock('../api/_lib/auth.js', async (importActual) => ({
	...(await importActual()),
	extractBearer: () => 'sk_live_test',
	authenticateBearer: async () => auth.bearer,
}));

vi.mock('../api/_lib/rate-limit.js', async (importActual) => ({
	...(await importActual()),
	limits: { agentUpgradeKey: async () => ({ success: true }) },
}));

const sub = { plan: { id: 'free', rank: 0 }, periodStart: new Date(), periodEnd: new Date(Date.now() + 86_400_000) };
vi.mock('../api/_lib/dev-plans/subscription.js', () => ({ getDevSubscription: async () => sub }));

const quote = { amountUsd: 29 };
vi.mock('../api/_lib/dev-plans/billing.js', () => ({
	quoteDevPlanChange: (_sub, planId) => {
		if (planId === 'free') {
			throw Object.assign(new Error('the Free plan cannot be bought here'), { status: 400, code: 'not_purchasable' });
		}
		return { ...quote, plan: { id: planId } };
	},
	recordX402DevPlanPayment: async (args) => {
		calls.receipts.push(args);
		return { plan: args.planId, tx_signature: args.txSignature };
	},
}));

vi.mock('../api/_lib/api-keys.js', () => ({
	mintApiKey: async (args) => {
		calls.keys.push(args);
		return { row: { id: 'key-1', scope: args.scopes.join(' ') }, secret: 'sk_live_minted' };
	},
}));

const handler = (await import('../api/billing/agent-upgrade.js')).default;

function reqFor(plan) {
	return { method: 'POST', url: `/api/billing/agent-upgrade${plan ? `?plan=${plan}` : ''}`, query: plan ? { plan } : {}, headers: {} };
}
function resStub() {
	const res = { statusCode: 200, headers: {}, body: '', writableEnded: false };
	res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
	res.getHeader = (k) => res.headers[k.toLowerCase()];
	res.writeHead = (s, h = {}) => {
		res.statusCode = s;
		for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
	};
	res.end = (b = '') => {
		res.body += b;
		res.writableEnded = true;
	};
	return res;
}
const body = (res) => JSON.parse(res.body);

beforeEach(() => {
	calls.specs.length = 0;
	calls.receipts.length = 0;
	calls.keys.length = 0;
	auth.bearer = { userId: 'user-1', apiKeyId: 'apikey-1', scope: 'read agents:read agents:write wallet:read', source: 'apikey' };
	quote.amountUsd = 29;
});

describe('agent-upgrade dispatcher', () => {
	it('answers 401 with a Bearer challenge before any payment challenge', async () => {
		auth.bearer = null;
		const res = resStub();
		await handler(reqFor('builder'), res);
		expect(res.statusCode).toBe(401);
		expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
		expect(calls.specs).toHaveLength(0);
	});

	it('refuses a key without agents:write', async () => {
		auth.bearer = { ...auth.bearer, scope: 'read' };
		const res = resStub();
		await handler(reqFor('builder'), res);
		expect(res.statusCode).toBe(403);
		expect(calls.specs).toHaveLength(0);
	});

	it('rejects a plan that is not self-serve', async () => {
		for (const plan of ['free', 'enterprise', 'nope', undefined]) {
			const res = resStub();
			await handler(reqFor(plan), res);
			expect(res.statusCode).toBe(400);
			expect(body(res).error).toBe('validation_error');
		}
		expect(calls.specs).toHaveLength(0);
	});

	it('prices the paid endpoint at the account quote in USDC atomics, Solana only, no $THREE', async () => {
		await handler(reqFor('builder'), resStub());
		const spec = calls.specs.at(-1);
		expect(spec.priceAtomics).toBe('29000000');
		expect(spec.networks).toEqual(['solana']);
		expect(spec.acceptThree).toBe(false);
		expect(spec.streaming).toBe(true);
	});

	it('re-prices for a pro-rata quote', async () => {
		quote.amountUsd = 12.5;
		await handler(reqFor('scale'), resStub());
		expect(calls.specs.at(-1).priceAtomics).toBe('12500000');
	});

	it('reuses one paid endpoint per (plan, price)', async () => {
		await handler(reqFor('builder'), resStub());
		const before = calls.specs.length;
		await handler(reqFor('builder'), resStub());
		expect(calls.specs.length).toBe(before);
	});

	it('refuses to charge nothing', async () => {
		quote.amountUsd = 0;
		const res = resStub();
		await handler(reqFor('builder'), res);
		expect(res.statusCode).toBe(400);
		expect(body(res).error).toBe('nothing_to_pay');
	});
});

describe('agent-upgrade settled handler', () => {
	it('grants the plan against the settled signature and returns a scoped key that cannot spend', async () => {
		const res = resStub();
		await handler(reqFor('builder'), res);
		expect(res.statusCode).toBe(200);
		const out = body(res);
		expect(out.plan).toBe('builder');
		expect(out.receipt.tx_signature).toBe('SettledTxSig');
		expect(out.credentials.api_key).toBe('sk_live_minted');
		expect(calls.receipts[0]).toMatchObject({ userId: 'user-1', planId: 'builder', payer: 'PayerAddr', txSignature: 'SettledTxSig', payTo: 'PayToAddr' });
		const scopes = calls.keys[0].scopes;
		for (const forbidden of ['spend', 'wallet:write', 'wallet:trade', 'wallet:launch']) expect(scopes).not.toContain(forbidden);
		expect(scopes).toContain('agents:write');
	});
});
