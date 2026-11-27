/**
 * Forge stampede guard (forge-hardening order 125, task 8): two identical
 * requests arriving together produce one job, not two.
 *
 * Before the guard, the in-flight record (forge-scale.js) was only written once
 * a job existed, a minute or more into a text prompt (direction, then the
 * throttled reference image). Every identical request inside that window missed
 * the record and started its own pipeline. The store is faked at its boundary
 * (an Upstash-shaped get/set/del with NX), so the real claim code runs.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));

const { claimGeneration, awaitGeneration, publishGeneration, releaseGeneration, CLAIM_TTL_S } = await import(
	'../api/_lib/forge-stampede.js'
);

function fakeRedis({ failing = false } = {}) {
	const store = new Map();
	const sets = [];
	if (failing) {
		const boom = async () => {
			throw new Error('upstash unreachable');
		};
		return { store, sets, get: boom, set: boom, del: boom };
	}
	return {
		store,
		sets,
		async get(k) {
			return store.has(k) ? store.get(k) : null;
		},
		async set(k, v, opts = {}) {
			sets.push({ k, v, opts });
			if (opts.nx && store.has(k)) return null;
			store.set(k, v);
			return 'OK';
		},
		async del(k) {
			return store.delete(k) ? 1 : 0;
		},
	};
}

// The submit protocol the handler follows (api/forge.js and api/gpt-forge.js):
// claim, then either generate and publish the handle, or wait for the owner.
// `generate` stands in for the minute of direction + reference image + submit.
async function submit(req, hash, { redis, generate, jobs, waitOpts }) {
	const role = await claimGeneration(req, hash, { redis });
	try {
		if (role === 'waiter') {
			const settled = await awaitGeneration(hash, { redis, ...waitOpts });
			if (settled.jobHandle) return { job: settled.jobHandle, coalesced: true };
		}
		const handle = await generate();
		jobs.push(handle);
		if (handle) await publishGeneration(req, handle);
		return { job: handle, coalesced: false };
	} finally {
		await releaseGeneration(req);
	}
}

const fastWait = { pollMs: 1, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

describe('two identical requests arriving together make one job', () => {
	it('the second request is handed the job the first one starts', async () => {
		const redis = fakeRedis();
		const jobs = [];
		let n = 0;
		const generate = async () => {
			await new Promise((r) => setTimeout(r, 30));
			return `job-${++n}`;
		};
		const [a, b] = await Promise.all([
			submit({}, 'h1', { redis, generate, jobs, waitOpts: fastWait }),
			submit({}, 'h1', { redis, generate, jobs, waitOpts: fastWait }),
		]);
		expect(jobs).toEqual(['job-1']);
		expect(a.job).toBe('job-1');
		expect(b.job).toBe('job-1');
		expect([a.coalesced, b.coalesced].sort()).toEqual([false, true]);
	});

	it('ten at once still make one job', async () => {
		const redis = fakeRedis();
		const jobs = [];
		const generate = async () => {
			await new Promise((r) => setTimeout(r, 20));
			return 'job-only';
		};
		const out = await Promise.all(Array.from({ length: 10 }, () => submit({}, 'h10', { redis, generate, jobs, waitOpts: fastWait })));
		expect(jobs).toHaveLength(1);
		expect(new Set(out.map((o) => o.job))).toEqual(new Set(['job-only']));
	});

	it('different requests never wait on each other', async () => {
		const redis = fakeRedis();
		expect(await claimGeneration({}, 'ha', { redis })).toBe('owner');
		expect(await claimGeneration({}, 'hb', { redis })).toBe('owner');
	});

	it('the claim is taken atomically (NX) and expires on its own', async () => {
		const redis = fakeRedis();
		await claimGeneration({}, 'hx', { redis });
		expect(redis.sets[0].opts).toEqual({ nx: true, ex: CLAIM_TTL_S });
	});
});

describe('when the first request does not produce a job, the waiter is never stranded', () => {
	it('a failed owner releases the claim and the waiter generates itself', async () => {
		const redis = fakeRedis();
		const owner = {};
		expect(await claimGeneration(owner, 'hf', { redis })).toBe('owner');
		const waiting = awaitGeneration('hf', { redis, ...fastWait });
		await releaseGeneration(owner);
		expect(await waiting).toEqual({ released: true });
	});

	it('a waiter whose owner hangs carries on once the wait runs out', async () => {
		const redis = fakeRedis();
		await claimGeneration({}, 'hh', { redis });
		let t = 0;
		const out = await awaitGeneration('hh', { redis, waitMs: 5, pollMs: 1, sleep: async () => {}, now: () => t++ });
		expect(out).toEqual({ timedOut: true });
	});

	it('releasing never removes a newer owner\'s claim', async () => {
		const redis = fakeRedis();
		const first = {};
		await claimGeneration(first, 'hn', { redis });
		// The first claim expired and a second request now owns the fingerprint.
		redis.store.set('fc:claim:hn', 'pending:someone-else');
		await releaseGeneration(first);
		expect(redis.store.get('fc:claim:hn')).toBe('pending:someone-else');
	});

	it('a published claim is kept for late arrivals, not released', async () => {
		const redis = fakeRedis();
		const owner = {};
		await claimGeneration(owner, 'hp', { redis });
		await publishGeneration(owner, 'job-9');
		await releaseGeneration(owner);
		expect(await awaitGeneration('hp', { redis, ...fastWait })).toEqual({ jobHandle: 'job-9' });
	});

	it('publish and release are no-ops for a request that never claimed', async () => {
		await expect(publishGeneration({}, 'job')).resolves.toBeUndefined();
		await expect(releaseGeneration({})).resolves.toBeUndefined();
		await expect(releaseGeneration(null)).resolves.toBeUndefined();
	});
});

describe('a store outage turns the guard off, never breaks a request', () => {
	it('no store: every request runs as before', async () => {
		expect(await claimGeneration({}, 'h')).toBe('off');
		expect(await awaitGeneration('h')).toEqual({ released: true });
	});
	it('a failing store: claim is off, a waiter stops waiting, release does not throw', async () => {
		const redis = fakeRedis({ failing: true });
		expect(await claimGeneration({}, 'h', { redis })).toBe('off');
		expect(await awaitGeneration('h', { redis })).toEqual({ released: true });
	});
	it('a store that fails after the claim: publish and release swallow the error', async () => {
		const redis = fakeRedis();
		const owner = {};
		await claimGeneration(owner, 'hz', { redis });
		redis.get = redis.set = redis.del = async () => {
			throw new Error('gone');
		};
		await expect(publishGeneration(owner, 'job')).resolves.toBeUndefined();
		await expect(releaseGeneration(owner)).resolves.toBeUndefined();
	});
});
