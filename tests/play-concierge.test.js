import { describe, it, expect } from 'vitest';
import {
	GREETED_KEY, LANDMARKS, CONCIERGE_POST, WALK_AWAY, STOP_RADIUS,
	isFirstVisit, markGreeted, npcLayerEnabled, eventLine, buildTour, nextStop, reached,
	conciergePersona, featureLines,
} from '../src/game/npc/concierge-logic.js';
import { parseEventConfig } from '../src/shared/event-config.js';
import { WHEEL, GACHA, WAR_PORTAL, PLAZA_STAGE, ATMS } from '../multiplayer/src/world-features.js';
import { SIGNATURE_WALL } from '../src/game/signature-wall.js';
import { KIOSK_SPOT } from '../src/game/intel-kiosk.js';
import { spawnsOfType } from '../src/game/world-zones.js';

const memStore = () => {
	const m = new Map();
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const brokenStore = () => ({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });

describe('first-visit detection', () => {
	it('greets once, then never again after the flag is set', () => {
		const s = memStore();
		expect(isFirstVisit(s)).toBe(true);
		markGreeted(s);
		expect(s.getItem(GREETED_KEY)).toBe('1');
		expect(isFirstVisit(s)).toBe(false);
	});
	it('treats unreadable storage as already greeted so it never nags', () => {
		expect(isFirstVisit(brokenStore())).toBe(false);
		expect(() => markGreeted(brokenStore())).not.toThrow();
	});
	it('is off when the NPC layer is disabled', () => {
		expect(npcLayerEnabled('?npcs=0')).toBe(false);
		expect(npcLayerEnabled('?coin=x')).toBe(true);
		expect(npcLayerEnabled('')).toBe(true);
	});
});

describe('event-window opening line', () => {
	const cfg = parseEventConfig({
		name: 'Test Meetup', tagline: 'In the plaza.',
		startsAt: '2026-11-06T16:00:00Z', endsAt: '2026-11-06T17:00:00Z',
	});
	const at = (iso) => Date.parse(iso);
	it('is absent well before the start', () => {
		expect(eventLine(cfg, at('2026-11-05T10:00:00Z'))).toBeNull();
	});
	it('announces the event inside the final hour before it starts', () => {
		expect(eventLine(cfg, at('2026-11-06T15:30:00Z'))).toBe('Test Meetup starts soon. In the plaza.');
	});
	it('says it is happening while live', () => {
		expect(eventLine(cfg, at('2026-11-06T16:30:00Z'))).toBe('Test Meetup is happening right now. In the plaza.');
	});
	it('is absent after the end and with no config', () => {
		expect(eventLine(cfg, at('2026-11-06T17:00:01Z'))).toBeNull();
		expect(eventLine(null)).toBeNull();
	});
});

describe('tour route', () => {
	it('every stop resolves to a real station position', () => {
		const real = [
			KIOSK_SPOT, { x: SIGNATURE_WALL.x, z: SIGNATURE_WALL.z }, WHEEL[0], WAR_PORTAL,
		];
		const tour = buildTour({ x: CONCIERGE_POST.x, z: CONCIERGE_POST.z });
		expect(tour.length).toBeGreaterThanOrEqual(3);
		expect(tour.length).toBeLessThanOrEqual(4);
		for (const stop of tour) {
			expect(real.some((r) => r.x === stop.x && r.z === stop.z)).toBe(true);
			expect(stop.line.length).toBeGreaterThan(10);
		}
	});
	it('starts at the stop nearest the player and visits each stop once', () => {
		const tour = buildTour({ x: -8, z: -6 });
		expect(tour[0].id).toBe('intel-kiosk');
		expect(new Set(tour.map((s) => s.id)).size).toBe(tour.length);
	});
	it('skip advances from every index and ends the tour after the last stop', () => {
		const tour = buildTour({ x: 0, z: 0 });
		for (let i = 0; i < tour.length - 1; i++) expect(nextStop(tour, i)).toBe(i + 1);
		expect(nextStop(tour, tour.length - 1)).toBeNull();
	});
	it('reached() uses the stop radius', () => {
		const stop = { x: 10, z: 10 };
		expect(reached({ x: 10 + STOP_RADIUS - 0.1, z: 10 }, stop)).toBe(true);
		expect(reached({ x: 10 + STOP_RADIUS + 0.1, z: 10 }, stop)).toBe(false);
		expect(WALK_AWAY).toBeGreaterThan(STOP_RADIUS);
	});
});

describe('persona is grounded in stations that exist', () => {
	it('every landmark position matches the module that places the station', () => {
		const pos = Object.fromEntries(LANDMARKS.map((l) => [l.id, l.at]));
		expect(pos['intel-kiosk']).toEqual(KIOSK_SPOT);
		expect(pos.wheel).toEqual({ x: WHEEL[0].x, z: WHEEL[0].z });
		expect(pos.gacha).toEqual({ x: GACHA[0].x, z: GACHA[0].z });
		expect(pos['war-portal']).toEqual({ x: WAR_PORTAL.x, z: WAR_PORTAL.z });
		expect(pos['plaza-stage']).toEqual({ x: PLAZA_STAGE.x, z: PLAZA_STAGE.z });
		expect(pos.bank).toEqual({ x: ATMS[0].x, z: ATMS[0].z });
		const b = spawnsOfType('boutique')[0];
		expect(pos.boutique).toEqual({ x: b.x, z: b.z });
	});
	it('names every landmark in the prompt and keeps $three the only coin', () => {
		const p = conciergePersona();
		for (const line of featureLines()) expect(p).toContain(line);
		expect(p).toMatch(/Intel Kiosk/);
		expect(p).toMatch(/War Portal/);
		expect(p).toMatch(/boutique/i);
		expect(p).not.toMatch(/[\u2013\u2014]/);
	});
	it('the stations the persona names are still wired into the world', async () => {
		const { readFileSync } = await import('node:fs');
		const cc = readFileSync(new URL('../src/game/coincommunities.js', import.meta.url), 'utf8');
		for (const sym of ['new IntelKiosk', 'new WheelStation', 'new GachaStation', 'new SignatureWall', 'new WarPortal', 'createChartScreen(']) {
			expect(cc).toContain(sym);
		}
	});
});

describe('mountConcierge gate', () => {
	it('returns null and builds nothing when the NPC layer is disabled', async () => {
		const { mountConcierge } = await import('../src/game/npc/concierge.js');
		const scene = { add() { throw new Error('must not touch the scene'); } };
		expect(mountConcierge({ scene, search: '?npcs=0' })).toBeNull();
	});
});
