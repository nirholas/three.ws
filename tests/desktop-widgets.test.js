import { describe, it, expect } from 'vitest';
import {
	CATALOG,
	DEFAULT_LAYOUT,
	SIZES,
	STEP,
	UNIT,
	GAP,
	catalogItem,
	cellAt,
	firstFit,
	fits,
	fmtBytes,
	fmtCompact,
	fmtPct,
	fmtPrice,
	gridFor,
	monthGrid,
	nudge,
	pixelBox,
	relTime,
	settle,
	sparkPath,
	tzCity,
	usesFahrenheit,
	weatherInfo,
	weekStartFor,
} from '../src/desktop/widgets/logic.js';

const cells = (list) => {
	const taken = new Set();
	for (const w of list.filter((x) => !x.hidden)) {
		const s = SIZES[w.size];
		for (let c = w.col; c < w.col + s.w; c++) for (let r = w.row; r < w.row + s.h; r++) {
			const k = `${c},${r}`;
			if (taken.has(k)) return null;
			taken.add(k);
		}
	}
	return taken;
};

describe('widget catalog', () => {
	it('has unique types with a valid default size', () => {
		const types = CATALOG.map((c) => c.type);
		expect(new Set(types).size).toBe(types.length);
		for (const c of CATALOG) {
			expect(c.sizes.length).toBeGreaterThan(0);
			for (const s of c.sizes) expect(SIZES[s], `${c.type}:${s}`).toBeTruthy();
		}
	});
	it('starts from widgets that exist', () => {
		for (const w of DEFAULT_LAYOUT) expect(catalogItem(w.type)?.sizes).toContain(w.size);
	});
});

describe('widget grid', () => {
	it('measures how many units fit', () => {
		expect(gridFor(UNIT, UNIT)).toEqual({ cols: 1, rows: 1 });
		expect(gridFor(UNIT * 2 + GAP, UNIT * 3 + GAP * 2)).toEqual({ cols: 2, rows: 3 });
		expect(gridFor(UNIT - 1, 10)).toEqual({ cols: 0, rows: 0 });
	});
	it('packs the default layout into a laptop work area without overlap', () => {
		const grid = gridFor(1440 - 140, 900 - 80);
		const laid = settle(DEFAULT_LAYOUT, grid);
		expect(laid.every((w) => !w.hidden)).toBe(true);
		expect(cells(laid)).not.toBeNull();
		for (const w of laid) {
			const s = SIZES[w.size];
			expect(w.col + s.w).toBeLessThanOrEqual(grid.cols);
			expect(w.row + s.h).toBeLessThanOrEqual(grid.rows);
		}
	});
	it('fills from the right edge, top to bottom', () => {
		const grid = { cols: 4, rows: 3 };
		expect(firstFit({ id: 'a', size: 's' }, [], grid)).toEqual({ col: 0, row: 0 });
		const others = [{ id: 'x', size: 'l', col: 0, row: 0 }];
		expect(firstFit({ id: 'a', size: 's' }, others, grid)).toEqual({ col: 0, row: 2 });
		expect(firstFit({ id: 'a', size: 'm' }, others, grid)).toEqual({ col: 0, row: 2 });
	});
	it('rejects cells off the grid or under another widget', () => {
		const grid = { cols: 3, rows: 2 };
		const other = { id: 'o', size: 's', col: 1, row: 0 };
		expect(fits({ id: 'a', size: 'm' }, 0, 0, [other], grid)).toBe(false);
		expect(fits({ id: 'a', size: 'm' }, 0, 1, [other], grid)).toBe(true);
		expect(fits({ id: 'a', size: 'm' }, 2, 1, [], grid)).toBe(false);
		expect(fits({ id: 'o', size: 's' }, 1, 0, [other], grid)).toBe(true);
	});
	it('re-places stored widgets that collide and hides what cannot fit', () => {
		const grid = { cols: 2, rows: 2 };
		const laid = settle(
			[
				{ id: 'a', type: 'pulse', size: 'l', col: 0, row: 0 },
				{ id: 'b', type: 'clock', size: 's', col: 0, row: 0 },
			],
			grid,
		);
		expect(laid[0]).toMatchObject({ id: 'a', col: 0, row: 0 });
		expect(laid[1]).toMatchObject({ id: 'b', hidden: true });
	});
	it('drops junk, unknown types and bad sizes from storage', () => {
		const laid = settle([null, 4, { type: 'nope' }, { type: 'clock', size: 'xl' }, { type: 'note', size: 'm', id: '<script>', data: { text: 'hi' } }], { cols: 6, rows: 4 });
		expect(laid.map((w) => w.type)).toEqual(['clock', 'note']);
		expect(laid[0].size).toBe('s');
		expect(laid[1].id).toMatch(/^[\w-]+$/);
		expect(laid[1].data).toEqual({ text: 'hi' });
		expect(settle('garbage', { cols: 2, rows: 2 })).toEqual([]);
	});
	it('nudges a widget one cell with the arrow keys, hopping over neighbours', () => {
		const grid = { cols: 4, rows: 3 };
		const me = { id: 'a', size: 's', col: 1, row: 1 };
		// Columns count from the right edge, so Left is col + 1.
		expect(nudge(me, 'ArrowLeft', [me], grid)).toEqual({ col: 2, row: 1 });
		expect(nudge(me, 'ArrowRight', [me], grid)).toEqual({ col: 0, row: 1 });
		expect(nudge(me, 'ArrowUp', [me], grid)).toEqual({ col: 1, row: 0 });
		expect(nudge(me, 'ArrowDown', [me], grid)).toEqual({ col: 1, row: 2 });
		// A neighbour in the way is jumped, not swapped or overlapped.
		const wall = { id: 'w', size: 's', col: 2, row: 1 };
		expect(nudge(me, 'ArrowLeft', [me, wall], grid)).toEqual({ col: 3, row: 1 });
		// At the edge, or with only blocked cells beyond, it stays put.
		expect(nudge({ ...me, col: 0 }, 'ArrowRight', [], grid)).toBeNull();
		expect(nudge({ id: 'b', size: 'm', col: 2, row: 0 }, 'ArrowLeft', [], grid)).toBeNull();
		expect(nudge(me, 'ArrowLeft', [me, wall, { id: 'v', size: 's', col: 3, row: 1 }], grid)).toBeNull();
		expect(nudge(me, 'Enter', [me], grid)).toBeNull();
	});
	it('converts between cells and pixels', () => {
		expect(pixelBox({ size: 'l', col: 1, row: 2 })).toEqual({ right: STEP, top: STEP * 2, width: UNIT * 2 + GAP, height: UNIT * 2 + GAP });
		expect(cellAt(STEP * 1.4, STEP * 0.6)).toEqual({ col: 1, row: 1 });
		expect(cellAt(-50, -50)).toEqual({ col: 0, row: 0 });
	});
});

