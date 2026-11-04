import { describe, it, expect } from 'vitest';
import { facilitatorMetrics } from '../api/_lib/x402/facilitator-metrics.js';
import { facilitatorPackage } from '../api/_lib/x402/facilitator-package.js';

// The query itself is Postgres; this pins the roll-up of its rows.
const rowsSql = (rows) => async () => rows;

describe('facilitatorMetrics', () => {
	it('keeps canary and external traffic apart and counts refusals by reason', async () => {
		const m = await facilitatorMetrics(
			rowsSql([
				{ action: 'settle', ok: true, origin: 'internal_canary', reason: '', n: 40, fee_lamports: '200000' },
				{ action: 'verify', ok: true, origin: 'internal_canary', reason: '', n: 41, fee_lamports: '0' },
				{ action: 'verify', ok: false, origin: 'external', reason: 'pay_to_not_allowlisted', n: 3, fee_lamports: '0' },
				{ action: 'settle', ok: false, origin: 'external', reason: 'settlement_pending', n: 1, fee_lamports: '5000' },
			]),
			new Set(['a']),
		);
		expect(m.internal_canary.settled).toBe(40);
		expect(m.internal_canary.sponsorLamportsBurned).toBe(200000);
		expect(m.external.settled).toBe(0);
		expect(m.external.pending).toBe(1);
		expect(m.external.refusals).toEqual({ pay_to_not_allowlisted: 3 });
	});

	it('reports the package version from package.json', () => {
		expect(facilitatorPackage()).toEqual({ name: '@three-ws/x402-server', version: '0.2.0' });
	});
});
