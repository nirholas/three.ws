// Pure geometry, search and persistence helpers for the three.ws desktop shell.
// No DOM access here so every rule can be unit-tested (tests/desktop-layout.test.js).

export const MIN_W = 320;
export const MIN_H = 220;
export const SNAP_EDGE = 10;
export const MAX_WINDOWS = 8;
export const STATE_VERSION = 1;

/** The usable region for windows: below the menu bar, above the dock. */
export function workArea(vw, vh, menuH, dockH) {
	return { x: 0, y: menuH, w: vw, h: Math.max(MIN_H, vh - menuH - dockH) };
}

/** Keep a window reachable: its title bar must stay inside the work area. */
export function clampRect(rect, area) {
	const w = Math.min(Math.max(rect.w, MIN_W), area.w);
	const h = Math.min(Math.max(rect.h, MIN_H), area.h);
	const grab = 96;
	const x = Math.min(Math.max(rect.x, area.x - w + grab), area.x + area.w - grab);
	const y = Math.min(Math.max(rect.y, area.y), area.y + area.h - 36);
	return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Which snap zone, if any, the pointer is in while dragging a window. */
export function snapZone(px, py, area) {
	if (py <= area.y + SNAP_EDGE) return 'max';
	if (px <= area.x + SNAP_EDGE) return 'left';
	if (px >= area.x + area.w - SNAP_EDGE) return 'right';
	return null;
}

export function snapRect(zone, area) {
	if (zone === 'max') return { x: area.x, y: area.y, w: area.w, h: area.h };
	const half = Math.floor(area.w / 2);
	if (zone === 'left') return { x: area.x, y: area.y, w: half, h: area.h };
	if (zone === 'right') return { x: area.x + half, y: area.y, w: area.w - half, h: area.h };
	return null;
}

/** Staggered placement for the nth open window so new ones never sit exactly on top. */
export function cascadeRect(n, area, want) {
	const w = Math.min(want.w, area.w - 24);
	const h = Math.min(want.h, area.h - 24);
	const step = 28;
	const slots = Math.max(1, Math.floor(Math.min(area.w - w, area.h - h) / step));
	const k = n % slots;
	const x = area.x + Math.max(12, Math.floor((area.w - w) / 2) - Math.floor((slots * step) / 4)) + k * step;
	const y = area.y + 14 + k * step;
	return clampRect({ x, y, w, h }, area);
}

/** Apply a pointer delta to a rect for one of the eight resize handles. */
export function resizeRect(start, handle, dx, dy, area) {
	let { x, y, w, h } = start;
	if (handle.includes('e')) w = start.w + dx;
	if (handle.includes('s')) h = start.h + dy;
	if (handle.includes('w')) {
		w = start.w - dx;
		x = start.x + dx;
	}
	if (handle.includes('n')) {
		h = start.h - dy;
		y = start.y + dy;
	}
	if (w < MIN_W) {
		if (handle.includes('w')) x -= MIN_W - w;
		w = MIN_W;
	}
	if (h < MIN_H) {
		if (handle.includes('n')) y -= MIN_H - h;
		h = MIN_H;
	}
	if (y < area.y) {
		if (handle.includes('n')) h -= area.y - y;
		y = area.y;
	}
	return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** A path is framable as a window only when it is a same-origin absolute path. */
export function isInternalPath(href) {
	return typeof href === 'string' && /^\/(?!\/)/.test(href) && !/[\u0000-\u001f\\]/.test(href);
}

/** Strip the site suffix pages put in <title> so a window title stays short. */
export function cleanTitle(raw, fallback) {
	const t = String(raw || '')
		.replace(/\s*[·|\u2013\u2014-]\s*three\.ws.*$/i, '')
		.replace(/^three\.ws\s*[·|\u2013\u2014-]\s*/i, '')
		.trim();
	return t || fallback;
}

/**
 * Rank launchable items for a query. Title prefix beats word prefix beats
 * keyword beats substring beats description. Empty query keeps input order.
 */
export function rankItems(query, items) {
	const q = String(query || '').trim().toLowerCase();
	if (!q) return items.slice();
	const scored = [];
	items.forEach((it, i) => {
		const title = String(it.title || '').toLowerCase();
		const kw = (it.keywords || []).map((k) => String(k).toLowerCase());
		const desc = String(it.desc || '').toLowerCase();
		let s = 0;
		if (title === q) s = 100;
		else if (title.startsWith(q)) s = 80;
		else if (title.split(/[\s/\-_.]+/).some((w) => w.startsWith(q))) s = 60;
		else if (kw.some((k) => k.startsWith(q))) s = 50;
		else if (title.includes(q)) s = 40;
		else if (kw.some((k) => k.includes(q))) s = 30;
		else if (desc.includes(q)) s = 10;
		if (s) scored.push({ it, s, i });
	});
	scored.sort((a, b) => b.s - a.s || a.i - b.i);
	return scored.map((r) => r.it);
}

/** `?app=forge` (or `#app=forge`) opens that app on load. */
export function deepLinkApp(search, hash) {
	const fromQuery = new URLSearchParams(search || '').get('app');
	if (fromQuery) return fromQuery.toLowerCase();
	const m = /^#app=([a-z0-9-]+)$/i.exec(hash || '');
	return m ? m[1].toLowerCase() : null;
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate persisted desktop state. Anything malformed, from an older version
 * or naming an unknown app is dropped, so a corrupt blob can never brick boot.
 */
export const PAGE_PREFIX = 'page:';

/** Any same-origin page can be launched as a window; its id carries its path. */
export function pageAppId(path) {
	return `${PAGE_PREFIX}${path}`;
}

export function pagePathOf(id) {
	if (typeof id !== 'string' || !id.startsWith(PAGE_PREFIX)) return null;
	const p = id.slice(PAGE_PREFIX.length);
	return isInternalPath(p) ? p : null;
}

export function sanitizeState(raw, knownIds) {
	const empty = { windows: [], focus: null };
	let data = raw;
	if (typeof raw === 'string') {
		try {
			data = JSON.parse(raw);
		} catch {
			return empty;
		}
	}
	if (!data || data.v !== STATE_VERSION || !Array.isArray(data.windows)) return empty;
	const seen = new Set();
	const windows = [];
	for (const w of data.windows) {
		if (!w || typeof w.app !== 'string' || !(knownIds.has(w.app) || pagePathOf(w.app)) || seen.has(w.app)) continue;
		if (![w.x, w.y, w.w, w.h].every(num)) continue;
		seen.add(w.app);
		windows.push({
			app: w.app,
			x: w.x,
			y: w.y,
			w: w.w,
			h: w.h,
			max: w.max === true,
			min: w.min === true,
			path: isInternalPath(w.path) ? w.path : null,
		});
		if (windows.length >= MAX_WINDOWS) break;
	}
	const focus = typeof data.focus === 'string' && seen.has(data.focus) ? data.focus : null;
	return { windows, focus };
}

// ---------------------------------------------------------------------------
// Desktop icon grid, rubber-band selection and preferences
// ---------------------------------------------------------------------------

export const ICON_SIZES = {
	small: { w: 76, h: 84, tile: 36 },
	medium: { w: 92, h: 100, tile: 44 },
	large: { w: 112, h: 120, tile: 56 },
};
export const ACCENTS = ['#3b91d8', '#ad6eca', '#e5484d', '#f08a24', '#2fb67c', '#d6409f'];
export const MODES = ['dark', 'light', 'auto'];
export const PREFS_VERSION = 1;
export const DEFAULT_PREFS = {
	wall: 'aurora',
	accent: ACCENTS[0],
	mode: 'dark',
	iconSize: 'medium',
	clock24: false,
	taskbarAlign: 'center',
	name: '',
	avatarHue: 262,
};

/** Normalise a rectangle given two corner points (any drag direction). */
export function marqueeRect(ax, ay, bx, by) {
	return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx), h: Math.abs(ay - by) };
}

export function rectsIntersect(a, b) {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Ids of every icon whose cell overlaps the marquee. */
export function iconsInRect(rect, items, cell, origin = { x: 0, y: 0 }) {
	return items
		.filter((it) =>
			rectsIntersect(rect, { x: origin.x + it.col * cell.w, y: origin.y + it.row * cell.h, w: cell.w, h: cell.h }),
		)
		.map((it) => it.id);
}

/** Grid dimensions that fit a desktop area (always at least 1x1). */
export function gridSize(areaW, areaH, cell) {
	return { cols: Math.max(1, Math.floor(areaW / cell.w)), rows: Math.max(1, Math.floor(areaH / cell.h)) };
}

export function cellAt(px, py, cell, grid, origin = { x: 0, y: 0 }) {
	const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((px - origin.x) / cell.w)));
	const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((py - origin.y) / cell.h)));
	return { col, row };
}

