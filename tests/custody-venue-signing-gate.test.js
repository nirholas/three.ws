// An agent in external or session signing mode must get a clean 409 from the
// perps and predictions boundaries, not a 500, when the platform refuses to sign.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: Object.assign(async () => [], { transaction: async () => [] }) }));

import { assertPlatformSigningAllowed } from '../api/_lib/custody/signing.js';
import { describeError as describePerps } from '../api/_lib/perps/service.js';
import { describeError as describePredictions } from '../api/_lib/predictions/engine.js';

function refusal() {
	return Object.assign(new Error('This agent is in external signing mode, so the platform will not sign for it.'), {
		status: 409, code: 'platform_signing_disabled', expose: true, signerMode: 'external',
	});
}

describe('platform_signing_disabled at the venue boundaries', () => {
	it('perps reports it as a 409 with its code', () => {
		const d = describePerps(refusal());
		expect(d).toMatchObject({ status: 409, code: 'platform_signing_disabled' });
	});
	it('predictions reports it as a 409 with its code', () => {
		const d = describePredictions(refusal());
		expect(d).toMatchObject({ status: 409, code: 'platform_signing_disabled' });
	});
	it('still ignores unrelated errors', () => {
		expect(describePerps(new Error('boom'))).toBeNull();
		expect(describePredictions(new Error('boom'))).toBeNull();
	});
	it('assertPlatformSigningAllowed passes for a platform-mode agent', async () => {
		await expect(assertPlatformSigningAllowed('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
	});
});
