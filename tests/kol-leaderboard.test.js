import { describe, it, expect } from 'vitest';
import { getLeaderboard } from '../src/kol/leaderboard.js';

describe('getLeaderboard', () => {
	it('returns items sorted descending by pnlUsd', async () => {
		const items = await getLeaderboard({ window: '7d', limit: 25 });
		expect(items.length).toBeGreaterThan(0);
		for (let i = 1; i < items.length; i++) {
			expect(items[i - 1].pnlUsd).toBeGreaterThanOrEqual(items[i].pnlUsd);
		}
	});

	it('assigns sequential rank starting at 1', async () => {
		const items = await getLeaderboard({ window: '7d', limit: 5 });
		items.forEach((item, i) => {
			expect(item.rank).toBe(i + 1);
		});
	});

	it('each item has required fields', async () => {
		const [first] = await getLeaderboard({ window: '7d', limit: 1 });
		expect(typeof first.wallet).toBe('string');
		expect(typeof first.pnlUsd).toBe('number');
		expect(typeof first.winRate).toBe('number');
		expect(typeof first.trades).toBe('number');
		expect(typeof first.rank).toBe('number');
	});

	it('rejects invalid window', async () => {
		await expect(getLeaderboard({ window: '1y' })).rejects.toThrow(/invalid window/);
	});

	it('caps limit at 100', async () => {
		const items = await getLeaderboard({ window: '7d', limit: 999 });
		expect(items.length).toBeLessThanOrEqual(100);
	});

	it('respects limit below seed size', async () => {
		const items = await getLeaderboard({ window: '7d', limit: 5 });
		expect(items.length).toBe(5);
	});

	it('works for 24h window', async () => {
		const items = await getLeaderboard({ window: '24h', limit: 10 });
		expect(items.length).toBeGreaterThan(0);
		for (let i = 1; i < items.length; i++) {
			expect(items[i - 1].pnlUsd).toBeGreaterThanOrEqual(items[i].pnlUsd);
		}
	});

	it('works for 30d window', async () => {
		const items = await getLeaderboard({ window: '30d', limit: 10 });
		expect(items.length).toBeGreaterThan(0);
	});

	it('defaults to 7d window and 25 limit', async () => {
		const items = await getLeaderboard();
		expect(items.length).toBeGreaterThan(0);
		expect(items.length).toBeLessThanOrEqual(25);
	});
});
