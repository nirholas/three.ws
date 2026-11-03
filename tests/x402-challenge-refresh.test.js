// A paid call that comes back 402 means the endpoint rejected the payment it was
// handed. The usual cause is a challenge that moved between the probe and the
// payment (a price change, a rotated payTo or fee payer). The loop used to log
// `http_402` and give up, then repeat the same doomed payment next cooldown: 9,998
// such rows in the 7 days to 2026-11-03, all from 2026-10-27 to 2026-10-30.
//
// payWithChallengeRefresh re-fetches the challenge once after a paid 402 and pays
// again ONLY against a challenge that differs from the one just rejected, so a
// requirement is never reused across a price change and an unchanged challenge is
// never paid twice.

import { describe, it, expect } from 'vitest';
import {
	challengeChanged,
	payableChallenge,
	payWithChallengeRefresh,
} from '../api/_lib/x402/challenge-refresh.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PAY_TO = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const accept = (over = {}) => ({
	scheme: 'exact',
	network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
	asset: USDC,
	payTo: PAY_TO,
	amount: '1000',
	extra: { feePayer: 'feepayer1111111111111111111111111111111111' },
	...over,
});

const challengeRes = (a) => ({ status: 402, ok: false, body: { accepts: [a] } });
const paid = (status) => ({ status, ok: status >= 200 && status < 300, body: null });
const limits = { usdcMint: USDC, remainingCap: 1_000_000, payerUsdcAtomic: 1_000_000 };

describe('challengeChanged', () => {
	it('is false for an identical challenge', () => {
		expect(challengeChanged(accept(), accept())).toBe(false);
	});

	it('detects a price change, a payTo rotation, a fee payer rotation and an asset change', () => {
		expect(challengeChanged(accept(), accept({ amount: '2000' }))).toBe(true);
		expect(challengeChanged(accept(), accept({ payTo: 'other' }))).toBe(true);
		expect(challengeChanged(accept(), accept({ extra: { feePayer: 'rotated' } }))).toBe(true);
		expect(challengeChanged(accept(), accept({ asset: 'other' }))).toBe(true);
	});
});

describe('payableChallenge', () => {
	it('accepts a challenge inside the cap and the payer float', () => {
		expect(payableChallenge(accept(), limits)).toEqual({ ok: true });
	});

	it('refuses a missing accept, a foreign asset and a missing fee payer', () => {
		expect(payableChallenge(null, limits).reason).toBe('no_solana_accept');
		expect(payableChallenge(accept({ asset: 'other' }), limits).reason).toBe('unexpected_asset');
		expect(payableChallenge(accept({ extra: {} }), limits).reason).toBe('missing_fee_payer');
	});

	it('refuses a repriced challenge the cap or the float cannot cover', () => {
		expect(payableChallenge(accept({ amount: '5000000' }), limits).reason).toBe('cap_would_exceed');
		expect(
			payableChallenge(accept({ amount: '5000' }), { ...limits, payerUsdcAtomic: 4_999 }).reason,
		).toBe('insufficient_payer_usdc');
	});

	it('does not gate on an unknown float', () => {
		expect(payableChallenge(accept({ amount: '5000' }), { ...limits, payerUsdcAtomic: null })).toEqual({
			ok: true,
		});
	});
});

describe('payWithChallengeRefresh', () => {
	it('pays once and never re-probes when the first payment is accepted', async () => {
		const calls = { pay: 0, probe: 0 };
		const out = await payWithChallengeRefresh({
			accept: accept(),
			limits,
			pay: async () => (calls.pay++, paid(200)),
			reprobe: async () => (calls.probe++, challengeRes(accept())),
		});
		expect(out.paidRes.status).toBe(200);
		expect(out.refreshed).toBe(false);
		expect(calls).toEqual({ pay: 1, probe: 0 });
	});

	it('re-pays against the NEW price when the advertised price changes between calls', async () => {
		const paidAmounts = [];
		const responses = [paid(402), paid(200)];
		const out = await payWithChallengeRefresh({
			accept: accept({ amount: '1000' }),
			limits,
			pay: async (a) => (paidAmounts.push(a.amount), responses.shift()),
			reprobe: async () => challengeRes(accept({ amount: '2500' })),
		});
		expect(paidAmounts).toEqual(['1000', '2500']);
		expect(out.paidRes.status).toBe(200);
		expect(out.accept.amount).toBe('2500');
		expect(out.refreshed).toBe(true);
	});

	it('does not pay an unchanged challenge a second time', async () => {
		let pays = 0;
		const out = await payWithChallengeRefresh({
			accept: accept(),
			limits,
			pay: async () => (pays++, paid(402)),
			reprobe: async () => challengeRes(accept()),
		});
		expect(pays).toBe(1);
		expect(out.paidRes.status).toBe(402);
		expect(out.refreshed).toBe(false);
		expect(out.refreshSkipped).toBe('challenge_unchanged');
	});

	it('retries at most once even if the fresh payment is rejected too', async () => {
		let pays = 0;
		let probes = 0;
		const out = await payWithChallengeRefresh({
			accept: accept({ amount: '1000' }),
			limits,
			pay: async () => (pays++, paid(402)),
			reprobe: async () => (probes++, challengeRes(accept({ amount: String(1000 + probes) }))),
		});
		expect(pays).toBe(2);
		expect(probes).toBe(1);
		expect(out.paidRes.status).toBe(402);
	});

	it('refuses to pay a repriced challenge that breaks the cap', async () => {
		let pays = 0;
		const out = await payWithChallengeRefresh({
			accept: accept({ amount: '1000' }),
			limits: { ...limits, remainingCap: 1_500 },
			pay: async () => (pays++, paid(402)),
			reprobe: async () => challengeRes(accept({ amount: '9000' })),
		});
		expect(pays).toBe(1);
		expect(out.refreshSkipped).toBe('cap_would_exceed');
	});

	it('honours the admission gate on the refreshed challenge', async () => {
		let pays = 0;
		const out = await payWithChallengeRefresh({
			accept: accept(),
			limits,
			pay: async () => (pays++, paid(402)),
			reprobe: async () => challengeRes(accept({ extra: { feePayer: 'rotated' } })),
			admit: async (a) => ({ ok: a.extra.feePayer !== 'rotated', reason: 'fee_runway_exhausted' }),
		});
		expect(pays).toBe(1);
		expect(out.refreshSkipped).toBe('fee_runway_exhausted');
	});

	it('keeps the original response when the re-probe itself fails', async () => {
		const out = await payWithChallengeRefresh({
			accept: accept(),
			limits,
			pay: async () => paid(402),
			reprobe: async () => {
				throw new Error('network down');
			},
		});
		expect(out.paidRes.status).toBe(402);
		expect(out.refreshSkipped).toBe('reprobe_failed');
	});

	it('does not retry a non-402 failure such as a 502 (a signed payment is never replayed)', async () => {
		let pays = 0;
		let probes = 0;
		const out = await payWithChallengeRefresh({
			accept: accept(),
			limits,
			pay: async () => (pays++, paid(502)),
			reprobe: async () => (probes++, challengeRes(accept({ amount: '9' }))),
		});
		expect(pays).toBe(1);
		expect(probes).toBe(0);
		expect(out.paidRes.status).toBe(502);
	});
});
