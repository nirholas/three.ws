// The real-funds agreement gate on the inference money paths.
//
// Three requests send mainnet USDC out of an agent's custodial wallet into
// inference credits:
//   POST /api/agents/:id/credits/topup        (api/agents/_id/credits.js)
//   PUT  /api/agents/:id/credits/auto-fund    arms an autonomous top-up rule
//   POST /api/me/inference/provision          (api/inference/[action].js)
// Each must refuse an account that has not signed the current real-funds
// agreements before anything moves and before the single-use CSRF token is
// spent. The previews and switching the rule off move nothing and stay open.
//
// The gate itself is the real requireRealFundsAgreement; only the database
// rows behind it, the session, and the money modules are doubles, so the
// assertions read what the handler actually decides.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://app.test';

const USER_ID = 'ab2aabd2-39f7-493b-8191-c9f174af62ab';
const AGENT_ID = '5e05f68f-eead-4ef9-b6b4-fc85ea73bbe9';

const state = { signed: false };

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		const query = strings.join('?');
		if (query.includes('legal_signatures')) {
			return state.signed ? [{ created_at: new Date(), signature_name: 'Ada', context: 'inference-topup' }] : [];
		}
		if (query.includes('agent_identities')) {
			return [{ id: AGENT_ID, user_id: USER_ID, name: 'Topup Agent', meta: {} }];
		}
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => ({ id: USER_ID }),
	authenticateBearer: async () => null,
	extractBearer: () => null,
	hasScope: () => true,
}));

vi.mock('../../api/_lib/http.js', async () => {
	const actual = await vi.importActual('../../api/_lib/http.js');
	return { ...actual, wrap: (fn) => fn, readJson: async (req) => JSON.parse(req._rawBody || '{}') };
});

vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { authIp: async () => ({ success: true }), authedReadIp: async () => ({ success: true }) },
	clientIp: () => '1.2.3.4',
}));

vi.mock('../../api/_lib/inference-billing.js', () => ({
	inferenceUsage: async () => ({}),
	autoFundIntent: vi.fn(async () => null),
}));

vi.mock('../../api/_lib/inference-topup.js', () => ({
	previewTopup: vi.fn(async () => ({ preview_id: 'p1', amount_usdc: 5 })),
	executeTopup: vi.fn(async () => ({ status: 'settled' })),
	reconcilePendingTopups: vi.fn(async () => {}),
}));

vi.mock('../../api/_lib/wallet-intents.js', () => ({
	normalizeIntent: () => ({ ok: true, intent: {} }),
	createIntent: vi.fn(async () => ({})),
	updateIntent: vi.fn(async () => ({})),
	describeIntent: () => 'Top up 5 USDC when credits fall below 1 USD',
}));

vi.mock('../../api/_lib/inference-provision.js', () => ({
	previewProvision: vi.fn(async () => ({ preview_id: 'p2' })),
	executeProvision: vi.fn(async () => ({ status: 201, body: { key: 'sk_test' } })),
	INFERENCE_BASE_URL: 'https://three.ws/api/inference/v1',
}));

const { handleCredits } = await import('../../api/agents/_id/credits.js');
const inferenceHandler = (await import('../../api/inference/[action].js')).default;
const { requireCsrf } = await import('../../api/_lib/csrf.js');
const { previewTopup, executeTopup } = await import('../../api/_lib/inference-topup.js');
const { createIntent } = await import('../../api/_lib/wallet-intents.js');
const { previewProvision, executeProvision } = await import('../../api/_lib/inference-provision.js');
const { resetRealFundsAgreementCache } = await import('../../api/_lib/real-funds-agreement.js');

function makeReq(httpMethod, body, query = {}) {
	return { method: httpMethod, headers: { host: 'three.ws' }, query, _rawBody: JSON.stringify(body), on() {} };
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(chunk) {
			if (chunk !== undefined) this.body += chunk;
			this.writableEnded = true;
		},
	};
}

const bodyOf = (res) => JSON.parse(res.body);

beforeEach(() => {
	state.signed = false;
	resetRealFundsAgreementCache();
	vi.clearAllMocks();
});

