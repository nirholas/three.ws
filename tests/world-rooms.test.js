import { describe, it, expect } from 'vitest';
import { ROOMS, roomById, roomFrame, roomToWorld, wallsOf, wallPieces, roomSolids, allRoomSolids, doorPoints, columnsOf, arrivalPointFor, WALL } from '../src/desktop/world/rooms.js';
import { insideSolids, resolveSolids } from '../src/shared/solids.js';
import { PLACES, SPAWN, CAMPUS_RADIUS, VEINS, DESK_OBJECTS, PLACE_TRIGGER, placeById, standPointFor } from '../src/desktop/world/places.js';

describe('campus rooms', () => {
	it('every room belongs to a real place and every place with a window has a door to walk through', () => {
		for (const room of ROOMS) {
			expect(placeById(room.place), room.id).not.toBeNull();
			if (room.kind === 'room' || room.kind === 'cave') {
				expect(room.door.w, `${room.id} door`).toBeGreaterThanOrEqual(1.1);
				expect(room.door.h, `${room.id} door height`).toBeGreaterThanOrEqual(2.1);
				expect(room.door.h).toBeLessThan(room.h);
			}
		}
		expect(new Set(ROOMS.map((r) => r.id)).size).toBe(ROOMS.length);
	});

	it('splits a wall into pieces that leave the door open and keep the lintel and sills', () => {
		const pieces = wallPieces(9, 3, [{ at: 0, w: 1.5, y0: 0, y1: 2.2 }, { at: 2.9, w: 1.8, y0: 0.95, y1: 2.3 }]);
		const full = pieces.filter((p) => p.y0 === 0 && p.y1 === 3);
		const covered = full.reduce((n, p) => n + p.len, 0);
		expect(covered).toBeCloseTo(9 - 1.5 - 1.8);
		expect(pieces.some((p) => p.at === 0 && p.y0 === 2.2 && p.y1 === 3)).toBe(true);
		expect(pieces.some((p) => p.at === 2.9 && p.y0 === 0 && p.y1 === 0.95)).toBe(true);
		expect(pieces.some((p) => p.at === 2.9 && p.y0 === 2.3 && p.y1 === 3)).toBe(true);
		expect(pieces.every((p) => p.len > 0)).toBe(true);
	});

	it('builds four walls for every closed room and none for halls, plazas and pads', () => {
		for (const room of ROOMS) {
			const walls = wallsOf(room);
			if (room.kind === 'room' || room.kind === 'cave') {
				expect(walls.map((w) => w.side).sort()).toEqual(['back', 'front', 'left', 'right']);
				for (const w of walls) expect(w.pieces.length).toBeGreaterThan(0);
			} else expect(walls).toEqual([]);
		}
	});

	it('is walkable through every door and solid through every wall', () => {
		for (const room of ROOMS) {
			if (!room.door) continue;
			const solids = roomSolids(room);
			const { outside, inside } = doorPoints(room, 0.9);
			expect(insideSolids(outside.x, outside.z, solids, 0.3), `${room.id} outside the door`).toBe(false);
			expect(insideSolids(inside.x, inside.z, solids, 0.3), `${room.id} inside the door`).toBe(false);
			// A body walking straight through the doorway is never pushed.
			for (let t = 0; t <= 1; t += 0.1) {
				const p = { x: outside.x + (inside.x - outside.x) * t, z: outside.z + (inside.z - outside.z) * t };
				const q = resolveSolids({ ...p }, solids, { keepout: 0.3 });
				expect(Math.hypot(q.x - p.x, q.z - p.z), `${room.id} doorway at ${t.toFixed(1)}`).toBeLessThan(1e-6);
			}
			// The middle of the back wall is solid.
			const back = roomToWorld(room, 0.3, -room.d / 2);
			expect(insideSolids(back.x, back.z, solids, 0.2), `${room.id} back wall`).toBe(true);
		}
	});

	it('keeps the office door in line with the gate so the walk from spawn to the desk is a straight run', () => {
		const office = roomById('office');
		const { outside, inside } = doorPoints(office, 1);
		expect(outside.x).toBeCloseTo(0);
		expect(inside.x).toBeCloseTo(0);
		expect(outside.z).toBeGreaterThan(inside.z);
		expect(SPAWN.x).toBe(0);
		// Nothing solid on the line x = 0 between the spawn and the desk.
		const solids = allRoomSolids();
		const desk = placeById('office');
		for (let z = SPAWN.z; z > desk.z + 1.2; z -= 0.25) expect(insideSolids(0, z, solids, 0.45), `corridor at z=${z}`).toBe(false);
	});

	it('leaves the desk objects and every mine vein inside their rooms, clear of the walls', () => {
		const office = roomById('office');
		const o = placeById('office');
		for (const d of DESK_OBJECTS) {
			const w = roomToWorld(office, d.dx, d.dz);
			expect(w.x).toBeCloseTo(o.x + d.dx);
			expect(w.z).toBeCloseTo(o.z + d.dz);
		}
		const mine = roomById('mine');
		const m = placeById('mine');
		const solids = roomSolids(mine);
		for (const v of VEINS) {
			expect(insideSolids(m.x + v.dx, m.z + v.dz, solids, 0.9), v.id).toBe(false);
			expect(Math.abs(v.dx)).toBeLessThan(mine.w / 2 - 1);
			expect(Math.abs(v.dz)).toBeLessThan(mine.d / 2 - 0.5);
		}
	});

	it('turns every building so its door faces the campus centre and its stand point is outside', () => {
		for (const room of ROOMS) {
			if (!room.door || room.id === 'office' || room.id === 'cabin') continue;
			const place = placeById(room.place);
			const { outside, inside } = doorPoints(room, 1);
			const dOut = Math.hypot(outside.x, outside.z);
			const dIn = Math.hypot(inside.x, inside.z);
			expect(dOut, `${room.id} door faces in`).toBeLessThan(dIn);
			const stand = standPointFor(place);
			expect(insideSolids(stand.x, stand.z, roomSolids(room), 0.5), `${room.id} stand point`).toBe(false);
			if (place.keepout) expect(Math.hypot(stand.x - place.x, stand.z - place.z)).toBeGreaterThan(Math.max(room.w || 0, room.d || 0, (room.r || 0) * 2) / 2);
		}
	});

	it('keeps every wall and column inside the campus and never in another building', () => {
		for (const room of ROOMS) {
			const f = roomFrame(room);
			const reach = Math.hypot((room.w || room.r * 2) / 2, (room.d || room.r * 2) / 2);
			expect(Math.hypot(f.x, f.z) + reach, room.id).toBeLessThan(CAMPUS_RADIUS + 2);
			for (const [x, z] of columnsOf(room)) {
				const w = roomToWorld(room, x, z);
				expect(Math.hypot(w.x, w.z)).toBeLessThan(CAMPUS_RADIUS);
			}
		}
		const centres = ROOMS.filter((r) => r.kind === 'room' || r.kind === 'cave').map((r) => ({ id: r.id, ...roomFrame(r), r: Math.hypot(r.w, r.d) / 2 }));
		for (const a of centres) for (const b of centres) {
			if (a.id === b.id) continue;
			if (a.id === 'cabin' || b.id === 'cabin') continue;
			expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} vs ${b.id}`).toBeGreaterThan(a.r + b.r - 2);
		}
	});

	it('keeps the facade columns clear of the exchange doorway', () => {
		const ex = roomById('exchange');
		for (const [x] of columnsOf(ex)) expect(Math.abs(x)).toBeGreaterThan(ex.door.w / 2 + 0.3);
		expect(columnsOf(ex)).toHaveLength(ex.columns);
	});

	it('uses one wall thickness for meshes and colliders', () => {
		expect(WALL).toBeGreaterThan(0.2);
		expect(WALL).toBeLessThan(0.5);
		expect(PLACES.length).toBeGreaterThan(0);
	});
});

describe('arrival points', () => {
	const solids = allRoomSolids();
	it('land every visitor outside the building, at its door, with open air behind the follow camera', () => {
		for (const place of PLACES) {
			const a = arrivalPointFor(place);
			const room = ROOMS.find((r) => r.place === place.id);
			expect(insideSolids(a.x, a.z, solids, 0.45), `${place.id} arrival stands clear`).toBe(false);
			if (room?.door) {
				const f = roomFrame(room);
				// Facing in: one step forward lands in the doorway, not out on the lawn.
				const step = { x: a.x + Math.sin(a.yaw) * 2.2, z: a.z + Math.cos(a.yaw) * 2.2 };
				const door = doorPoints(room, 0);
				expect(Math.hypot(step.x - door.outside.x, step.z - door.outside.z), `${place.id} faces its door`).toBeLessThan(0.05);
				expect(Math.abs(((a.yaw - f.yaw - Math.PI) % (Math.PI * 2)))).toBeLessThan(1e-9);
			}
			// The chase camera starts six metres behind: that spot must be clear of walls and the hill.
			const cam = { x: a.x - Math.sin(a.yaw) * 6, z: a.z - Math.cos(a.yaw) * 6 };
			expect(insideSolids(cam.x, cam.z, solids, 0.3), `${place.id} camera start is in open air`).toBe(false);
			// And the prompt to enter must already be armed where they land.
			if (place.kind !== 'office' && place.kind !== 'mine') {
				expect(Math.hypot(a.x - place.x, a.z - place.z)).toBeLessThan(PLACE_TRIGGER + place.keepout);
			}
		}
	});
});

describe('gable roofs', () => {
	it('slope down from the ridge to the eaves on both sides, never up into a V', async () => {
		const { gableRoof } = await import('../src/desktop/world/campus.js');
		const { MeshStandardMaterial, Vector3 } = await import('three');
		const surfaces = { material: () => new MeshStandardMaterial(), metresPerTile: () => 2.5 };
		const mats = { darkSteel: new MeshStandardMaterial(), white: new MeshStandardMaterial() };
		const room = roomById('office');
		const roof = gableRoof(room, surfaces, mats, (m) => m);
		roof.updateMatrixWorld(true);
		const slabs = roof.children.filter((m) => m.geometry?.type === 'BoxGeometry' && m.geometry.parameters.height === 0.16);
		expect(slabs).toHaveLength(2);
		for (const slab of slabs) {
			const run = slab.geometry.parameters.depth;
			const inner = slab.localToWorld(new Vector3(0, 0, slab.position.z > 0 ? -run / 2 : run / 2));
			const outer = slab.localToWorld(new Vector3(0, 0, slab.position.z > 0 ? run / 2 : -run / 2));
			expect(Math.abs(inner.z), 'inner end sits on the ridge line').toBeLessThan(0.05);
			expect(inner.y, 'ridge end is the high end').toBeGreaterThan(outer.y + 1);
			expect(outer.y, 'eave end sits just above the wall top').toBeLessThan(room.h + 0.3);
		}
	});
});
