// Plan enforcement for the v1 gateway: burst, concurrency and the monthly quota.
//
// Every keyed call passes through devPlanGate in this order:
//
//   1. burst: the plan's per-minute ceiling, a sliding window per account in
//      the shared limiter (Redis when configured). Over it: 429, Retry-After.
//   2. concurrency: calls in flight per account, counted in this process and
//      released in the gateway's finally. Over it: 429, Retry-After: 1.
//   3. quota: calls this period against the plan's included calls. The counter
//      is one Redis INCR per call (a Postgres upsert without Redis), keyed by
//      account and period start so a new period starts from zero by itself.
//      Over it: 402 with the upgrade path, and the refused call is not counted,
//      so `used` never shows more than the plan allows.
//
// Every keyed response carries the plan, the burst budget (X-RateLimit-* and
// the IETF RateLimit-* pair) and the quota position (X-Quota-*), success or not,
// so a client can pace itself without ever being refused first.
//
// The counter store is injectable (setDevQuotaStore) so the quota tests run the
// real gate against an in-memory store and a fake clock.

import { getRedis } from '../redis.js';
import { sql, isDbUnavailableError } from '../db.js';
import { limits } from '../rate-limit.js';
import { error, setRateLimitHeaders, rateLimited } from '../http.js';
import { listDevPlans, DEV_PLAN_UPGRADE_URL, DEV_PLAN_MANAGE_URL } from './config.js';
import { getDevSubscription } from './subscription.js';

const COUNTER_GRACE_MS = 7 * 86_400_000;

export function quotaCounterKey(userId, periodStart) {
	return `devplan:calls:${userId}:${new Date(periodStart).toISOString()}`;
}

/** An in-memory counter store with the same contract as the Redis one. */
export function createMemoryQuotaStore() {
	const counts = new Map();
	return {
		async incr(key) {
			const n = (counts.get(key) || 0) + 1;
			counts.set(key, n);
			return n;
		},
		async decr(key) {
			const n = Math.max(0, (counts.get(key) || 0) - 1);
			counts.set(key, n);
			return n;
		},
		async get(key) {
			return counts.get(key) || 0;
		},
	};
}

function redisQuotaStore(redis) {
	return {
		async incr(key, ttlMs) {
			const n = Number(await redis.incr(key));
			if (n === 1) await redis.expire(key, Math.ceil(ttlMs / 1000));
			return n;
		},
		async decr(key) {
			return Number(await redis.decr(key));
		},
		async get(key) {
			return Number((await redis.get(key)) || 0);
		},
	};
}

const postgresQuotaStore = {
	async incr(key, ttlMs) {
		const expires = new Date(Date.now() + ttlMs).toISOString();
		const rows = await sql`
			insert into dev_plan_counters (key, n, expires_at) values (${key}, 1, ${expires})
			on conflict (key) do update set n = dev_plan_counters.n + 1
			returning n
		`;
		if (Math.random() < 0.01) await sql`delete from dev_plan_counters where expires_at < now()`;
		return Number(rows[0].n);
	},
	async decr(key) {
		const rows = await sql`update dev_plan_counters set n = greatest(0, n - 1) where key = ${key} returning n`;
		return Number(rows[0]?.n || 0);
	},
	async get(key) {
		const rows = await sql`select n from dev_plan_counters where key = ${key} limit 1`;
		return Number(rows[0]?.n || 0);
	},
};

let injectedStore = null;
let redisStore = null;

function quotaStore() {
	if (injectedStore) return injectedStore;
	const redis = getRedis();
	if (redis) {
		if (!redisStore || redisStore.redis !== redis) redisStore = { redis, store: redisQuotaStore(redis) };
		return redisStore.store;
	}
	return postgresQuotaStore;
}

export function setDevQuotaStore(store) {
	injectedStore = store;
}

// Calls in flight per account on this instance.
let inflight = new Map();

export function acquireDevSlot(userId, limit) {
	const n = inflight.get(userId) || 0;
	if (n >= limit) return null;
	inflight.set(userId, n + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const now = inflight.get(userId) || 0;
		if (now <= 1) inflight.delete(userId);
		else inflight.set(userId, now - 1);
	};
}

export function devSlotsInFlight(userId) {
	return inflight.get(userId) || 0;
}

export function resetDevPlanState() {
	inflight = new Map();
	injectedStore = null;
	redisStore = null;
}

