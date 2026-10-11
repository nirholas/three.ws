import { describe, it, expect } from 'vitest';
import {
	workArea,
	clampRect,
	snapZone,
	snapRect,
	cascadeRect,
	resizeRect,
	isInternalPath,
	cleanTitle,
	rankItems,
	deepLinkApp,
	sanitizeState,
	pageAppId,
	pagePathOf,
	MIN_W,
	MIN_H,
	MAX_WINDOWS,
} from '../src/desktop/layout.js';

const area = workArea(1440, 900, 30, 84);

describe('desktop layout geometry', () => {
	it('reserves room for the menu bar and the dock', () => {
		expect(area).toEqual({ x: 0, y: 30, w: 1440, h: 786 });
	});

	it('keeps a dragged window reachable by its title bar', () => {
		const r = clampRect({ x: -5000, y: -400, w: 600, h: 400 }, area);
		expect(r.y).toBe(area.y);
		expect(r.x + r.w).toBeGreaterThanOrEqual(96);
		const far = clampRect({ x: 9000, y: 9000, w: 600, h: 400 }, area);
		expect(far.x).toBeLessThanOrEqual(area.w - 96);
		expect(far.y).toBeLessThanOrEqual(area.y + area.h - 36);
	});

	it('enforces minimum and maximum window sizes', () => {
		const tiny = clampRect({ x: 10, y: 40, w: 10, h: 10 }, area);
		expect([tiny.w, tiny.h]).toEqual([MIN_W, MIN_H]);
		const huge = clampRect({ x: 0, y: 40, w: 99999, h: 99999 }, area);
		expect([huge.w, huge.h]).toEqual([area.w, area.h]);
	});

	it('detects snap zones at the edges only', () => {
		expect(snapZone(700, 32, area)).toBe('max');
		expect(snapZone(2, 400, area)).toBe('left');
		expect(snapZone(1438, 400, area)).toBe('right');
		expect(snapZone(700, 400, area)).toBeNull();
	});

	it('snaps to halves that tile the work area exactly', () => {
		const l = snapRect('left', area);
		const r = snapRect('right', area);
		expect(l.w + r.w).toBe(area.w);
		expect(r.x).toBe(l.x + l.w);
		expect(snapRect('max', area)).toEqual({ x: 0, y: 30, w: 1440, h: 786 });
		expect(snapRect(null, area)).toBeNull();
	});

	it('cascades new windows to different positions that stay on screen', () => {
		const seen = new Set();
		for (let n = 0; n < MAX_WINDOWS; n++) {
			const r = cascadeRect(n, area, { w: 900, h: 600 });
			seen.add(`${r.x},${r.y}`);
			expect(r.x).toBeGreaterThanOrEqual(0);
			expect(r.y).toBeGreaterThanOrEqual(area.y);
			expect(r.y + r.h).toBeLessThanOrEqual(area.y + area.h);
		}
		expect(seen.size).toBeGreaterThan(1);
	});

	it('shrinks a window larger than a small viewport instead of overflowing', () => {
		const small = workArea(390, 700, 30, 70);
		const r = cascadeRect(0, small, { w: 900, h: 600 });
		expect(r.w).toBeLessThanOrEqual(small.w);
		expect(r.h).toBeLessThanOrEqual(small.h);
	});
});

describe('resizeRect', () => {
	const start = { x: 200, y: 100, w: 600, h: 400 };
	it('grows from the south-east corner', () => {
		expect(resizeRect(start, 'se', 50, 30, area)).toEqual({ x: 200, y: 100, w: 650, h: 430 });
	});
	it('moves the origin when dragging the west or north edge', () => {
		const r = resizeRect(start, 'nw', -40, -20, area);
		expect(r).toEqual({ x: 160, y: 80, w: 640, h: 420 });
	});
	it('never shrinks below the minimum and pins the opposite edge', () => {
		const r = resizeRect(start, 'w', 5000, 0, area);
		expect(r.w).toBe(MIN_W);
		expect(r.x + r.w).toBe(start.x + start.w);
	});
	it('never lets the top edge cross the menu bar', () => {
		const r = resizeRect({ x: 0, y: 40, w: 600, h: 400 }, 'n', 0, -500, area);
		expect(r.y).toBe(area.y);
	});
});

