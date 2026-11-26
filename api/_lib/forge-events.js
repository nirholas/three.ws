// Forge generation observability — fail-open structured logs + rolling counters.
//
// Under an influx you have to be able to SEE the pipeline: success rate, latency,
// and which backend is carrying the load. This module records every terminal
// generation outcome two ways:
//   1. One structured JSON log line per event — ALWAYS on, zero infra. Vercel log
//      drains / any aggregator can query `evt:"forge_gen"` for live throughput,
//      per-backend failure spikes, and latency without a database.
//   2. Best-effort rolling counters in the shared Upstash Redis, bucketed by hour,
//      surfaced in /api/forge?health=1 so the health dashboard shows real success
//      rate + latency instead of just upstream auth probes.
//
// Both fail OPEN: a metrics hiccup must never affect a generation. This is
// instrumentation, not a gate. Never construct a Redis client here — use the
// shared singleton (redis.js); per-module clients caused the June 2026 quota
// blowout.

import { AsyncLocalStorage } from 'node:async_hooks';
import { getRedis } from './redis.js';
import { backendCostClass } from './forge-tiers.js';

const redis = getRedis();

const METRICS_PREFIX = 'fc:metrics:';
const BUCKET_TTL_S = 26 * 3600; // keep ~26h so a 24h read always has full data
const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 48;

// Five-minute buckets in the same store, for the "last hour" view of submit
// outcomes. An hourly bucket can only answer "this clock hour", which at 00:05
// is five minutes of data; twelve five-minute buckets answer the last hour.
const MINUTE_PREFIX = `${METRICS_PREFIX}m5:`;
const MINUTE_BUCKET_MS = 5 * 60_000;
const MINUTE_BUCKET_TTL_S = 2 * 3600;
const LAST_HOUR_BUCKETS = 12;

// A submit outcome write is instrumentation on the request's tail. It is never
// awaited by the request, and this cap stops a stalled store from holding the
// promise (and its closure) for the Redis client's own, much longer, timeout.
export const PRE_JOB_RECORD_TIMEOUT_MS = 1_500;

// Epoch hour — the counter bucket granularity. Cheap to aggregate (≤48 HGETALLs)
// and fine-grained enough to watch a spike develop over an afternoon.
function hourBucket(ts = Date.now()) {
	return Math.floor(ts / 3_600_000);
}

function minuteBucket(ts = Date.now()) {
	return Math.floor(ts / MINUTE_BUCKET_MS);
}

// ── Submit trace ──────────────────────────────────────────────────────────────
// One per generation POST. The submit handler marks the stage it is in
// (reference image, lane submit) and the last provider error it caught, and the
// 'start' event below flips jobCreated the moment a forge_creations row exists.
// The submit observer (forge-prejob.js) reads it when the response is written
// to tell "ended before a job existed, at stage X" apart from "a job exists,
// its outcome is the lane's to report". Outside a generation POST there is no
// store and every helper is a no-op.
const submitTrace = new AsyncLocalStorage();

export function newSubmitTrace() {
	return { stage: 'gate', jobCreated: false, error: null };
}

export function runWithSubmitTrace(trace, fn) {
	return submitTrace.run(trace, fn);
}

export function currentSubmitTrace() {
	return submitTrace.getStore() || null;
}

// Mark the stage the current generation POST has reached.
export function markSubmitStage(stage) {
	const trace = submitTrace.getStore();
	if (trace && typeof stage === 'string') trace.stage = stage;
}

// Keep the fields of a caught provider error that say who refused and how.
// Never the prompt, never a URL, never a credential: code, status, wait, and
// the first words of the message (where the provider names itself).
export function noteSubmitError(err) {
	const trace = submitTrace.getStore();
	if (!trace || !err) return;
	trace.error = {
		code: typeof err.code === 'string' ? err.code : null,
		providerStatus: Number.isFinite(err.providerStatus) ? err.providerStatus : null,
		retryAfter: Number.isFinite(err.retryAfter) ? err.retryAfter : null,
		provider: typeof err.provider === 'string' ? err.provider : null,
		message: typeof err.message === 'string' ? err.message.slice(0, 80) : '',
	};
}

