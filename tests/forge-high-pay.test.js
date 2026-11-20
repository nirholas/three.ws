// HTTP-level tests for the Forge High pay-per-use branch on POST /api/forge.
//
// Companion to forge-high-gate.test.js (the hold-or-pay gate): these pin the
// consumption lever — a non-holder presenting a settled $THREE payment
// (payment_id + the client nonce) instead of holding. The payment helper is
// mocked so no DB/RPC is touched; what's under test is how api/forge.js routes a
// valid / invalid / already-used proof:
//   • valid proof        → satisfies the gate (not 402), claimed before dispatch,
//                          and released because the platform lane is unconfigured
//                          (no model delivered → reusable on retry).
//   • invalid proof      → the assert error is surfaced verbatim (402 payment_invalid).
//   • lost the claim race → 409 payment_already_used, nothing released.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

// POST /api/forge needs an account (api/_lib/creator-account.js). These tests
// exercise what happens past that gate, so the caller is a signed-in account.
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

const assertForgePayment = vi.fn();
const redeemForgePayment = vi.fn();
const releaseForgePayment = vi.fn();
vi.mock('../api/_lib/forge-high-payment.js', () => ({
	assertForgePayment: (...a) => assertForgePayment(...a),
	redeemForgePayment: (...a) => redeemForgePayment(...a),
	releaseForgePayment: (...a) => releaseForgePayment(...a),
}));

let forge;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '', _ended: false,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; this._ended = true; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq({ body = null } = {}) {
	const chunks = body != null ? [Buffer.from(JSON.stringify(body))] : [];
	const r = Readable.from(chunks);
	r.method = 'POST';
	r.url = '/api/forge';
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
	return r;
}

const PAY_BODY = {
	prompt: 'a brass telescope',
	tier: 'high',
	backend: 'trellis',
	payment_id: 'pay-1',
	ref_id: 'forge-high-abc123',
};

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	delete process.env.HOLDER_PASS_SECRET;
	// No platform vendor key → the post-gate platform path lands on a clean
	// 'unconfigured' instead of a real Replicate call, so a gate-passing request
	// resolves hermetically.
	delete process.env.REPLICATE_API_TOKEN;
	forge = (await import('../api/forge.js')).default;
});

beforeEach(() => {
	vi.clearAllMocks();
	// Defaults: a valid, claimable, releasable payment.
	assertForgePayment.mockResolvedValue({
		ok: true,
		payment: { id: 'pay-1', usd: 0.5, settledAt: new Date().toISOString() },
	});
	redeemForgePayment.mockResolvedValue({ redeemed: true });
	releaseForgePayment.mockResolvedValue(undefined);
});

describe('POST /api/forge — Forge High pay-per-use', () => {
	it('a valid payment proof satisfies the gate (not 402) and is claimed', async () => {
		const res = mockRes();
		await forge(mockReq({ body: PAY_BODY }), res);

		// Gate passed: never the hold-or-pay 402.
		expect(res.statusCode).not.toBe(402);
		expect(res.json?.error).not.toBe('three_hold_required');
		// Validated read-only at the gate, then claimed atomically before dispatch.
		expect(assertForgePayment).toHaveBeenCalledWith(
			expect.objectContaining({ paymentId: 'pay-1', refId: 'forge-high-abc123' }),
		);
		expect(redeemForgePayment).toHaveBeenCalledWith(
			expect.objectContaining({ paymentId: 'pay-1', refId: 'forge-high-abc123' }),
		);
		// Platform lane is unconfigured here → no model delivered → the claim is
		// released so the settled payment stays reusable on retry.
		expect(res.json?.error).toBe('unconfigured');
		expect(releaseForgePayment).toHaveBeenCalledWith({ paymentId: 'pay-1' });
	});

	it('surfaces an invalid proof verbatim and never reaches the claim', async () => {
		assertForgePayment.mockRejectedValueOnce(
			Object.assign(new Error('No settled $THREE payment found for this generation.'), {
				status: 402,
				code: 'payment_invalid',
			}),
		);
		const res = mockRes();
		await forge(mockReq({ body: PAY_BODY }), res);

		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('payment_invalid');
		expect(res.json.feature).toBe('forge.high');
		expect(res.json.pay_per_use).toMatchObject({ action: 'forge.high', usd: 0.5 });
		expect(redeemForgePayment).not.toHaveBeenCalled();
		expect(releaseForgePayment).not.toHaveBeenCalled();
	});

	it('returns 409 when the claim is lost (payment already used) and releases nothing', async () => {
		redeemForgePayment.mockResolvedValueOnce({ redeemed: false });
		const res = mockRes();
		await forge(mockReq({ body: PAY_BODY }), res);

		expect(res.statusCode).toBe(409);
		expect(res.json.error).toBe('payment_already_used');
		expect(releaseForgePayment).not.toHaveBeenCalled();
	});

	it('falls through to the hold-or-pay gate when no proof is presented', async () => {
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope', tier: 'high', backend: 'trellis' } }), res);

		// Anonymous, no proof → the normal 402 hold-or-pay gate (require-three.js).
		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('three_hold_required');
		expect(assertForgePayment).not.toHaveBeenCalled();
	});
});
