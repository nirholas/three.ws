// POST /api/agents/a2a-hire - the handler itself.
//
// The hire visualizer's pure phase/cap helpers had tests (a2a-hire-phases,
// a2a-hire-visualizer) but the endpoint that calls them had none, so a shadowed
// binding went unnoticed: a `const limits = getSpendLimits(...)` declared in the
// handler body shadowed the `limits` rate-limiter imported at module scope, which
// put the earlier `await limits.mcpAgentPay(...)` in a temporal dead zone. Every
// authenticated hire 500'd with "Cannot access 'limits' before initialization":
// the whole agent-to-agent hire path was dead, while unauthenticated probes
// (which return 401 before that line) looked perfectly healthy.
//
// These tests walk the handler past that line on every entry path, so any future
// shadowing or reordering fails here instead of in production.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitCalls = [];

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => ({ id: 'owner-1' })),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));

vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		mcpAgentPay: vi.fn(async (key) => {
			rateLimitCalls.push(key);
			return { success: true };
		}),
	},
	clientIp: () => '127.0.0.1',
}));

const dbState = { hirer: null, approval: null };
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		const q = (typeof strings === 'string' ? strings : strings.join('?')).toLowerCase();
		if (/from agent_identities/.test(q)) return dbState.hirer ? [dbState.hirer] : [];
		if (/from approval_requests/.test(q)) return dbState.approval ? [dbState.approval] : [];
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const offerState = { offer: null };
vi.mock('../api/_lib/agent-economy.js', () => ({
	atomicsToUsdc: (a) => Number(a) / 1e6,
	getOfferBySlug: vi.fn(async () => offerState.offer),
	getHireById: vi.fn(async () => null),
	recordHire: vi.fn(async () => ({ row: { id: 'hire-1', status: 'pending' }, existing: false })),
	updateHire: vi.fn(async () => ({ id: 'hire-1', status: 'failed' })),
}));

vi.mock('../api/_lib/real-funds-agreement.js', () => ({
	requireRealFundsAgreement: vi.fn(async () => true),
}));

vi.mock('../api/_lib/approvals.js', () => ({
	createApprovalRequest: vi.fn(async () => ({
		request: { id: 'appr-1', status: 'pending', summary: 'test approval', expires_at: '2026-10-16T00:00:00.000Z' },
		created: true,
		autoApproved: false,
		policy: null,
	})),
	runApproved: vi.fn(async () => ({ request: null, outcome: null })),
	TTL_MS: { transfer: 6 * 60 * 60 * 1000 },
}));

// Spend policy, screen frames, and the payment rails: the hire never reaches the
// settlement leg in these tests, but every import still has to resolve.
vi.mock('../api/_lib/agent-trade-guards.js', () => ({
	SpendLimitError: class SpendLimitError extends Error {},
	reserveSpendUsd: vi.fn(async () => ({ reservationId: 'res-1', dailySpentUsd: 0 })),
	releaseSpendReservation: vi.fn(async () => {}),
	updateCustodyEvent: vi.fn(async () => {}),
	recordCustodyEvent: vi.fn(async () => {}),
	getSpendLimits: vi.fn(() => ({ per_tx_usd: 5, daily_usd: 25, approval_threshold_usd: null })),
}));

vi.mock('../api/_lib/agent-screen-frame.js', () => ({ writeScreenFrame: vi.fn(async () => {}) }));
vi.mock('../api/_lib/x402-user-payer.js', () => ({
	payExternalX402: vi.fn(async () => { throw Object.assign(new Error('not reached'), { code: 'payment_failed' }); }),
	resolveSpendEnabled: vi.fn(() => true),
}));
vi.mock('../api/_lib/agent-paid-services.js', () => ({ serviceResourceUrl: (slug) => `https://three.ws/api/x402/service/${slug}` }));
vi.mock('../api/_lib/agent-wallet.js', () => ({ recoverSolanaAgentKeypair: vi.fn(async () => ({})) }));
vi.mock('../api/_lib/agent-invocation-onchain.js', () => ({ recordInvocationReceipt: vi.fn(async () => ({ signature: 'sig' })) }));

