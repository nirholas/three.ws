// IRL drop claims are idempotent per payout wallet, not only per claimant key.
//
// An anonymous claimant's identity is the x-irl-device header, a string the
// client picks. Keying the "one claim per person" rule on that alone let one
// person rotate the header and drain every slot of a multi-claim drop into a
// single wallet. reserveClaim must refuse a second live claim to the same
// claim_wallet on the same drop, both in the INSERT guard and in the
// "already claimed" diagnosis that picks the error the caller sees.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		calls.push({ text: strings.join('?'), values });
		return [{ claim_id: null, drop_status: 'active', is_expired: false, is_full: false, already: true }];
	}),
}));

const { reserveClaim } = await import('../api/_lib/irl-drops.js');

const WALLET = 'So11111111111111111111111111111111111111112';

describe('reserveClaim binds the payout wallet into the one-claim rule', () => {
	beforeEach(() => { calls.length = 0; });

	it('checks claim_wallet alongside claimant_key in the insert guard and the diagnosis', async () => {
		const r = await reserveClaim({
			dropId: '00000000-0000-4000-8000-000000000001',
			claimantDevice: 'device-rotated-123',
			claimantKey: 'd:device-rotated-123',
			claimWallet: WALLET,
		});
		expect(r).toEqual({ ok: false, reason: 'already_claimed' });
		expect(calls).toHaveLength(1);
		const { text, values } = calls[0];
		const walletChecks = text.match(/c\.claim_wallet = \?/g) || [];
		expect(walletChecks).toHaveLength(2);
		expect(values.filter((v) => v === WALLET).length).toBeGreaterThanOrEqual(3);
	});

	it('still refuses a malformed wallet before touching the database', async () => {
		await expect(reserveClaim({ dropId: 'x', claimantKey: 'd:a', claimWallet: 'not a wallet' }))
			.rejects.toMatchObject({ status: 400 });
		expect(calls).toHaveLength(0);
	});
});