// Record one generation event. `phase` is 'start' | 'done' | 'failed'. 'start'
// only logs (no counters — we count terminal outcomes, not attempts, so the
// success rate denominator is meaningful). latencyMs/cacheHit apply to 'done'.
// Returns a promise the async terminal writers already await; the Redis write is
// a single pipelined round-trip, so awaiting adds negligible latency and makes
// the counter durable (an un-awaited promise can be frozen by the serverless
// runtime before it flushes).
export async function recordGenerationEvent({
	phase,
	backend = 'unknown',
	tier = null,
	path = null,
	latencyMs = null,
	cacheHit = false,
	source = null,
	errorCode = null,
} = {}) {
	// 1) Structured log line — unconditional, must never throw.
	try {
		console.log(
			JSON.stringify({
				evt: 'forge_gen',
				phase,
				backend,
				tier,
				path,
				latency_ms: typeof latencyMs === 'number' && latencyMs >= 0 ? Math.round(latencyMs) : null,
				cache_hit: Boolean(cacheHit),
				source,
				error_code: errorCode,
			}),
		);
	} catch {
		/* logging is best-effort */
	}

	// A creation row now exists for this request: whatever the response says
	// next, it is no longer a pre-job outcome.
	if (phase === 'start') {
		const trace = submitTrace.getStore();
		if (trace) trace.jobCreated = true;
	}

	// 2) Rolling counters — terminal phases only, best-effort.
	if (!redis || (phase !== 'done' && phase !== 'failed')) return;
	const ok = phase === 'done';
	const safeBackend = String(backend || 'unknown').replace(/[^a-z0-9_-]/gi, '') || 'unknown';
	const key = `${METRICS_PREFIX}${hourBucket()}`;
	const fields = {
		total: 1,
		[ok ? 'ok' : 'fail']: 1,
		[`b:${safeBackend}:total`]: 1,
		[`b:${safeBackend}:${ok ? 'ok' : 'fail'}`]: 1,
	};
	if (ok && typeof latencyMs === 'number' && latencyMs >= 0) {
		fields.lat_sum = Math.round(latencyMs);
		fields.lat_n = 1;
	}
	if (cacheHit) fields.cache_hit = 1;

	try {
		const pipe = redis.pipeline();
		for (const [field, by] of Object.entries(fields)) pipe.hincrby(key, field, by);
		pipe.expire(key, BUCKET_TTL_S);
		// The last-hour view needs the lane outcome at the same five-minute grain
		// as the submit outcomes it is divided against.
		const minuteKey = `${MINUTE_PREFIX}${minuteBucket()}`;
		pipe.hincrby(minuteKey, ok ? 'ok' : 'fail', 1);
		pipe.expire(minuteKey, MINUTE_BUCKET_TTL_S);
		await pipe.exec();
	} catch {
		/* fail open — losing a counter never blocks a generation */
	}
}

// ── Submit outcomes (every generation POST, including the ones that never made a job) ──
//
// The terminal counters above only see requests that reached a 3D lane. A text
// prompt that died while its reference image was being painted never created a
// row, so it was in no count at all (the 2026-11-26 outage: lane success 93%,
// while text prompts were failing before any job existed). This records the
// outcome of every generation POST past the sign-in check, in the same buckets:
//
//   rq:accepted   POSTs past sign-in (the end-to-end denominator)
//   rq:job        a job was created (or joined an identical in-flight one)
//   rq:delivered  a finished model came back in the response itself (cache hit)
//   rq:failed     ended before any job existed
//   rq:signin     refused at the sign-in check (not in rq:accepted)
//   pj:<stage>:<cause>   one per pre-job ending, sign-in refusals included
//   pjp:<provider>       the provider that refused, when one did
//   pjw:sum / pjw:n      the waits the response stated (seconds)

const SUBMIT_OUTCOMES = new Set(['job', 'delivered', 'failed', 'sign_in']);

