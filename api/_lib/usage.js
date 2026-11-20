// Fire-and-forget usage event logging. Failures must never impact the request.
//
// ── Buffering strategy ────────────────────────────────────────────────────────
// At scale, a per-request Neon insert (one HTTP fetch each) creates connection
// pressure that shows up as latency spikes and write contention. Instead:
//   1. Push each event as JSON into a Redis list `usage:buffer` (fast RPUSH).
//   2. A QStash job (api/jobs/flush-usage-events.js) batches the list into a
//      concurrent Promise.all of Neon inserts — many fewer HTTP round-trips.
//   3. A 1-min cron (api/cron/flush-usage-events.js) acts as the safety net when
//      QStash is unavailable or the threshold trigger never fires.
//   4. If Redis itself is unavailable, fall through to the original direct-insert
//      path so telemetry is never silently lost.
//
// Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (via _lib/redis.js)
//      QSTASH_TOKEN (via _lib/qstash.js) — optional; enables immediate flush on burst
//      APP_ORIGIN — base URL used to build the QStash callback target

import { sql } from './db.js';
import { withDbRetry } from './db-retry.js';
import { getRedis, isRedisAuthError } from './redis.js';
import { qstashEnabled, publishJob } from './qstash.js';
import { env } from './env.js';

const BUFFER_KEY = 'usage:buffer';
const BUFFER_FLUSH_THRESHOLD = 50;  // trigger immediate flush at this list length
const BUFFER_MAX = 10_000;          // safety cap — drop oldest when exceeded
const BUFFER_TTL_S = 7200;          // 2h — events should never sit this long
const FLUSH_DEDUP_WINDOW_MS = 60_000; // one QStash flush job per minute

// Per-event budget for the direct-insert fallback (Redis buffer down/absent).
// Far below the 15s default DB budget on purpose: when the buffer is unavailable
// every usage event takes this path, and a slow Neon spell must never hold a
// serverless invocation open for 15s per event — that storm of 15000ms-deadline
// writes was stalling the avatar API. Telemetry is best-effort, so a bounded miss
// beats a wedged request. The batch flusher (flushUsageBuffer) keeps the default
// budget — it owns its own deadline and isn't on the request path.
const DIRECT_INSERT_TIMEOUT_MS = 2_500;

function normalizeEvt(evt) {
	return {
		userId: evt.userId ?? null,
		apiKeyId: evt.apiKeyId ?? null,
		clientId: evt.clientId ?? null,
		avatarId: evt.avatarId ?? null,
		agentId: evt.agentId ?? null,
		kind: evt.kind,
		tool: evt.tool ?? null,
		status: evt.status ?? 'ok',
		bytes: evt.bytes ?? null,
		latencyMs: evt.latencyMs ?? null,
		meta: evt.meta ?? {},
		provider: evt.provider ?? null,
		model: evt.model ?? null,
		inputTokens: evt.inputTokens ?? null,
		outputTokens: evt.outputTokens ?? null,
		costMicroUsd: evt.costMicroUsd ?? null,
	};
}

// client_id is a free-text attribution label (an OAuth client id, a hashed
// anonymous client, an MCP surface label); the oauth_clients foreign key was
// dropped for exactly that (migration 20260611120000), so the value is stored
// as given.
async function insertEvent(evt, opts) {
	await withDbRetry(() => sql`
		insert into usage_events (user_id, api_key_id, client_id, avatar_id, agent_id, kind, tool, status, bytes, latency_ms, meta, provider, model, input_tokens, output_tokens, cost_micro_usd)
		values (
			${evt.userId},
			${evt.apiKeyId},
			${evt.clientId},
			${evt.avatarId},
			${evt.agentId},
			${evt.kind},
			${evt.tool},
			${evt.status ?? 'ok'},
			${evt.bytes},
			${evt.latencyMs},
			${JSON.stringify(evt.meta ?? {})}::jsonb,
			${evt.provider},
			${evt.model},
			${evt.inputTokens},
			${evt.outputTokens},
			${evt.costMicroUsd}
		)
	`, opts);
}

function triggerFlushJob() {
	if (!qstashEnabled()) return;
	const origin = env.APP_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
	if (!origin) return;
	// Dedup within a 1-minute window so a burst doesn't spawn a fleet of flush jobs.
	const dedupMin = Math.floor(Date.now() / FLUSH_DEDUP_WINDOW_MS);
	publishJob({
		url: `${origin}/api/jobs/flush-usage-events`,
		body: {},
		retries: 2,
		deduplicationId: `usage-flush-${dedupMin}`,
	}).catch(() => {});
}