describe('internal paths and titles', () => {
	it('accepts same-origin absolute paths only', () => {
		expect(isInternalPath('/forge')).toBe(true);
		expect(isInternalPath('/discover?q=a')).toBe(true);
		expect(isInternalPath('//evil.example/x')).toBe(false);
		expect(isInternalPath('https://example.com')).toBe(false);
		expect(isInternalPath('javascript:alert(1)')).toBe(false);
		expect(isInternalPath('/a\\b')).toBe(false);
		expect(isInternalPath(null)).toBe(false);
	});

	it('shortens page titles for window chrome', () => {
		expect(cleanTitle('Forge · three.ws', 'x')).toBe('Forge');
		expect(cleanTitle('Marketplace | three.ws', 'x')).toBe('Marketplace');
		expect(cleanTitle('three.ws - Pricing', 'x')).toBe('Pricing');
		expect(cleanTitle('', 'Fallback')).toBe('Fallback');
	});
});

describe('rankItems', () => {
	const items = [
		{ title: 'Marketplace', keywords: ['skills', 'buy'], desc: 'Buy agent skills' },
		{ title: 'Forge', keywords: ['text to 3d', 'model'], desc: 'Generate models' },
		{ title: 'Agent Studio', keywords: ['persona'], desc: 'Author brains' },
		{ title: 'Create', keywords: ['agent', 'avatar'], desc: 'Make an agent' },
	];
	it('keeps input order for an empty query', () => {
		expect(rankItems('  ', items).map((i) => i.title)).toEqual(items.map((i) => i.title));
	});
	it('puts a title prefix ahead of keyword and description hits', () => {
		const out = rankItems('agent', items).map((i) => i.title);
		expect(out[0]).toBe('Agent Studio');
		expect(out).toContain('Create');
		expect(out).toContain('Marketplace');
	});
	it('matches keywords and drops non-matches', () => {
		expect(rankItems('model', items).map((i) => i.title)).toEqual(['Forge']);
		expect(rankItems('zzzz', items)).toEqual([]);
	});
});

describe('deep links', () => {
	it('reads ?app= and #app=', () => {
		expect(deepLinkApp('?app=Forge', '')).toBe('forge');
		expect(deepLinkApp('', '#app=discover')).toBe('discover');
		expect(deepLinkApp('?x=1', '#nope')).toBeNull();
	});
});

describe('sanitizeState', () => {
	const known = new Set(['forge', 'create', 'chat']);
	const good = { app: 'forge', x: 10, y: 40, w: 800, h: 500 };

	it('round-trips a valid state', () => {
		const s = sanitizeState({ v: 1, windows: [good], focus: 'forge' }, known);
		expect(s.windows).toHaveLength(1);
		expect(s.focus).toBe('forge');
	});
	it('survives garbage, wrong versions and bad JSON', () => {
		expect(sanitizeState('{not json', known).windows).toEqual([]);
		expect(sanitizeState({ v: 99, windows: [good] }, known).windows).toEqual([]);
		expect(sanitizeState(null, known).windows).toEqual([]);
		expect(sanitizeState({ v: 1, windows: 'x' }, known).windows).toEqual([]);
	});
	it('drops unknown apps, duplicates, non-numeric rects and external paths', () => {
		const s = sanitizeState(
			{
				v: 1,
				windows: [
					{ ...good, app: 'nope' },
					good,
					good,
					{ ...good, app: 'create', x: 'a' },
					{ ...good, app: 'chat', path: 'https://evil.example' },
				],
				focus: 'create',
			},
			known,
		);
		expect(s.windows.map((w) => w.app)).toEqual(['forge', 'chat']);
		expect(s.windows[1].path).toBeNull();
		expect(s.focus).toBeNull();
	});
	it('restores generic page windows only for same-origin paths', () => {
		const s = sanitizeState(
			{
				v: 1,
				windows: [
					{ ...good, app: 'page:/pricing' },
					{ ...good, app: 'page://evil.example/x' },
					{ ...good, app: 'page:https://evil.example' },
				],
			},
			known,
		);
		expect(s.windows.map((w) => w.app)).toEqual(['page:/pricing']);
		expect(pagePathOf('page:/pricing')).toBe('/pricing');
		expect(pagePathOf('forge')).toBeNull();
		expect(pageAppId('/pricing')).toBe('page:/pricing');
	});
	it('caps the number of restored windows', () => {
		const ids = new Set(Array.from({ length: 20 }, (_, i) => `a${i}`));
		const windows = [...ids].map((app) => ({ ...good, app }));
		expect(sanitizeState({ v: 1, windows }, ids).windows).toHaveLength(MAX_WINDOWS);
	});
});

