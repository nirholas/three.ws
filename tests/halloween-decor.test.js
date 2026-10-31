import { describe, it, expect } from 'vitest';

// The decor module touches window only when the weekend is live; placements are pure.
const { lanternPlacements } = await import('../src/game/halloween-decor.js');

describe('halloween lantern placements', () => {
	it('is deterministic so every player sees the same patch', () => {
		expect(lanternPlacements(24)).toEqual(lanternPlacements(24));
	});
	it('keeps the spawn plaza clear and stays inside the walkable disc', () => {
		for (const p of lanternPlacements(200)) {
			const r = Math.hypot(p.x, p.z);
			expect(r).toBeGreaterThanOrEqual(9 - 1e-9);
			expect(r).toBeLessThanOrEqual(50 + 1e-9);
			expect(p.scale).toBeGreaterThanOrEqual(2.2);
			expect(p.scale).toBeLessThanOrEqual(3.4);
		}
	});
	it('returns exactly the requested count', () => {
		expect(lanternPlacements(0)).toHaveLength(0);
		expect(lanternPlacements(36)).toHaveLength(36);
	});
});
