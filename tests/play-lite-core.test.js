import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
	LITE_PATH, LITE_PREF_KEY, HOME_COIN, liteUrlFrom, fullUrlFrom, liteReason, canUseWebGL,
	coinFromSearch, WALK_RADIUS, LITE_PLACES, LITE_WATER, LITE_DANGER, worldToMap, mapToWorld,
	safeTarget, MAX_TICK_STEP, stepToward, placeAt, approachPoint, LITE_REACTIONS, onDanceFloor,
	danceView, createStruggleDetector,
} from '../src/game/play-lite-core.js';
import { DANCE_FLOOR } from '../multiplayer/src/dance-off.js';
import { SERVER_MAX_STEP_M } from '../src/game/community-net.js';

const MEETUP = '?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three';

describe('client handoff URLs', () => {
	it('keeps the world and drops the switch keys going to lite', () => {
		expect(liteUrlFrom(`${MEETUP}&lite=1`)).toBe(`${LITE_PATH}${MEETUP}`);
		expect(liteUrlFrom('')).toBe(LITE_PATH);
		expect(liteUrlFrom('?full=1')).toBe(LITE_PATH);
	});

	it('marks the 3D link full=1 so /play does not bounce the player back', () => {
		const u = new URL(fullUrlFrom(`${MEETUP}&lite=1`), 'https://three.ws');
		expect(u.pathname).toBe('/play');
		expect(u.searchParams.get('full')).toBe('1');
		expect(u.searchParams.get('lite')).toBeNull();
		expect(u.searchParams.get('coin')).toBe(HOME_COIN.mint);
	});
});

describe('liteReason', () => {
	it('stays in 3D by default', () => expect(liteReason({ search: MEETUP, webgl: true })).toBeNull());
	it('honours ?lite=1, a missing GPU and the stored choice, in that order', () => {
		expect(liteReason({ search: '?lite=1', webgl: false })).toBe('asked');
		expect(liteReason({ search: '', webgl: false, pref: '1' })).toBe('no-webgl');
		expect(liteReason({ search: '', webgl: true, pref: '1' })).toBe('preference');
		expect(liteReason({ search: '', webgl: true, pref: '0' })).toBeNull();
	});
	it('never redirects full=1 or the venue director camera', () => {
		expect(liteReason({ search: '?full=1&lite=1', webgl: false, pref: '1' })).toBeNull();
		expect(liteReason({ search: '?director=1', webgl: false, pref: '1' })).toBeNull();
	});
});

// pages/play.html cannot import the module (it must decide before three.js
// downloads), so it inlines the rule. Run that exact script and hold it to liteReason.
describe('pages/play.html inline lite redirect', () => {
	const html = readFileSync(new URL('../pages/play.html', import.meta.url), 'utf8');
	const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('/play/lite'));

	function run({ search, webgl, pref, throwsStorage = false }) {
		let replaced = null;
		const ctx = {
			URLSearchParams,
			location: { search, hash: '', replace: (u) => { replaced = u; } },
			document: {
				createElement: () => ({
					getContext: () => (webgl ? { getExtension: () => ({ loseContext() {} }) } : null),
				}),
			},
			localStorage: {
				getItem: (k) => {
					if (throwsStorage) throw new Error('SecurityError');
					return k === LITE_PREF_KEY ? pref : null;
				},
			},
		};
		runInNewContext(script, ctx);
		return replaced;
	}

	it('exists in the page head', () => expect(script).toBeTruthy());

	const cases = [
		{ search: MEETUP, webgl: true, pref: null },
		{ search: MEETUP, webgl: false, pref: null },
		{ search: `${MEETUP}&lite=1`, webgl: true, pref: null },
		{ search: '', webgl: true, pref: '1' },
		{ search: '?full=1', webgl: false, pref: '1' },
		{ search: '?director=1&coin=x', webgl: false, pref: null },
		{ search: '?biome=noir', webgl: false, pref: null },
	];
	for (const c of cases) {
		it(`agrees with liteReason for ${JSON.stringify(c)}`, () => {
			const want = liteReason(c) ? liteUrlFrom(c.search) : null;
			expect(run(c)).toBe(want);
		});
	}

	it('still redirects a GPU-less device when storage is blocked', () => {
		expect(run({ search: '', webgl: false, pref: null, throwsStorage: true })).toBe(LITE_PATH);
		expect(run({ search: '', webgl: true, pref: null, throwsStorage: true })).toBeNull();
	});
});