describe('POST /api/agents/:id/credits/topup', () => {
	it('refuses an unsigned account before any USDC moves or the CSRF token is spent', async () => {
		const res = makeRes();
		await handleCredits(makeReq('POST', { preview_id: 'p1', confirm_deposit: true }), res, AGENT_ID, 'topup', undefined);
		expect(res.statusCode).toBe(403);
		expect(bodyOf(res).error).toBe('risk_ack_required');
		expect(bodyOf(res).context).toBe('inference-topup');
		expect(executeTopup).not.toHaveBeenCalled();
		expect(requireCsrf).not.toHaveBeenCalled();
	});

	it('settles the top-up once the account has signed', async () => {
		state.signed = true;
		const res = makeRes();
		await handleCredits(makeReq('POST', { preview_id: 'p1', confirm_deposit: true }), res, AGENT_ID, 'topup', undefined);
		expect(res.statusCode).toBe(200);
		expect(executeTopup).toHaveBeenCalledOnce();
	});

	it('still quotes a preview for an unsigned account, since nothing moves', async () => {
		const res = makeRes();
		await handleCredits(makeReq('POST', { amount_usdc: 5 }), res, AGENT_ID, 'topup', 'preview');
		expect(res.statusCode).toBe(200);
		expect(previewTopup).toHaveBeenCalledOnce();
		expect(executeTopup).not.toHaveBeenCalled();
	});
});

describe('PUT /api/agents/:id/credits/auto-fund', () => {
	it('refuses to arm an autonomous top-up rule for an unsigned account', async () => {
		const res = makeRes();
		await handleCredits(makeReq('PUT', { enabled: true, threshold_usd: 1, amount_usdc: 5 }), res, AGENT_ID, 'auto-fund');
		expect(res.statusCode).toBe(403);
		expect(bodyOf(res).error).toBe('risk_ack_required');
		expect(bodyOf(res).context).toBe('inference-auto-fund');
		expect(createIntent).not.toHaveBeenCalled();
		expect(requireCsrf).not.toHaveBeenCalled();
	});

	it('arms the rule once the account has signed', async () => {
		state.signed = true;
		const res = makeRes();
		await handleCredits(makeReq('PUT', { enabled: true, threshold_usd: 1, amount_usdc: 5 }), res, AGENT_ID, 'auto-fund');
		expect(res.statusCode).toBe(200);
		expect(createIntent).toHaveBeenCalledOnce();
	});

	it('lets an unsigned account switch the rule off, since that never spends', async () => {
		const res = makeRes();
		await handleCredits(makeReq('PUT', { enabled: false }), res, AGENT_ID, 'auto-fund');
		expect(res.statusCode).toBe(200);
		expect(bodyOf(res).auto_fund).toBeNull();
	});
});

describe('POST /api/me/inference/provision', () => {
	it('refuses an unsigned account before the funding top-up runs', async () => {
		const res = makeRes();
		await inferenceHandler(makeReq('POST', { preview_id: 'p2', confirm_deposit: true }, { action: 'provision' }), res);
		expect(res.statusCode).toBe(403);
		expect(bodyOf(res).error).toBe('risk_ack_required');
		expect(bodyOf(res).context).toBe('inference-provision');
		expect(executeProvision).not.toHaveBeenCalled();
		expect(requireCsrf).not.toHaveBeenCalled();
	});

	it('provisions once the account has signed', async () => {
		state.signed = true;
		const res = makeRes();
		await inferenceHandler(makeReq('POST', { preview_id: 'p2', confirm_deposit: true }, { action: 'provision' }), res);
		expect(res.statusCode).toBe(201);
		expect(executeProvision).toHaveBeenCalledOnce();
	});

	it('still previews for an unsigned account, since nothing moves', async () => {
		const res = makeRes();
		await inferenceHandler(makeReq('POST', { agent_id: AGENT_ID, amount_usdc: 5 }, { action: 'provision-preview' }), res);
		expect(res.statusCode).toBe(200);
		expect(previewProvision).toHaveBeenCalledOnce();
	});
});
