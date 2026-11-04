// api/_lib/a2a/mandate.js: an Intent Mandate's currency pin cannot be emptied
// or pointed at an arbitrary asset.
//
// The A2A rails settle in USDC only, and the agent spend guard prices a payment
// in dollars only when it is USDC (a2a-call.js spendUsdOf returns null for any
// other asset, which skips the per-transaction, daily and per-counterparty USD
// ceilings). The mandate's currency pin is what keeps every A2A payment USDC.
// It used to accept any string: `currency: ""` slipped past the destructure
// default, and assertMandateAllows skipped the pin whenever the mandate's
// currency was falsy, so a self-issued mandate could authorize paying a peer
// in any asset, unpriced and outside the owner's USD limits. A mandate whose
// currency is anything but a settled currency is now refused at issuance, and
// one that was signed before this fix is refused at spend time.

import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
	process.env.A2A_MANDATE_SECRET = 'a2a-mandate-currency-pin-test-secret-0123456789';
});

const { issueIntentMandate, assertMandateAllows, MandateError } = await import('../api/_lib/a2a/mandate.js');

const issue = (currency) =>
	issueIntentMandate({
		ownerUserId: 'user-1',
		subjectAgentId: 'agent-1',
		maxAtomics: '1000000',
		perCallAtomics: '100000',
		currency,
		ttlSec: 600,
	});

// A clearly synthetic SPL mint id, standing in for "some asset that is not USDC".
const OTHER_ASSET = 'THREEsynthetic1111111111111111111111111111';

describe('issueIntentMandate currency', () => {
	it('defaults to USDC', async () => {
		const { mandate } = await issue(undefined);
		expect(mandate.currency).toBe('USDC');
	});

	it('accepts USDC explicitly', async () => {
		const { mandate } = await issue('USDC');
		expect(mandate.currency).toBe('USDC');
	});

	it('refuses an empty currency instead of signing a mandate with no pin', async () => {
		await expect(issue('')).rejects.toMatchObject({ code: 'unsupported_currency' });
	});

	it('refuses an arbitrary asset id', async () => {
		await expect(issue(OTHER_ASSET)).rejects.toMatchObject({ code: 'unsupported_currency' });
	});

	it('refuses a non-string currency', async () => {
		await expect(issue(42)).rejects.toBeInstanceOf(MandateError);
	});
});

describe('assertMandateAllows currency pin', () => {
	const base = { amountAtomics: '10', network: undefined, resource: undefined, nowSec: 1 };
	const mandate = (currency) => ({ perCallAtomics: '1000', currency, networks: [], resources: [], expiresAt: 0 });

	it('allows a USDC payment under a USDC mandate', () => {
		expect(() => assertMandateAllows({ ...base, mandate: mandate('USDC'), currency: 'USDC' })).not.toThrow();
	});

	it('rejects a non-USDC payment under a USDC mandate', () => {
		expect(() => assertMandateAllows({ ...base, mandate: mandate('USDC'), currency: OTHER_ASSET })).toThrow(
			/mandate authorizes USDC/,
		);
	});

	it('rejects any payment under a mandate signed with an empty currency', () => {
		let err;
		try {
			assertMandateAllows({ ...base, mandate: mandate(''), currency: OTHER_ASSET });
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(MandateError);
		expect(err.code).toBe('unsupported_currency');
	});

	it('rejects any payment under a mandate signed for an arbitrary asset', () => {
		let err;
		try {
			assertMandateAllows({ ...base, mandate: mandate(OTHER_ASSET), currency: OTHER_ASSET });
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(MandateError);
		expect(err.code).toBe('unsupported_currency');
	});
});
