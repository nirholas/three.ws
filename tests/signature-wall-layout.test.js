import { describe, it, expect } from 'vitest';
import {
	assignSlots, diffSlots, pageCount, pageOrder, tileRect, gridRegion, CANVAS_W, CANVAS_H,
} from '../src/game/signature-wall-layout.js';
import { tierFor, pageSize, styleFor, hashString, INKS } from '../src/game/signature-wall-style.js';

const mk = (no) => ({ id: `id${no}`, no });
const newestFirst = (n, top = n) => Array.from({ length: n }, (_, i) => mk(top - i));

describe('density tiers', () => {
	it('grows the page as the wall fills and caps at the densest grid', () => {
		expect(pageSize(0)).toBe(8);
		expect(pageSize(10)).toBe(18);
		expect(pageSize(40)).toBe(60);
		expect(pageSize(5000)).toBe(128);
		expect(tierFor(5000).cols).toBe(16);
	});

	it('needs ceil(total / page) pages and never fewer than one', () => {
		expect(pageCount(0)).toBe(1);
		expect(pageCount(10)).toBe(1);
		expect(pageCount(5000)).toBe(Math.ceil(5000 / 128));
	});
});

describe('tile geometry', () => {
	it('keeps every tile of every tier inside the canvas', () => {
		for (const total of [1, 10, 30, 50, 5000]) {
			const size = pageSize(total);
			for (let i = 0; i < size; i++) {
				const r = tileRect(i, total);
				expect(r.x).toBeGreaterThanOrEqual(0);
				expect(r.y).toBeGreaterThanOrEqual(gridRegion().y);
				expect(r.x + r.w).toBeLessThanOrEqual(CANVAS_W);
				expect(r.y + r.h).toBeLessThanOrEqual(CANVAS_H);
			}
		}
	});

	it('is deterministic', () => {
		expect(tileRect(7, 50)).toEqual(tileRect(7, 50));
	});
});

describe('slot assignment (incremental redraw)', () => {
	it('changes exactly one tile when one signature arrives', () => {
		const size = 18;
		const before = assignSlots(newestFirst(18, 40), size);
		const after = assignSlots(newestFirst(18, 41), size);
		expect(diffSlots(before, after)).toHaveLength(1);
	});

	it('places every signature once and survives a removal gap', () => {
		const sigs = [mk(50), mk(49), mk(47), mk(46), mk(32)]; // 48 removed, 32 collides mod 18 with 50
		const slots = assignSlots(sigs, 18);
		expect(slots.filter(Boolean).map((s) => s.id).sort()).toEqual(sigs.map((s) => s.id).sort());
	});

	it('never overfills a page', () => {
		const slots = assignSlots(newestFirst(200), 8);
		expect(slots.filter(Boolean)).toHaveLength(8);
	});
});

describe('page rotation', () => {
	it('shows a single page without cycling', () => {
		expect(pageOrder(1)).toEqual([0]);
	});

	it('visits every older page exactly once per cycle and returns to the newest often', () => {
		const order = pageOrder(40, 123, 3);
		const older = order.filter((p) => p !== 0);
		expect(new Set(older).size).toBe(39);
		expect(older).toHaveLength(39);
		for (let i = 0; i + 4 < order.length; i++) {
			expect(order.slice(i, i + 5)).toContain(0);
		}
	});

	it('is stable for a seed and varies across seeds', () => {
		expect(pageOrder(20, 5)).toEqual(pageOrder(20, 5));
		expect(pageOrder(20, 5)).not.toEqual(pageOrder(20, 6));
	});
});

describe('signature style', () => {
	it('derives the same hand from the same id, forever', () => {
		expect(styleFor({ id: 'abc123' })).toEqual(styleFor({ id: 'abc123' }));
		expect(hashString('abc123')).toBe(hashString('abc123'));
	});

	it('varies across ids and uses only the palette', () => {
		const inks = new Set();
		for (let i = 0; i < 200; i++) {
			const st = styleFor({ id: `sig${i}` });
			expect(INKS).toContain(st.ink);
			expect(st.ink2).not.toBe(st.ink);
			inks.add(st.ink);
		}
		expect(inks.size).toBeGreaterThan(5);
	});
});
