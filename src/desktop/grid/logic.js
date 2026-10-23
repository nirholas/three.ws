// The Grid's pure rules: the room, where every surface hangs, which one is in
// reach, the byte-tier ladder and the text helpers the panels use. No DOM and
// no three.js, so tests/desktop-grid.test.js can check all of it.

import { shortAddress } from '../../shared/address.js';

/** The room is a square of this half-width, in metres. Walls stand on it. */
export const ROOM = { half: 18, height: 10 };

/** The player may roam inside this radius (the room is square, the bound is round). */
export const ROOM_BOUND = 16.5;

export const SPAWN = { x: 0, z: 13, yaw: Math.PI };

/** Distance at which a surface arms its prompt. */
export const REACH = 3.6;

/** Byte-tier ladder. A tier is earned at its `at` gem points (mined in the campus). */
export const TIERS = [
	{ name: 'Byte', at: 0 },
	{ name: 'Kilobyte', at: 10 },
	{ name: 'Megabyte', at: 30 },
	{ name: 'Gigabyte', at: 80 },
	{ name: 'Terabyte', at: 200 },
	{ name: 'Petabyte', at: 500 },
	{ name: 'Exabyte', at: 1200 },
	{ name: 'Zettabyte', at: 3000 },
	{ name: 'Yottabyte', at: 7500 },
];

/**
 * The tier for a gem-point balance: its number (1-based), name, and how far
 * the player is toward the next one (1 at the top tier).
 */
export function tierFor(points) {
	const p = Number.isFinite(points) && points > 0 ? points : 0;
	let i = 0;
	while (i + 1 < TIERS.length && p >= TIERS[i + 1].at) i++;
	const next = TIERS[i + 1] || null;
	const progress = next ? (p - TIERS[i].at) / (next.at - TIERS[i].at) : 1;
	return { level: i + 1, name: TIERS[i].name, progress, next: next ? next.name : null, toNext: next ? next.at - p : 0 };
}

/**
 * The info walls. Each hangs flat on a wall, centred at (x, y, z), turned to
 * face into the room by `yaw`. `app` is the desktop app E opens.
 */
export const WALLS = [
	{ id: 'board', kind: 'board', title: 'Live board', sub: 'New agents, launches, wallet moves and $THREE', app: 'discover', x: 0, y: 6.5, z: -ROOM.half + 0.05, yaw: 0, w: 16, h: 6.4 },
	{ id: 'wiki', kind: 'directory', title: 'Directory', sub: 'Every app in the room', app: 'apps', x: -ROOM.half + 0.05, y: 3.9, z: -2, yaw: Math.PI / 2, w: 10, h: 6.25 },
	{ id: 'pulse', kind: 'pulse', title: 'Pulse', sub: 'Live agent wallet activity', app: 'pulse', x: ROOM.half - 0.05, y: 3.9, z: -2, yaw: -Math.PI / 2, w: 10, h: 6.25 },
];

export const KIOSK = { w: 3.3, h: 3.1, z: -11.5, gap: 0.45 };

/**
 * Standing kiosks, one per app, in a centred row across the room. Returns
 * placed surfaces; `x` is centred on the room and the row never leaves it.
 */
export function kioskLayout(apps, { half = ROOM.half - 2.5 } = {}) {
	const n = apps.length;
	if (!n) return [];
	const pitch = Math.min(KIOSK.w + KIOSK.gap, (half * 2) / n);
	const start = -((n - 1) * pitch) / 2;
	return apps.map((a, i) => ({
		id: `kiosk:${a.id}`,
		kind: 'kiosk',
		app: a.id,
		title: a.title,
		sub: a.desc || '',
		hue: a.hue,
		x: start + i * pitch,
		y: KIOSK.h / 2,
		z: KIOSK.z,
		yaw: 0,
		w: Math.min(KIOSK.w, pitch - 0.2),
		h: KIOSK.h,
	}));
}

/** The surface in reach of (x, z), nearest first, or null. */
export function nearestSurface(x, z, surfaces, reach = REACH) {
	let best = null;
	for (const s of surfaces) {
		// Distance to the surface's face, not its centre, so wide boards arm along their length.
		const dx = x - s.x;
		const dz = z - s.z;
		const cos = Math.cos(s.yaw);
		const sin = Math.sin(s.yaw);
		const along = dx * cos - dz * sin; // across the face
		const out = dx * sin + dz * cos; // out from the face
		const lateral = Math.max(0, Math.abs(along) - s.w / 2);
		const d = Math.hypot(lateral, out);
		if (out < -0.4 || d > reach) continue;
		if (!best || d < best.d) best = { d, surface: s };
	}
	return best ? best.surface : null;
}

/** Clip to `n` characters with an ellipsis. */
export function clip(s, n) {
	const t = String(s ?? '').replace(/\s+/g, ' ').trim();
	return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t;
}

/** Break text into lines no wider than `max` characters; words longer than a line are cut. */
export function wrap(text, max) {
	const out = [];
	let line = '';
	for (const raw of String(text ?? '').split(/\s+/).filter(Boolean)) {
		let word = raw;
		while (word.length > max) {
			if (line) { out.push(line); line = ''; }
			out.push(word.slice(0, max));
			word = word.slice(max);
		}
		if (!line) line = word;
		else if (line.length + 1 + word.length <= max) line += ` ${word}`;
		else { out.push(line); line = word; }
	}
	if (line) out.push(line);
	return out;
}

/** A wallet address as `AbCd...wXyZ`. Anything short is returned whole. */
export function shortWallet(addr) { return shortAddress(addr, 4, 4, { sep: '...' }); }
