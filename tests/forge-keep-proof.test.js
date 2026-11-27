// Pay-to-keep must never charge twice for one keep (order 129).
//
// ensureKept pays, then POSTs the proof to /api/forge-keep. The pay sheet now
// remembers an unspent settled proof (src/shared/forge-paid-proofs.js) and offers
// it again instead of a second charge, so the keep flow has to tell it what
// happened: forget the proof once the server recorded the keep, forget it and pay
// fresh once when a reused proof is refused, and keep it when the follow-up
// request faulted so the next Download presents the same payment.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const payForConsumption = vi.fn();
const forgetPaidProof = vi.fn();
vi.mock('../src/forge-pay.js', () => ({
	payForConsumption: (...a) => payForConsumption(...a),
	forgetPaidProof: (...a) => forgetPaidProof(...a),
}));
vi.mock('../src/three-access.js', () => ({ attachTierPass: (h) => h, getTierPass: async () => null }));

const { ensureKept } = await import('../src/forge-keep.js');

const CREATION = '11111111-1111-4111-8111-111111111111';
const PRICE = { action: 'forge.keep.standard', usd: 0.15 };
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let calls;
function stubFetch(...replies) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init) => {
			calls.push(init?.body ? JSON.parse(init.body) : null);
			return replies.shift();
		}),
	);
}

beforeEach(() => {
	calls = [];
	payForConsumption.mockReset();
	forgetPaidProof.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('ensureKept and the remembered proof', () => {
	it('forgets the proof once the server recorded the keep', async () => {
		payForConsumption.mockResolvedValue({ ok: true, paymentId: 'pay-1', refId: 'forge-keep-1' });
		stubFetch(reply(402, { error: 'three_hold_required', pay_per_use: PRICE }), reply(200, { kept: true, reason: 'paid' }));
		expect(await ensureKept(CREATION)).toEqual({ ok: true });
		expect(forgetPaidProof).toHaveBeenCalledWith('pay-1');
	});

	it('keeps the proof when the keep request faults after the payment, so the next try is free', async () => {
		payForConsumption.mockResolvedValue({ ok: true, paymentId: 'pay-1', refId: 'forge-keep-1' });
		stubFetch(reply(402, { error: 'three_hold_required', pay_per_use: PRICE }), reply(503, { error: 'service_unavailable' }));
		await ensureKept(CREATION);
		expect(forgetPaidProof).not.toHaveBeenCalled();
	});

	it('drops a reused proof the server refused and pays fresh exactly once', async () => {
		payForConsumption
			.mockResolvedValueOnce({ ok: true, paymentId: 'old-pay', refId: 'forge-keep-old', reused: true })
			.mockResolvedValueOnce({ ok: true, paymentId: 'new-pay', refId: 'forge-keep-new' });
		stubFetch(
			reply(402, { error: 'three_hold_required', pay_per_use: PRICE }),
			reply(409, { error: 'payment_already_used', pay_per_use: PRICE }),
			reply(200, { kept: true, reason: 'paid' }),
		);
		expect(await ensureKept(CREATION)).toEqual({ ok: true });
		expect(payForConsumption).toHaveBeenCalledTimes(2);
		expect(forgetPaidProof.mock.calls.map((c) => c[0])).toEqual(['old-pay', 'new-pay']);
		expect(calls[2]).toMatchObject({ payment_id: 'new-pay', ref_id: 'forge-keep-new' });
	});

	it('never loops: a fresh payment the server refuses is reported, not paid again', async () => {
		payForConsumption.mockResolvedValue({ ok: true, paymentId: 'pay-1', refId: 'forge-keep-1' });
		stubFetch(
			reply(402, { error: 'three_hold_required', pay_per_use: PRICE }),
			reply(402, { error: 'payment_invalid', pay_per_use: PRICE }),
		);
		const out = await ensureKept(CREATION);
		expect(out.ok).toBe(false);
		expect(payForConsumption).toHaveBeenCalledTimes(1);
		expect(forgetPaidProof).toHaveBeenCalledWith('pay-1');
	});
});
