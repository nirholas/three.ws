// Signature wall layout: the pure geometry and scheduling behind the canvas, kept
// free of DOM and three so it is unit-tested (tests/signature-wall-layout.test.js).

import { tierFor, pageSize, rng, hashString } from './signature-wall-style.js';

export const CANVAS_W = 2048;
export const CANVAS_H = 1024;
export const HEADER_H = 118;
export const NEWEST_H = 150;
export const MARGIN = 20;
export const NEWEST_SHOWN = 3;

/** The region the page grid lives in (below the header and the newest strip). */
export function gridRegion() {
	const y = HEADER_H + NEWEST_H;
	return { x: MARGIN, y, w: CANVAS_W - MARGIN * 2, h: CANVAS_H - y - MARGIN };
}

/** Rect of tile `i` in the grid for `total` signatures, with a seeded organic jitter. */
export function tileRect(i, total) {
	const { cols, rows } = tierFor(total);
	const g = gridRegion();
	const cw = g.w / cols;
	const ch = g.h / rows;
	const col = i % cols;
	const row = Math.floor(i / cols);
	const r = rng(hashString(`tile:${i}:${cols}`));
	const jx = (r() - 0.5) * cw * 0.06;
	const jy = (r() - 0.5) * ch * 0.08;
	const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
	return {
		x: clamp(g.x + col * cw + jx, g.x, g.x + g.w - cw),
		y: clamp(g.y + row * ch + jy, g.y, g.y + g.h - ch),
		w: cw,
		h: ch,
	};
}

/** The rect of newest-strip cell `i` (0..NEWEST_SHOWN-1). */
export function newestRect(i) {
	const w = (CANVAS_W - MARGIN * 2) / NEWEST_SHOWN;
	return { x: MARGIN + i * w, y: HEADER_H, w, h: NEWEST_H };
}

/**
 * Put a newest-first list of signatures into `size` fixed slots. A signature's home
 * slot is its number modulo the page size, so when a new signature arrives it lands
 * in exactly one slot and every other tile stays where it was. Collisions (only
 * possible after moderation removed a number) probe forward.
 * @param {Array<{id:string,no:number}>} sigs newest first
 * @param {number} size slots per page
 * @returns {Array<object|null>}
 */
export function assignSlots(sigs, size) {
	const slots = new Array(size).fill(null);
	for (const s of sigs.slice(0, size)) {
		let i = ((s.no % size) + size) % size;
		while (slots[i]) i = (i + 1) % size;
		slots[i] = s;
	}
	return slots;
}

/** Indexes whose occupant differs between two slot arrays of the same size. */
export function diffSlots(prev, next) {
	const changed = [];
	for (let i = 0; i < next.length; i++) {
		if ((prev[i]?.id || null) !== (next[i]?.id || null)) changed.push(i);
	}
	return changed;
}

/** Number of pages for `total` signatures. At least 1. */
export function pageCount(total) {
	return Math.max(1, Math.ceil(total / pageSize(total)));
}

/**
 * The order pages are shown in. Page 0 is the newest; it returns after every
 * `gap` older pages so recent names always get airtime, and the older pages are
 * walked in a shuffle seeded by `seed` (the caller passes the hour) so the wall
 * is varied but two viewers in the same hour see the same sequence.
 * @returns {number[]} one full cycle
 */
export function pageOrder(pages, seed = 0, gap = 3) {
	if (pages <= 1) return [0];
	const older = [];
	for (let p = 1; p < pages; p++) older.push(p);
	const r = rng(hashString(`order:${seed}:${pages}`));
	for (let i = older.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[older[i], older[j]] = [older[j], older[i]];
	}
	const order = [0];
	older.forEach((p, i) => {
		order.push(p);
		if ((i + 1) % gap === 0 && i !== older.length - 1) order.push(0);
	});
	return order;
}

/** How long (ms) a page stays up. The newest page lingers; older pages flip faster. */
export function dwellMs(page) {
	return page === 0 ? 14_000 : 9_000;
}
