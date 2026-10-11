import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CARD,
	CORE,
	DISTRICTS,
	RING,
	RING_TALL,
	agentPosition,
	agentSize,
	clampCam,
	coreRadius,
	deepLink,
	describeEvent,
	districtForEvent,
	fitRect,
	layoutDistricts,
	lodFor,
	relTime,
	ringFor,
	screenToWorld,
	searchField,
	trailAlpha,
	wantsField,
	worldBounds,
	worldToScreen,
	zoomAt,
	zoomPath,
} from '../src/field/logic.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
const routed = (path) => vercel.routes.some((r) => r.src && new RegExp(`^${r.src}$`).test(path));

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('field districts', () => {
	it('points every district at a routed same-origin page with a unique id', () => {
		const ids = [CORE, ...DISTRICTS].map((d) => d.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const d of [CORE, ...DISTRICTS]) expect(routed(d.href), d.href).toBe(true);
	});

	for (const [name, ring] of [['wide', RING], ['tall', RING_TALL]]) {
		it(`keeps cards apart and clear of a full agent core on the ${name} ring`, () => {
			const laid = layoutDistricts(DISTRICTS, ring);
			for (let i = 0; i < laid.length; i++) for (let j = i + 1; j < laid.length; j++) expect(overlap(laid[i].rect, laid[j].rect), `${laid[i].id}/${laid[j].id}`).toBe(false);
			const r = coreRadius(ring.cap);
			for (const d of laid) {
				const nx = Math.max(d.rect.x, Math.min(0, d.rect.x + d.rect.w));
				const ny = Math.max(d.rect.y, Math.min(0, d.rect.y + d.rect.h));
				expect(Math.hypot(nx, ny), d.id).toBeGreaterThan(r);
			}
			const b = worldBounds(ring);
			for (const d of laid) expect(d.rect.x >= b.x && d.rect.x + d.rect.w <= b.x + b.w && d.rect.y >= b.y && d.rect.y + d.rect.h <= b.y + b.h).toBe(true);
		});
	}

	// Far tags are counter-scaled, so they keep their screen size however far out the camera is.
	for (const [vw, vh] of [[390, 844], [360, 740], [430, 932], [1440, 900], [1024, 768]]) {
		it(`keeps every far tag apart and on screen at the home view on ${vw}x${vh}`, () => {
			const ring = ringFor(vw, vh);
			const home = fitRect(worldBounds(ring), vw, vh, 16);
			const tags = layoutDistricts(DISTRICTS, ring).map((d) => {
				const s = worldToScreen(home, vw, vh, d.x, d.y);
				return { id: d.id, x: s.x - 75, y: s.y - 27, w: 150, h: 54 };
			});
			for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) expect(overlap(tags[i], tags[j]), `${tags[i].id}/${tags[j].id}`).toBe(false);
			for (const t of tags) expect(t.x >= 0 && t.x + t.w <= vw && t.y >= 56 && t.y + t.h <= vh, t.id).toBe(true);
		});
	}

	it('picks the tall ring for portrait screens', () => {
		expect(ringFor(390, 844)).toBe(RING_TALL);
		expect(ringFor(1440, 900)).toBe(RING);
	});
});

describe('field agents', () => {
	it('places agents on a stable spiral, newest at the centre', () => {
		expect(agentPosition(5)).toEqual(agentPosition(5));
		expect(Math.hypot(agentPosition(0).x, agentPosition(0).y)).toBeLessThan(Math.hypot(agentPosition(100).x, agentPosition(100).y));
		for (let i = 0; i < 384; i++) {
			const p = agentPosition(i);
			expect(Math.hypot(p.x, p.y)).toBeLessThan(coreRadius(384));
		}
	});
	it('sizes stars by conversation, within bounds', () => {
		expect(agentSize(0)).toBe(3);
		expect(agentSize(90)).toBeGreaterThan(agentSize(2));
		expect(agentSize(1e9)).toBe(9);
		expect(agentSize('nope')).toBe(3);
	});
});