describe('canUseWebGL', () => {
	it('reports a context and releases it', () => {
		let lost = false;
		const ok = canUseWebGL(() => ({ getContext: (k) => (k === 'webgl' ? { getExtension: () => ({ loseContext: () => { lost = true; } }) } : null) }));
		expect(ok).toBe(true);
		expect(lost).toBe(true);
	});
	it('is false when no context or the probe throws', () => {
		expect(canUseWebGL(() => ({ getContext: () => null }))).toBe(false);
		expect(canUseWebGL(() => { throw new Error('blocked'); })).toBe(false);
	});
});

describe('coinFromSearch', () => {
	it('reads the meetup link', () => {
		expect(coinFromSearch(MEETUP)).toEqual({ mint: HOME_COIN.mint, name: 'three.ws', symbol: 'three', image: '' });
	});
	it('falls back to the home world for a missing or malformed mint', () => {
		expect(coinFromSearch('').mint).toBe(HOME_COIN.mint);
		expect(coinFromSearch('?coin=not-a-mint<script>').mint).toBe(HOME_COIN.mint);
	});
});

describe('map geometry', () => {
	it('round-trips world and canvas coordinates', () => {
		const { px, py } = worldToMap(12.5, -7, 600);
		const back = mapToWorld(px, py, 600);
		expect(back.x).toBeCloseTo(12.5, 6);
		expect(back.z).toBeCloseTo(-7, 6);
	});

	it('keeps tap targets on land, out of danger zones, inside the walk disc', () => {
		for (const w of LITE_WATER) {
			const t = safeTarget(w.x, w.z);
			expect(Math.hypot(t.x - w.x, t.z - w.z)).toBeGreaterThanOrEqual(w.r);
		}
		for (const d of LITE_DANGER) {
			const t = safeTarget(d.x + 0.1, d.z);
			expect(Math.hypot(t.x - d.x, t.z - d.z)).toBeGreaterThanOrEqual(d.r);
		}
		const far = safeTarget(500, 500);
		expect(Math.hypot(far.x, far.z)).toBeLessThanOrEqual(WALK_RADIUS + 1e-9);
		expect(safeTarget('junk', undefined)).toEqual(safeTarget(0, 0));
	});

	it('approaches the dance floor dead centre and other places from the spawn side', () => {
		const dance = LITE_PLACES.find((p) => p.id === 'dance');
		expect(onDanceFloor(approachPoint(dance).x, approachPoint(dance).z)).toBe(true);
		for (const p of LITE_PLACES.filter((q) => q.go && q.id !== 'dance')) {
			const a = approachPoint(p);
			expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeGreaterThan(p.r);
			expect(placeAt(a.x, a.z)?.id).toBe(p.id);
		}
	});

	it('matches the server dance pad', () => {
		expect(onDanceFloor(DANCE_FLOOR.x, DANCE_FLOOR.z)).toBe(true);
		expect(onDanceFloor(DANCE_FLOOR.x + DANCE_FLOOR.r + 0.1, DANCE_FLOOR.z)).toBe(false);
	});
});

