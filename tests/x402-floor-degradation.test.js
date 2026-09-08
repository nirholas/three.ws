// A sponsor wallet under its SOL floor is transient capacity, not an outage,
// and every layer must say so consistently.
//
// During the July 2026 dry spells the floor-refused settles surfaced as 502
// settle_failed (tens of thousands of rows), so trust monitors, buyers, and
// our own pipelines all read a funding gap as a broken platform. Three rules
// now hold:
//   1. settlePayment maps floor-class failure reasons to a 503
//      settlement_unavailable X402Error (unknown failures stay 502).
//   2. The settle path records the observed floor state, readable
//      synchronously via sponsorKnownBelowFloor().
//   3. While the floor state is fresh, the 402 challenge builder stops
//      advertising the Solana accept (and classifies an all-dropped accepts
//      list as 503, never the 500 no_payto_configured misconfig error).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// callFacilitator is internal to x402-spec.js and reaches its facilitator over
// fetch, so the failure envelope is injected at the fetch boundary.
const facilitatorReply = (errorReason) =>
	vi.fn(async () => new Response(JSON.stringify({ success: false, errorReason }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	}));

async function settleAgainst(errorReason) {
	vi.resetModules();
	process.env.X402_FACILITATOR_URL_SOLANA = 'https://facilitator.test';
	vi.stubGlobal('fetch', facilitatorReply(errorReason));
	const { settlePayment } = await import('../api/_lib/x402-spec.js');
	try {
		await settlePayment({
			requirement: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo: 'x', amount: '1000' },
			paymentPayload: { fake: true },
		});
		return null;
	} catch (err) {
		return err;
	} finally {
		vi.unstubAllGlobals();
	}
}

describe('settlePayment floor classification', () => {
	it('maps fee_wallet_below_floor to 503 settlement_unavailable', async () => {
		const err = await settleAgainst('fee_wallet_below_floor:19883918<20000000');
		expect(err).toMatchObject({ code: 'settlement_unavailable', status: 503 });
	});

	// The wallet fee governor refuses for the same reason class and was missed by
	// the floor branch, so it kept answering 502 long after the floor stopped:
	// 15,619 of the autonomous loop's 20,030 `http_502` rows in the 48h to
	// 2026-08-06 were this one refusal wearing a server-fault status.
	// A wallet that clears the floor but cannot afford this settle's ATA rent is
	// the same transient funding gap, and must not read as a broken endpoint.
	it('maps fee_wallet_cannot_cover_settle to 503 settlement_unavailable', async () => {
		const err = await settleAgainst('fee_wallet_cannot_cover_settle:2100000-2049281<2000000');
		expect(err).toMatchObject({ code: 'settlement_unavailable', status: 503 });
	});

	it('maps fee_runway_exhausted to 503 settlement_unavailable', async () => {
		const err = await settleAgainst('fee_runway_exhausted:10132243+10000>10000000');
		expect(err).toMatchObject({ code: 'settlement_unavailable', status: 503 });
	});

	it('keeps unexplained settle failures as 502 settle_failed', async () => {
		const err = await settleAgainst('facilitator exploded');
		expect(err).toMatchObject({ code: 'settle_failed', status: 502 });
	});
});

