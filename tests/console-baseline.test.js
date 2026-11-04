import { describe, it, expect } from 'vitest';
import { diffAgainstBaseline, mergeBaseline } from '../scripts/lib/console-baseline.mjs';

describe('console sweep baseline', () => {
	const empty = { routes: {} };

	it('treats a missing baseline entry as zero, so any error is a regression', () => {
		const { regressions } = diffAgainstBaseline(empty, { '/forge': { desktop: 1, mobile: 0 } });
		expect(regressions).toEqual([{ route: '/forge', viewport: 'desktop', was: 0, now: 1 }]);
	});

	it('accepts a count at or below its baseline and reports the drop as an improvement', () => {
		const baseline = { routes: { '/a': { desktop: 2 }, '/b': { mobile: 1 } } };
		const d = diffAgainstBaseline(baseline, { '/a': { desktop: 2 }, '/b': { mobile: 0 } });
		expect(d.regressions).toEqual([]);
		expect(d.improvements).toEqual([{ route: '/b', viewport: 'mobile', was: 1, now: 0 }]);
	});

	it('flags a count that rises above its baseline', () => {
		const d = diffAgainstBaseline({ routes: { '/a': { desktop: 1 } } }, { '/a': { desktop: 3 } });
		expect(d.regressions).toEqual([{ route: '/a', viewport: 'desktop', was: 1, now: 3 }]);
	});

	it('does not judge routes or viewports that were not measured', () => {
		const d = diffAgainstBaseline({ routes: { '/a': { desktop: 4, mobile: 4 } } }, { '/b': { desktop: 0 } });
		expect(d).toEqual({ regressions: [], improvements: [] });
	});

	it('merges measured counts, drops zeros, keeps unmeasured entries, sorts routes', () => {
		const merged = mergeBaseline(
			{ routes: { '/z': { desktop: 1 }, '/a': { desktop: 2, mobile: 1 } } },
			{ '/a': { desktop: 0 }, '/m': { desktop: 5 } },
		);
		expect(merged).toEqual({ routes: { '/a': { mobile: 1 }, '/m': { desktop: 5 }, '/z': { desktop: 1 } } });
		expect(Object.keys(merged.routes)).toEqual(['/a', '/m', '/z']);
	});
});
