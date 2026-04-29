import { describe, it, expect } from 'vitest';
import { filterFirstClaims } from '../src/pump/first-claims.js';

const sinceTs = 1000; // boundary: claims < 1000 are "prior"

function claim(creator, ts, overrides = {}) {
	return { creator, mint: `mint_${ts}`, signature: `sig_${ts}`, lamports: 1e9, ts, ...overrides };
}

describe('filterFirstClaims — dedupe rule', () => {
	it('includes a creator whose only claim is within the window', () => {
		const result = filterFirstClaims([claim('A', 1200)], sinceTs, 50);
		expect(result).toHaveLength(1);
		expect(result[0].creator).toBe('A');
	});

	it('excludes a creator with any prior claim before sinceTs', () => {
		const result = filterFirstClaims(
			[
				claim('B', 500),  // prior — before sinceTs
				claim('B', 1200), // within window
			],
			sinceTs,
			50,
		);
		expect(result).toHaveLength(0);
	});

	it('handles multiple creators, only includes first-timers', () => {
		const claims = [
			claim('A', 1200), // new
			claim('B', 800),  // prior
			claim('B', 1300), // B also has a later claim, but excluded by prior
			claim('C', 1400), // new
		];
		const result = filterFirstClaims(claims, sinceTs, 50);
		const creators = result.map((r) => r.creator).sort();
		expect(creators).toEqual(['A', 'C']);
	});

	it('returns items sorted newest first', () => {
		const claims = [claim('A', 1200), claim('C', 1400)];
		const result = filterFirstClaims(claims, sinceTs, 50);
		expect(result[0].ts).toBe(1400);
		expect(result[1].ts).toBe(1200);
	});

	it('respects the limit', () => {
		const claims = Array.from({ length: 10 }, (_, i) =>
			claim(`creator_${i}`, 1100 + i),
		);
		const result = filterFirstClaims(claims, sinceTs, 3);
		expect(result).toHaveLength(3);
	});

	it('returns the earliest claim per creator (the first-claim event)', () => {
		// Creator with two claims both within window — should surface the earlier one.
		const claims = [claim('D', 1300), claim('D', 1100)];
		const result = filterFirstClaims(claims, sinceTs, 50);
		expect(result).toHaveLength(1);
		expect(result[0].ts).toBe(1100);
	});

	it('returns empty array when all creators have prior claims', () => {
		const result = filterFirstClaims(
			[claim('X', 100), claim('Y', 200), claim('Z', 500)],
			sinceTs,
			50,
		);
		expect(result).toHaveLength(0);
	});

	it('returns empty array for empty input', () => {
		expect(filterFirstClaims([], sinceTs, 50)).toEqual([]);
	});

	it('claim at exactly sinceTs boundary is included (>= rule)', () => {
		const result = filterFirstClaims([claim('E', sinceTs)], sinceTs, 50);
		expect(result).toHaveLength(1);
	});

	it('claim one second before sinceTs is excluded', () => {
		const result = filterFirstClaims([claim('F', sinceTs - 1)], sinceTs, 50);
		expect(result).toHaveLength(0);
	});
});
