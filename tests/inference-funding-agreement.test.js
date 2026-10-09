// The two routes that send USDC out of an agent wallet to fund inference must
// refuse an account that has not signed the real-funds agreements, and must do
// so before the CSRF check (a refusal must not burn the owner's single-use
// token) and before any money path runs. Previews and switching a rule off move
// nothing, so they stay open.
//
//   POST /api/agents/:id/credits/topup        api/agents/_id/credits.js
//   PUT  /api/agents/:id/credits/auto-fund    api/agents/_id/credits.js
//   POST /api/me/inference/provision          api/inference/[action].js
//
// The agreement record itself is covered by tests/real-funds-agreement.test.js;
// here it is a switch, and every money helper is a spy that must stay unused.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER = 'user-funding-1';
const AGENT = '00000000-0000-4000-8000-0000000000a1';

const state = { signed: true };
const requireRealFundsAgreement = vi.fn(async (_req, res) => {
	if (state.signed) return true;
	res.statusCode = 403;
	res.end(JSON.stringify({ error: 'risk_ack_required' }));
	return false;
});
vi.mock('../api/_lib/real-funds-agreement.js', () => ({
	requireRealFundsAgreement: (...a) => requireRealFundsAgreement(...a),
}));

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => ({ id: USER })),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
	hasScope: vi.fn(() => true),
}));

const requireCsrf = vi.fn(async () => true);
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: (...a) => requireCsrf(...a) }));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '127.0.0.1',
}));

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => [{ id: AGENT, user_id: USER, name: 'Funder', meta: {} }]),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const money = {
	previewTopup: vi.fn(async () => ({ preview_id: 'pv-1' })),
	executeTopup: vi.fn(async () => ({ status: 'settled' })),
	reconcilePendingTopups: vi.fn(async () => {}),
	previewProvision: vi.fn(async () => ({ preview_id: 'pv-2' })),
	executeProvision: vi.fn(async () => ({ status: 201, body: { ok: true } })),
	createIntent: vi.fn(async () => {}),
	updateIntent: vi.fn(async () => {}),
};
vi.mock('../api/_lib/inference-topup.js', () => ({
	previewTopup: (...a) => money.previewTopup(...a),
	executeTopup: (...a) => money.executeTopup(...a),
	reconcilePendingTopups: (...a) => money.reconcilePendingTopups(...a),
}));
vi.mock('../api/_lib/inference-provision.js', () => ({
	previewProvision: (...a) => money.previewProvision(...a),
	executeProvision: (...a) => money.executeProvision(...a),
	INFERENCE_BASE_URL: 'https://three.ws/api/v1',
}));
vi.mock('../api/_lib/inference-billing.js', () => ({
	inferenceUsage: vi.fn(async () => ({})),
	autoFundIntent: vi.fn(async () => null),
}));
vi.mock('../api/_lib/wallet-intents.js', () => ({
	normalizeIntent: vi.fn((intent) => ({ ok: true, intent })),
	createIntent: (...a) => money.createIntent(...a),
	updateIntent: (...a) => money.updateIntent(...a),
	describeIntent: vi.fn(() => 'Keep the agent thinking'),
}));

const { handleCredits } = await import('../api/agents/_id/credits.js');
const { default: inferenceHandler } = await import('../api/inference/[action].js');

function makeReq(httpMethod, body, query = {}) {
	return {
		method: httpMethod,
		url: '/api/test',
		query,
		headers: { 'content-type': 'application/json', origin: 'https://three.ws' },
		body,
	};
}
function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b;
			this.writableEnded = true;
		},
	};
}
const parse = (res) => (res.body ? JSON.parse(res.body) : undefined);

beforeEach(() => {
	state.signed = true;
	requireRealFundsAgreement.mockClear();
	requireCsrf.mockClear();
	for (const fn of Object.values(money)) fn.mockClear();
});