function counterToken(value, fallback) {
	const t = String(value ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, '')
		.slice(0, 40);
	return t || fallback;
}

export function submitOutcomeFields({ outcome, stage, cause, provider, retryAfterS }) {
	if (!SUBMIT_OUTCOMES.has(outcome)) return null;
	if (outcome === 'job') return { 'rq:accepted': 1, 'rq:job': 1 };
	if (outcome === 'delivered') return { 'rq:accepted': 1, 'rq:delivered': 1 };
	const fields =
		outcome === 'sign_in' ? { 'rq:signin': 1 } : { 'rq:accepted': 1, 'rq:failed': 1 };
	fields[`pj:${counterToken(stage, 'unknown')}:${counterToken(cause, 'unknown')}`] = 1;
	if (provider) fields[`pjp:${counterToken(provider, 'unknown')}`] = 1;
	if (Number.isFinite(retryAfterS) && retryAfterS > 0) {
		fields['pjw:sum'] = Math.round(retryAfterS);
		fields['pjw:n'] = 1;
	}
	return fields;
}

function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve('timeout'), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Record one generation POST outcome. Callers fire and forget: this never
// throws, and resolves within PRE_JOB_RECORD_TIMEOUT_MS even when the store
// stalls. `internal` (a showcase seed job) logs but never counts, so platform
// seeding cannot move a user-facing rate.
export async function recordSubmitOutcome({
	outcome,
	stage = null,
	cause = null,
	provider = null,
	httpStatus = null,
	retryAfterS = null,
	upstreamStatus = null,
	internal = false,
} = {}) {
	try {
		console.log(
			JSON.stringify({
				evt: 'forge_submit',
				outcome,
				stage,
				cause,
				provider,
				http_status: httpStatus,
				retry_after_s: Number.isFinite(retryAfterS) ? retryAfterS : null,
				upstream_status: upstreamStatus,
				internal: Boolean(internal),
			}),
		);
	} catch {
		/* logging is best-effort */
	}

	if (!redis || internal) return;
	const fields = submitOutcomeFields({ outcome, stage, cause, provider, retryAfterS });
	if (!fields) return;
	const hourKey = `${METRICS_PREFIX}${hourBucket()}`;
	const minuteKey = `${MINUTE_PREFIX}${minuteBucket()}`;
	try {
		const pipe = redis.pipeline();
		for (const [field, by] of Object.entries(fields)) {
			pipe.hincrby(hourKey, field, by);
			pipe.hincrby(minuteKey, field, by);
		}
		pipe.expire(hourKey, BUCKET_TTL_S);
		pipe.expire(minuteKey, MINUTE_BUCKET_TTL_S);
		await withTimeout(
			Promise.resolve(pipe.exec()).catch(() => null),
			PRE_JOB_RECORD_TIMEOUT_MS,
		);
	} catch {
		/* fail open, a lost counter never touches the request */
	}
}