const key = (c, r) => `${c},${r}`;

/** The free cell closest to (col,row), scanning outward; null when the grid is full. */
export function nearestFreeCell(col, row, grid, taken) {
	let best = null;
	let bestD = Infinity;
	for (let c = 0; c < grid.cols; c++) {
		for (let r = 0; r < grid.rows; r++) {
			if (taken.has(key(c, r))) continue;
			const d = (c - col) ** 2 + (r - row) ** 2;
			if (d < bestD || (d === bestD && best && (c < best.col || (c === best.col && r < best.row)))) {
				best = { col: c, row: r };
				bestD = d;
			}
		}
	}
	return best;
}

/** Column-major auto arrange: top to bottom, then the next column (Windows order). */
export function arrangeIcons(ids, grid) {
	return ids.map((id, i) => ({ id, col: Math.floor(i / grid.rows), row: i % grid.rows }));
}

/**
 * Move the selected icons by a cell delta. Every icon lands on a free cell,
 * nearest to where it was dropped; icons that are not moving keep their cell.
 */
export function moveIcons(items, movingIds, dCol, dRow, grid) {
	const moving = new Set(movingIds);
	const taken = new Set(items.filter((it) => !moving.has(it.id)).map((it) => key(it.col, it.row)));
	const placed = new Map();
	const order = items
		.filter((it) => moving.has(it.id))
		.sort((a, b) => a.col - b.col || a.row - b.row);
	for (const it of order) {
		const wantC = Math.min(grid.cols - 1, Math.max(0, it.col + dCol));
		const wantR = Math.min(grid.rows - 1, Math.max(0, it.row + dRow));
		const free = nearestFreeCell(wantC, wantR, grid, taken) || { col: it.col, row: it.row };
		taken.add(key(free.col, free.row));
		placed.set(it.id, free);
	}
	return items.map((it) => (placed.has(it.id) ? { ...it, ...placed.get(it.id) } : it));
}