const { default: handler } = await import('../api/agents/a2a-hire.js');

const HIRER_ID = '22222222-2222-4222-8222-222222222222';
const WALLET = 'So11111111111111111111111111111111111111112';

function makeReq(body) {
	return {
		method: 'POST',
		url: '/api/agents/a2a-hire',
		headers: { 'content-type': 'application/json', origin: 'https://three.ws', 'x-csrf-token': 't' },
		body,
	};
}

function makeRes() {
	return {
		statusCode: 0,
		payload: null,
		headers: {},
		setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this.headers[String(k).toLowerCase()]; },
		removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
		writeHead(code) { this.statusCode = code; return this; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		end(chunk) {
			if (chunk) { try { this.payload = JSON.parse(String(chunk)); } catch { this.payload = String(chunk); } }
			return this;
		},
	};
}

async function post(body) {
	const res = makeRes();
	await handler(makeReq(body), res);
	return res;
}

function ownedHirer() {
	return { id: HIRER_ID, user_id: 'owner-1', name: 'Mine', meta: { solana_address: WALLET, encrypted_solana_secret: 'ENC' } };
}

beforeEach(() => {
	rateLimitCalls.length = 0;
	dbState.hirer = null;
	dbState.approval = null;
	offerState.offer = null;
	vi.clearAllMocks();
});

describe('POST /api/agents/a2a-hire', () => {
	it('rate-limits the authenticated caller instead of crashing on a shadowed binding', async () => {
		const res = await post({});
		expect(res.statusCode).toBe(400);
		expect(res.payload.error).toBe('validation_error');
		// The temporal-dead-zone crash happened on this exact call. A 500 here, or an
		// empty list, means the shadowing is back.
		expect(rateLimitCalls).toEqual(['owner-1']);
	});

	it('requires a serviceSlug', async () => {
		const res = await post({ hirerAgentId: HIRER_ID });
		expect(res.statusCode).toBe(400);
		expect(res.payload.error_description).toMatch(/serviceSlug/);
	});

	it('404s when the hiring agent does not exist', async () => {
		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'inspect-glb' });
		expect(res.statusCode).toBe(404);
		expect(res.payload.error).toBe('not_found');
	});

	it('403s when the caller does not own the hiring agent', async () => {
		dbState.hirer = { id: HIRER_ID, user_id: 'someone-else', name: 'Theirs', meta: {} };
		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'inspect-glb' });
		expect(res.statusCode).toBe(403);
		expect(res.payload.error).toBe('forbidden');
	});

	it('409s when the hiring agent has no wallet to pay from', async () => {
		dbState.hirer = { id: HIRER_ID, user_id: 'owner-1', name: 'Mine', meta: {} };
		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'inspect-glb' });
		expect(res.statusCode).toBe(409);
		expect(res.payload.error).toBe('no_wallet');
	});

	// Past the spend-policy read at the top of the wallet-bearing path: that read is
	// the statement that shadowed the rate limiter, so it has to be exercised too.
	it('reads the agent spend policy and reports an unknown offer as 404', async () => {
		dbState.hirer = ownedHirer();
		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'no-such-offer' });
		expect(res.statusCode).toBe(404);
		expect(res.payload.error).toBe('offer_not_found');

		const { getSpendLimits } = await import('../api/_lib/agent-trade-guards.js');
		expect(getSpendLimits).toHaveBeenCalled();
	});

	it('refuses an agent hiring its own service before any spend is reserved', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = {
			slug: 'self', name: 'Self skill', service_id: 's1', price_atomics: '1000',
			network: 'solana', method: 'POST',
			provider: { id: HIRER_ID, name: 'Mine', is_public: true, solana_address: WALLET },
		};
		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'self' });
		expect(res.statusCode).toBe(400);
		expect(res.payload.error).toBe('self_hire');

		const { reserveSpendUsd } = await import('../api/_lib/agent-trade-guards.js');
		expect(reserveSpendUsd).not.toHaveBeenCalled();
	});

	it('rejects a hire priced above the caller-supplied per-call ceiling', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = {
			slug: 'pricey', name: 'Pricey skill', service_id: 's2', price_atomics: '5000000',
			network: 'solana', method: 'POST',
			provider: { id: 'provider-1', name: 'Them', is_public: true, solana_address: WALLET },
		};
		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'pricey', maxUsd: 0.5 });
		expect(res.statusCode).toBe(402);
		expect(res.payload.error).toBe('over_cap');

		const { reserveSpendUsd } = await import('../api/_lib/agent-trade-guards.js');
		expect(reserveSpendUsd).not.toHaveBeenCalled();
	});

	it('401s an unauthenticated caller', async () => {
		const auth = await import('../api/_lib/auth.js');
		auth.getSessionUser.mockResolvedValueOnce(null);
		auth.authenticateBearer.mockResolvedValueOnce(null);
		const res = await post({});
		expect(res.statusCode).toBe(401);
		expect(res.payload.error).toBe('unauthorized');
	});
});

