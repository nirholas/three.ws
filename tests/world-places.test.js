import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_APPS } from '../src/desktop/apps.js';
import {
	CAMPUS_RADIUS,
	SPAWN,
	PLACES,
	VEINS,
	DESK_OBJECTS,
	PLACE_TRIGGER,
	OBJECT_TRIGGER,
	placeById,
	nearestInteractable,
	facingOf,
	standPointFor,
	dist2,
} from '../src/desktop/world/places.js';
import { GEMS, GEM_BY_ID, NODES, DAILY_DIG_CAP, MIN_DIG_INTERVAL_MS, validAnonId, validNode, rollGem, digAllowed, totalPoints, summarize } from '../api/_lib/world-gems.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('campus places', () => {
	it('opens only real desktop apps', () => {
		const ids = new Set(ALL_APPS.map((a) => a.id));
		for (const p of PLACES.filter((p) => p.kind === 'app')) expect(ids.has(p.app), `${p.id} -> ${p.app}`).toBe(true);
		expect(PLACES.filter((p) => p.kind === 'office')).toHaveLength(1);
		expect(PLACES.filter((p) => p.kind === 'mine')).toHaveLength(1);
	});
	it('has unique ids and keeps every place and the spawn inside the walkable disc', () => {
		expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
		for (const p of PLACES) expect(Math.hypot(p.x, p.z) + p.keepout, p.id).toBeLessThan(CAMPUS_RADIUS);
		expect(Math.hypot(SPAWN.x, SPAWN.z)).toBeLessThan(CAMPUS_RADIUS);
	});
	it('spaces buildings so no two keep-outs overlap and the trigger zones are reachable', () => {
		for (let i = 0; i < PLACES.length; i++) {
			for (let j = i + 1; j < PLACES.length; j++) {
				const a = PLACES[i];
				const b = PLACES[j];
				const d = Math.sqrt(dist2(a.x, a.z, b.x, b.z));
				expect(d, `${a.id} vs ${b.id}`).toBeGreaterThan(a.keepout + b.keepout + PLACE_TRIGGER);
			}
		}
	});
	it('faces every building toward the campus centre and stands the player in front of it', () => {
		for (const p of PLACES) {
			const s = standPointFor(p);
			// The stand point is nearer the origin than the building is.
			expect(Math.hypot(s.x, s.z)).toBeLessThan(Math.hypot(p.x, p.z) + 0.001);
			// It sits just outside the keep-out, inside the trigger zone.
			const d = Math.sqrt(dist2(s.x, s.z, p.x, p.z));
			expect(d).toBeGreaterThan(p.keepout);
			expect(d).toBeLessThan(p.keepout + PLACE_TRIGGER);
			// And the player faces the building: walking along their yaw moves them closer.
			const step = { x: s.x + Math.sin(s.yaw) * 0.5, z: s.z + Math.cos(s.yaw) * 0.5 };
			expect(dist2(step.x, step.z, p.x, p.z)).toBeLessThan(d * d);
		}
		expect(facingOf({ x: 0, z: -10 })).toBeCloseTo(0);
		expect(facingOf({ x: 10, z: 0 })).toBeCloseTo(-Math.PI / 2);
	});
	it('names the mine veins exactly as the gem API does', () => {
		expect(VEINS.map((v) => v.id).sort()).toEqual([...NODES].sort());
		expect(new Set(DESK_OBJECTS.map((o) => o.id)).size).toBe(DESK_OBJECTS.length);
		expect(placeById('nope')).toBeNull();
	});
	it('picks the nearest desk object, then vein, then place', () => {
		const office = placeById('office');
		const monitor = DESK_OBJECTS.find((o) => o.id === 'monitor');
		expect(nearestInteractable(office.x + monitor.dx, office.z + monitor.dz + 0.5)).toMatchObject({ type: 'object', id: 'monitor' });
		const veins = [{ id: 'vein-a', x: 0, z: -33 }];
		expect(nearestInteractable(0.3, -33, { veinPositions: veins })).toMatchObject({ type: 'vein', id: 'vein-a' });
		expect(nearestInteractable(0, -33 - OBJECT_TRIGGER - 1, { veinPositions: veins })).toBeNull();
		const ex = placeById('exchange');
		const s = standPointFor(ex);
		expect(nearestInteractable(s.x, s.z)).toMatchObject({ type: 'place', id: 'exchange' });
		expect(nearestInteractable(0, 0)).toBeNull();
	});
});