/**
 * Re-seat icons after the grid changed size (window resize, icon size change):
 * keep cells that still fit, move the rest to the nearest free cell.
 */
export function reflowIcons(items, grid) {
	const taken = new Set();
	const out = [];
	const overflow = [];
	for (const it of items) {
		if (it.col < grid.cols && it.row < grid.rows && !taken.has(key(it.col, it.row))) {
			taken.add(key(it.col, it.row));
			out.push(it);
		} else overflow.push(it);
	}
	for (const it of overflow) {
		const free = nearestFreeCell(Math.min(it.col, grid.cols - 1), Math.min(it.row, grid.rows - 1), grid, taken);
		if (!free) continue; // more icons than cells: the extras stay reachable from Start
		taken.add(key(free.col, free.row));
		out.push({ ...it, ...free });
	}
	const order = new Map(items.map((it, i) => [it.id, i]));
	return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}

/** Add icons that are missing (new defaults, new shortcuts) into free cells. */
export function addIcons(items, ids, grid) {
	const have = new Set(items.map((it) => it.id));
	const taken = new Set(items.map((it) => key(it.col, it.row)));
	const out = items.slice();
	for (const id of ids) {
		if (have.has(id)) continue;
		const free = nearestFreeCell(0, 0, grid, taken);
		if (!free) break;
		taken.add(key(free.col, free.row));
		out.push({ id, ...free });
	}
	return out;
}

