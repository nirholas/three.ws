// The buildings: real rooms with walls, floors, doorways and windows the
// avatar walks into. Pure data and geometry rules (no Three.js) so tests can
// prove every door is walkable, every wall is solid, and nothing a visitor
// has to reach is sealed off. campus.js turns these specs into meshes and
// src/shared/solids.js turns the wall spans into collision.
//
// Room-local frame: the centre is the place's own position, +z is the front
// (the side with the door, turned toward the campus centre), +x is the right
// hand side seen from the front. `at` on an opening is measured along the run
// of its wall: x for the front and back walls, z for the sides.

import { boxSolid } from '../../shared/solids.js';
import { facingOf, placeById, standPointFor } from './places.js';

/** Wall thickness, in metres, shared by the meshes and the colliders. */
export const WALL = 0.3;
/** Window sill and head heights shared by every room. */
export const SILL = 0.95;
export const HEAD = 2.3;

/**
 * Every building on the campus.
 * `kind`: room (four walls, roof), hall (a roof on posts, open sides),
 * plaza (paving and a pergola), pad (the launch pad), cave (the mine: rock
 * walls, no roof, a hill over it).
 */
export const ROOMS = [
	{
		id: 'office', place: 'office', kind: 'room', w: 9, d: 7, h: 3, wall: 'plaster', floor: 'wood',
		door: { at: 0, w: 1.8, h: 2.2 },
		windows: { front: [{ at: -2.9, w: 1.8 }, { at: 2.9, w: 1.8 }], back: [{ at: -1.9, w: 2.2 }], left: [{ at: 1.3, w: 1.8 }], right: [{ at: 1.3, w: 1.8 }] },
	},
	{
		id: 'exchange', place: 'exchange', kind: 'room', w: 13, d: 9, h: 5.2, wall: 'plaster', floor: 'marble', columns: 6,
		door: { at: 0, w: 2.6, h: 3.4 },
		windows: { left: [{ at: -1.2, w: 2 }, { at: 1.8, w: 2 }], right: [{ at: -1.2, w: 2 }, { at: 1.8, w: 2 }] },
		sill: 1.3, head: 3.8,
	},
	{ id: 'pad', place: 'launchpad', kind: 'pad', r: 5.2 },
	{
		id: 'cabin', place: 'launchpad', kind: 'room', w: 3.4, d: 2.8, h: 2.7, wall: 'plaster', floor: 'concrete', at: { x: -3.6, z: 2.4 }, turn: Math.PI / 2,
		door: { at: 0.4, w: 1.1, h: 2.1 },
		windows: { front: [{ at: -0.9, w: 1 }], back: [{ at: 0, w: 1.6 }] },
	},
	{
		id: 'mine', place: 'mine', kind: 'cave', w: 16, d: 13.5, h: 4.5, wall: 'rock', floor: 'rock',
		door: { at: 0, w: 3.2, h: 3.2 },
		windows: {},
	},
	{
		id: 'forge', place: 'forge', kind: 'room', w: 6.6, d: 5.8, h: 3.4, wall: 'brick', floor: 'concrete',
		door: { at: -1.3, w: 1.6, h: 2.3 },
		windows: { front: [{ at: 1.6, w: 1.6 }], right: [{ at: 0.2, w: 1.6 }] },
	},
	{
		id: 'gallery', place: 'gallery', kind: 'room', w: 6.6, d: 6.6, h: 3.6, wall: 'plaster', floor: 'marble', skylight: true,
		door: { at: 0, w: 1.8, h: 2.5 },
		windows: {},
	},
	{ id: 'plaza', place: 'agents', kind: 'plaza', r: 6.5, pergola: 4.4 },
	{ id: 'market', place: 'market', kind: 'hall', w: 9, d: 7, h: 3.4, floor: 'paving', posts: [[-4.2, -3.2], [0, -3.2], [4.2, -3.2], [-4.2, 3.2], [0, 3.2], [4.2, 3.2]] },
];

