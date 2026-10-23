// Flappin UFO: the shared simulation, the run verifier, and POST/GET
// /api/play/ufo-runs driven through the real handler against an in-process
// Postgres (PGlite), so the migration SQL, the dedupe index and the
// best-run-per-player ranking all run for real.

import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import * as S from '../src/play/ufo/sim.js';

const holder = vi.hoisted(() => ({ db: null, viewer: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => holder.viewer,
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const ok = async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 });
	return { ...actual, limits: new Proxy({}, { get: () => ok }) };
});

const { default: handler, cleanName } = await import('../api/play/ufo-runs.js');

// A controller that flies the course: aim at the next gap center.
function fly(level, { crashAt = null } = {}) {
	const st = S.createLevelState(level);
	const edges = [];
	let up = false;
	let last = -9;
	while (st.status === 'playing' && st.tick < S.maxLevelTicks(level)) {
		if (crashAt !== null && st.passed >= crashAt) {
			// stop thrusting and fall into the floor
			if (up && st.tick - last >= S.MIN_EDGE_GAP) {
				up = false;
				edges.push(st.tick);
				last = st.tick;
			}
		} else {
			const p = st.course.pillars[st.passed];
			const want = st.y + st.vy * 0.1 > (p.top + p.bottom) / 2 + 4;
			if (want !== up && st.tick - last >= S.MIN_EDGE_GAP) {
				up = want;
				edges.push(st.tick);
				last = st.tick;
			}
		}
		S.step(st, up);
	}
	return { edges, status: st.status, passed: st.passed };
}

function goodRun(variant = 0) {
	const l1 = fly(1);
	expect(l1.status).toBe('cleared');
	const l2 = fly(2, { crashAt: 3 + variant });
	expect(l2.status).toBe('crashed');
	return { levels: [{ edges: l1.edges }, { edges: l2.edges }], score: S.pillarCount(1) + 3 + variant };
}

function call(method, { query = '', body } = {}) {
	const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
	const req = Readable.from(payload);
	req.method = method;
	req.url = '/api/play/ufo-runs' + (query ? `?${query}` : '');
	req.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
	return new Promise((resolve) => {
		const res = {
			statusCode: 200,
			_headers: {},
			setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
			getHeader(k) { return this._headers[k.toLowerCase()]; },
			end(b) {
				let parsed = null;
				try { parsed = JSON.parse(b || ''); } catch { /* empty body */ }
				resolve({ status: this.statusCode, body: parsed });
			},
		};
		Promise.resolve(handler(req, res)).catch((e) => resolve({ status: 500, body: { error: String(e) } }));
	});
}

describe('ufo simulation', () => {
	it('is deterministic: the same edges give the same result', () => {
		const { edges } = fly(1);
		expect(S.simulateLevel(1, edges)).toEqual(S.simulateLevel(1, edges));
	});

	it('every level up to the cap is clearable by a controller (the course is fair)', () => {
		for (let level = 1; level <= S.MAX_LEVELS; level++) {
			expect(fly(level).status).toBe('cleared');
		}
	});

	it('levels get longer and tighter', () => {
		expect(S.pillarCount(5)).toBeGreaterThan(S.pillarCount(1));
		expect(S.gapSize(5)).toBeLessThan(S.gapSize(1));
		expect(S.levelCourse(3)).toEqual(S.levelCourse(3));
	});

	it('a ship that never thrusts falls into the floor', () => {
		expect(S.simulateLevel(1, []).status).toBe('crashed');
	});

	it('verifyRun scores a clear plus a partial level', () => {
		const run = goodRun();
		expect(S.verifyRun(run.levels)).toMatchObject({ ok: true, score: run.score, level: 2 });
	});

	it('verifyRun rejects impossible runs', () => {
		const run = goodRun();
		expect(S.verifyRun([run.levels[0]])).toMatchObject({ ok: false, reason: 'run_did_not_end_in_crash' });
		expect(S.verifyRun([{ edges: [5, 6] }, run.levels[1]])).toMatchObject({ ok: false, reason: 'bad_edges' });
		expect(S.verifyRun([{ edges: [10, 4] }])).toMatchObject({ ok: false, reason: 'bad_edges' });
		expect(S.verifyRun([{ edges: [1.5] }])).toMatchObject({ ok: false, reason: 'bad_edges' });
		const late = { edges: [...run.levels[1].edges, run.levels[1].edges.at(-1) + 600] };
		expect(S.verifyRun([run.levels[0], late])).toMatchObject({ ok: false, reason: 'input_after_end' });
		expect(S.verifyRun([])).toMatchObject({ ok: false, reason: 'bad_level_count' });
	});
});

