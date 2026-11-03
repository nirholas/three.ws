// Regression: api/_lib/fixed-launch.js used the `sql` tag in recordFixedLaunch
// and getFixedLaunch without importing it, so both threw a ReferenceError.

import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const sql = (strings, ...vals) => {
		h.calls.push({ text: strings.join('?'), vals });
		return Promise.resolve([{ id: 'row1', mint: 'M', network: 'mainnet' }]);
	};
	return { ...actual, sql };
});

process.env.DATABASE_URL ||= 'postgres://stub.test/db';

describe('fixed-launch persistence', () => {
	it('recordFixedLaunch inserts through the db sql tag', async () => {
		const { recordFixedLaunch } = await import('../api/_lib/fixed-launch.js');
		const row = await recordFixedLaunch({
			userId: 'u1', mint: 'M', launchAccount: 'L', creator: 'C', signatures: ['s1'],
			launch: { name: 'n', symbol: 's', image_url: 'i', token_allocation: 5e7, raise_goal_sol: 250, liquidity_bps: 2000, deposit_start_at: 't0', deposit_end_at: 't1' },
		});
		expect(row.id).toBe('row1');
		expect(h.calls[0].text).toMatch(/INSERT INTO fixed_supply_launches/);
	});

	it('getFixedLaunch reads through the db sql tag', async () => {
		const { getFixedLaunch } = await import('../api/_lib/fixed-launch.js');
		await expect(getFixedLaunch({ mint: 'M' })).resolves.toBeTruthy();
	});
});
