/**
 * /api/pay/execute: human approval above a payment session's approval threshold.
 *
 * Order 519. A payment session already had a `requires_approval` verdict (the
 * governor's approval-threshold rule in api/_lib/pay/policy.js), but nothing
 * wired it to a human: the governor just rejected the call outright, so an
 * agent whose session carried a threshold could never spend above it, approved
 * or not. This file pins the wiring that uses the existing generic Approval
 * Inbox (api/_lib/approvals.js) instead of a bespoke mechanism:
 *
 *   - a call that trips requires_approval parks on the inbox and answers 202
 *     with a poll URL, instead of a bare 403,
 *   - GET /api/pay/execute?approval_id=&session_token= reports the current
 *     state (pending/executed/denied/expired) without re-spending,
 *   - the registered executor (api/_lib/approvals.js EXECUTORS.payment_session_execute)
 *     re-probes and settles through the exact same settlePayment() path a
 *     direct call uses, scoped by approvalGranted:true to lift only the
 *     approval-threshold rule, never any other governance check.
 *
 * The network is stubbed at the fetch boundary (same technique as
 * tests/pay-probe-endpoint-error.test.js); the SSRF guard chain is pinned by
 * its own suite. The session/approval persistence is stubbed at the module
 * boundary (api/_lib/pay/spend-governor.js, api/_lib/approvals.js, api/_lib/db.js)
 * so this file exercises execute.js's own orchestration, not Postgres.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

vi.mock('../api/_lib/ssrf.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		resolvePublicHost: async () => ['203.0.113.10'],
		pinnedAgent: () => ({ destroy: async () => {} }),
	};
});

const reserveState = { impl: null };
vi.mock('../api/_lib/pay/spend-governor.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		verifySessionToken: vi.fn(async () => SESSION),
		reserveSessionSpend: vi.fn(async (args) => reserveState.impl(args)),
		rollbackReservation: vi.fn(async () => {}),
		recordExecution: vi.fn(async () => {}),
	};
});

const approvalState = { row: null };
vi.mock('../api/_lib/approvals.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		createApprovalRequest: vi.fn(async () => ({
			request: {
				id: 'appr-1', status: 'pending', summary: 'test approval',
				expires_at: '2026-10-16T00:00:00.000Z',
			},
			created: true,
			autoApproved: false,
			policy: null,
		})),
		runApproved: vi.fn(async () => ({ request: null, outcome: null })),
	};
});

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => (approvalState.row ? [approvalState.row] : [])),
}));

const PAYER = Keypair.generate();
vi.mock('../api/_lib/x402/pay.js', () => ({
	loadSeedKeypair: vi.fn(() => PAYER),
}));

vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: vi.fn(() => ({})),
}));

const BLOCKHASH = Keypair.generate().publicKey.toBase58();
vi.mock('../api/_lib/solana/read-guards.js', () => ({
	mintDecimals: vi.fn(async () => 6),
	ataExists: vi.fn(async () => true),
	getRecentBlockhash: vi.fn(async () => BLOCKHASH),
	isRpcUnavailable: vi.fn(() => false),
	RPC_RETRY_AFTER_SECONDS: 30,
}));

const { SpendGovernorError } = await import('../api/_lib/pay/spend-governor.js');
const { USDC_SOLANA_MINT } = await import('../api/_lib/pay/probe.js');
const execMod = await import('../api/pay/execute.js');
const { default: handler, executeApprovedPaymentSessionCall, APPROVAL_SOURCE } = execMod;

const SESSION = {
	id: 'sess-1', user_id: 'owner-1', agent_id: null, label: 'my session',
	network: 'solana', spent_usdc: '0', budget_usdc: '100000000',
};

const TARGET_URL = 'https://api.example.com/data';
const PAY_TO = Keypair.generate().publicKey.toBase58();
const FEE_PAYER = Keypair.generate().publicKey.toBase58();

function challengeBody() {
	return JSON.stringify({
		x402Version: 2,
		resource: TARGET_URL,
		accepts: [{
			scheme: 'exact', network: 'solana', amount: '2000000', asset: USDC_SOLANA_MINT,
			payTo: PAY_TO, extra: { feePayer: FEE_PAYER },
		}],
	});
}

function settledResponseHeaders() {
	const payload = { payer: PAYER.publicKey.toBase58(), transaction: 'tx-settled-123' };
	return { 'x-payment-response': Buffer.from(JSON.stringify(payload)).toString('base64') };
}

function queueFetch(...factories) {
	let i = 0;
	globalThis.fetch = vi.fn(async () => factories[Math.min(i++, factories.length - 1)]());
}

function makeReq({ method = 'POST', url = '/api/pay/execute', body = null } = {}) {
	return { method, url, headers: { 'content-type': 'application/json', origin: 'https://three.ws' }, body };
}

function makeRes() {
	return {
		statusCode: 0, payload: null, headers: {},
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
	await handler(makeReq({ body }), res);
	return res;
}

async function get(qs) {
	const res = makeRes();
	await handler(makeReq({ method: 'GET', url: `/api/pay/execute?${qs}` }), res);
	return res;
}

let realFetch;
beforeEach(() => {
	realFetch = globalThis.fetch;
	approvalState.row = null;
	reserveState.impl = async () => {
		throw new SpendGovernorError('requires_approval', 'exceeds threshold', {
			amount_usd: 2, threshold_usd: 1, policy_digest: 'digest', verdict_signature: 'sig', verdict_signed_at: '2026-10-15T00:00:00.000Z',
		});
	};
	vi.clearAllMocks();
});
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

describe('POST /api/pay/execute: parks a call above the session approval threshold', () => {
	it('answers 202 with a poll URL instead of a bare 403', async () => {
		queueFetch(() => new Response(challengeBody(), { status: 402 }));
		const res = await post({ session_token: 'pss_11111111-1111-4111-8111-111111111111_abc', url: TARGET_URL });

		expect(res.statusCode).toBe(202);
		expect(res.payload.pending_approval).toBe(true);
		expect(res.payload.approval.id).toBe('appr-1');

		const { createApprovalRequest } = await import('../api/_lib/approvals.js');
		expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
			source: APPROVAL_SOURCE,
			venue: 'payment_session_execute',
			autoApprovable: false,
			payload: expect.objectContaining({ kind: 'payment_session_execute', session_id: 'sess-1', url: TARGET_URL }),
		}));
	});

	it('never builds or submits a payment while parked', async () => {
		queueFetch(() => new Response(challengeBody(), { status: 402 }));
		await post({ session_token: 'pss_11111111-1111-4111-8111-111111111111_abc', url: TARGET_URL });
		// Exactly one fetch: the probe. No second fetch for a payment submission.
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});
});

describe('GET /api/pay/execute: polling a parked approval', () => {
	it('400s without approval_id and session_token', async () => {
		const res = await get('');
		expect(res.statusCode).toBe(400);
	});

	it('404s when no approval matches this session', async () => {
		approvalState.row = null;
		const res = await get('approval_id=11111111-1111-4111-8111-111111111111&session_token=pss_11111111-1111-4111-8111-111111111111_abc');
		expect(res.statusCode).toBe(404);
	});

	it('202s with the current pending status', async () => {
		approvalState.row = {
			id: 'appr-1', status: 'pending', summary: 'test approval',
			expires_at: '2026-10-16T00:00:00.000Z', payload: { session_id: 'sess-1' },
		};
		const res = await get('approval_id=11111111-1111-4111-8111-111111111111&session_token=pss_11111111-1111-4111-8111-111111111111_abc');
		expect(res.statusCode).toBe(202);
		expect(res.payload.pending_approval).toBe(true);
	});

	it('returns the retained result body once executed', async () => {
		approvalState.row = {
			id: 'appr-1', status: 'executed', payload: { session_id: 'sess-1' },
			result: { data: { ok: true, paid: true, note: 'settled' } },
		};
		const res = await get('approval_id=11111111-1111-4111-8111-111111111111&session_token=pss_11111111-1111-4111-8111-111111111111_abc');
		expect(res.statusCode).toBe(200);
		expect(res.payload).toEqual({ ok: true, paid: true, note: 'settled' });
	});

	it('403s a denied approval', async () => {
		approvalState.row = { id: 'appr-1', status: 'denied', payload: { session_id: 'sess-1' } };
		const res = await get('approval_id=11111111-1111-4111-8111-111111111111&session_token=pss_11111111-1111-4111-8111-111111111111_abc');
		expect(res.statusCode).toBe(403);
		expect(res.payload.error).toBe('approval_denied');
	});

	it('410s an expired approval', async () => {
		approvalState.row = { id: 'appr-1', status: 'expired', payload: { session_id: 'sess-1' } };
		const res = await get('approval_id=11111111-1111-4111-8111-111111111111&session_token=pss_11111111-1111-4111-8111-111111111111_abc');
		expect(res.statusCode).toBe(410);
		expect(res.payload.error).toBe('approval_expired');
	});
});

describe('executeApprovedPaymentSessionCall: the payment_session_execute approval executor', () => {
	it('re-probes, settles with approvalGranted bypassing only the threshold rule, and returns the result', async () => {
		reserveState.impl = async ({ approvalGranted }) => {
			expect(approvalGranted).toBe(true);
			return {
				session: { id: 'sess-1', user_id: 'owner-1', spent_usdc: '2000000', budget_usdc: '100000000' },
				railReservationId: 'rail-1', policyDigest: 'digest', verdictCode: 'ok',
				verdictSignature: 'sig2', verdictSignedAt: '2026-10-15T00:00:01.000Z',
			};
		};
		queueFetch(
			() => new Response(challengeBody(), { status: 402 }),
			() => new Response(JSON.stringify({ served: true }), { status: 200, headers: settledResponseHeaders() }),
		);

		const outcome = await executeApprovedPaymentSessionCall({
			payload: {
				kind: 'payment_session_execute', session_id: 'sess-1', url: TARGET_URL,
				method: 'GET', body: null, idempotency_key: null,
			},
		});

		expect(outcome.status).toBe('ok');
		expect(outcome.signature).toBe('tx-settled-123');
		expect(outcome.data.ok).toBe(true);
		expect(outcome.data.paid).toBe(true);
	});

	it('reports status error without faking a completion when settlement fails', async () => {
		reserveState.impl = async () => ({
			session: { id: 'sess-1', user_id: 'owner-1', spent_usdc: '2000000', budget_usdc: '100000000' },
			railReservationId: 'rail-1', policyDigest: 'digest', verdictCode: 'ok',
			verdictSignature: 'sig2', verdictSignedAt: '2026-10-15T00:00:01.000Z',
		});
		queueFetch(
			() => new Response(challengeBody(), { status: 402 }),
			() => new Response(JSON.stringify({ error: 'rejected' }), { status: 402 }),
		);

		const outcome = await executeApprovedPaymentSessionCall({
			payload: {
				kind: 'payment_session_execute', session_id: 'sess-1', url: TARGET_URL,
				method: 'GET', body: null, idempotency_key: null,
			},
		});

		expect(outcome.status).toBe('error');
	});
});
