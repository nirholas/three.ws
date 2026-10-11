import { describe, it, expect } from 'vitest';
import { PROPS, MODELS, PROP_BUDGET, LIBRARY_BASE, placeProps, payloadBytes, propSolids, propUrl, hedgePlacements, HEDGE } from '../src/desktop/world/props.js';
import { allRoomSolids, roomById, doorPoints } from '../src/desktop/world/rooms.js';
import { insideSolids } from '../src/shared/solids.js';
import { CAMPUS_RADIUS, SPAWN, VEINS, DESK_OBJECTS, placeById } from '../src/desktop/world/places.js';

describe('campus props', () => {
	it('only places models that were measured, and names a real library file for each', () => {
		for (const p of PROPS) expect(MODELS[p.model], p.model).toBeDefined();
		expect(propUrl('sofa_02')).toBe(`${LIBRARY_BASE}/sofa_02.glb`);
		for (const m of Object.values(MODELS)) {
			expect(m.bytes).toBeGreaterThan(0);
			expect(m.w).toBeGreaterThan(0);
			expect(m.h).toBeGreaterThan(0);
		}
	});

	it('stays inside the payload budget on desktop and on phones, and phones get a subset', () => {
		expect(payloadBytes('desktop')).toBeLessThanOrEqual(PROP_BUDGET.desktop);
		expect(payloadBytes('mobile')).toBeLessThanOrEqual(PROP_BUDGET.mobile);
		const desktop = new Set(placeProps('desktop').map((p) => p.model));
		for (const p of placeProps('mobile')) expect(desktop.has(p.model)).toBe(true);
		expect(placeProps('mobile').length).toBeLessThan(placeProps('desktop').length);
	});

	it('places everything on the campus and nothing on the walk from the gate to the desk', () => {
		for (const p of placeProps('desktop')) {
			expect(Math.hypot(p.x, p.z), p.model).toBeLessThan(CAMPUS_RADIUS + 6);
			const onCorridor = Math.abs(p.x) < 1.6 && p.z > 9.5 && p.z < SPAWN.z + 1;
			expect(onCorridor, `${p.model} at ${p.x.toFixed(1)},${p.z.toFixed(1)} blocks the walk in`).toBe(false);
		}
	});

	it('never stands a solid prop in a doorway, on a vein, or on the desk objects', () => {
		const solids = propSolids(placeProps('desktop'));
		for (const room of [roomById('office'), roomById('exchange'), roomById('forge'), roomById('gallery'), roomById('mine'), roomById('cabin')]) {
			const { outside, inside } = doorPoints(room, 0.8);
			expect(insideSolids(outside.x, outside.z, solids, 0.35), `${room.id} door, outside`).toBe(false);
			expect(insideSolids(inside.x, inside.z, solids, 0.35), `${room.id} door, inside`).toBe(false);
		}
		const mine = placeById('mine');
		for (const v of VEINS) expect(insideSolids(mine.x + v.dx, mine.z + v.dz, solids, 0.6), v.id).toBe(false);
		const office = placeById('office');
		// The player must reach the phone and headset: a solid prop may not sit on their reach points.
		for (const d of DESK_OBJECTS) expect(insideSolids(office.x + d.dx, office.z + d.dz + 1.2, solids, 0.3), d.id).toBe(false);
	});

	it('keeps room props inside their rooms, clear of the walls', () => {
		const walls = allRoomSolids();
		for (const p of PROPS) {
			if (!p.room) continue;
			const room = roomById(p.room);
			if (!room.w) continue;
			const w = MODELS[p.model];
			expect(Math.abs(p.x), `${p.model} in ${p.room}`).toBeLessThanOrEqual(room.w / 2 + 0.01);
			expect(Math.abs(p.z), `${p.model} in ${p.room}`).toBeLessThanOrEqual(room.d / 2 + 0.01);
			if (p.anchor === 'origin' && p.y) expect(p.y).toBeLessThanOrEqual(room.h);
			expect(w.h * (p.scale || 1)).toBeLessThanOrEqual(room.h + 0.01);
		}
		expect(walls.length).toBeGreaterThan(20);
	});

	it('rings the campus with hedge and leaves the gate behind the spawn open', () => {
		const hedge = hedgePlacements();
		expect(hedge.length).toBeGreaterThan(HEDGE.count * 0.8);
		expect(hedge.length).toBeLessThan(HEDGE.count);
		for (const h of hedge) {
			expect(Math.hypot(h.x, h.z)).toBeCloseTo(HEDGE.radius);
			const nearGate = Math.abs(h.x) < 8 && h.z > 0;
			expect(nearGate, `hedge at ${h.x.toFixed(1)},${h.z.toFixed(1)} blocks the gate`).toBe(false);
		}
	});

	it('resolves room-local positions through the room rotation', () => {
		const desk = placeProps('desktop').find((p) => p.model === 'metal_office_desk');
		const office = placeById('office');
		expect(desk.x).toBeCloseTo(office.x);
		expect(desk.z).toBeCloseTo(office.z - 0.5);
		const cart = placeProps('desktop').find((p) => p.model === 'CoffeeCart_01');
		const market = placeById('market');
		expect(Math.hypot(cart.x - market.x, cart.z - market.z)).toBeCloseTo(Math.hypot(2.6, 1.8));
	});
});

it('every placement, hedge included, resolves to a library URL and a byte size', () => {
	for (const tier of ['desktop', 'mobile']) {
		for (const p of placeProps(tier)) {
			expect(p.url, `${p.model} url`).toMatch(/^https:\/\/.+\.glb$/);
			expect(p.bytes, `${p.model} bytes`).toBeGreaterThan(0);
		}
	}
});