import {
	marqueeRect,
	rectsIntersect,
	iconsInRect,
	gridSize,
	cellAt,
	nearestFreeCell,
	arrangeIcons,
	moveIcons,
	reflowIcons,
	addIcons,
	sanitizeIcons,
	sanitizePrefs,
	initialsOf,
	storageBytes,
	formatBytes,
	parseSessionImport,
	DEFAULT_PREFS,
} from '../src/desktop/layout.js';

describe('desktop icon grid', () => {
	const cell = { w: 100, h: 100 };
	const grid = { cols: 4, rows: 3 };

	it('builds a marquee from any drag direction', () => {
		expect(marqueeRect(50, 80, 10, 20)).toEqual({ x: 10, y: 20, w: 40, h: 60 });
	});
	it('detects overlap but not mere touching', () => {
		expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
		expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
	});
	it('selects the icons under the marquee', () => {
		const items = [
			{ id: 'a', col: 0, row: 0 },
			{ id: 'b', col: 1, row: 0 },
			{ id: 'c', col: 3, row: 2 },
		];
		expect(iconsInRect({ x: 50, y: 10, w: 100, h: 30 }, items, cell)).toEqual(['a', 'b']);
		expect(iconsInRect({ x: 350, y: 250, w: 10, h: 10 }, items, cell)).toEqual(['c']);
	});
	it('sizes the grid and clamps pointer positions into it', () => {
		expect(gridSize(450, 320, cell)).toEqual(grid);
		expect(gridSize(10, 10, cell)).toEqual({ cols: 1, rows: 1 });
		expect(cellAt(9999, -50, cell, grid)).toEqual({ col: 3, row: 0 });
	});
	it('finds the nearest free cell and reports a full grid', () => {
		const taken = new Set(['1,1']);
		expect(nearestFreeCell(1, 1, grid, taken)).toEqual({ col: 0, row: 1 });
		const all = new Set();
		for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) all.add(`${c},${r}`);
		expect(nearestFreeCell(0, 0, grid, all)).toBeNull();
	});
	it('arranges column-major', () => {
		expect(arrangeIcons(['a', 'b', 'c', 'd'], grid)).toEqual([
			{ id: 'a', col: 0, row: 0 },
			{ id: 'b', col: 0, row: 1 },
			{ id: 'c', col: 0, row: 2 },
			{ id: 'd', col: 1, row: 0 },
		]);
	});
	it('moves a group by a delta without ever stacking two icons', () => {
		const items = arrangeIcons(['a', 'b', 'c'], grid);
		const out = moveIcons(items, ['a', 'b'], 1, 0, grid);
		expect(out.find((i) => i.id === 'a')).toMatchObject({ col: 1, row: 0 });
		expect(out.find((i) => i.id === 'c')).toMatchObject({ col: 0, row: 2 });
		const cells = new Set(out.map((i) => `${i.col},${i.row}`));
		expect(cells.size).toBe(3);
	});
	it('drops onto an occupied cell by taking the nearest free one', () => {
		const items = [
			{ id: 'a', col: 0, row: 0 },
			{ id: 'b', col: 1, row: 0 },
		];
		const out = moveIcons(items, ['a'], 1, 0, grid);
		expect(`${out[0].col},${out[0].row}`).not.toBe('1,0');
	});
	it('reflows icons that no longer fit after the grid shrinks', () => {
		const items = [
			{ id: 'a', col: 0, row: 0 },
			{ id: 'b', col: 3, row: 2 },
		];
		const out = reflowIcons(items, { cols: 2, rows: 2 });
		expect(out).toHaveLength(2);
		out.forEach((i) => {
			expect(i.col).toBeLessThan(2);
			expect(i.row).toBeLessThan(2);
		});
	});
	it('adds only missing icons', () => {
		const out = addIcons([{ id: 'a', col: 0, row: 0 }], ['a', 'b'], grid);
		expect(out.map((i) => i.id)).toEqual(['a', 'b']);
	});
	it('rejects corrupt persisted placement', () => {
		const known = (id) => ['a', 'b'].includes(id);
		const out = sanitizeIcons(
			[
				{ id: 'a', col: 0, row: 0 },
				{ id: 'a', col: 1, row: 1 },
				{ id: 'b', col: 0, row: 0 },
				{ id: 'zz', col: 2, row: 2 },
				{ id: 'b', col: -1, row: 0 },
				{ id: 'b', col: 1.5, row: 0 },
				{ id: 'b', col: 2, row: 1 },
			],
			known,
		);
		expect(out).toEqual([
			{ id: 'a', col: 0, row: 0 },
			{ id: 'b', col: 2, row: 1 },
		]);
		expect(sanitizeIcons('nope', known)).toEqual([]);
	});
});