export function roomById(id) {
	return ROOMS.find((r) => r.id === id) || null;
}

/** The yaw a place's buildings turn by: the front faces the campus centre; the office faces the gate. */
export function rotationOf(place) {
	return place.id === 'office' ? 0 : facingOf(place);
}

/** World position and yaw of a room's centre. */
export function roomFrame(room) {
	const place = placeById(room.place);
	const base = rotationOf(place);
	const { x, z } = toWorld(place, room.at?.x || 0, room.at?.z || 0, base);
	return { x, z, yaw: base + (room.turn || 0) };
}

/** Rotate a local offset by `yaw` (Three.js Y rotation) and add the place. */
export function toWorld(place, lx, lz, yaw = rotationOf(place)) {
	const sin = Math.sin(yaw);
	const cos = Math.cos(yaw);
	return { x: place.x + lx * cos + lz * sin, z: place.z - lx * sin + lz * cos };
}

/** A room-local point to world space, including the room's own turn. */
export function roomToWorld(room, lx, lz) {
	const f = roomFrame(room);
	const sin = Math.sin(f.yaw);
	const cos = Math.cos(f.yaw);
	return { x: f.x + lx * cos + lz * sin, z: f.z - lx * sin + lz * cos, yaw: f.yaw };
}

const SIDES = {
	front: (r) => ({ cx: 0, cz: r.d / 2, len: r.w, yaw: 0 }),
	back: (r) => ({ cx: 0, cz: -r.d / 2, len: r.w, yaw: 0 }),
	left: (r) => ({ cx: -r.w / 2, cz: 0, len: r.d, yaw: Math.PI / 2 }),
	right: (r) => ({ cx: r.w / 2, cz: 0, len: r.d, yaw: Math.PI / 2 }),
};

/** Every opening in one wall of a room, as {at, w, y0, y1}. */
export function openingsOf(room, side) {
	const list = [];
	if (room.door && (room.door.side || 'front') === side) list.push({ at: room.door.at, w: room.door.w, y0: 0, y1: room.door.h, kind: 'door' });
	for (const win of room.windows?.[side] || []) list.push({ at: win.at, w: win.w, y0: room.sill ?? SILL, y1: room.head ?? HEAD, kind: 'window' });
	return list.sort((a, b) => a.at - b.at);
}

/**
 * Split one wall into solid pieces around its openings: full-height pieces
 * between openings, a sill piece under each window and a lintel piece over
 * every opening. Each piece is {at, len, y0, y1} along the wall's run.
 */
export function wallPieces(len, h, openings) {
	const pieces = [];
	let cursor = -len / 2;
	for (const o of openings) {
		const a = o.at - o.w / 2;
		const b = o.at + o.w / 2;
		if (a > cursor + 0.01) pieces.push({ at: (cursor + a) / 2, len: a - cursor, y0: 0, y1: h });
		if (o.y0 > 0) pieces.push({ at: o.at, len: o.w, y0: 0, y1: o.y0 });
		if (o.y1 < h) pieces.push({ at: o.at, len: o.w, y0: o.y1, y1: h });
		cursor = b;
	}
	if (cursor < len / 2 - 0.01) pieces.push({ at: (cursor + len / 2) / 2, len: len / 2 - cursor, y0: 0, y1: h });
	return pieces;
}

/**
 * The four walls of a room as pieces in room-local space:
 * {side, x, z, yaw, len, y0, y1, openings}. Halls, plazas and pads have none.
 */
export function wallsOf(room) {
	if (!['room', 'cave'].includes(room.kind)) return [];
	const out = [];
	for (const [side, geom] of Object.entries(SIDES)) {
		const { cx, cz, len, yaw } = geom(room);
		const openings = openingsOf(room, side);
		const pieces = wallPieces(len, room.h, openings).map((p) => ({
			side,
			yaw,
			len: p.len,
			y0: p.y0,
			y1: p.y1,
			x: side === 'left' || side === 'right' ? cx : p.at,
			z: side === 'left' || side === 'right' ? p.at : cz,
		}));
		out.push({ side, cx, cz, len, yaw, openings, pieces });
	}
	return out;
}