describe('stepToward', () => {
	it('never steps past the server anti-teleport limit, even after a long stall', () => {
		expect(MAX_TICK_STEP).toBeLessThan(SERVER_MAX_STEP_M);
		const s = stepToward({ x: 0, z: 0 }, { x: 40, z: 0 }, 5);
		expect(Math.hypot(s.x, s.z)).toBeCloseTo(MAX_TICK_STEP, 6);
		expect(s.arrived).toBe(false);
	});
	it('faces the target in the 3D yaw convention and lands exactly', () => {
		const s = stepToward({ x: 0, z: 0 }, { x: 0, z: 10 }, 0.1);
		expect(s.yaw).toBeCloseTo(0, 6);
		const e = stepToward({ x: 0, z: 0 }, { x: 10, z: 0 }, 0.1);
		expect(e.yaw).toBeCloseTo(Math.PI / 2, 6);
		expect(stepToward({ x: 0, z: 0 }, { x: 0.1, z: 0 }, 0.1)).toMatchObject({ x: 0.1, z: 0, arrived: true });
	});
	it('walks a whole route without one oversize step', () => {
		let p = { x: -20, z: 30, yaw: 0 };
		const t = { x: 25, z: -18 };
		for (let i = 0; i < 400 && !p.arrived; i++) {
			const n = stepToward(p, t, 1 / 15);
			expect(Math.hypot(n.x - p.x, n.z - p.z)).toBeLessThan(SERVER_MAX_STEP_M);
			p = n;
		}
		expect(p.arrived).toBe(true);
	});
});

describe('LITE_REACTIONS', () => {
	it('is exactly the WalkRoom reaction allowlist', () => {
		const src = readFileSync(new URL('../multiplayer/src/rooms/WalkRoom.js', import.meta.url), 'utf8');
		for (const e of LITE_REACTIONS) expect(src).toContain(e);
	});
});

describe('danceView', () => {
	const now = 1_000_000;
	it('is hidden with no state', () => expect(danceView(null).visible).toBe(false));
	it('tells an idle player how to start a round', () => {
		const v = danceView({ phase: 'idle', now }, { now });
		expect(v).toMatchObject({ visible: true, phase: 'idle', canEnter: true });
		expect(danceView({ phase: 'idle', now, nextAt: now + 30_000 }, { now }).detail).toMatch(/30s/);
	});
	it('counts down the join window, corrected for server clock skew', () => {
		const v = danceView({ phase: 'joining', now: now - 5000, endsAt: now - 5000 + 10_000 }, { now, onFloor: false });
		expect(v.detail).toMatch(/next 10s/);
		expect(danceView({ phase: 'joining', now, endsAt: now + 8000 }, { now, onFloor: true }).canEnter).toBe(false);
	});
	it('lets the crowd vote once and never a contestant', () => {
		const state = { phase: 'performing', roundId: 7, now, endsAt: now + 20_000, contestants: [{ id: 'a', name: 'Ada', votes: 2 }, { id: 'b', name: 'Bo', votes: 0 }] };
		expect(danceView(state, { selfId: 'c', now }).canVote).toBe(true);
		expect(danceView(state, { selfId: 'c', now, votedRound: 7 }).canVote).toBe(false);
		expect(danceView(state, { selfId: 'c', now, votedRound: 6 }).canVote).toBe(true);
		const me = danceView(state, { selfId: 'a', now });
		expect(me.canVote).toBe(false);
		expect(me.contestants.find((c) => c.self)?.name).toBe('Ada');
	});
	it('names the winner', () => {
		expect(danceView({ phase: 'winner', now, winner: { name: 'Ada' }, standings: [] }, { now }).detail).toMatch(/Ada/);
	});
});

describe('createStruggleDetector', () => {
	it('fires once after sustained slow frames at the lowest tier', () => {
		const d = createStruggleDetector({ holdSec: 2 });
		let fires = 0;
		for (let i = 0; i < 200; i++) if (d.tick(0.25, 'low')) fires++;
		expect(fires).toBe(1);
		expect(d.fired).toBe(true);
	});
	it('never fires while the watchdog still has tiers to give', () => {
		const d = createStruggleDetector({ holdSec: 2 });
		for (let i = 0; i < 200; i++) expect(d.tick(0.25, 'medium')).toBe(false);
	});
	it('resets when frames recover and ignores junk frame times', () => {
		const d = createStruggleDetector({ holdSec: 2 });
		for (let i = 0; i < 400; i++) expect(d.tick(1 / 60, 'low')).toBe(false);
		expect(d.tick(NaN, 'low')).toBe(false);
		expect(d.tick(-1, 'low')).toBe(false);
		expect(d.fired).toBe(false);
	});
});