// Fold raw bucket fields into the submit-outcome rollup. Pure, so the health
// endpoint and the reports share one definition.
//
// end_to_end_success_rate answers "of the generation requests we accepted past
// sign-in, what share became a model?". Jobs created in the window are credited
// at the window's lane success rate (their own outcome lands later, and on a
// different counter), cache hits count as delivered, and every pre-job ending
// counts as a failure. lane_success_rate is the old headline number: it only
// sees jobs that reached a 3D lane.
export function summarizeSubmitOutcomes(buckets = []) {
	const c = { accepted: 0, job: 0, delivered: 0, failed: 0, signin: 0, ok: 0, fail: 0, wait_sum: 0, wait_n: 0 };
	const byStage = {};
	const byCause = {};
	const byProvider = {};
	for (const bucket of buckets) {
		if (!bucket) continue;
		for (const [field, raw] of Object.entries(bucket)) {
			const v = Number(raw) || 0;
			if (field === 'ok') c.ok += v;
			else if (field === 'fail') c.fail += v;
			else if (field === 'rq:accepted') c.accepted += v;
			else if (field === 'rq:job') c.job += v;
			else if (field === 'rq:delivered') c.delivered += v;
			else if (field === 'rq:failed') c.failed += v;
			else if (field === 'rq:signin') c.signin += v;
			else if (field === 'pjw:sum') c.wait_sum += v;
			else if (field === 'pjw:n') c.wait_n += v;
			else if (field.startsWith('pjp:')) {
				const p = field.slice(4);
				byProvider[p] = (byProvider[p] || 0) + v;
			} else if (field.startsWith('pj:')) {
				const [, stage, cause] = field.split(':');
				if (!stage || !cause) continue;
				byStage[stage] = (byStage[stage] || 0) + v;
				const k = `${stage}:${cause}`;
				byCause[k] = (byCause[k] || 0) + v;
			}
		}
	}
	const terminal = c.ok + c.fail;
	const laneRate = terminal > 0 ? c.ok / terminal : null;
	let endToEnd = null;
	if (c.accepted > 0 && (c.job === 0 || laneRate != null)) {
		const credited = c.delivered + c.job * (laneRate ?? 0);
		endToEnd = Math.min(1, Math.max(0, credited / c.accepted));
	}
	const round = (x) => (x == null ? null : Number(x.toFixed(4)));
	return {
		accepted: c.accepted,
		jobs_created: c.job,
		delivered_in_response: c.delivered,
		failed_before_job: c.failed,
		sign_in_refused: c.signin,
		pre_job_failure_rate: c.accepted > 0 ? round(c.failed / c.accepted) : null,
		lane_success_rate: round(laneRate),
		end_to_end_success_rate: round(endToEnd),
		by_stage: byStage,
		by_cause: Object.entries(byCause)
			.map(([k, count]) => {
				const [stage, cause] = k.split(':');
				return { stage, cause, count };
			})
			.sort((a, b) => b.count - a.count),
		by_provider: byProvider,
		avg_stated_wait_s: c.wait_n > 0 ? Math.round(c.wait_sum / c.wait_n) : null,
	};
}

// The last hour (twelve five-minute buckets, the current one partial) and the
// last 24 hours (the hourly buckets) of submit outcomes. Null without Redis, so
// a deployment with no store shows no block rather than zeros that read as "no
// failures".
export async function readSubmitOutcomes() {
	if (!redis) return null;
	const nowMin = minuteBucket();
	const nowHour = hourBucket();
	const minuteKeys = Array.from({ length: LAST_HOUR_BUCKETS }, (_, i) => `${MINUTE_PREFIX}${nowMin - i}`);
	const hourKeys = Array.from({ length: DEFAULT_WINDOW_HOURS }, (_, i) => `${METRICS_PREFIX}${nowHour - i}`);
	// A read that failed is not an empty bucket. When every read fails (store
	// down, or unreachable from where this runs) the answer is "unknown", not a
	// window of zeros that reads as "nothing failed".
	const FAILED = Symbol('read failed');
	let minuteBuckets;
	let hourBuckets;
	try {
		[minuteBuckets, hourBuckets] = await Promise.all([
			Promise.all(minuteKeys.map((k) => redis.hgetall(k).catch(() => FAILED))),
			Promise.all(hourKeys.map((k) => redis.hgetall(k).catch(() => FAILED))),
		]);
	} catch {
		return null;
	}
	if ([...minuteBuckets, ...hourBuckets].every((b) => b === FAILED)) return null;
	minuteBuckets = minuteBuckets.map((b) => (b === FAILED ? null : b));
	hourBuckets = hourBuckets.map((b) => (b === FAILED ? null : b));
	const coveredMinutes = (LAST_HOUR_BUCKETS - 1) * 5 + Math.floor((Date.now() % MINUTE_BUCKET_MS) / 60_000) + 1;
	return {
		last_hour: { window_minutes: coveredMinutes, ...summarizeSubmitOutcomes(minuteBuckets) },
		last_24h: { window_hours: DEFAULT_WINDOW_HOURS, ...summarizeSubmitOutcomes(hourBuckets) },
	};
}