describe('cleanName', () => {
	it('trims, collapses, strips control characters and caps length', () => {
		expect(cleanName('  Ace   Pilot ')).toBe('Ace Pilot');
		expect(cleanName('a\u0000b\u200bc')).toBe('abc');
		expect(cleanName('x'.repeat(50))).toHaveLength(20);
	});
	it('refuses empty names and links', () => {
		expect(cleanName('   ')).toBeNull();
		expect(cleanName('visit scam.com')).toBeNull();
		expect(cleanName('https://x')).toBeNull();
	});
});

describe('/api/play/ufo-runs', () => {
	beforeAll(async () => {
		holder.db = createPgliteSql();
		await holder.db.exec(`
			create extension if not exists pgcrypto;
			create table users (id uuid primary key default gen_random_uuid(), display_name text);
		`).catch(async () => {
			await holder.db.exec('create table users (id uuid primary key default gen_random_uuid(), display_name text);');
		});
		const migration = readFileSync(new URL('../api/_lib/migrations/20261023150000_ufo_runs.sql', import.meta.url), 'utf8');
		await holder.db.exec(migration);
	});
	beforeEach(async () => {
		holder.viewer = null;
		await holder.db.exec('delete from ufo_runs');
	});

	it('POST a run, then GET the leaderboard and see it', async () => {
		const run = goodRun();
		const post = await call('POST', { body: { name: 'Ace', levels: run.levels } });
		expect(post.status).toBe(201);
		expect(post.body).toMatchObject({ name: 'Ace', score: run.score, level: 2, rank: 1, isPersonalBest: true });

		const get = await call('GET');
		expect(get.status).toBe(200);
		expect(get.body.rows).toHaveLength(1);
		expect(get.body.rows[0]).toMatchObject({ rank: 1, name: 'Ace', score: run.score, level: 2, signedIn: false });
		expect(get.body.ghost).toBeNull();
	});

	it('serves the top run as the ghost replay on request', async () => {
		const run = goodRun();
		await call('POST', { body: { name: 'Ace', levels: run.levels } });
		const get = await call('GET', { query: 'ghost=1' });
		expect(get.body.ghost).toMatchObject({ name: 'Ace', score: run.score, levels: run.levels });
	});

	it('ranks the best run per player, higher score first', async () => {
		const low = goodRun(0);
		const mid = goodRun(1);
		const high = goodRun(2);
		await call('POST', { body: { name: 'Ace', levels: low.levels } });
		await call('POST', { body: { name: 'ace', levels: high.levels } });
		const other = await call('POST', { body: { name: 'Bee', levels: mid.levels } });
		expect(other.status).toBe(201);
		expect(other.body.rank).toBe(2);
		const get = await call('GET');
		expect(get.body.rows.map((r) => [r.name.toLowerCase(), r.score])).toEqual([
			['ace', high.score],
			['bee', mid.score],
		]);
	});

	it('rejects a tampered score: edges are replayed, a claimed score is ignored', async () => {
		const run = goodRun();
		const post = await call('POST', { body: { name: 'Cheat', score: 9999, levels: run.levels } });
		expect(post.status).toBe(201);
		expect(post.body.score).toBe(run.score);
	});

	it('rejects impossible runs with 422 and writes nothing', async () => {
		const run = goodRun();
		const bad = await call('POST', { body: { name: 'Bot', levels: [{ edges: [0, 1] }, run.levels[1]] } });
		expect(bad.status).toBe(422);
		expect(bad.body.error).toBe('impossible_run');
		const never = await call('POST', { body: { name: 'Bot', levels: [run.levels[0]] } });
		expect(never.status).toBe(422);
		const get = await call('GET');
		expect(get.body.rows).toHaveLength(0);
	});

	it('refuses the same run submitted twice', async () => {
		const run = goodRun();
		await call('POST', { body: { name: 'Ace', levels: run.levels } });
		const again = await call('POST', { body: { name: 'Other', levels: run.levels } });
		expect(again.status).toBe(409);
	});

	it('requires a usable name and a levels array', async () => {
		const run = goodRun();
		expect((await call('POST', { body: { name: '  ', levels: run.levels } })).status).toBe(400);
		expect((await call('POST', { body: { name: 'Ace' } })).status).toBe(400);
	});

	it('ties a signed-in submission to the account and falls back to its display name', async () => {
		const [{ id }] = await holder.db.query("insert into users (display_name) values ('Captain Zed') returning id");
		holder.viewer = { id, display_name: 'Captain Zed' };
		const run = goodRun();
		const post = await call('POST', { body: { levels: run.levels } });
		expect(post.status).toBe(201);
		expect(post.body.name).toBe('Captain Zed');
		const rows = (await holder.db.query('select user_id from ufo_runs'));
		expect(rows[0].user_id).toBe(id);
	});
});
