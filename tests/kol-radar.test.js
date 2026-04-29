import { describe, it, expect } from 'vitest';
import { getRadarSignals } from '../src/kol/radar.js';

describe('getRadarSignals', () => {
	it('returns default pump-fun category sorted by score desc', async () => {
		const results = await getRadarSignals();
		expect(results.length).toBeGreaterThan(0);
		results.forEach((r) => expect(r.signalType).toBe('pump-fun'));
		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
		}
	});

	it('filters by volume-spike category', async () => {
		const results = await getRadarSignals({ category: 'volume-spike' });
		expect(results.length).toBeGreaterThan(0);
		results.forEach((r) => expect(r.signalType).toBe('volume-spike'));
	});

	it('filters by new-mints category', async () => {
		const results = await getRadarSignals({ category: 'new-mints' });
		expect(results.length).toBeGreaterThan(0);
		results.forEach((r) => expect(r.signalType).toBe('new-mints'));
	});

	it('caps limit at 100', async () => {
		const results = await getRadarSignals({ category: 'pump-fun', limit: 1000 });
		expect(results.length).toBeLessThanOrEqual(100);
	});

	it('respects explicit limit smaller than available entries', async () => {
		const results = await getRadarSignals({ category: 'volume-spike', limit: 2 });
		expect(results.length).toBeLessThanOrEqual(2);
	});

	it('result entries have required fields', async () => {
		const results = await getRadarSignals({ category: 'new-mints' });
		results.forEach((r) => {
			expect(r).toHaveProperty('mint');
			expect(r).toHaveProperty('name');
			expect(r).toHaveProperty('symbol');
			expect(r).toHaveProperty('signalType');
			expect(r).toHaveProperty('score');
			expect(r).toHaveProperty('ts');
		});
	});

	it('throws on unknown category', async () => {
		await expect(getRadarSignals({ category: 'unknown' })).rejects.toThrow(/Unknown category/);
	});
});