// Aggregate the last `windowHours` hourly buckets into a single rollup for the
// health endpoint. Returns null when Redis is absent (the dashboard then simply
// omits the metrics block rather than showing zeros that look like an outage).
export async function readGenerationMetrics({ windowHours = DEFAULT_WINDOW_HOURS } = {}) {
	if (!redis) return null;
	const hours = Math.min(Math.max(Number(windowHours) || DEFAULT_WINDOW_HOURS, 1), MAX_WINDOW_HOURS);
	const now = hourBucket();
	const keys = [];
	for (let i = 0; i < hours; i += 1) keys.push(`${METRICS_PREFIX}${now - i}`);

	let buckets;
	try {
		buckets = await Promise.all(keys.map((k) => redis.hgetall(k).catch(() => null)));
	} catch {
		return null;
	}

	const agg = { total: 0, ok: 0, fail: 0, cache_hit: 0, lat_sum: 0, lat_n: 0, by_backend: {} };
	for (const bucket of buckets) {
		if (!bucket) continue;
		for (const [field, rawValue] of Object.entries(bucket)) {
			const value = Number(rawValue) || 0;
			if (field === 'total') agg.total += value;
			else if (field === 'ok') agg.ok += value;
			else if (field === 'fail') agg.fail += value;
			else if (field === 'cache_hit') agg.cache_hit += value;
			else if (field === 'lat_sum') agg.lat_sum += value;
			else if (field === 'lat_n') agg.lat_n += value;
			else if (field.startsWith('b:')) {
				const parts = field.split(':');
				const backend = parts[1];
				const kind = parts[2];
				if (!backend || !['total', 'ok', 'fail'].includes(kind)) continue;
				const slot = (agg.by_backend[backend] ||= { total: 0, ok: 0, fail: 0 });
				slot[kind] += value;
			}
		}
	}

	// Free-vs-paid serve split — the headline number for the self-host-first cost
	// goal: how many generations were served on a zero-vendor-cost lane (our own
	// GPU workers + free external previews) vs a paid one (Replicate platform
	// credits or a BYOK vendor key). Derived from the per-backend counters via the
	// registry's cost class, so it needs no extra counter writes and stays correct
	// as lanes are added. `unknown` collects any backend the registry no longer
	// knows (a renamed lane), surfaced rather than silently dropped.
	const byCost = {
		free: { total: 0, ok: 0, fail: 0 },
		paid: { total: 0, ok: 0, fail: 0 },
		unknown: { total: 0, ok: 0, fail: 0 },
	};
	for (const [backend, c] of Object.entries(agg.by_backend)) {
		const cls = backend === 'unknown' ? 'unknown' : backendCostClass(backend) || 'unknown';
		const slot = byCost[cls] || byCost.unknown;
		slot.total += c.total;
		slot.ok += c.ok;
		slot.fail += c.fail;
	}
	const servedTotal = byCost.free.total + byCost.paid.total;
	const submits = summarizeSubmitOutcomes(buckets);

	return {
		window_hours: hours,
		total: agg.total,
		ok: agg.ok,
		fail: agg.fail,
		cache_hits: agg.cache_hit,
		success_rate: agg.total > 0 ? Number((agg.ok / agg.total).toFixed(4)) : null,
		// success_rate only sees jobs that reached a 3D lane. The end-to-end rate
		// beside it counts every generation request accepted past sign-in,
		// including the ones that ended before a job existed (see
		// summarizeSubmitOutcomes). Null until the submit observer has data.
		success_rate_scope: 'jobs that reached a 3D lane',
		end_to_end_success_rate: submits.end_to_end_success_rate,
		requests_accepted: submits.accepted,
		failed_before_job: submits.failed_before_job,
		avg_latency_ms: agg.lat_n > 0 ? Math.round(agg.lat_sum / agg.lat_n) : null,
		by_backend: agg.by_backend,
		by_cost: byCost,
		// Share of generations that cost no vendor money — the metric the
		// self-host-first work is measured by. Null when nothing has been served yet.
		free_share: servedTotal > 0 ? Number((byCost.free.total / servedTotal).toFixed(4)) : null,
	};
}
