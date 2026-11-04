import { describe, it, expect } from 'vitest';
import { pickHeroSet, HERO_GLB_BUDGET_BYTES } from '../src/shared/hero-glb-budget.js';

const m = (id, sizeBytes) => ({ id, sizeBytes });

describe('pickHeroSet', () => {
	it('shares the budget across the whole set, not per model', () => {
		const set = pickHeroSet([m('a', 1_500_000), m('b', 1_500_000), m('c', 500_000)]);
		expect(set.map((x) => x.id)).toEqual(['a', 'c']);
		expect(set.reduce((n, x) => n + x.sizeBytes, 0)).toBeLessThanOrEqual(HERO_GLB_BUDGET_BYTES);
	});

	it('keeps curated order and caps at max', () => {
		const set = pickHeroSet([m('a', 100), m('b', 100), m('c', 100), m('d', 100)], { max: 3 });
		expect(set.map((x) => x.id)).toEqual(['a', 'b', 'c']);
	});

	it('falls back to the single smallest model when nothing fits', () => {
		const set = pickHeroSet([m('a', 9_000_000), m('b', 4_000_000), m('c', 7_000_000)]);
		expect(set.map((x) => x.id)).toEqual(['b']);
	});

	it('tries unsized models instead of dropping them', () => {
		expect(pickHeroSet([m('a', null), m('b', 1_000_000)]).map((x) => x.id)).toEqual(['a', 'b']);
		expect(pickHeroSet([m('a', null)]).map((x) => x.id)).toEqual(['a']);
	});

	it('returns an empty set for no candidates', () => {
		expect(pickHeroSet([])).toEqual([]);
		expect(pickHeroSet(undefined)).toEqual([]);
	});
});