describe('field camera', () => {
	const vw = 1440;
	const vh = 900;
	it('round-trips world and screen coordinates', () => {
		const cam = { x: 120, y: -40, k: 1.7 };
		const s = worldToScreen(cam, vw, vh, 300, 200);
		const w = screenToWorld(cam, vw, vh, s.x, s.y);
		expect(w.x).toBeCloseTo(300);
		expect(w.y).toBeCloseTo(200);
	});
	it('zooms about the cursor', () => {
		const cam = { x: 0, y: 0, k: 1 };
		const before = screenToWorld(cam, vw, vh, 200, 150);
		const z = zoomAt(cam, vw, vh, 200, 150, 2.5);
		const after = screenToWorld(z, vw, vh, 200, 150);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
		expect(z.k).toBeCloseTo(2.5);
	});
	it('clamps zoom and keeps the camera on the map', () => {
		expect(zoomAt({ x: 0, y: 0, k: 5 }, vw, vh, 0, 0, 100).k).toBe(6);
		const c = clampCam({ x: 1e6, y: -1e6, k: 0.0001 });
		const b = worldBounds();
		expect(c.x).toBe(b.x + b.w);
		expect(c.y).toBe(b.y);
		expect(c.k).toBeGreaterThan(0);
	});
	it('fits a rect inside the viewport', () => {
		const cam = fitRect({ x: 0, y: 0, w: CARD.w, h: CARD.h }, vw, vh, 0);
		expect(CARD.w * cam.k).toBeLessThanOrEqual(vw + 1e-6);
		expect(CARD.h * cam.k).toBeLessThanOrEqual(vh + 1e-6);
		expect(cam.x).toBe(CARD.w / 2);
	});
	it('switches level of detail at the near threshold', () => {
		expect(lodFor(0.3)).toBe('far');
		expect(lodFor(1.4)).toBe('near');
	});
	it('smooth-zooms between views and lands exactly', () => {
		const a = { x: 0, y: 0, k: 0.4 };
		const b = { x: 1200, y: -600, k: 2 };
		const p = zoomPath(a, b, vw);
		const start = p.at(0);
		const end = p.at(1);
		expect(start.x).toBeCloseTo(0);
		expect(start.k).toBeCloseTo(0.4);
		expect(end.x).toBeCloseTo(1200);
		expect(end.y).toBeCloseTo(-600);
		expect(end.k).toBeCloseTo(2);
		expect(p.duration).toBeGreaterThan(300);
	});
	it('pulls out mid-flight when the target starts off-screen', () => {
		const p = zoomPath({ x: 0, y: 0, k: 2 }, { x: 3000, y: 0, k: 2 }, vw);
		expect(p.at(0.5).k).toBeLessThan(2);
		expect(p.at(1).x).toBeCloseTo(3000);
		expect(p.at(1).k).toBeCloseTo(2);
	});
	it('handles a pure zoom with no travel', () => {
		const p = zoomPath({ x: 5, y: 5, k: 1 }, { x: 5, y: 5, k: 3 }, vw);
		expect(p.at(1).k).toBeCloseTo(3);
		expect(p.at(1).x).toBeCloseTo(5);
	});
});

describe('field events', () => {
	it('routes each wallet move to the district it lands in', () => {
		expect(districtForEvent('launch')).toBe('launcher');
		expect(districtForEvent('snipe')).toBe('trenches');
		expect(districtForEvent('trade')).toBe('trenches');
		expect(districtForEvent('purchase')).toBe('marketplace');
		expect(districtForEvent('tip')).toBe('pulse');
		const ids = DISTRICTS.map((d) => d.id);
		for (const k of ['launch', 'snipe', 'trade', 'purchase', 'tip', 'x402', 'other']) expect(ids).toContain(districtForEvent(k));
	});
	it('fades trails with age', () => {
		expect(trailAlpha(0)).toBeGreaterThan(trailAlpha(3_600_000 * 24));
		expect(trailAlpha(3_600_000 * 24)).toBeGreaterThan(trailAlpha(3_600_000 * 500));
		expect(trailAlpha(-5)).toBe(trailAlpha(0));
	});
	it('describes events in plain words', () => {
		expect(describeEvent({ kind: 'trade', side: 'buy', sol: 0.01, symbol: 'three', agent: { name: 'Ada' } })).toBe('Ada bought $THREE for 0.01 SOL');
		expect(describeEvent({ kind: 'snipe', sol: 1.5, symbol: 'abc', agent: { name: 'Bo' } })).toBe('Bo sniped $ABC with 1.50 SOL');
		expect(describeEvent({ kind: 'launch', symbol: 'xyz' })).toBe('An agent launched $XYZ');
	});
	it('formats relative time', () => {
		const now = Date.parse('2026-10-11T12:00:00Z');
		expect(relTime('2026-10-11T11:59:50Z', now)).toBe('now');
		expect(relTime('2026-10-11T11:30:00Z', now)).toBe('30m');
		expect(relTime('2026-10-11T09:00:00Z', now)).toBe('3h');
		expect(relTime('2026-10-09T12:00:00Z', now)).toBe('2d');
		expect(relTime('garbage', now)).toBe('');
	});
});

describe('field search and links', () => {
	const agents = [{ id: 'a1', name: 'Forge Bot', description: 'makes things', skills: ['sculpt'], home_url: '/agents/a1' }, { id: 'a2', name: 'Ada', skills: [] }];
	const pages = [{ title: 'Forge Studio', href: '/forge-studio', desc: '' }];
	it('lists the places on an empty query', () => {
		const r = searchField('', { districts: DISTRICTS, agents, pages }, 50);
		expect(r.every((x) => x.type === 'district')).toBe(true);
		expect(r).toHaveLength(DISTRICTS.length);
	});
	it('ranks the place first, then agents, then pages', () => {
		const r = searchField('forge', { districts: DISTRICTS, agents, pages });
		expect(r[0]).toMatchObject({ type: 'district', id: 'forge' });
		expect(r.map((x) => x.type)).toEqual(['district', 'agent', 'page']);
	});
	it('finds agents by skill', () => {
		expect(searchField('sculpt', { agents })[0]).toMatchObject({ type: 'agent', id: 'a1', href: '/agents/a1' });
	});
	it('only dives into same-origin deep links', () => {
		expect(deepLink('?app=forge', ['forge'])).toEqual({ type: 'district', id: 'forge' });
		expect(deepLink('?app=nope', ['forge'])).toBeNull();
		expect(deepLink('?go=%2Fmarketplace', [])).toEqual({ type: 'page', href: '/marketplace' });
		expect(deepLink('?go=https://evil.example', [])).toBeNull();
		expect(deepLink('?go=//evil.example', [])).toBeNull();
	});
	it('opens the desktop at / and keeps the Field one link away', () => {
		expect(wantsField('?view=field')).toBe(true);
		expect(wantsField('')).toBe(false);
		expect(wantsField('?view=desktop')).toBe(false);
		expect(wantsField('?world=1')).toBe(false);
		expect(wantsField('?app=forge')).toBe(false);
	});
});
