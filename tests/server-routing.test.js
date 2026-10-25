// The /api route cache is keyed by attacker-chosen paths, so it must be bounded.
import { describe, it, expect } from 'vitest';
import { setBounded, touchBounded } from '../server/bounded-cache.mjs';

describe('bounded route cache', () => {
	it('never grows past its cap under unique-path pressure', () => {
		const m = new Map();
		for (let i = 0; i < 20_000; i++) setBounded(m, `junk/${i}`, null, 5000);
		expect(m.size).toBe(5000);
		expect(m.has('junk/19999')).toBe(true);
		expect(m.has('junk/0')).toBe(false);
	});

	it('keeps a hot key alive when it is touched', () => {
		const m = new Map();
		setBounded(m, 'hot', { file: 'a' }, 3);
		setBounded(m, 'b', null, 3);
		setBounded(m, 'c', null, 3);
		expect(touchBounded(m, 'hot')).toEqual({ file: 'a' });
		setBounded(m, 'd', null, 3);
		expect(m.has('hot')).toBe(true);
		expect(m.has('b')).toBe(false);
	});

	it('returns undefined for an unknown key so a cached null stays distinguishable', () => {
		const m = new Map();
		setBounded(m, 'miss', null, 3);
		expect(touchBounded(m, 'miss')).toBeNull();
		expect(touchBounded(m, 'other')).toBeUndefined();
	});
});
