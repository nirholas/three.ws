// A paid endpoint's job is RECEIVING crypto. It must not stop doing that
// because the wallet we use to sponsor buyers' gas ran dry.
//
// Sponsoring is a convenience: three.ws pays the Solana fee so a buyer holding
// only USDC can pay without owning SOL. It is not a precondition for taking
// money. The x402 rail already supports self-pay end to end (settleRingPayment
// broadcasts a fully-signed buyer-paid transaction without touching a sponsor
// key), but buildRequirements used to DROP the Solana accept entirely when the
// sponsor was under its SOL floor, so /club answered 503 on both the cover
// charge and every dance tip for four days while the payTo wallet sat there
// perfectly able to receive.
//
// The contract these tests pin: no sponsor means the accept is advertised
// WITHOUT `extra.feePayer`, which is the wire signal that the buyer signs as
// their own fee payer.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SPONSOR = 'WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW';
const PAY_TO = 'wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const ENV = {
	X402_PAY_TO_SOLANA: PAY_TO,
	X402_ASSET_MINT_SOLANA: USDC,
	X402_FEE_PAYER_SOLANA: SPONSOR,
	THREE_TOKEN_MINT: THREE,
	X402_ACCEPT_THREE_SOLANA: 'true',
	X402_SELF_FACILITATOR_ENABLED: 'true',
	// Non-empty means the sponsor co-signing key is loaded, so solanaSettleable()
	// reports sponsor mode available. Never parsed by buildRequirements.
	X402_FEE_PAYER_SECRET_BASE58: 'test-cosigning-key-present',
};

// Cleared per test so facilitator routing is decided by X402_SELF_FACILITATOR_ENABLED
// rather than by whatever the ambient environment happens to point at.
const CLEARED = ['X402_FACILITATOR_URL_SOLANA', 'X402_RING_SELF_PAY'];

let saved;
beforeEach(() => {
	saved = {};
	for (const [k, v] of Object.entries(ENV)) {
		saved[k] = process.env[k];
		process.env[k] = v;
	}
	for (const k of CLEARED) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
	vi.resetModules();
});
afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	vi.restoreAllMocks();
	vi.resetModules();
});

/** Load buildRequirements with the sponsor's floor state stubbed. */
async function requirementsWith({ belowFloor }) {
	vi.doMock('../api/_lib/x402/self-facilitator.js', () => ({
		sponsorKnownBelowFloor: () => belowFloor,
		refreshSponsorFloorState: () => {},
	}));
	const { buildRequirements } = await import('../api/_lib/x402-paid-endpoint.js');
	return buildRequirements({
		priceAtomics: '1000',
		networks: ['solana'],
		resourceUrl: 'https://three.ws/api/x402/dance-tip',
	});
}

const solanaAccepts = (list) => list.filter((a) => String(a.network).startsWith('solana'));

describe('a dry sponsor keeps the endpoint payable via self-pay', () => {
	it('still advertises Solana when the sponsor is below its floor', async () => {
		const accepts = await requirementsWith({ belowFloor: true });
		// The regression: this list used to come back empty and the endpoint 503'd.
		expect(solanaAccepts(accepts).length).toBeGreaterThan(0);
	});

	it('omits feePayer on every Solana accept when the sponsor is dry', async () => {
		const accepts = solanaAccepts(await requirementsWith({ belowFloor: true }));
		for (const accept of accepts) {
			expect(accept.extra).toBeDefined();
			expect(accept.extra.feePayer).toBeUndefined();
		}
		// Both tokens stay on the menu, so $THREE does not quietly disappear the
		// moment the sponsor runs out.
		expect(accepts.map((a) => a.asset)).toEqual([USDC, THREE]);
	});

	it('keeps sponsoring gas while the sponsor is healthy', async () => {
		const accepts = solanaAccepts(await requirementsWith({ belowFloor: false }));
		expect(accepts.length).toBeGreaterThan(0);
		for (const accept of accepts) {
			expect(accept.extra.feePayer).toBe(SPONSOR);
		}
	});

	it('falls back to self-pay when no sponsor is configured at all', async () => {
		delete process.env.X402_FEE_PAYER_SOLANA;
		const accepts = solanaAccepts(await requirementsWith({ belowFloor: false }));
		// Previously this dropped Solana too, so a deployment that never set a
		// sponsor could not take Solana payments at all.
		expect(accepts.length).toBeGreaterThan(0);
		for (const accept of accepts) {
			expect(accept.extra.feePayer).toBeUndefined();
		}
	});

	it('keeps the sponsor as fee payer when an EXTERNAL facilitator settles', async () => {
		// PayAI and friends pin the sponsor as fee payer and reject a challenge
		// without one at /verify, so the self-pay fallback must not apply there:
		// it would trade a retryable 503 for a hard verify failure.
		process.env.X402_FACILITATOR_URL_SOLANA = 'https://facilitator.payai.network';
		const accepts = solanaAccepts(await requirementsWith({ belowFloor: true }));
		for (const accept of accepts) {
			expect(accept.extra.feePayer).toBe(SPONSOR);
		}
	});

	it('still refuses to advertise Solana when the receiving address is missing', async () => {
		// Self-pay fixes who pays gas. It cannot conjure somewhere to send the
		// money, so a genuinely unconfigured lane must stay unadvertised, and with
		// Solana the only requested network that leaves nothing payable at all.
		delete process.env.X402_PAY_TO_SOLANA;
		await expect(requirementsWith({ belowFloor: false })).rejects.toMatchObject({
			code: 'no_payto_configured',
		});
	});
});