// Order 519: a hire priced above the hiring agent's approval_threshold_usd
// parks on the generic approval inbox instead of paying, and never reserves
// spend while it waits.
describe('POST /api/agents/a2a-hire: human approval above threshold', () => {
	const PRICEY_OFFER = {
		slug: 'pricey', name: 'Pricey skill', service_id: 's2', price_atomics: '2000000',
		network: 'solana', method: 'POST',
		provider: { id: 'provider-1', name: 'Them', is_public: true, solana_address: WALLET },
	};

	it('parks a hire above the threshold instead of paying, without reserving spend', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = PRICEY_OFFER;
		const { getSpendLimits } = await import('../api/_lib/agent-trade-guards.js');
		getSpendLimits.mockReturnValueOnce({ per_tx_usd: 5, daily_usd: 25, approval_threshold_usd: 1 });
		const { recordHire, updateHire } = await import('../api/_lib/agent-economy.js');
		recordHire.mockResolvedValueOnce({ row: { id: 'hire-1', status: 'pending', meta: {} }, existing: false });

		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'pricey' });

		expect(res.statusCode).toBe(202);
		expect(res.payload.pending_approval).toBe(true);
		expect(res.payload.approval.id).toBe('appr-1');

		const { createApprovalRequest } = await import('../api/_lib/approvals.js');
		expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
			source: 'a2a_hire',
			sourceRef: 'hire-1',
			venue: 'a2a_hire',
			autoApprovable: false,
			payload: expect.objectContaining({ kind: 'a2a_hire', hire_id: 'hire-1', usd: 2 }),
		}));
		expect(updateHire).toHaveBeenCalledWith('hire-1', { meta: { awaiting_approval: true, approval_id: 'appr-1' } });

		const { reserveSpendUsd } = await import('../api/_lib/agent-trade-guards.js');
		expect(reserveSpendUsd).not.toHaveBeenCalled();
		const { payExternalX402 } = await import('../api/_lib/x402-user-payer.js');
		expect(payExternalX402).not.toHaveBeenCalled();
	});

	it('still pays inline when the price is at or below the threshold', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = PRICEY_OFFER;
		const { getSpendLimits } = await import('../api/_lib/agent-trade-guards.js');
		getSpendLimits.mockReturnValueOnce({ per_tx_usd: 5, daily_usd: 25, approval_threshold_usd: 2 });
		const { recordHire } = await import('../api/_lib/agent-economy.js');
		recordHire.mockResolvedValueOnce({ row: { id: 'hire-1', status: 'pending', meta: {} }, existing: false });

		await post({ hirerAgentId: HIRER_ID, serviceSlug: 'pricey' });

		const { reserveSpendUsd } = await import('../api/_lib/agent-trade-guards.js');
		expect(reserveSpendUsd).toHaveBeenCalled();
		const { createApprovalRequest } = await import('../api/_lib/approvals.js');
		expect(createApprovalRequest).not.toHaveBeenCalled();
	});

	it('re-polls the parked approval on a retry with the same idempotency key instead of double-parking', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = PRICEY_OFFER;
		dbState.approval = { id: 'appr-1', status: 'pending', summary: 'test approval', expires_at: '2026-10-16T00:00:00.000Z' };
		const { recordHire } = await import('../api/_lib/agent-economy.js');
		recordHire.mockResolvedValueOnce({
			row: { id: 'hire-1', status: 'pending', meta: { awaiting_approval: true, approval_id: 'appr-1' } },
			existing: true,
		});

		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'pricey' });

		expect(res.statusCode).toBe(202);
		expect(res.payload.pending_approval).toBe(true);
		const { createApprovalRequest } = await import('../api/_lib/approvals.js');
		expect(createApprovalRequest).not.toHaveBeenCalled();
	});

	it('reports a denied approval as 403 on retry', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = PRICEY_OFFER;
		dbState.approval = { id: 'appr-1', status: 'denied', summary: 'test approval', expires_at: '2026-10-16T00:00:00.000Z' };
		const { recordHire } = await import('../api/_lib/agent-economy.js');
		recordHire.mockResolvedValueOnce({
			row: { id: 'hire-1', status: 'pending', meta: { awaiting_approval: true, approval_id: 'appr-1' } },
			existing: true,
		});

		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'pricey' });
		expect(res.statusCode).toBe(403);
		expect(res.payload.error).toBe('approval_denied');
	});

	it('reports an expired approval as 410 on retry', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = PRICEY_OFFER;
		dbState.approval = { id: 'appr-1', status: 'expired', summary: 'test approval', expires_at: '2026-10-16T00:00:00.000Z' };
		const { recordHire } = await import('../api/_lib/agent-economy.js');
		recordHire.mockResolvedValueOnce({
			row: { id: 'hire-1', status: 'pending', meta: { awaiting_approval: true, approval_id: 'appr-1' } },
			existing: true,
		});

		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'pricey' });
		expect(res.statusCode).toBe(410);
		expect(res.payload.error).toBe('approval_expired');
	});

	it('returns the retained execution result once the owner approves and the executor finishes', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = PRICEY_OFFER;
		dbState.approval = {
			id: 'appr-1', status: 'executed', summary: 'test approval', expires_at: '2026-10-16T00:00:00.000Z',
			result: { data: { ok: true, hire: { id: 'hire-1', status: 'completed' } } },
		};
		const { recordHire } = await import('../api/_lib/agent-economy.js');
		recordHire.mockResolvedValueOnce({
			row: { id: 'hire-1', status: 'pending', meta: { awaiting_approval: true, approval_id: 'appr-1' } },
			existing: true,
		});

		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'pricey' });
		expect(res.statusCode).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.hire.status).toBe('completed');
	});

	it('still reports pending while the owner has approved but the executor has not run yet', async () => {
		dbState.hirer = ownedHirer();
		offerState.offer = PRICEY_OFFER;
		dbState.approval = { id: 'appr-1', status: 'approved', summary: 'test approval', expires_at: '2026-10-16T00:00:00.000Z' };
		const { recordHire } = await import('../api/_lib/agent-economy.js');
		recordHire.mockResolvedValueOnce({
			row: { id: 'hire-1', status: 'pending', meta: { awaiting_approval: true, approval_id: 'appr-1' } },
			existing: true,
		});

		const res = await post({ hirerAgentId: HIRER_ID, serviceSlug: 'pricey' });
		expect(res.statusCode).toBe(202);
		expect(res.payload.approval.status).toBe('approved');
	});
});

