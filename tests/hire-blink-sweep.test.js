// The hire-Blink settlement sweep (api/cron/hire-blink-sweep.js) is what makes
// a wallet hire safe when the client never calls the confirm callback: a paid
// hire must be delivered, an unpaid one must close as 'expired' (never 'failed',
// which would count against the provider), and the tick must stop picking up
// rows once its time budget is spent.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
	listOpenBlinkHires: vi.fn(),
	updateHire: vi.fn(),
	locateHirePayment: vi.fn(),
	settleBlinkHire: vi.fn(),
	expireBlinkHire: vi.fn(),
}));

vi.mock('../api/_lib/agent-economy.js', () => ({
	listOpenBlinkHires: (...a) => h.listOpenBlinkHires(...a),
	updateHire: (...a) => h.updateHire(...a),
}));
vi.mock('../api/_lib/hire-blink.js', () => ({
	BLINK_HIRE_TTL_MS: 20 * 60 * 1000,
	locateHirePayment: (...a) => h.locateHirePayment(...a),
	settleBlinkHire: (...a) => h.settleBlinkHire(...a),
	expireBlinkHire: (...a) => h.expireBlinkHire(...a),
}));

const { sweepBlinkHires } = await import('../api/cron/hire-blink-sweep.js');

const NOW = Date.parse('2026-11-04T12:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();
const hire = (id, ageMin) => ({ id, created_at: minutesAgo(ageMin), status: 'pending', meta: { source: 'blink', reference: `ref-${id}` } });
const SIG = '4'.repeat(88);

beforeEach(() => {
	for (const fn of Object.values(h)) fn.mockReset();
});

describe('hire-blink-sweep', () => {
	it('settles a paid hire it finds by reference', async () => {
		h.listOpenBlinkHires.mockResolvedValue([hire('a', 3)]);
		h.locateHirePayment.mockResolvedValue(SIG);
		h.settleBlinkHire.mockResolvedValue({ state: 'completed', hire: {} });

		const out = await sweepBlinkHires({ now: () => NOW });
		expect(h.settleBlinkHire).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), { signature: SIG });
		expect(out).toMatchObject({ scanned: 1, completed: 1, expired: 0 });
	});

	it('leaves a young unpaid hire open and expires an old one', async () => {
		h.listOpenBlinkHires.mockResolvedValue([hire('young', 5), hire('old', 25)]);
		h.locateHirePayment.mockResolvedValue(null);

		const out = await sweepBlinkHires({ now: () => NOW });
		expect(h.expireBlinkHire).toHaveBeenCalledTimes(1);
		expect(h.expireBlinkHire.mock.calls[0][0].id).toBe('old');
		expect(h.settleBlinkHire).not.toHaveBeenCalled();
		expect(out).toMatchObject({ confirming: 1, expired: 1 });
	});

	it('expires a hire whose only payment does not match, keeping the transaction on the row', async () => {
		h.listOpenBlinkHires.mockResolvedValue([hire('m', 30)]);
		h.locateHirePayment.mockResolvedValue(SIG);
		h.settleBlinkHire.mockResolvedValue({ state: 'mismatch', reason: 'amount not transferred', hire: {} });

		const out = await sweepBlinkHires({ now: () => NOW });
		const [id, patch] = h.updateHire.mock.calls[0];
		expect(id).toBe('m');
		expect(patch.status).toBe('expired');
		expect(patch.error).toMatch(/does not match/);
		expect(patch.meta.mismatch_signature).toBe(SIG);
		expect(out).toMatchObject({ mismatched: 1, expired: 1 });
	});

	it('keeps going past one broken row and counts the error', async () => {
		h.listOpenBlinkHires.mockResolvedValue([hire('x', 3), hire('y', 3)]);
		h.locateHirePayment.mockRejectedValueOnce(new Error('rpc down')).mockResolvedValueOnce(SIG);
		h.settleBlinkHire.mockResolvedValue({ state: 'failed', hire: {} });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const out = await sweepBlinkHires({ now: () => NOW });
		expect(out).toMatchObject({ errors: 1, failed: 1 });
		warn.mockRestore();
	});

	it('defers the rest of the batch once the tick budget is spent', async () => {
		h.listOpenBlinkHires.mockResolvedValue([hire('1', 3), hire('2', 3), hire('3', 3)]);
		h.locateHirePayment.mockResolvedValue(null);
		let t = NOW;
		const clock = () => t;
		h.locateHirePayment.mockImplementation(async () => {
			t += 50_000;
			return null;
		});

		const out = await sweepBlinkHires({ now: clock, budgetMs: 80_000 });
		expect(h.locateHirePayment).toHaveBeenCalledTimes(2);
		expect(out.deferred).toBe(1);
	});
});