/**
 * Collision for a building, in world space. Walls are solid along their
 * whole run except through the door; a hall's posts and the pad's rocket are
 * cylinders; the cave adds the hill that wraps round it.
 */
export function roomSolids(room) {
	const f = roomFrame(room);
	const solids = [];
	const world = (lx, lz) => roomToWorld(room, lx, lz);
	for (const wall of wallsOf(room)) {
		const spans = wallPieces(wall.len, room.h, wall.openings.filter((o) => o.y0 === 0)).filter((p) => p.y0 === 0 && p.y1 === room.h);
		for (const s of spans) {
			const lx = wall.side === 'left' || wall.side === 'right' ? wall.cx : s.at;
			const lz = wall.side === 'left' || wall.side === 'right' ? s.at : wall.cz;
			const p = world(lx, lz);
			solids.push(boxSolid(p.x, p.z, f.yaw + wall.yaw, s.len, WALL));
		}
	}
	if (room.kind === 'hall') for (const [lx, lz] of room.posts) solids.push(disc(world(lx, lz), 0.5));
	for (const [lx, lz] of columnsOf(room)) solids.push(disc(world(lx, lz), 0.45));
	if (room.kind === 'plaza') {
		const r = room.pergola / 2;
		for (const [lx, lz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) solids.push(disc(world(lx, lz), 0.45));
	}
	if (room.kind === 'pad') solids.push(disc(world(1.2, 0), 1.6), disc(world(3.6, 0), 0.5));
	if (room.kind === 'cave') {
		// The hill: shoulders either side of the portal and the mass behind the cave.
		solids.push(disc(world(-12, -5), 4), disc(world(12, -5), 4), disc(world(0, -14), 6.5));
	}
	return solids;
}

/** Local positions of a classical facade's columns: evenly spaced, never in front of the door. */
export const COLUMN_X = [-5.4, -3.6, -1.8, 1.8, 3.6, 5.4];
export function columnsOf(room) {
	if (!room.columns) return [];
	return COLUMN_X.slice(0, room.columns).map((x) => [x, room.d / 2 + 1.5]);
}

function disc(p, keepout) {
	return { group: { position: { x: p.x, y: 0, z: p.z } }, keepout };
}

/** The world point just outside and just inside a room's door, for tests and arrivals. */
export function doorPoints(room, reach = 1) {
	if (!room.door) return null;
	const f = roomFrame(room);
	const side = room.door.side || 'front';
	const g = SIDES[side](room);
	const onRun = (t, off) => (side === 'front' || side === 'back' ? { lx: t, lz: g.cz + off } : { lx: g.cx + off, lz: t });
	const sign = side === 'front' || side === 'right' ? 1 : -1;
	const out = onRun(room.door.at, sign * reach);
	const inn = onRun(room.door.at, -sign * reach);
	return { outside: roomToWorld(room, out.lx, out.lz), inside: roomToWorld(room, inn.lx, inn.lz), yaw: f.yaw };
}

/**
 * Where a visitor lands when they teleport to a place or come back from it:
 * just outside the building's door, facing in, so the follow camera has open
 * air behind it. Open-air places keep the stand point on the approach path.
 * @returns {{ x:number, z:number, yaw:number }}
 */
export function arrivalPointFor(place, reach = 2.2) {
	const room = ROOMS.find((r) => r.place === place.id);
	if (!room?.door) return standPointFor(place);
	const d = doorPoints(room, reach);
	return { x: d.outside.x, z: d.outside.z, yaw: roomFrame(room).yaw + Math.PI };
}

/** Every building's collision, in one list. */
export function allRoomSolids() {
	return ROOMS.flatMap(roomSolids);
}
