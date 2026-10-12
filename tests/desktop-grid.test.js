import { describe, it, expect } from 'vitest';
import { ROOM, ROOM_BOUND, SPAWN, TIERS, WALLS, KIOSK, tierFor, kioskLayout, nearestSurface, clip, wrap, shortWallet } from '../src/desktop/grid/logic.js';
import { APPS, ALL_APPS } from '../src/desktop/apps.js';

describe('the Grid byte tiers', () => {
	it('starts at Byte with no points and treats junk as zero', () => {
		expect(tierFor(0)).toMatchObject({ level: 1, name: 'Byte', next: 'Kilobyte', progress: 0, toNext: 10 });
		expect(tierFor(NaN).level).toBe(1);
		expect(tierFor(-5).level).toBe(1);
	});
	it('moves up exactly at each threshold', () => {
		TIERS.forEach((t, i) => expect(tierFor(t.at).level).toBe(i + 1));
		expect(tierFor(29).name).toBe('Kilobyte');
		expect(tierFor(30).name).toBe('Megabyte');
	});
	it('reports progress toward the next tier and tops out at 1', () => {
		expect(tierFor(20).progress).toBeCloseTo(0.5);
		const top = tierFor(1e9);
		expect(top.name).toBe('Yottabyte');
		expect(top).toMatchObject({ progress: 1, next: null, toNext: 0 });
	});
});

describe('the Grid layout', () => {
	const dock = APPS.filter((a) => a.dock);
	const kiosks = kioskLayout(dock);

	it('gives every dock app one kiosk that opens that app', () => {
		expect(kiosks.map((k) => k.app)).toEqual(dock.map((a) => a.id));
		expect(new Set(kiosks.map((k) => k.id)).size).toBe(kiosks.length);
	});
	it('keeps the kiosk row centred, inside the walls and non-overlapping', () => {
		const xs = kiosks.map((k) => k.x);
		expect(xs[0] + xs[xs.length - 1]).toBeCloseTo(0);
		kiosks.forEach((k) => expect(Math.abs(k.x) + k.w / 2).toBeLessThan(ROOM.half));
		for (let i = 1; i < kiosks.length; i++) expect(kiosks[i].x - kiosks[i - 1].x).toBeGreaterThanOrEqual(kiosks[i].w);
	});
	it('handles zero and one app', () => {
		expect(kioskLayout([])).toEqual([]);
		expect(kioskLayout([dock[0]])[0].x).toBeCloseTo(0);
	});
	it('points every wall into the room and opens a real app', () => {
		const ids = new Set(ALL_APPS.map((a) => a.id));
		for (const w of WALLS) {
			expect(ids.has(w.app)).toBe(true);
			const nx = Math.sin(w.yaw) * 1;
			const nz = Math.cos(w.yaw) * 1;
			// stepping one metre along the normal from the wall lands inside the room
			expect(Math.abs(w.x + nx)).toBeLessThan(ROOM.half);
			expect(Math.abs(w.z + nz)).toBeLessThan(ROOM.half);
		}
	});
	it('spawns the player inside the roaming bound, facing the board', () => {
		expect(Math.hypot(SPAWN.x, SPAWN.z)).toBeLessThan(ROOM_BOUND);
		expect(KIOSK.z).toBeGreaterThan(-ROOM.half);
	});
});

describe('the Grid proximity', () => {
	const all = [...WALLS, ...kioskLayout(APPS.filter((a) => a.dock))];

	it('arms nothing in the middle of an empty floor', () => {
		expect(nearestSurface(0, 13, all)).toBeNull();
	});
	it('arms the board along its length, not just at its centre', () => {
		expect(nearestSurface(6, -15.5, all)?.id).toBe('board');
		expect(nearestSurface(-6, -15.5, all)?.id).toBe('board');
	});
	it('arms the side walls from inside the room', () => {
		expect(nearestSurface(-15.5, -2, all)?.id).toBe('wiki');
		expect(nearestSurface(15.5, -2, all)?.id).toBe('pulse');
	});
	it('does not arm a surface from behind it', () => {
		expect(nearestSurface(0, -19.5, [WALLS[0]])).toBeNull();
	});
	it('picks the closest kiosk', () => {
		const k = kioskLayout(APPS.filter((a) => a.dock));
		const mid = k[3];
		expect(nearestSurface(mid.x, mid.z + 1.6, k)?.id).toBe(mid.id);
	});
});

describe('the Grid text helpers', () => {
	it('clips with an ellipsis and collapses whitespace', () => {
		expect(clip('a  b\n c', 10)).toBe('a b c');
		expect(clip('abcdefghij', 5)).toBe('abcd…');
		expect(clip(null, 5)).toBe('');
	});
	it('wraps on words and cuts words longer than a line', () => {
		expect(wrap('one two three', 7)).toEqual(['one two', 'three']);
		expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
		expect(wrap('', 5)).toEqual([]);
	});
	it('shortens wallets and leaves short strings alone', () => {
		expect(shortWallet('xcgUabcdefghijkliPnp')).toBe('xcgU...iPnp');
		expect(shortWallet('abc')).toBe('abc');
		expect(shortWallet(undefined)).toBe('');
	});
});