export function recordEvent(evt) {
	// Intentionally not awaited in callers; failures are swallowed.
	queueMicrotask(async () => {
		const r = getRedis();
		if (r) {
			try {
				const serialized = JSON.stringify(normalizeEvt(evt));
				const len = await r.rpush(BUFFER_KEY, serialized);
				// Hard cap: if something is consuming too slowly, trim the oldest.
				if (len > BUFFER_MAX) await r.ltrim(BUFFER_KEY, len - BUFFER_MAX, -1);
				// Set TTL once on first push so the key self-cleans if the flusher dies.
				if (len === 1) await r.expire(BUFFER_KEY, BUFFER_TTL_S);
				// Trigger an immediate background flush on every threshold multiple.
				if (len % BUFFER_FLUSH_THRESHOLD === 0) triggerFlushJob();
				return;
			} catch (err) {
				// circuitOpen → the shared Redis auth breaker (api/_lib/redis.js) already
				// logged the credential failure once and is fast-failing; falling back to
				// a direct insert is the right move, but re-warning per event is noise.
				// isRedisAuthError also catches the raw WRONGPASS the breaker's once-per-
				// cooldown half-open trial command surfaces (it bypasses the circuitOpen
				// short-circuit), so the bad-token signal stays owned solely by the breaker.
				if (!err?.circuitOpen && !isRedisAuthError(err)) {
					console.warn('[usage] buffer push failed, falling back to direct insert', err?.message);
				}
			}
		}
		// Direct-insert fallback when Redis is absent or the push fails. Bounded by
		// a short per-event timeout so a slow DB can't stall the (already-detached)
		// request work for 15s — the buffer-down path must stay cheap.
		try {
			await insertEvent(normalizeEvt(evt), { timeoutMs: DIRECT_INSERT_TIMEOUT_MS });
		} catch (err) {
			console.warn('[usage] write failed', err?.message);
		}
	});
}

/**
 * Drain up to `limit` events from the Redis buffer and insert them into Neon,
 * stopping after `deadlineMs` so a slow Neon spell can't push the caller past its
 * function timeout. Returns { flushed, remaining, errors, timedOut }.
 * Called by api/cron/flush-usage-events.js and api/jobs/flush-usage-events.js.
 */
export async function flushUsageBuffer({ limit = 500, deadlineMs = 45_000 } = {}) {
	const r = getRedis();
	if (!r) return { flushed: 0, remaining: 0, errors: 0, skipped: 'redis_unavailable' };

	const BATCH = 200;
	let flushed = 0;
	let errors = 0;
	let timedOut = false;
	// Stop cleanly before the function's maxDuration: a slow Neon write spell across
	// several batches could otherwise run past the limit and 504 the cron, dropping
	// the entire flush. Bailing early returns what we managed — the safety-net cron
	// runs again next minute and clears the rest (`remaining` is also alerted on).
	const startedAt = Date.now();

	while (flushed < limit) {
		if (Date.now() - startedAt > deadlineMs) { timedOut = true; break; }
		const take = Math.min(BATCH, limit - flushed);
		// Read the front of the list, then atomically trim those entries.
		let raw;
		try {
			raw = await r.lrange(BUFFER_KEY, 0, take - 1);
		} catch (err) {
			if (!err?.circuitOpen && !isRedisAuthError(err)) console.warn('[usage-flush] redis unavailable on lrange:', err?.message);
			return { flushed, remaining: -1, errors, skipped: 'redis_unavailable' };
		}
		if (!raw || raw.length === 0) break;

		const events = raw.map((item) => {
			try { return typeof item === 'string' ? JSON.parse(item) : item; }
			catch { return null; }
		}).filter(Boolean);

		// Concurrent batch insert — each is an independent Neon HTTP fetch.
		const results = await Promise.allSettled(events.map((evt) => insertEvent(evt)));
		const batchErrors = results.filter((r) => r.status === 'rejected').length;
		errors += batchErrors;
		if (batchErrors > 0) {
			const sample = results.find((r) => r.status === 'rejected');
			console.warn(`[usage-flush] ${batchErrors}/${events.length} inserts failed`, sample?.reason?.message);
		}

		// Trim the consumed entries regardless of insert failures — re-inserting
		// duplicates on retry is worse than losing a few failed telemetry rows.
		await r.ltrim(BUFFER_KEY, raw.length, -1);
		flushed += events.length;

		if (raw.length < take) break; // list exhausted
	}

	const remaining = await r.llen(BUFFER_KEY).catch(() => -1);
	return { flushed, remaining, errors, timedOut };
}

export function logger(name) {
	return {
		info: (msg, meta = {}) => console.log(JSON.stringify({ lvl: 'info', name, msg, ...meta })),
		warn: (msg, meta = {}) => console.warn(JSON.stringify({ lvl: 'warn', name, msg, ...meta })),
		error: (msg, meta = {}) =>
			console.error(JSON.stringify({ lvl: 'error', name, msg, ...meta })),
	};
}
