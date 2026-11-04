import { describe, it, expect } from 'vitest';
import { BUDGET, BUDGET_PAGES, checkBudget } from '../scripts/lib/mobile-perf-budget.mjs';

const ok = (label, over = {}) => ({ label, okRuns: 1, lcp: 3000, cls: 0.02, tbtProxy: 300, ...over });

describe('mobile perf budget', () => {
	it('passes when every page is inside LCP 4000, CLS 0.1 and TBT* 600', () => {
		expect(checkBudget([ok('home'), ok('play')])).toEqual({ pass: true, failures: [] });
	});
	it('fails the metric that is over, naming page and limit', () => {
		const v = checkBudget([ok('home', { lcp: 7356 }), ok('play', { cls: 0.5, tbtProxy: 45900 })]);
		expect(v.pass).toBe(false);
		expect(v.failures).toEqual([
			{ label: 'home', metric: 'lcp', value: 7356, limit: BUDGET.lcp },
			{ label: 'play', metric: 'cls', value: 0.5, limit: BUDGET.cls },
			{ label: 'play', metric: 'tbtProxy', value: 45900, limit: BUDGET.tbtProxy },
		]);
	});
	it('treats the limit itself as over budget (strictly under)', () => {
		expect(checkBudget([ok('x', { lcp: 4000 })]).pass).toBe(false);
	});
	it('fails a page that never loaded or reported no value', () => {
		expect(checkBudget([{ label: 'forge', okRuns: 0 }]).failures[0].metric).toBe('load');
		expect(checkBudget([ok('coin', { cls: null })]).failures[0]).toMatchObject({ metric: 'cls', value: null });
	});
	it('gates the five fixed pages (the agent profile id is resolved at runtime)', () => {
		expect(BUDGET_PAGES.map((p) => p.path)).toEqual(['/', '/play', '/marketplace', '/forge', '/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump']);
	});
});
