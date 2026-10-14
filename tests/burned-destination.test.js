// classifySweepPattern is pure: no RPC, no network. These tests build
// synthetic recorded-transaction-history deltas (never a real wallet) to
// exercise every verdict branch, including the chronological-ordering fix
// over the upstream CLI this module was ported from (see the file header in
// api/_lib/burned-destination.js): an outflow is only "quick" if it follows
// the nearest PRIOR inflow within the window, not merely an inflow seen
// later in an unsorted scan.

import { describe, expect, it } from 'vitest';
import { classifySweepPattern, NEAR_ZERO_LAMPORTS, QUICK_OUT_WINDOW_MS } from '../api/_lib/burned-destination.js';

const T0 = 1_700_000_000_000;

describe('classifySweepPattern', () => {
	it('flags a destination that is drained within seconds of every inflow, repeatedly', () => {
		const deltas = [
			{ deltaSol: 0.5, blockTimeMs: T0 },
			{ deltaSol: -0.49, blockTimeMs: T0 + 5_000 },
			{ deltaSol: 1.2, blockTimeMs: T0 + 60_000 },
			{ deltaSol: -1.18, blockTimeMs: T0 + 65_000 },
		];
		const result = classifySweepPattern({ balanceLamports: 1000, deltas, sigCount: 4, sigLimit: 25 });
		expect(result.verdict).toBe('likely_swept');
		expect(result.flagged).toBe(true);
		expect(result.quickOutflows).toBe(2);
	});

	it('flags a near-zero destination with churn when history is truncated at the signature limit, even without a timed quick-out', () => {
		const deltas = [
			{ deltaSol: 2, blockTimeMs: T0 },
			{ deltaSol: -2, blockTimeMs: T0 + 10 * 60_000 },
		];
		const result = classifySweepPattern({ balanceLamports: 0, deltas, sigCount: 25, sigLimit: 25 });
		expect(result.verdict).toBe('likely_swept');
		expect(result.flagged).toBe(true);
	});

	it('does not flag a near-zero destination whose single old outflow is unrelated to a much later inflow', () => {
		// Chronologically: inflow, then (long after) an outflow, with nothing
		// quick about the gap. Feeding these in reverse order is exactly what
		// trips up an unsorted, newest-first scan like the upstream CLI's.
		const deltas = [
			{ deltaSol: -1, blockTimeMs: T0 + 10 * 60_000 },
			{ deltaSol: 1, blockTimeMs: T0 },
		];
		const result = classifySweepPattern({ balanceLamports: 0, deltas, sigCount: 2, sigLimit: 25 });
		expect(result.quickOutflows).toBe(0);
		expect(result.verdict).toBe('empty_active_history');
		expect(result.flagged).toBe(false);
	});

	it('reports "empty, active history" for a near-zero address with activity but no churn pattern', () => {
		const deltas = [{ deltaSol: 1, blockTimeMs: T0 }];
		const result = classifySweepPattern({ balanceLamports: 0, deltas, sigCount: 1, sigLimit: 25 });
		expect(result.verdict).toBe('empty_active_history');
		expect(result.flagged).toBe(false);
	});

	it('reports "holds a balance" for a funded address regardless of history', () => {
		const result = classifySweepPattern({ balanceLamports: NEAR_ZERO_LAMPORTS + 1, deltas: [], sigCount: 0, sigLimit: 25 });
		expect(result.verdict).toBe('holds_balance');
		expect(result.flagged).toBe(false);
	});

	it('reports "no activity" for an empty, never-used address', () => {
		const result = classifySweepPattern({ balanceLamports: 0, deltas: [], sigCount: 0, sigLimit: 25 });
		expect(result.verdict).toBe('no_activity');
		expect(result.flagged).toBe(false);
	});

	it('treats an outflow exactly at the quick-out window boundary as quick', () => {
		const deltas = [
			{ deltaSol: 1, blockTimeMs: T0 },
			{ deltaSol: -1, blockTimeMs: T0 + QUICK_OUT_WINDOW_MS },
		];
		const result = classifySweepPattern({ balanceLamports: 0, deltas, sigCount: 2, sigLimit: 25 });
		expect(result.quickOutflows).toBe(1);
		expect(result.verdict).toBe('likely_swept');
	});
});