describe('agent credits top-up', () => {
	it('refuses an unsigned account before CSRF and before any USDC moves', async () => {
		state.signed = false;
		const res = makeRes();
		await handleCredits(makeReq('POST', { preview_id: 'pv-1', confirm_deposit: true }), res, AGENT, 'topup');
		expect(res.statusCode).toBe(403);
		expect(parse(res).error).toBe('risk_ack_required');
		expect(requireCsrf).not.toHaveBeenCalled();
		expect(money.executeTopup).not.toHaveBeenCalled();
	});

	it('settles for a signed account', async () => {
		const res = makeRes();
		await handleCredits(makeReq('POST', { preview_id: 'pv-1', confirm_deposit: true }), res, AGENT, 'topup');
		expect(res.statusCode).toBe(200);
		expect(requireRealFundsAgreement.mock.calls[0][2]).toMatchObject({ userId: USER, context: 'inference-topup' });
		expect(money.executeTopup).toHaveBeenCalledTimes(1);
	});

	it('leaves the preview open to an unsigned account, since nothing moves', async () => {
		state.signed = false;
		const res = makeRes();
		await handleCredits(makeReq('POST', { amount_usdc: 5 }), res, AGENT, 'topup', 'preview');
		expect(res.statusCode).toBe(200);
		expect(requireRealFundsAgreement).not.toHaveBeenCalled();
		expect(money.previewTopup).toHaveBeenCalledTimes(1);
		expect(money.executeTopup).not.toHaveBeenCalled();
	});
});

describe('agent credits auto-fund rule', () => {
	it('refuses to arm the rule for an unsigned account', async () => {
		state.signed = false;
		const res = makeRes();
		await handleCredits(makeReq('PUT', { enabled: true, threshold_usd: 2, amount_usdc: 5 }), res, AGENT, 'auto-fund');
		expect(res.statusCode).toBe(403);
		expect(requireCsrf).not.toHaveBeenCalled();
		expect(money.createIntent).not.toHaveBeenCalled();
		expect(money.updateIntent).not.toHaveBeenCalled();
	});

	it('arms the rule for a signed account', async () => {
		const res = makeRes();
		await handleCredits(makeReq('PUT', { enabled: true, threshold_usd: 2, amount_usdc: 5 }), res, AGENT, 'auto-fund');
		expect(res.statusCode).toBe(200);
		expect(requireRealFundsAgreement.mock.calls[0][2]).toMatchObject({ context: 'inference-auto-fund' });
		expect(money.createIntent).toHaveBeenCalledTimes(1);
	});

	it('lets an unsigned account switch the rule off, which never spends', async () => {
		state.signed = false;
		const res = makeRes();
		await handleCredits(makeReq('PUT', { enabled: false }), res, AGENT, 'auto-fund');
		expect(res.statusCode).toBe(200);
		expect(parse(res)).toEqual({ auto_fund: null });
		expect(requireRealFundsAgreement).not.toHaveBeenCalled();
	});
});

describe('inference key provisioning', () => {
	it('refuses an unsigned account before CSRF and before any USDC moves', async () => {
		state.signed = false;
		const res = makeRes();
		await inferenceHandler(makeReq('POST', { preview_id: 'pv-2', confirm_deposit: true }, { action: 'provision' }), res);
		expect(res.statusCode).toBe(403);
		expect(requireCsrf).not.toHaveBeenCalled();
		expect(money.executeProvision).not.toHaveBeenCalled();
	});

	it('provisions for a signed account', async () => {
		const res = makeRes();
		await inferenceHandler(makeReq('POST', { preview_id: 'pv-2', confirm_deposit: true }, { action: 'provision' }), res);
		expect(res.statusCode).toBe(201);
		expect(requireRealFundsAgreement.mock.calls[0][2]).toMatchObject({ userId: USER, context: 'inference-provision' });
		expect(money.executeProvision).toHaveBeenCalledTimes(1);
	});

	it('leaves the provisioning preview open to an unsigned account', async () => {
		state.signed = false;
		const res = makeRes();
		await inferenceHandler(makeReq('POST', { agent_id: AGENT, amount_usdc: 5 }, { action: 'provision-preview' }), res);
		expect(res.statusCode).toBe(200);
		expect(requireRealFundsAgreement).not.toHaveBeenCalled();
		expect(money.previewProvision).toHaveBeenCalledTimes(1);
	});
});
