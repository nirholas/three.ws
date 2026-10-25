/**
 * The free-image quota must be reserved atomically before generation, so a burst
 * of concurrent requests from one IP cannot all generate on paid upstream lanes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reserveFreeQuota, releaseFreeQuota, peekFreeQuota, freePerDay, __resetFreeQuota } from '../api/_lib/ai-image-quota.js';

beforeEach(() => {
	__resetFreeQuota();
});

describe('reserveFreeQuota', () => {
	it('grants only the daily limit out of a concurrent burst', async () => {
		const limit = freePerDay();
		const results = await Promise.all(Array.from({ length: limit + 6 }, () => reserveFreeQuota('198.51.100.7')));
		expect(results.filter((r) => r.granted)).toHaveLength(limit);
		expect((await peekFreeQuota('198.51.100.7')).allowed).toBe(false);
	});

	it('gives a slot back on release', async () => {
		const ip = '198.51.100.8';
		const limit = freePerDay();
		for (let i = 0; i < limit; i++) await reserveFreeQuota(ip);
		expect((await reserveFreeQuota(ip)).granted).toBe(false);
		await releaseFreeQuota(ip);
		expect((await reserveFreeQuota(ip)).granted).toBe(true);
	});

	it('keeps separate budgets per IP', async () => {
		const limit = freePerDay();
		for (let i = 0; i < limit; i++) await reserveFreeQuota('198.51.100.9');
		expect((await reserveFreeQuota('198.51.100.10')).granted).toBe(true);
	});
});