describe('widget formatting', () => {
	it('prices sub-cent tokens with significant digits', () => {
		expect(fmtPrice(0.0005026)).toBe('$0.000503');
		expect(fmtPrice(0.12)).toBe('$0.120');
		expect(fmtPrice(1234.5)).toBe('$1,234.50');
		expect(fmtPrice(0)).toBe('$0.00');
		expect(fmtPrice('x')).toBe('');
	});
	it('compacts big numbers', () => {
		expect(fmtCompact(502446, '$')).toBe('$502K');
		expect(fmtCompact(15159)).toBe('15.2K');
		expect(fmtCompact(4468)).toBe('4.5K');
		expect(fmtCompact(1_500_000)).toBe('1.5M');
		expect(fmtCompact(90)).toBe('90');
	});
	it('signs percentages', () => {
		expect(fmtPct(-3.64)).toBe('-3.6%');
		expect(fmtPct(12.01)).toBe('+12.0%');
		expect(fmtPct(0)).toBe('0.0%');
		expect(fmtPct(null)).toBe('');
	});
	it('formats relative ages', () => {
		const now = Date.parse('2026-10-11T12:00:00Z');
		expect(relTime('2026-10-11T11:59:30Z', now)).toBe('now');
		expect(relTime('2026-10-11T11:00:00Z', now)).toBe('1h');
		expect(relTime('bad', now)).toBe('');
	});
	it('formats bytes', () => {
		expect(fmtBytes(512)).toBe('512 B');
		expect(fmtBytes(1536)).toBe('1.5 KB');
		expect(fmtBytes(8 * 1024 ** 3)).toBe('8.0 GB');
	});
});

describe('widget sparkline', () => {
	it('spans the box and inverts y', () => {
		const { line, area } = sparkPath([1, 3, 2], 100, 40, 0);
		expect(line).toBe('M0.0 40.0L50.0 0.0L100.0 20.0');
		expect(area.endsWith('L100 40L0 40Z')).toBe(true);
	});
	it('needs two points and survives a flat series', () => {
		expect(sparkPath([5], 10, 10).line).toBe('');
		expect(sparkPath([2, 2, 2], 10, 10, 0).line).toBe('M0.0 10.0L5.0 10.0L10.0 10.0');
	});
});

describe('widget weather and calendar', () => {
	it('maps weather codes and night icons', () => {
		expect(weatherInfo(0)).toEqual({ label: 'Clear', icon: 'sun' });
		expect(weatherInfo(0, false).icon).toBe('moon');
		expect(weatherInfo(63).label).toBe('Rain');
		expect(weatherInfo(999).label).toBe('Unknown');
	});
	it('reads a city out of a time zone', () => {
		expect(tzCity('America/New_York')).toBe('New York');
		expect(tzCity('Etc/GMT+3')).toBe('');
		expect(tzCity('UTC')).toBe('');
	});
	it('picks Fahrenheit only where it is used', () => {
		expect(usesFahrenheit('en-US')).toBe(true);
		expect(usesFahrenheit('en-GB')).toBe(false);
	});
	it('lays out a month starting on the right weekday', () => {
		const oct = monthGrid(new Date(2026, 9, 11), 1, new Date(2026, 9, 11));
		expect(oct).toHaveLength(42);
		// 1 Oct 2026 is a Thursday: Monday-first weeks lead with 3 September days.
		expect(oct.slice(0, 4).map((c) => [c.d, c.inMonth])).toEqual([[28, false], [29, false], [30, false], [1, true]]);
		expect(oct.filter((c) => c.today)).toEqual([{ y: 2026, m: 9, d: 11, inMonth: true, today: true }]);
		const sun = monthGrid(new Date(2026, 9, 1), 0);
		expect(sun[4]).toMatchObject({ d: 1, inMonth: true });
	});
	it('knows a sensible first weekday', () => {
		expect([0, 1, 6]).toContain(weekStartFor('en-US'));
		expect(weekStartFor('de-DE')).toBe(1);
	});
});