// The executor api/_lib/approvals.js registers for source 'a2a_hire': runs
// ONLY after the owner approves, scoped to row.payload, independent of the
// original HTTP request (which already returned 202 and may be long gone).
describe('executeApprovedA2aHire (the a2a_hire approval executor)', () => {
	const OFFER = {
		slug: 'pricey', name: 'Pricey skill', service_id: 's2', price_atomics: '2000000',
		network: 'solana', method: 'POST',
		provider: { id: 'provider-1', name: 'Them', is_public: true, solana_address: WALLET },
	};
	const PAYLOAD = {
		kind: 'a2a_hire', hire_id: 'hire-1', hirer_agent_id: HIRER_ID,
		provider_agent_id: 'provider-1', service_slug: 'pricey', usd: 2, max_usd: null, input: null,
	};

	it('re-runs reserve + pay + finalize and returns a status-ok result with the completed hire', async () => {
		const { executeApprovedA2aHire } = await import('../api/agents/a2a-hire.js');
		const { getHireById, updateHire } = await import('../api/_lib/agent-economy.js');
		offerState.offer = OFFER;
		getHireById.mockResolvedValueOnce({ id: 'hire-1', status: 'pending', usd: 2, service_slug: 'pricey', meta: {} });
		dbState.hirer = ownedHirer();
		updateHire.mockResolvedValueOnce({ id: 'hire-1', status: 'completed', usd: 2 });
		const { payExternalX402 } = await import('../api/_lib/x402-user-payer.js');
		payExternalX402.mockResolvedValueOnce({ receipt: { transaction: 'sig-123' }, payer: WALLET, result: { ok: true } });

		const outcome = await executeApprovedA2aHire({ payload: PAYLOAD });

		expect(outcome.status).toBe('ok');
		expect(outcome.signature).toBe('sig-123');
		expect(outcome.data.ok).toBe(true);
		expect(outcome.data.hire.id).toBe('hire-1');

		const { reserveSpendUsd } = await import('../api/_lib/agent-trade-guards.js');
		expect(reserveSpendUsd).toHaveBeenCalled();
	});

	it('releases the spend reservation and reports status error when the payment fails, without faking a completion', async () => {
		const { executeApprovedA2aHire } = await import('../api/agents/a2a-hire.js');
		const { getHireById } = await import('../api/_lib/agent-economy.js');
		offerState.offer = OFFER;
		getHireById.mockResolvedValueOnce({ id: 'hire-1', status: 'pending', usd: 2, service_slug: 'pricey', meta: {} });
		dbState.hirer = ownedHirer();
		const { payExternalX402 } = await import('../api/_lib/x402-user-payer.js');
		payExternalX402.mockRejectedValueOnce(Object.assign(new Error('upstream 500'), { code: 'payment_failed' }));

		const outcome = await executeApprovedA2aHire({ payload: PAYLOAD });

		expect(outcome.status).toBe('error');
		expect(outcome.note).toMatch(/no funds were moved/);
		const { releaseSpendReservation } = await import('../api/_lib/agent-trade-guards.js');
		expect(releaseSpendReservation).toHaveBeenCalled();
	});

	it('short-circuits to ok without re-paying when the hire is already completed', async () => {
		const { executeApprovedA2aHire } = await import('../api/agents/a2a-hire.js');
		const { getHireById } = await import('../api/_lib/agent-economy.js');
		offerState.offer = OFFER;
		getHireById.mockResolvedValueOnce({
			id: 'hire-1', status: 'completed', usd: 2, service_slug: 'pricey',
			payment_signature: 'sig-already', meta: {},
		});

		const outcome = await executeApprovedA2aHire({ payload: PAYLOAD });

		expect(outcome.status).toBe('ok');
		expect(outcome.signature).toBe('sig-already');
		const { reserveSpendUsd } = await import('../api/_lib/agent-trade-guards.js');
		expect(reserveSpendUsd).not.toHaveBeenCalled();
	});
});