/** Spend one call of the period's quota. The refused call is handed back. */
export async function consumeDevQuota(sub, { now = new Date() } = {}) {
	const limit = sub.plan.includedCalls;
	const key = quotaCounterKey(sub.userId, sub.periodStart);
	const ttlMs = Math.max(60_000, sub.periodEnd.getTime() - now.getTime() + COUNTER_GRACE_MS);
	const store = quotaStore();
	let n;
	try {
		n = await store.incr(key, ttlMs);
		if (n > limit) {
			await store.decr(key);
			return { allowed: false, limit, used: limit, remaining: 0, resetAt: sub.periodEnd };
		}
	} catch (err) {
		if (!isDbUnavailableError(err) && !/redis|fetch|ECONN|timeout/i.test(err?.message || '')) throw err;
		// The counter store is down: never refuse paid traffic for our outage.
		return { allowed: true, limit, used: 0, remaining: limit, resetAt: sub.periodEnd, degraded: true };
	}
	return { allowed: true, limit, used: n, remaining: Math.max(0, limit - n), resetAt: sub.periodEnd };
}

/** Where the period's quota stands, without spending a call. */
export async function peekDevQuota(sub) {
	const limit = sub.plan.includedCalls;
	let used = 0;
	try {
		used = await quotaStore().get(quotaCounterKey(sub.userId, sub.periodStart));
	} catch (err) {
		if (!isDbUnavailableError(err)) throw err;
	}
	used = Math.min(limit, used);
	return { limit, used, remaining: limit - used, resetAt: sub.periodEnd };
}

/** The next plan up, for the upgrade hint on a 402. */
export function nextDevPlan(planId) {
	const plans = listDevPlans();
	const idx = plans.findIndex((p) => p.id === planId);
	return plans.slice(idx + 1).find((p) => p.purchasable) || null;
}

function setPlanHeaders(res, sub, burst, quota) {
	res.setHeader('x-plan', sub.planId);
	res.setHeader('x-concurrency-limit', String(sub.plan.concurrent));
	if (burst) {
		const resetSec = setRateLimitHeaders(res, burst);
		res.setHeader('x-ratelimit-limit', String(burst.limit ?? sub.plan.burstPerMinute));
		res.setHeader('x-ratelimit-remaining', String(Math.max(0, burst.remaining ?? 0)));
		res.setHeader('x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + resetSec));
	}
	if (quota) {
		res.setHeader('x-quota-limit', String(quota.limit));
		res.setHeader('x-quota-used', String(quota.used));
		res.setHeader('x-quota-remaining', String(quota.remaining));
		res.setHeader('x-quota-reset', String(Math.floor(quota.resetAt.getTime() / 1000)));
	}
}

/**
 * Run the three checks for one keyed call and write the plan headers.
 * Returns `{ ok: true, sub, release }` when the call may proceed (call
 * `release()` when it ends) or `{ ok: false }` after writing the 429/402.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {import('http').ServerResponse} opts.res
 * @param {boolean} [opts.countsAgainstQuota=true] false for a signed-in owner
 *   browsing their own dashboard: they still get the plan's burst and
 *   concurrency ceilings, but a dashboard refresh never eats a developer's calls.
 * @param {Date} [opts.now]
 */
export async function devPlanGate({ userId, res, countsAgainstQuota = true, now = new Date() }) {
	const sub = await getDevSubscription(userId, { now });
	const plan = sub.plan;

	const burst = await limits.devPlanBurst(sub.planId, `user:${userId}`, { limit: plan.burstPerMinute });
	if (!burst.success) {
		setPlanHeaders(res, sub, burst, null);
		rateLimited(res, burst, `the ${plan.name} plan allows ${plan.burstPerMinute} calls per minute`, {
			plan: sub.planId,
			upgrade_url: DEV_PLAN_UPGRADE_URL,
		});
		return { ok: false, sub };
	}

	const release = acquireDevSlot(userId, plan.concurrent);
	if (!release) {
		setPlanHeaders(res, sub, burst, null);
		res.setHeader('retry-after', '1');
		error(res, 429, 'concurrency_limited', `the ${plan.name} plan allows ${plan.concurrent} concurrent calls`, {
			retry_after: 1,
			plan: sub.planId,
			concurrent_limit: plan.concurrent,
			upgrade_url: DEV_PLAN_UPGRADE_URL,
		});
		return { ok: false, sub };
	}

	const quota = countsAgainstQuota ? await consumeDevQuota(sub, { now }) : await peekDevQuota(sub);
	setPlanHeaders(res, sub, burst, quota);
	if (!quota.allowed && countsAgainstQuota) {
		release();
		const next = nextDevPlan(sub.planId);
		error(res, 402, 'quota_exceeded', `the ${plan.name} plan includes ${plan.includedCalls.toLocaleString('en-US')} calls per period and this period's calls are used up`, {
			plan: sub.planId,
			limit: quota.limit,
			used: quota.used,
			reset_at: quota.resetAt.toISOString(),
			upgrade_url: DEV_PLAN_UPGRADE_URL,
			manage_url: DEV_PLAN_MANAGE_URL,
			next_plan: next ? { id: next.id, name: next.name, included_calls: next.includedCalls, price_usd: next.priceUsd } : null,
		});
		return { ok: false, sub };
	}
	return { ok: true, sub, quota, release };
}
