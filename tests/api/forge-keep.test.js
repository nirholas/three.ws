import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { signTierPass } from '../../api/_lib/three-tier.js';

const CREATION = '11111111-1111-4111-8111-111111111111';
let creation = { id: CREATION, tier: 'standard', glb_url: 'https://cdn.example/forge/a.glb', status: 'done' };
let kept = false;

vi.mock('../../api/_lib/forge-keep.js', () => ({
	loadKeepableCreation: vi.fn(async (id) => (id === CREATION ? creation : null)),
	isCreationKept: vi.fn(async () => kept),
}));
const assertForgePurchase = vi.fn(async () => ({ payment: { settledAt: new Date().toISOString() } }));
const redeemForgePurchase = vi.fn(async () => ({ redeemed: true }));
vi.mock('../../api/_lib/forge-consumption-payment.js', () => ({
	assertForgePurchase: (...a) => assertForgePurchase(...a),
	redeemForgePurchase: (...a) => redeemForgePurchase(...a),
}));

process.env.NODE_ENV = 'development';
delete process.env.HOLDER_PASS_SECRET;
const BRONZE = signTierPass({ wallet: 'THREEsynthetic1111111111111111111111111111', level: 1, tierId: 'bronze', usd: 30 });

const { default: handler } = await import('../../api/forge-keep.js');

async function call({ method = 'POST', body = null, query = '', pass = null } = {}) {
	const payload = body ? JSON.stringify(body) : '';
	const stream = Readable.from(payload ? [Buffer.from(payload)] : []);
	stream.method = method;
	stream.url = `/api/forge-keep${query}`;
	stream.headers = {
		'content-type': 'application/json',
		'x-forwarded-for': '203.0.113.70',
		...(pass ? { 'x-three-tier-pass': pass } : {}),
	};
	const res = {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(n, v) {
			this.headers[String(n).toLowerCase()] = v;
		},
		end(b) {
			this.body = b ?? null;
		},
	};
	await handler(stream, res);
	return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

beforeEach(() => {
	creation = { id: CREATION, tier: 'standard', glb_url: 'https://cdn.example/forge/a.glb', status: 'done' };
	kept = false;
	assertForgePurchase.mockClear();
	redeemForgePurchase.mockClear();
	delete process.env.FORGE_PAY_TO_KEEP;
});

describe('/api/forge-keep with the flag off (default)', () => {
	it('releases every generation and asks for nothing', async () => {
		const r = await call({ body: { creation_id: CREATION } });
		expect(r.status).toBe(200);
		expect(r.json).toMatchObject({ enabled: false, kept: true, reason: 'pay_to_keep_off', download_url: creation.glb_url });
		const g = await call({ method: 'GET', query: `?creation_id=${CREATION}` });
		expect(g.json.kept).toBe(true);
		expect(assertForgePurchase).not.toHaveBeenCalled();
	});
});

describe('/api/forge-keep with FORGE_PAY_TO_KEEP=on', () => {
	beforeEach(() => {
		process.env.FORGE_PAY_TO_KEEP = 'on';
	});

	it('validates the creation id and 404s unknown creations', async () => {
		expect((await call({ body: { creation_id: 'nope' } })).json.error).toBe('invalid_creation');
		const missing = await call({ body: { creation_id: '22222222-2222-4222-8222-222222222222' } });
		expect(missing.status).toBe(404);
	});

	it('402s a non-holder with the tier price and withholds the file', async () => {
		const r = await call({ body: { creation_id: CREATION } });
		expect(r.status).toBe(402);
		expect(r.json.error).toBe('three_hold_required');
		expect(r.json.pay_per_use).toEqual({ action: 'forge.keep.standard', usd: 0.15 });
		expect(r.json.download_url).toBeUndefined();
		const g = await call({ method: 'GET', query: `?creation_id=${CREATION}` });
		expect(g.json).toMatchObject({ kept: false, reason: 'payment_required' });
		expect(g.json.download_url).toBeUndefined();
	});

	it('releases the file to a holder without a payment', async () => {
		const r = await call({ body: { creation_id: CREATION }, pass: BRONZE });
		expect(r.status).toBe(200);
		expect(r.json).toMatchObject({ kept: true, reason: 'holder', download_url: creation.glb_url });
	});

	it('redeems a settled payment against the creation exactly once', async () => {
		const body = { creation_id: CREATION, payment_id: '33333333-3333-4333-8333-333333333333', ref_id: 'forge-keep-x' };
		const r = await call({ body });
		expect(r.json).toMatchObject({ kept: true, reason: 'paid' });
		expect(assertForgePurchase).toHaveBeenCalledWith(expect.objectContaining({ action: 'forge.keep.standard' }));
		expect(redeemForgePurchase).toHaveBeenCalledWith(expect.objectContaining({ jobId: CREATION, action: 'forge.keep.standard' }));
		redeemForgePurchase.mockResolvedValueOnce({ redeemed: false });
		const again = await call({ body });
		expect(again.status).toBe(409);
		expect(again.json.error).toBe('payment_already_used');
	});

	it('echoes a rejected payment as a recoverable 402', async () => {
		assertForgePurchase.mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 402, code: 'payment_invalid' }));
		const r = await call({ body: { creation_id: CREATION, payment_id: '33333333-3333-4333-8333-333333333333', ref_id: 'r' } });
		expect(r.status).toBe(402);
		expect(r.json.error).toBe('payment_invalid');
		expect(r.json.pay_per_use.usd).toBe(0.15);
	});

	it('treats an already-paid creation and a High generation as kept', async () => {
		kept = true;
		expect((await call({ body: { creation_id: CREATION } })).json.reason).toBe('paid');
		kept = false;
		creation = { ...creation, tier: 'high' };
		expect((await call({ body: { creation_id: CREATION } })).json.reason).toBe('included');
	});
});
