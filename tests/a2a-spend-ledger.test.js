// Without Redis the mandate spend ledger fell back to a per-instance Map. On a
// multi-instance production deploy that multiplies a mandate's total budget by
// the instance count, so production must refuse (fail closed) instead.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));

const { reserve, spent, release, _resetMemoryStore } = await import('../api/_lib/a2a/spend-ledger.js');

const original = process.env.NODE_ENV;
afterEach(() => {
	process.env.NODE_ENV = original;
	_resetMemoryStore();
});

describe('spend ledger without Redis', () => {
	it('keeps the in-memory fallback outside production', async () => {
		process.env.NODE_ENV = 'test';
		const r = await reserve('m1', 5, 10, 60);
		expect(r.ok).toBe(true);
		expect(await spent('m1')).toBe(5);
	});

	it('refuses to reserve or read in production', async () => {
		process.env.NODE_ENV = 'production';
		await expect(reserve('m2', 5, 10, 60)).rejects.toThrow('spend ledger unavailable');
		await expect(spent('m2')).rejects.toThrow('spend ledger unavailable');
	});

	it('answers a release in production without throwing into the failure path', async () => {
		process.env.NODE_ENV = 'production';
		await expect(release('m3', 1)).resolves.toBe(-1);
	});
});