describe('sponsorKnownBelowFloor', () => {
	beforeEach(() => vi.resetModules());

	it('reflects the last balance the settle path observed for the sponsor', async () => {
		// The state gates the SPONSORED accept, so only the advertised fee payer
		// may write it. A read of any other wallet is somebody else's balance.
		const SPONSOR = 'SponsorSponsorSponsorSponsorSponsorSponsor1';
		process.env.X402_FEE_PAYER_SOLANA = SPONSOR;
		const { sponsorSolLamports, sponsorKnownBelowFloor } = await import('../api/_lib/x402/self-facilitator.js');
		const pubkey = { toBase58: () => SPONSOR };

		// Fresh module: no observation yet, must fail open (not paused).
		expect(sponsorKnownBelowFloor()).toBe(false);

		const t0 = Date.now();
		await sponsorSolLamports({ getBalance: async () => 19_000_000 }, pubkey, t0);
		expect(sponsorKnownBelowFloor(t0)).toBe(true);

		// A later healthy read of the SAME wallet clears it. The read is dated
		// past the balance cache TTL so it actually re-reads rather than
		// replaying the dry observation.
		const t1 = t0 + 10 * 60_000;
		await sponsorSolLamports({ getBalance: async () => 500_000_000 }, pubkey, t1);
		expect(sponsorKnownBelowFloor(t1)).toBe(false);
	});

	it('ignores a healthy balance read for a wallet that is not the sponsor', async () => {
		// A self-pay buyer pays its own fee, so its balance says nothing about
		// whether the sponsor can still settle. Letting it write the shared state
		// re-advertised sponsored accepts that were guaranteed to fail.
		process.env.X402_FEE_PAYER_SOLANA = 'SponsorSponsorSponsorSponsorSponsorSponsor1';
		const { sponsorSolLamports, sponsorKnownBelowFloor } = await import('../api/_lib/x402/self-facilitator.js');

		const t0 = Date.now();
		await sponsorSolLamports(
			{ getBalance: async () => 19_000_000 },
			{ toBase58: () => 'SponsorSponsorSponsorSponsorSponsorSponsor1' },
			t0,
		);
		expect(sponsorKnownBelowFloor(t0)).toBe(true);

		await sponsorSolLamports(
			{ getBalance: async () => 500_000_000 },
			{ toBase58: () => 'BuyerBuyerBuyerBuyerBuyerBuyerBuyerBuyer22' },
			t0,
		);
		expect(sponsorKnownBelowFloor(t0)).toBe(true);
	});

	it('warms itself on instances that never settle', async () => {
		// The gap this closes: the floor state used to be written only by the
		// settle path, so an instance serving nothing but 402 challenges kept
		// advertising a Solana accept while the sponsor was dry.
		process.env.X402_FEE_PAYER_SOLANA = 'SponsorSponsorSponsorSponsorSponsorSponsor9';
		vi.doMock('../api/_lib/solana/connection.js', () => ({
			solanaConnection: () => ({ getBalance: async () => 19_000_000 }),
		}));
		const { refreshSponsorFloorState, sponsorKnownBelowFloor } = await import('../api/_lib/x402/self-facilitator.js');

		expect(sponsorKnownBelowFloor()).toBe(false); // nothing observed yet
		refreshSponsorFloorState();
		await new Promise((r) => setTimeout(r, 20)); // fire-and-forget settles
		expect(sponsorKnownBelowFloor()).toBe(true);
		vi.doUnmock('../api/_lib/solana/connection.js');
	});

	it('leaves the state untouched when the balance read fails', async () => {
		process.env.X402_FEE_PAYER_SOLANA = 'SponsorSponsorSponsorSponsorSponsorSponsorA';
		vi.doMock('../api/_lib/solana/connection.js', () => ({
			solanaConnection: () => ({ getBalance: async () => { throw new Error('rpc down'); } }),
		}));
		const { refreshSponsorFloorState, sponsorKnownBelowFloor } = await import('../api/_lib/x402/self-facilitator.js');

		refreshSponsorFloorState();
		await new Promise((r) => setTimeout(r, 20));
		// Fail open: an RPC outage must not pause payments.
		expect(sponsorKnownBelowFloor()).toBe(false);
		vi.doUnmock('../api/_lib/solana/connection.js');
	});

	it('expires: a stale observation stops pausing the challenge', async () => {
		const SPONSOR = 'SponsorSponsorSponsorSponsorSponsorSponsor3';
		process.env.X402_FEE_PAYER_SOLANA = SPONSOR;
		const { sponsorSolLamports, sponsorKnownBelowFloor } = await import('../api/_lib/x402/self-facilitator.js');
		const pubkey = { toBase58: () => SPONSOR };
		await sponsorSolLamports({ getBalance: async () => 19_000_000 }, pubkey);

		expect(sponsorKnownBelowFloor(Date.now())).toBe(true);
		expect(sponsorKnownBelowFloor(Date.now() + 61_000)).toBe(false);
	});
});
