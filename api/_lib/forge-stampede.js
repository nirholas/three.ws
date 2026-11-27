// Stampede guard for Forge generation: two identical requests arriving together
// produce one job, not two.
//
// In-flight coalescing (forge-scale.js) maps a request fingerprint to the job
// that serves it, but the mapping is only written once the job exists, and a
// text prompt spends a minute or more before that (prompt direction, then the
// reference image, which the only live image rung allows once per 45 seconds for
// the whole service). Every identical request arriving inside that window missed
// the mapping and started its own pipeline: a double-click or a second tab was
// two GPU jobs and two reference-image calls.
//
// The fix is a claim taken before the slow part. The first request to claim a
// fingerprint generates; every identical request that arrives while the claim is
// held waits for it to resolve:
//   - the owner minted a job handle: the waiter is handed that handle (coalesced),
//   - the owner finished or failed without a handle (a synchronous lane, a
//     rejected request): the claim is released and the waiter re-checks the
//     result cache and the in-flight mapping, then generates itself if neither
//     has an answer,
//   - the wait runs out: the waiter generates itself. The guard costs at most a
//     delay, never a request.
//
// The claim belongs to the request that took it. It is tracked per request
// object (WeakMap) so the handler can publish or release it from wherever the
// outcome is known without threading it through every lane.
//
// Fail-open like every other Forge store primitive: without Redis, or on any
// command error, claim() answers 'off' and the request runs exactly as before.

import { randomUUID } from 'node:crypto';
import { getRedis } from './redis.js';

const CLAIM_PREFIX = 'fc:claim:';
// Long enough to cover direction plus a throttled reference image plus the
// submit; short enough that a claim orphaned by a crashed instance cannot stall
// identical requests for long.
export const CLAIM_TTL_S = 180;
// How long a waiter waits before generating on its own. Below the claim TTL so
// an orphaned claim never holds a waiter until it expires.
export const WAIT_MS = 150_000;
const POLL_MS = 1_000;
const PENDING = 'pending:';
const JOB = 'job:';

const claims = new WeakMap();

function client(override) {
	if (override) return override;
	try {
		return getRedis() || null;
	} catch {
		return null;
	}
}

/**
 * Try to become the request that generates `hash`.
 *
 * @param {object} req  the incoming request (identity only; nothing is read from it)
 * @param {string|null} hash  forgeRequestHash of the request
 * @param {{ redis?: object }} [opts]
 * @returns {Promise<'owner'|'waiter'|'off'>}
 */
export async function claimGeneration(req, hash, { redis } = {}) {
	const r = client(redis);
	if (!r || !req || !hash) return 'off';
	const token = randomUUID();
	try {
		const ok = await r.set(`${CLAIM_PREFIX}${hash}`, `${PENDING}${token}`, { nx: true, ex: CLAIM_TTL_S });
		if (ok) {
			claims.set(req, { hash, token, published: false, redis: r });
			return 'owner';
		}
		return 'waiter';
	} catch {
		return 'off';
	}
}

/**
 * Wait for the owner of `hash` to resolve its claim.
 *
 * @param {string} hash
 * @param {{ redis?: object, waitMs?: number, pollMs?: number,
 *           sleep?: (ms: number) => Promise<void>, now?: () => number }} [opts]
 * @returns {Promise<{ jobHandle: string } | { released: true } | { timedOut: true }>}
 */
export async function awaitGeneration(
	hash,
	{ redis, waitMs = WAIT_MS, pollMs = POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {},
) {
	const r = client(redis);
	if (!r || !hash) return { released: true };
	const deadline = now() + waitMs;
	for (;;) {
		let v;
		try {
			v = await r.get(`${CLAIM_PREFIX}${hash}`);
		} catch {
			return { released: true };
		}
		if (typeof v !== 'string' || !v) return { released: true };
		if (v.startsWith(JOB)) return { jobHandle: v.slice(JOB.length) };
		if (now() >= deadline) return { timedOut: true };
		await sleep(pollMs);
	}
}

/**
 * The owner minted a job handle: hand it to every waiter. A no-op for a request
 * that does not own a claim.
 *
 * @param {object} req
 * @param {string} jobHandle
 */
export async function publishGeneration(req, jobHandle) {
	const c = req ? claims.get(req) : null;
	if (!c || !jobHandle) return;
	try {
		await c.redis.set(`${CLAIM_PREFIX}${c.hash}`, `${JOB}${jobHandle}`, { ex: CLAIM_TTL_S });
		c.published = true;
	} catch {
		/* waiters fall back to the in-flight mapping when the claim is released */
	}
}

/**
 * The owner's request is over. If it never published a handle, release the
 * claim so waiters stop waiting. Only our own pending claim is removed, never
 * a newer owner's. Safe to call for any request.
 *
 * @param {object} req
 */
export async function releaseGeneration(req) {
	const c = req ? claims.get(req) : null;
	if (!c) return;
	claims.delete(req);
	if (c.published) return;
	const key = `${CLAIM_PREFIX}${c.hash}`;
	try {
		if ((await c.redis.get(key)) === `${PENDING}${c.token}`) await c.redis.del(key);
	} catch {
		/* the claim expires on its own TTL */
	}
}
