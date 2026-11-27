// Forge's scaling protections under simulated concurrency (Forge hardening 78).
//
// Every protection in api/_lib/forge-scale.js and the waiting line in
// api/_lib/forge-line.js is driven here by many callers at once against a fake
// Redis that yields to the event loop between commands, so a check-then-act
// sequence interleaves exactly as it would across Cloud Run instances. Each runs
// three ways: with Redis, with Redis absent, and with Redis throwing on every
// command. The rule for the last two is the order's: fail open, never unbounded.

import { describe, it, expect, vi, afterEach } from 'vitest';

// ── A fake Upstash client ────────────────────────────────────────────────────
// Implements the subset of commands the two modules use, with the Upstash call
// shapes (zadd(key, opts?, ...members), set(key, val, { nx, px })). Each command
// awaits a macrotask first, so concurrent callers interleave between commands.
// Lua scripts are atomic in Redis; eval dispatches on the script's tag comment
// and runs its JavaScript mirror without yielding.

function fakeRedis() {
	const kv = new Map(); // key -> { v, exp }
	const zsets = new Map(); // key -> Map(member -> score)
	const lists = new Map(); // key -> array
	let clock = () => Date.now();
	const tick = () => new Promise((r) => setImmediate(r));
	const live = (key) => {
		const e = kv.get(key);
		if (!e) return null;
		if (e.exp && e.exp <= clock()) {
			kv.delete(key);
			return null;
		}
		return e;
	};
	const z = (key) => {
		let s = zsets.get(key);
		if (!s) zsets.set(key, (s = new Map()));
		return s;
	};
	const sorted = (key) => [...z(key).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	const api = {
		setClock(fn) {
			clock = fn;
		},
		async get(key) {
			await tick();
			return live(key)?.v ?? null;
		},
		async set(key, v, opts = {}) {
			await tick();
			if (opts.nx && live(key)) return null;
			const ttl = opts.px ?? (opts.ex ? opts.ex * 1000 : null);
			kv.set(key, { v: String(v), exp: ttl ? clock() + ttl : null });
			return 'OK';
		},
		async del(...keys) {
			await tick();
			let n = 0;
			for (const k of keys) {
				if (live(k)) n++;
				kv.delete(k);
				zsets.delete(k);
				lists.delete(k);
			}
			return n;
		},
		async incr(key) {
			await tick();
			const e = live(key);
			const n = (e ? Number(e.v) : 0) + 1;
			kv.set(key, { v: String(n), exp: e?.exp ?? null });
			return n;
		},
		async expire(key, s) {
			await tick();
			const e = live(key);
			if (e && !e.exp) e.exp = clock() + s * 1000;
			return 1;
		},
		async zadd(key, ...rest) {
			await tick();
			let opts = {};
			if (rest[0] && !('score' in rest[0])) opts = rest.shift();
			const s = z(key);
			let added = 0;
			for (const { score, member } of rest) {
				if (opts.nx && s.has(member)) continue;
				if (!s.has(member)) added++;
				s.set(member, Number(score));
			}
			return added;
		},
		async zrem(key, ...members) {
			await tick();
			let n = 0;
			for (const m of members) if (z(key).delete(m)) n++;
			return n;
		},
		async zcard(key) {
			await tick();
			return z(key).size;
		},
		async zrank(key, member) {
			await tick();
			const i = sorted(key).findIndex(([m]) => m === member);
			return i < 0 ? null : i;
		},
		async zscore(key, member) {
			await tick();
			return z(key).has(member) ? z(key).get(member) : null;
		},
		async zremrangebyscore(key, min, max) {
			await tick();
			let n = 0;
			for (const [m, sc] of z(key)) {
				if (sc >= Number(min) && sc <= Number(max)) {
					z(key).delete(m);
					n++;
				}
			}
			return n;
		},
		async zrange(key, min, max, opts = {}) {
			await tick();
			if (opts.byScore) return sorted(key).filter(([, sc]) => sc >= Number(min) && sc <= Number(max)).map(([m]) => m);
			const all = sorted(key).map(([m]) => m);
			return all.slice(min, max === -1 ? undefined : max + 1);
		},
		async lpush(key, ...vals) {
			await tick();
			const l = lists.get(key) || [];
			l.unshift(...vals.reverse());
			lists.set(key, l);
			return l.length;
		},
		async ltrim(key, start, stop) {
			await tick();
			lists.set(key, (lists.get(key) || []).slice(start, stop + 1));
			return 'OK';
		},
		async lrange(key, start, stop) {
			await tick();
			const l = lists.get(key) || [];
			return l.slice(start, stop === -1 ? undefined : stop + 1);
		},
		async eval(script, keys, args) {
			await tick();
			const tag = /--\s*forge:([a-z-]+)/.exec(script)?.[1];
			if (tag === 'slot-acquire') {
				const [now, max, score, member, ttlMs] = args.map((a, i) => (i === 3 ? a : Number(a)));
				const s = z(keys[0]);
				for (const [m, sc] of s) if (sc <= now) s.delete(m);
				if (s.size >= max) return 0;
				s.set(member, score);
				void ttlMs;
				return 1;
			}
			if (tag === 'rate-reserve') {
				const [now, interval, tau, maxWait] = args.map(Number);
				const e = live(keys[0]);
				const tat = e ? Number(e.v) : now;
				const serveAt = Math.max(now, tat - tau);
				const waitMs = serveAt - now;
				if (waitMs > maxWait) return [0, Math.floor(waitMs)];
				const newTat = Math.max(now, tat) + interval;
				kv.set(keys[0], { v: String(newTat), exp: null });
				return [1, Math.floor(waitMs)];
			}
			throw new Error(`fake redis: unknown script ${tag}`);
		},
	};
	return api;
}

// A client whose every command fails, like Upstash during the June 2026 quota
// blowout or an auth-breaker trip.
function brokenRedis() {
	return new Proxy(
		{},
		{
			get: () => async () => {
				throw new Error('ERR max requests limit exceeded');
			},
		},
	);
}

async function load(client) {
	vi.resetModules();
	vi.doMock('../../api/_lib/redis.js', () => ({ getRedis: () => client }));
	const scale = await import('../../api/_lib/forge-scale.js');
	const line = await import('../../api/_lib/forge-line.js');
	return { scale, line };
}

afterEach(() => {
	vi.doUnmock('../../api/_lib/redis.js');
	vi.restoreAllMocks();
});

const MODES = [
	['with Redis', () => fakeRedis()],
	['with Redis absent', () => null],
	['with Redis throwing', () => brokenRedis()],
];

const silenceWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

// ── The in-flight cap ────────────────────────────────────────────────────────

describe.each(MODES)('in-flight cap (acquireBlockingSlot) %s', (_mode, make) => {
	it('admits exactly `max` of 50 simultaneous holders and refuses the rest', async () => {
		silenceWarn();
		const { scale } = await load(make());
		const results = await Promise.all(
			Array.from({ length: 50 }, () => scale.acquireBlockingSlot('hf-test', { max: 12, ttlMs: 60_000 })),
		);
		expect(results.filter((r) => r.ok)).toHaveLength(12);
	});

	it('gives a released slot to the next caller', async () => {
		silenceWarn();
		const { scale } = await load(make());
		const first = await scale.acquireBlockingSlot('hf-release', { max: 1, ttlMs: 60_000 });
		expect(first.ok).toBe(true);
		expect((await scale.acquireBlockingSlot('hf-release', { max: 1, ttlMs: 60_000 })).ok).toBe(false);
		await first.release();
		expect((await scale.acquireBlockingSlot('hf-release', { max: 1, ttlMs: 60_000 })).ok).toBe(true);
	});

	it('reclaims a holder that never released once its lease expires', async () => {
		silenceWarn();
		const { scale } = await load(make());
		expect((await scale.acquireBlockingSlot('hf-expire', { max: 1, ttlMs: 20 })).ok).toBe(true);
		await new Promise((r) => setTimeout(r, 40));
		expect((await scale.acquireBlockingSlot('hf-expire', { max: 1, ttlMs: 20 })).ok).toBe(true);
	});
});

// ── Per-provider pacing ──────────────────────────────────────────────────────

describe.each(MODES)('per-provider pacing %s', (_mode, make) => {
	it('spaces 20 simultaneous reservations one interval apart and refuses past the queue budget', async () => {
		silenceWarn();
		const { scale } = await load(make());
		const now = 1_800_000_000_000;
		const results = await Promise.all(
			Array.from({ length: 20 }, () =>
				scale.reserveProviderRateSlot('replicate-test', { ratePerMin: 6, burst: 1, maxWaitMs: 45_000, now }),
			),
		);
		const granted = results.filter((r) => r.ok).map((r) => r.waitMs).sort((a, b) => a - b);
		// 6/min is one slot every 10 s: 0, 10, 20, 30, 40 s fit inside 45 s.
		expect(granted).toEqual([0, 10_000, 20_000, 30_000, 40_000]);
		// A refused caller took no slot and is told when one would open.
		for (const r of results.filter((x) => !x.ok)) expect(r.waitMs).toBe(50_000);
	});

	it('holds a fixed-window submit cap of 40 against 50 simultaneous submits', async () => {
		silenceWarn();
		const { scale } = await load(make());
		const allowed = await Promise.all(
			Array.from({ length: 50 }, () => scale.providerSubmitAllowed('replicate-window', { limit: 40, windowS: 10 })),
		);
		expect(allowed.filter(Boolean)).toHaveLength(40);
	});
});

// ── Dedupe: shared when identical, never across private owners ───────────────

describe('in-flight dedupe', () => {
	const base = { path: 'image', tier: 'standard', backend: 'trellis_selfhost', prompt: 'A red ceramic mug', images: null, options: {} };

	it('collapses the same person submitting the same prompt twice', async () => {
		const { scale } = await load(fakeRedis());
		const a = scale.forgeRequestHash({ ...base, owner: 'user:alice' });
		const b = scale.forgeRequestHash({ ...base, prompt: '  a red ceramic mug ', owner: 'user:alice' });
		expect(a).toBe(b);
		await scale.registerInFlight(a, 'job-alice');
		expect(await scale.coalesceInFlight(b)).toBe('job-alice');
	});

	it('never hands one person\'s private job to another person with the same prompt', async () => {
		const { scale } = await load(fakeRedis());
		const alice = scale.forgeRequestHash({ ...base, owner: 'user:alice' });
		const bob = scale.forgeRequestHash({ ...base, owner: 'user:bob' });
		expect(alice).not.toBe(bob);
		await scale.registerInFlight(alice, 'job-alice');
		expect(await scale.coalesceInFlight(bob)).toBeNull();
	});

	it('shares a public generation between people', async () => {
		const { scale } = await load(fakeRedis());
		const one = scale.forgeRequestHash({ ...base, owner: 'public' });
		const two = scale.forgeRequestHash({ ...base, owner: 'public' });
		expect(one).toBe(two);
	});

	it('20 simultaneous identical submits from one person resolve to the first job', async () => {
		const { scale } = await load(fakeRedis());
		const hash = scale.forgeRequestHash({ ...base, owner: 'user:alice' });
		await scale.registerInFlight(hash, 'job-1');
		const seen = await Promise.all(Array.from({ length: 20 }, () => scale.coalesceInFlight(hash)));
		expect(new Set(seen)).toEqual(new Set(['job-1']));
	});
});

// ── The waiting line ─────────────────────────────────────────────────────────

const T0 = 1_800_000_000_000;

describe.each(MODES)('waiting line %s', (_mode, make) => {
	it('lets everyone straight through while nothing is saturated', async () => {
		silenceWarn();
		const { line } = await load(make());
		const out = await Promise.all(
			Array.from({ length: 5 }, (_, i) => line.admitToLine('t-open', `user:${i}`, { now: T0 })),
		);
		expect(out.every((d) => d.action === 'proceed' && d.inLine === false)).toBe(true);
	});

	it('gives 20 people one place each, in order, with waits built from the stated interval', async () => {
		silenceWarn();
		const { line } = await load(make());
		// The first attempt is refused with a stated 45 s wait.
		const first = await line.lineThrottled('t-order', 'user:0', { retryAfterSeconds: 45, joinedAt: T0, now: T0 });
		expect(first).toMatchObject({ action: 'queued', position: 1, etaSeconds: 45 });
		const rest = [];
		for (let i = 1; i < 20; i++) rest.push(await line.admitToLine('t-order', `user:${i}`, { now: T0 + i }));
		expect(rest.map((d) => d.position)).toEqual(Array.from({ length: 19 }, (_, i) => i + 2));
		// Person 20 waits the stated 45 s, then 19 more intervals of 45 s.
		expect(rest.at(-1).etaSeconds).toBe(45 + 19 * 45);
		expect(rest.every((d) => d.checkAgainSeconds >= 1 && d.checkAgainSeconds <= 15)).toBe(true);
	});

	it('never gives one person two places, however often they submit', async () => {
		silenceWarn();
		const { line } = await load(make());
		await line.lineThrottled('t-one', 'user:a', { retryAfterSeconds: 45, now: T0 });
		const again = await Promise.all(
			Array.from({ length: 10 }, () => line.admitToLine('t-one', 'user:b', { now: T0 + 1 })),
		);
		expect(new Set(again.map((d) => d.position))).toEqual(new Set([2]));
		expect((await line.lineSnapshot('t-one', { now: T0 + 2 })).depth).toBe(2);
	});

	it('says full past the defined depth, with when to come back, under 30 simultaneous arrivals', async () => {
		silenceWarn();
		const { line } = await load(make());
		await line.lineThrottled('t-full', 'user:head', { retryAfterSeconds: 45, now: T0 });
		const out = await Promise.all(
			Array.from({ length: 30 }, (_, i) => line.admitToLine('t-full', `user:${i}`, { now: T0 + 1 })),
		);
		const snap = await line.lineSnapshot('t-full', { now: T0 + 2 });
		expect(snap.depth).toBeLessThanOrEqual(line.LINE_LIMITS.maxDepth);
		const full = out.filter((d) => d.action === 'full');
		expect(full.length).toBeGreaterThanOrEqual(30 + 1 - line.LINE_LIMITS.maxDepth);
		for (const d of full) expect(d.retryAfterSeconds).toBeGreaterThan(45);
	});

	it('lets only the head try the rung, once the stated wait has passed, and paces the next by it', async () => {
		silenceWarn();
		const { line } = await load(make());
		await line.lineThrottled('t-head', 'user:a', { retryAfterSeconds: 45, now: T0 });
		await line.admitToLine('t-head', 'user:b', { now: T0 + 1 });
		// Before the wait passes nobody proceeds.
		expect((await line.admitToLine('t-head', 'user:a', { now: T0 + 10_000 })).action).toBe('queued');
		// After it, the head and the second person arrive together: only the head goes.
		const [a, b] = await Promise.all([
			line.admitToLine('t-head', 'user:a', { now: T0 + 46_000 }),
			line.admitToLine('t-head', 'user:b', { now: T0 + 46_000 }),
		]);
		expect(a).toMatchObject({ action: 'proceed', inLine: true, prepaid: true });
		expect(b).toMatchObject({ action: 'queued', position: 2 });
		// A second submit from the head while its attempt runs does not start another.
		expect((await line.admitToLine('t-head', 'user:a', { now: T0 + 47_000 })).action).toBe('queued');
		await line.lineServed('t-head', 'user:a', { now: T0 + 50_000 });
		// Next in line waits the provider's stated interval after the serve.
		const early = await line.lineStatus('t-head', 'user:b', { now: T0 + 60_000 });
		expect(early).toMatchObject({ inLine: true, position: 1, yourTurn: false, etaSeconds: 35 });
		const turn = await line.lineStatus('t-head', 'user:b', { now: T0 + 95_001 });
		expect(turn).toMatchObject({ yourTurn: true, checkAgainSeconds: 0 });
		expect((await line.admitToLine('t-head', 'user:b', { now: T0 + 95_001 })).action).toBe('proceed');
	});

	it('frees the place of someone who stopped checking in', async () => {
		silenceWarn();
		const { line } = await load(make());
		await line.lineThrottled('t-stale', 'user:a', { retryAfterSeconds: 45, now: T0 });
		await line.admitToLine('t-stale', 'user:gone', { now: T0 + 1 });
		await line.admitToLine('t-stale', 'user:c', { now: T0 + 2 });
		// user:a and user:c keep checking in; user:gone closed the tab.
		await line.lineStatus('t-stale', 'user:a', { now: T0 + 30_000 });
		await line.lineStatus('t-stale', 'user:c', { now: T0 + 30_000 });
		const later = await line.lineStatus('t-stale', 'user:c', { now: T0 + 60_000 });
		expect(later).toMatchObject({ inLine: true, position: 2, depth: 2 });
	});

	it('deactivates once the last person is served', async () => {
		silenceWarn();
		const { line } = await load(make());
		await line.lineThrottled('t-clear', 'user:a', { retryAfterSeconds: 45, now: T0 });
		const turn = await line.admitToLine('t-clear', 'user:a', { now: T0 + 46_000 });
		expect(turn.action).toBe('proceed');
		await line.lineServed('t-clear', 'user:a', { now: T0 + 50_000 });
		const snap = await line.lineSnapshot('t-clear', { now: T0 + 50_001 });
		expect(snap).toMatchObject({ depth: 0, active: false });
		expect((await line.admitToLine('t-clear', 'user:z', { now: T0 + 50_002 })).inLine).toBe(false);
	});
});

describe('waiting line measurement and answers', () => {
	it('measures the interval as the median gap between recent serves', async () => {
		const { line } = await load(null);
		const now = T0 + 200_000;
		expect(line.lineServiceIntervalMs({ served: [now, now - 60_000, now - 120_000, now - 170_000], now })).toBe(60_000);
		// A provider's stated wait is a floor: it will refuse anything sooner.
		expect(line.lineServiceIntervalMs({ served: [now, now - 20_000, now - 40_000], statedWaitMs: 45_000, now })).toBe(45_000);
		// Nothing measured yet: the stated wait, else the keyless rung's 45 s.
		expect(line.lineServiceIntervalMs({ served: [], statedWaitMs: 15_000, now })).toBe(15_000);
		expect(line.lineServiceIntervalMs({ served: [], now })).toBe(45_000);
		// Serves older than the window do not count.
		expect(line.lineServiceIntervalMs({ served: [now - 40 * 60_000, now - 41 * 60_000], now })).toBe(45_000);
	});

	it('answers queued as busy, never as a limit', async () => {
		const { line } = await load(null);
		const a = line.lineAnswer({ action: 'queued', position: 3, ahead: 2, depth: 5, etaSeconds: 135, intervalSeconds: 45, checkAgainSeconds: 15 });
		expect(a.status).toBe(429);
		expect(a.headers['retry-after']).toBe('15');
		expect(a.body).toMatchObject({ error: 'forge_queued', queued: true, position: 3, eta_seconds: 135, line_url: '/api/forge?line=1' });
		expect(a.body.message).toMatch(/number 3 in line/);
		expect(a.body.message).not.toMatch(/limit/i);
	});

	it('answers full with a 503 and when to come back', async () => {
		const { line } = await load(null);
		const f = line.lineAnswer({ action: 'full', depth: 20, maxDepth: 20, retryAfterSeconds: 90, intervalSeconds: 45 });
		expect(f.status).toBe(503);
		expect(f.headers['retry-after']).toBe('90');
		expect(f.body).toMatchObject({ error: 'forge_full', retry_after: 90 });
		expect(f.body.message).toMatch(/full/i);
		expect(f.body.message).not.toMatch(/limit/i);
	});

	it('tells a background job to yield while people wait', async () => {
		const { line } = await load(null);
		const y = line.lineYieldAnswer({ depth: 3, saturatedUntil: T0 + 120_000 }, { now: T0 });
		expect(y.status).toBe(503);
		expect(y.body.error).toBe('forge_yielding');
		expect(y.body.retry_after).toBe(120);
	});
});
