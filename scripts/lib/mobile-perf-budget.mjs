// Mobile web-vitals budget for scripts/mobile-perf.mjs --budget.
// Pure: takes the harness's summarised results and returns the verdicts.

export const BUDGET = { lcp: 4000, cls: 0.1, tbtProxy: 600 };

export const BUDGET_PAGES = [
	{ path: '/', label: 'home' },
	{ path: '/play', label: 'play' },
	{ path: '/marketplace', label: 'marketplace' },
	{ path: '/forge', label: 'forge' },
	{ path: '/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump', label: 'coin ($THREE)' },
];

// Returns { pass, failures: [{ label, metric, value, limit }] }. A page whose
// runs all failed to load, or that reported no value for a metric, fails: an
// unmeasured page is not a passing page.
export function checkBudget(results, budget = BUDGET) {
	const failures = [];
	for (const r of results) {
		if (!r.okRuns) {
			failures.push({ label: r.label, metric: 'load', value: null, limit: null });
			continue;
		}
		for (const metric of Object.keys(budget)) {
			const value = r[metric];
			if (value === null || value === undefined || Number.isNaN(value) || value >= budget[metric]) {
				failures.push({ label: r.label, metric, value: value ?? null, limit: budget[metric] });
			}
		}
	}
	return { pass: failures.length === 0, failures };
}