/** Validate persisted icon placement. Unknown ids and duplicate cells are dropped. */
export function sanitizeIcons(raw, isKnown) {
	if (!Array.isArray(raw)) return [];
	const seenId = new Set();
	const seenCell = new Set();
	const out = [];
	for (const it of raw) {
		if (!it || typeof it.id !== 'string' || !isKnown(it.id) || seenId.has(it.id)) continue;
		if (!Number.isInteger(it.col) || !Number.isInteger(it.row) || it.col < 0 || it.row < 0) continue;
		if (seenCell.has(key(it.col, it.row))) continue;
		seenId.add(it.id);
		seenCell.add(key(it.col, it.row));
		out.push({ id: it.id, col: it.col, row: it.row });
	}
	return out;
}

/** Validate persisted preferences, falling back per field so one bad value never resets the rest. */
export function sanitizePrefs(raw, wallpaperIds) {
	let data = raw;
	if (typeof raw === 'string') {
		try {
			data = JSON.parse(raw);
		} catch {
			data = null;
		}
	}
	const d = data && typeof data === 'object' ? data : {};
	const name = typeof d.name === 'string' ? d.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) : '';
	const hue = Number.isFinite(d.avatarHue) ? Math.round(((d.avatarHue % 360) + 360) % 360) : DEFAULT_PREFS.avatarHue;
	return {
		wall: wallpaperIds.includes(d.wall) ? d.wall : DEFAULT_PREFS.wall,
		accent: /^#[0-9a-f]{6}$/i.test(d.accent || '') ? d.accent.toLowerCase() : DEFAULT_PREFS.accent,
		mode: MODES.includes(d.mode) ? d.mode : DEFAULT_PREFS.mode,
		iconSize: d.iconSize in ICON_SIZES ? d.iconSize : DEFAULT_PREFS.iconSize,
		clock24: d.clock24 === true,
		taskbarAlign: d.taskbarAlign === 'left' ? 'left' : 'center',
		name,
		avatarHue: hue,
	};
}

/** Initials for the profile avatar. */
export function initialsOf(name) {
	const parts = String(name || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (!parts.length) return '?';
	return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Bytes of localStorage used by keys with the given prefix (UTF-16, as browsers count). */
export function storageBytes(entries, prefix) {
	let n = 0;
	for (const [k, v] of entries) if (k.startsWith(prefix)) n += (k.length + String(v).length) * 2;
	return n;
}

export function formatBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const EXPORT_PREFIX = 'tws:';
export const EXPORT_MAX_BYTES = 2 * 1024 * 1024;
/** Keys a session export may restore. Anything else in an imported file is ignored. */
export const EXPORT_KEYS = ['tws:desktop', 'tws:prefs', 'tws:icons', 'tws:recent', 'tws:notes', 'tws:welcomed', 'tws:wall'];

export function parseSessionImport(text) {
	if (typeof text !== 'string' || text.length > EXPORT_MAX_BYTES) return { ok: false, error: 'That file is too large to be a desktop session.' };
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return { ok: false, error: 'That file is not valid JSON.' };
	}
	if (!data || data.kind !== 'three.ws-desktop-session' || data.v !== 1 || typeof data.items !== 'object' || !data.items) {
		return { ok: false, error: 'That file is not a three.ws desktop session export.' };
	}
	const items = {};
	for (const k of EXPORT_KEYS) if (typeof data.items[k] === 'string') items[k] = data.items[k];
	if (!Object.keys(items).length) return { ok: false, error: 'The export contains no desktop data.' };
	return { ok: true, items };
}
