import { describe, it, expect } from 'vitest';

// cacheWrapLastGood used to wait for the whole live refresh before it would
// look at the last-good copy. When the fresh window lapsed on a throttled
// upstream (GeckoTerminal behind /api/ibm/oracle, which /play loads for the
// oracle ribbon) the caller sat through every retry and timeout, 16 s in
// production, while a perfectly good copy was already in the store. With a
// refresh budget the caller gets the last-good copy once the budget is spent,
// and the slow refresh still lands in the cache for the next reader.
import { cacheWrapLastGood, cacheGet } from '../api/_lib/cache.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed(key, value) {
	await cacheWrapLastGood(key, 1, async () => value, { staleTtlSeconds: 60 });
	await sleep(1100);
}

describe('cacheWrapLastGood refresh budget', () => {
	it('serves the last-good copy when the live refresh outlives the budget', async () => {
		const key = `t:budget:slow:${Date.now()}`;
		await seed(key, { v: 'old' });
		let finish;
		const slow = new Promise((resolve) => { finish = resolve; });
		const started = Date.now();
		const out = await cacheWrapLastGood(key, 1, () => slow, {
			staleTtlSeconds: 60,
			refreshBudgetMs: 80,
			withMeta: true,
		});
		expect(Date.now() - started).toBeLessThan(1000);
		expect(out).toEqual({ value: { v: 'old' }, stale: true });

		finish({ v: 'new' });
		await sleep(50);
		expect(await cacheGet(key)).toEqual({ v: 'new' });
	});

	it('returns the live value when it lands inside the budget', async () => {
		const key = `t:budget:fast:${Date.now()}`;
		await seed(key, { v: 'old' });
		const out = await cacheWrapLastGood(key, 1, async () => ({ v: 'fresh' }), {
			staleTtlSeconds: 60,
			refreshBudgetMs: 500,
			withMeta: true,
		});
		expect(out).toEqual({ value: { v: 'fresh' }, stale: false });
	});

	it('waits for the live fetch when no last-good copy exists', async () => {
		const key = `t:budget:cold:${Date.now()}`;
		const out = await cacheWrapLastGood(
			key,
			1,
			async () => { await sleep(150); return { v: 'first' }; },
			{ staleTtlSeconds: 60, refreshBudgetMs: 20, withMeta: true },
		);
		expect(out).toEqual({ value: { v: 'first' }, stale: false });
	});

	it('still serves last-good when the refresh throws inside the budget', async () => {
		const key = `t:budget:throw:${Date.now()}`;
		await seed(key, { v: 'old' });
		const out = await cacheWrapLastGood(key, 1, async () => { throw new Error('429'); }, {
			staleTtlSeconds: 60,
			refreshBudgetMs: 500,
			withMeta: true,
		});
		expect(out).toEqual({ value: { v: 'old' }, stale: true });
	});
});