describe('preferences and session export', () => {
	const walls = ['aurora', 'midnight'];
	it('falls back per field and clamps the name', () => {
		const p = sanitizePrefs({ wall: 'nope', accent: 'red', mode: 'light', iconSize: 'huge', name: '  <b>Ada</b>  '.repeat(10), avatarHue: -30 }, walls);
		expect(p.wall).toBe(DEFAULT_PREFS.wall);
		expect(p.accent).toBe(DEFAULT_PREFS.accent);
		expect(p.mode).toBe('light');
		expect(p.iconSize).toBe('medium');
		expect(p.name.length).toBeLessThanOrEqual(40);
		expect(p.name).not.toMatch(/[<>]/);
		expect(p.avatarHue).toBe(330);
	});
	it('survives bad JSON', () => {
		expect(sanitizePrefs('{oops', walls)).toEqual(DEFAULT_PREFS);
		expect(sanitizePrefs(null, walls)).toEqual(DEFAULT_PREFS);
	});
	it('derives initials', () => {
		expect(initialsOf('ada lovelace')).toBe('AL');
		expect(initialsOf('Ada')).toBe('A');
		expect(initialsOf('')).toBe('?');
	});
	it('counts and formats storage', () => {
		expect(storageBytes([['tws:a', 'xy'], ['other', 'zzzz']], 'tws:')).toBe((5 + 2) * 2);
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2.0 KB');
		expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
	});
	it('only accepts a well-formed session export and ignores foreign keys', () => {
		const good = JSON.stringify({ kind: 'three.ws-desktop-session', v: 1, items: { 'tws:prefs': '{}', 'twx_theme': 'light', 'evil': 'x' } });
		const r = parseSessionImport(good);
		expect(r.ok).toBe(true);
		expect(Object.keys(r.items)).toEqual(['tws:prefs']);
		expect(parseSessionImport('{').ok).toBe(false);
		expect(parseSessionImport(JSON.stringify({ kind: 'x', v: 1, items: {} })).ok).toBe(false);
		expect(parseSessionImport(JSON.stringify({ kind: 'three.ws-desktop-session', v: 1, items: { evil: 'x' } })).ok).toBe(false);
		expect(parseSessionImport('x'.repeat(3 * 1024 * 1024)).ok).toBe(false);
	});
});