describe('gem mining rules', () => {
	it('ships the API handler and its migration', () => {
		expect(existsSync(resolve(root, 'api/world/gems.js'))).toBe(true);
		expect(existsSync(resolve(root, 'api/_lib/migrations/20261015000000_world_gems.sql'))).toBe(true);
		expect(readFileSync(resolve(root, 'api/_lib/migrations/20261015000000_world_gems.sql'), 'utf8')).toContain('world_gems');
	});
	it('weights sum to a thousand so the roll is exact', () => {
		expect(GEMS.reduce((n, g) => n + g.weight, 0)).toBe(1000);
		for (const g of GEMS) expect(GEM_BY_ID[g.id]).toBe(g);
	});
	it('rolls the common gem at the bottom of the range and the rarest at the top', () => {
		expect(rollGem(0).id).toBe(GEMS[0].id);
		expect(rollGem(0.9999).id).toBe(GEMS.at(-1).id);
		const seen = new Set();
		for (let i = 0; i < 1000; i++) seen.add(rollGem(i / 1000).id);
		expect(seen.size).toBe(GEMS.length);
	});
	it('validates nodes and anonymous ids', () => {
		expect(validNode('vein-a')).toBe(true);
		expect(validNode('vein-z')).toBe(false);
		expect(validAnonId('anon_0f5e2c1a-3b4d-4e5f-8a6b-7c8d9e0f1a2b')).toBe(true);
		expect(validAnonId('anon_x')).toBe(false);
		expect(validAnonId('')).toBe(false);
	});
	it('rate limits a dig on the server floor', () => {
		const now = 1_000_000;
		expect(digAllowed(null, now)).toBe(true);
		expect(digAllowed(undefined, now)).toBe(true);
		expect(digAllowed(NaN, now)).toBe(true);
		expect(digAllowed(now - MIN_DIG_INTERVAL_MS / 2, now)).toBe(false);
		expect(digAllowed(now - MIN_DIG_INTERVAL_MS, now)).toBe(true);
		expect(DAILY_DIG_CAP).toBeGreaterThan(0);
		const handler = readFileSync(resolve(root, 'api/world/gems.js'), 'utf8');
		expect(handler).toContain('DAILY_DIG_CAP');
		expect(handler).toContain('daily_cap');
		expect(handler).toContain('dig_too_soon');
	});
	it('totals points and summarises a ledger', () => {
		const rows = [
			{ gem: GEMS[0].id, amount: 2 },
			{ gem: GEMS[1].id, amount: 1 },
		];
		expect(totalPoints(rows)).toBe(GEMS[0].points * 2 + GEMS[1].points);
		const s = summarize(rows);
		expect(s.total).toBe(3);
		expect(s.points).toBe(totalPoints(rows));
		expect(s.gems[GEMS[0].id]).toBe(2);
		expect(s.gems[GEMS.at(-1).id]).toBe(0);
		expect(summarize([]).total).toBe(0);
	});
});

describe('desk objects', () => {
	it('arms the monitor, not the phone, when the player walks straight up to the desk', () => {
		// Walking down the x=0 axis the desk's keep-out disc stops the player
		// about 1.35 m in front of the monitor; the phone sits to one side and
		// must not steal the prompt from there.
		const office = placeById('office');
		expect(nearestInteractable(0, office.z + 0.85)).toMatchObject({ type: 'object', id: 'monitor' });
		expect(nearestInteractable(0.05, office.z + 0.9)).toMatchObject({ type: 'object', id: 'monitor' });
	});
	it('hands the prompt to the phone and the headset only at the side of the desk', () => {
		const office = placeById('office');
		const phone = DESK_OBJECTS.find((o) => o.id === 'phone');
		const headset = DESK_OBJECTS.find((o) => o.id === 'headset');
		expect(nearestInteractable(office.x + 1.35, office.z - 0.5)).toMatchObject({ type: 'object', id: 'phone' });
		expect(nearestInteractable(office.x - 1.35, office.z - 0.5)).toMatchObject({ type: 'object', id: 'headset' });
		expect(nearestInteractable(office.x + phone.dx, office.z + phone.dz + 1.6)).not.toMatchObject({ id: 'phone' });
		expect(nearestInteractable(office.x + headset.dx, office.z + headset.dz + 1.6)).not.toMatchObject({ id: 'headset' });
	});
});
