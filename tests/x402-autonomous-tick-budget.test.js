import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tickBudgetSpent, TICK_START_CUTOFF_MS } from '../api/_lib/x402/tick-budget.js';
import { DEFAULT_CRON_MAX_DURATION_MS } from '../api/_lib/http.js';

// 2026-11-05: x402-autonomous-loop answered 503 cron_timeout when a slow paid
// call (probe + pay + challenge refresh, 20s each) started late in a tick and
// carried it past wrapCron's 120s budget. The loop must stop starting calls
// while a worst-case call can still finish inside the budget.
describe('x402 autonomous tick budget', () => {
	it('leaves room for one worst-case paid call before the cron budget', () => {
		expect(TICK_START_CUTOFF_MS + 3 * 20_000).toBeLessThanOrEqual(DEFAULT_CRON_MAX_DURATION_MS);
	});

	it('allows new calls early and refuses them past the cutoff', () => {
		expect(tickBudgetSpent(1_000, 1_000 + 5_000)).toBe(false);
		expect(tickBudgetSpent(1_000, 1_000 + TICK_START_CUTOFF_MS)).toBe(true);
	});

	it('is enforced inside the entry loop', () => {
		const src = readFileSync(new URL('../api/cron/x402-autonomous-loop.js', import.meta.url), 'utf8');
		expect(src).toMatch(/tickBudgetSpent\(tickStartedAt/);
	});
});
