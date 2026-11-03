// x402 audit log — durable ledger of every payment event.
//
// Three exports:
//   logPaymentEvent(event) — fire-and-forget INSERT. Never blocks, never throws.
//   getAuditLog({ route?, payer?, eventType?, since?, limit? }) — filtered query.
//   getPaymentStats({ since?, groupBy? }) — aggregate stats for dashboards.
//
// Schema: api/_lib/migrations/2026-05-27-x402-audit-log.sql
//
// Design rules:
//   1. logPaymentEvent is fire-and-forget via queueMicrotask. A DB hiccup must
//      NEVER cause a payment to fail or a response to delay.
//   1b. A row that cannot be written is never dropped. It moves to a dead-letter
//      list (Redis `x402:audit:dead`) with an attempt count, and
//      drainAuditDeadLetter retries it with capped exponential backoff. After
//      MAX_ATTEMPTS it is parked in the x402_audit_dead_letter table for an
//      operator. Inserts are ON CONFLICT DO NOTHING against the partial unique
//      index on (tx_hash, event_type), so a replay writes the event once.
//   2. Only on-chain identifiers enter the log (addresses, tx hashes, amounts).
//      IP and UA are captured for rate-limit forensics but never surfaced to
//      non-admin callers.
//   3. All queries use the covering indexes on (route, created_at),
//      (payer, created_at), and (event_type, created_at).

import { sql } from '../db.js';
import { withDbRetry } from '../db-retry.js';
import { getRedis, isRedisAuthError } from '../redis.js';

// ── Redis write buffer ────────────────────────────────────────────────────────
// The hot paid routes (e.g. /api/x402/dance-tip) queue one audit write PER
// request. Firing each as its own Neon HTTP fetch turned a slow-DB spell into a
// self-amplifying storm: dozens of concurrent single-row INSERTs pile onto an
// already-saturated Neon and every one blows the deadline (the production log
// export this fixes). So writes are coalesced into a Redis list and drained by a
// batch flusher (flushAuditBuffer) off the request path — the same buffer→cron
// pattern the usage-event pipeline already uses (api/_lib/usage.js). One flush
// does a single multi-row INSERT instead of N fetches, so DB load scales with
// flush cadence, not request rate. When Redis is absent/down we fall back to the
// original bounded direct insert so nothing silently stops being logged.
const BUFFER_KEY = 'x402:audit:buffer';
const BUFFER_MAX = 20_000;   // safety cap — trim oldest if the flusher falls behind
const BUFFER_TTL_S = 7200;   // 2h — a row should never sit buffered this long
const DEAD_KEY = 'x402:audit:dead';
const DEAD_TABLE = 'x402_audit_dead_letter';
const MAX_ATTEMPTS = 10;     // after this many failed writes a row is parked in Postgres
const FLUSH_BATCH = 200;
const DEAD_BACKOFF_BASE_MS = 30_000;
const DEAD_BACKOFF_MAX_MS = 3_600_000;

// This is best-effort telemetry on a fire-and-forget path: the payment has
// already been decided and the response sent by the time this runs. So a write
// must FAIL FAST against a slow/saturated DB rather than burn the full default
// 15s retry budget — a healthy single-row INSERT settles in well under a second,
// so this window still absorbs a transient connection blip, but a genuinely
// saturated Neon (the production failure mode) abandons the write in ~3s instead
// of holding a Neon HTTP connection open for 15s. That distinction matters
// because dance-tip traffic queues one of these per request: at 15s each they
// pile up and worsen the exact saturation that's making them fail. Tunable via
// X402_AUDIT_WRITE_TIMEOUT_MS for a deploy that wants more durability headroom.
function auditWriteTimeoutMs() {
	const raw = Number.parseInt(String(process.env.X402_AUDIT_WRITE_TIMEOUT_MS ?? ''), 10);
	if (Number.isFinite(raw) && raw >= 500 && raw <= 15_000) return raw;
	return 3_000;
}

// Throttle the failure log. A saturated DB fails EVERY write in the degraded
// window, and on a hot route like /api/x402/dance-tip that emitted dozens of
// identical error lines per minute — the flood seen in the production log export.
// Collapse repeats to one line per window with a suppressed-count digest so a
// sustained outage stays visible without drowning the error stream.
const AUDIT_WARN_THROTTLE_MS = 60_000;
let _auditWarn = { lastAt: 0, suppressed: 0 };

function logAuditFailure(event, err) {
	const now = Date.now();
	if (now - _auditWarn.lastAt < AUDIT_WARN_THROTTLE_MS) {
		_auditWarn.suppressed++;
		return;
	}
	const tail = _auditWarn.suppressed > 0
		? ` (+${_auditWarn.suppressed} more in last ${Math.round((now - _auditWarn.lastAt) / 1000)}s)`
		: '';
	console.error('[x402-audit] insert failed', {
		eventType: event.eventType,
		route: event.route,
		error: err?.message,
	}, tail);
	_auditWarn = { lastAt: now, suppressed: 0 };
}

/**
 * Fire-and-forget audit log write. Swallows all errors.
 *
 * @param {object} event
 * @param {string} event.eventType   — 'payment_settled' | 'payment_failed' | 'siwx_grant' | 'siwx_access' | 'bypass_granted'
 * @param {string} event.route       — e.g. '/api/x402/dance-tip'
 * @param {string|null} [event.resourceUrl]
 * @param {string|null} [event.payer]          — wallet address
 * @param {string|null} [event.network]        — CAIP-2 chain ID
 * @param {string|null} [event.amountAtomics]  — atomic USDC amount
 * @param {string|null} [event.asset]          — asset address/mint
 * @param {string|null} [event.txHash]         — on-chain transaction hash
 * @param {string|null} [event.settlementStatus] — 'success' | 'failed'
 * @param {object|null} [event.facilitatorResponse]
 * @param {number|null} [event.durationMs]     — ms from request start to settle
 * @param {string|null} [event.ipAddress]
 * @param {string|null} [event.userAgent]
 * @param {object|null} [event.metadata]       — small JSON blob
 */
export function logPaymentEvent(event) {
	// Intentionally not awaited by callers; the payment is already decided and the
	// response sent by the time this runs. Failures are swallowed.
	queueMicrotask(async () => {
		const r = getRedis();
		if (r) {
			try {
				const len = await r.rpush(BUFFER_KEY, JSON.stringify(normalizeEvent(event)));
				// Hard cap: if the flusher is falling behind, move the oldest rows
				// to the dead-letter list rather than let the buffer grow without
				// bound or lose them.
				if (len > BUFFER_MAX) await shedBufferOverflow(r, len - BUFFER_MAX);
				// Set the TTL once on first push so the key self-cleans if the flusher
				// dies — the safety-net cron (api/cron/flush-usage-events.js) normally
				// drains it every minute.
				if (len === 1) await r.expire(BUFFER_KEY, BUFFER_TTL_S);
				return;
			} catch (err) {
				// The shared Redis breaker already logged an auth/credential failure
				// once and is fast-failing; a direct insert is the right fallback but
				// re-warning per event is noise.
				if (!err?.circuitOpen && !isRedisAuthError(err)) {
					console.warn('[x402-audit] buffer push failed, falling back to direct insert', err?.message);
				}
			}
		}
		// Direct-insert fallback when Redis is absent or the push failed. Bounded by
		// the short audit write timeout so a slow Neon spell can't hold this detached
		// work open per-event.
		try {
			await insertAuditRows([event], { timeoutMs: auditWriteTimeoutMs() });
		} catch (err) {
			logAuditFailure(event, err);
			await recordUnwritable(normalizeEvent(event), err);
		}
	});
}

// ── Dead-letter ───────────────────────────────────────────────────────────────
// An envelope wraps one normalized row with its failure history so the drain can
// back off and cap retries.
function makeEnvelope(row, err, prev) {
	const now = Date.now();
	return {
		row,
		attempts: (prev?.attempts ?? 0) + 1,
		error: String(err?.message ?? err ?? 'unknown').slice(0, 500),
		firstFailedAt: prev?.firstFailedAt ?? now,
		lastFailedAt: now,
	};
}

function backoffMs(attempts) {
	return Math.min(DEAD_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts), DEAD_BACKOFF_MAX_MS);
}

function parseEnvelope(item) {
	try {
		const env = typeof item === 'string' ? JSON.parse(item) : item;
		if (env && Array.isArray(env.row) && env.row.length === AUDIT_COLUMNS.length) return env;
	} catch { /* unparseable: handled by the caller */ }
	return null;
}

// Move the oldest `count` buffered rows onto the dead-letter list. Push first,
// trim second: a crash in between duplicates rows (harmless, the insert is
// idempotent) instead of losing them.
async function shedBufferOverflow(r, count) {
	const raw = await r.lrange(BUFFER_KEY, 0, count - 1);
	if (!raw?.length) return;
	const envs = raw
		.map((item) => { try { return typeof item === 'string' ? JSON.parse(item) : item; } catch { return null; } })
		.filter((row) => Array.isArray(row) && row.length === AUDIT_COLUMNS.length)
		.map((row) => JSON.stringify(makeEnvelope(row, 'buffer_overflow')));
	if (envs.length > 0) await r.rpush(DEAD_KEY, ...envs);
	await r.ltrim(BUFFER_KEY, raw.length, -1);
}

// Park one payload in the durable dead-letter table. Returns true when stored.
async function parkInDatabase(payload, reason, error, attempts, firstFailedAt) {
	try {
		await withDbRetry(
			() => sql(
				`INSERT INTO ${DEAD_TABLE} (payload, reason, error, attempts, first_failed_at)
				 VALUES ($1::jsonb, $2, $3, $4, $5)`,
				[JSON.stringify(payload), reason, error ?? null, attempts, new Date(firstFailedAt ?? Date.now()).toISOString()],
			),
			{ timeoutMs: auditWriteTimeoutMs() },
		);
		return true;
	} catch {
		return false;
	}
}

// A row that failed on the no-buffer path (Redis absent or down). Try the Redis
// dead-letter list, then the DB dead-letter table; only if both are unreachable
// is the row lost, and that is logged with its transaction hash so it can be
// recovered from the chain.
async function recordUnwritable(row, err) {
	const env = makeEnvelope(row, err);
	const r = getRedis();
	if (r) {
		try { await r.rpush(DEAD_KEY, JSON.stringify(env)); return; } catch { /* fall through */ }
	}
	if (await parkInDatabase(env, 'insert_failed', env.error, env.attempts, env.firstFailedAt)) return;
	console.error('[x402-audit] row lost: no buffer, no dead-letter reachable', {
		eventType: row[0], route: row[1], txHash: row[7],
	});
}

function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`audit insert timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Canonical column order for the audit table. Kept in one place so the buffered
// record shape, the multi-row INSERT, and any future migration stay in lockstep.
const AUDIT_COLUMNS = [
	'event_type', 'route', 'resource_url', 'payer', 'network', 'amount_atomics',
	'asset', 'tx_hash', 'settlement_status', 'facilitator_response',
	'duration_ms', 'ip_address', 'user_agent', 'metadata',
];
// 0-based indexes of the JSONB columns, whose placeholders need a `::jsonb` cast.
const AUDIT_JSONB_COLS = new Set([9, 13]);

// Flatten an event into a positional row matching AUDIT_COLUMNS. JSON columns are
// pre-stringified here so both the buffer record and the INSERT bind the same
// value; the `::jsonb` cast on the placeholder does the parse server-side.
function normalizeEvent(event) {
	return [
		event.eventType ?? null,
		event.route ?? null,
		event.resourceUrl ?? null,
		event.payer ?? null,
		event.network ?? null,
		event.amountAtomics ?? null,
		event.asset ?? null,
		event.txHash ?? null,
		event.settlementStatus ?? null,
		event.facilitatorResponse ? JSON.stringify(event.facilitatorResponse) : null,
		event.durationMs ?? null,
		event.ipAddress ?? null,
		event.userAgent ?? null,
		event.metadata ? JSON.stringify(event.metadata) : null,
	];
}

// Accepts either raw event objects (fallback path) or already-normalized rows
// (buffer path — arrays). Builds ONE multi-row INSERT and runs it under the retry
// guard so a transient Neon connection blip is retried (the write never committed).
async function insertAuditRows(events, opts) {
	const rows = events.map((e) => (Array.isArray(e) ? e : normalizeEvent(e)));
	if (rows.length === 0) return;

	const cols = AUDIT_COLUMNS.length;
	const params = [];
	const tuples = rows.map((row, i) => {
		const base = i * cols;
		const placeholders = row.map((val, c) => {
			params.push(val);
			return AUDIT_JSONB_COLS.has(c) ? `$${base + c + 1}::jsonb` : `$${base + c + 1}`;
		});
		return `(${placeholders.join(', ')})`;
	});

	const text =
		`INSERT INTO x402_audit_log (${AUDIT_COLUMNS.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`;
	await withDbRetry(() => sql(text, params), opts);
}

/**
 * Drain up to `limit` buffered audit rows from Redis and batch-insert them into
 * Neon (200 per multi-row INSERT, oldest first), stopping after `deadlineMs` so a
 * slow Neon spell can't push the caller past its function timeout.
 *
 * Nothing is dropped. A batch that fails or exceeds `insertTimeoutMs` is moved to
 * the dead-letter list (drained later by drainAuditDeadLetter) and the flush
 * stops, leaving later batches buffered for the next tick instead of hammering a
 * struggling DB. The buffer is trimmed only after the batch is either inserted or
 * safely on the dead-letter list; if the dead-letter push also fails the rows stay
 * buffered. Inserts are idempotent (ON CONFLICT DO NOTHING).
 *
 * @param {{ limit?: number, deadlineMs?: number, insertTimeoutMs?: number }} [opts]
 * @returns {Promise<{ flushed: number, remaining: number, errors: number, deadLettered: number, timedOut?: boolean, skipped?: string }>}
 */
export async function flushAuditBuffer({ limit = 1000, deadlineMs = 45_000, insertTimeoutMs = 15_000 } = {}) {
	const r = getRedis();
	if (!r) return { flushed: 0, remaining: 0, errors: 0, deadLettered: 0, skipped: 'redis_unavailable' };

	let flushed = 0;
	let errors = 0;
	let deadLettered = 0;
	let timedOut = false;
	const startedAt = Date.now();

	while (flushed < limit) {
		if (Date.now() - startedAt > deadlineMs) { timedOut = true; break; }
		const take = Math.min(FLUSH_BATCH, limit - flushed);

		let raw;
		try {
			raw = await r.lrange(BUFFER_KEY, 0, take - 1);
		} catch (err) {
			if (!err?.circuitOpen && !isRedisAuthError(err)) {
				console.warn('[x402-audit-flush] redis unavailable on lrange:', err?.message);
			}
			return { flushed, remaining: -1, errors, deadLettered, skipped: 'redis_unavailable' };
		}
		if (!raw || raw.length === 0) break;

		const rows = raw.map((item) => {
			try { return typeof item === 'string' ? JSON.parse(item) : item; }
			catch { return null; }
		}).filter((row) => Array.isArray(row) && row.length === AUDIT_COLUMNS.length);

		let failure = null;
		if (rows.length > 0) {
			try {
				await withTimeout(insertAuditRows(rows), insertTimeoutMs);
			} catch (err) {
				failure = err;
			}
		}

		if (failure) {
			errors += 1;
			console.warn(`[x402-audit-flush] batch insert of ${rows.length} rows failed`, failure?.message);
			try {
				await r.rpush(DEAD_KEY, ...rows.map((row) => JSON.stringify(makeEnvelope(row, failure))));
			} catch (pushErr) {
				// Cannot make the rows safe elsewhere, so leave them buffered.
				console.error('[x402-audit-flush] dead-letter push failed, rows stay buffered', pushErr?.message);
				break;
			}
			deadLettered += rows.length;
			await r.ltrim(BUFFER_KEY, raw.length, -1);
			flushed += raw.length;
			break;
		}

		await r.ltrim(BUFFER_KEY, raw.length, -1);
		flushed += raw.length;

		if (raw.length < take) break; // list exhausted
	}

	const remaining = await r.llen(BUFFER_KEY).catch(() => -1);
	return { flushed, remaining, errors, deadLettered, timedOut };
}

/**
 * Retry dead-lettered audit rows. Each row waits out an exponential backoff
 * (30s, 1m, 2m, ... capped at 1h) keyed on its attempt count. A row that fails
 * MAX_ATTEMPTS times is parked in the x402_audit_dead_letter table for an
 * operator; if even that write fails it stays on the Redis list. Failed and
 * not-yet-due rows are appended to the tail BEFORE the head is trimmed, so a crash
 * mid-drain duplicates work (idempotent) rather than losing a row.
 *
 * @param {{ limit?: number, deadlineMs?: number, insertTimeoutMs?: number, now?: number }} [opts]
 * @returns {Promise<{ inserted: number, requeued: number, parked: number, deferred: number, errors: number, remaining: number, skipped?: string }>}
 */
export async function drainAuditDeadLetter({ limit = 500, deadlineMs = 30_000, insertTimeoutMs = 15_000, now = Date.now() } = {}) {
	const r = getRedis();
	const out = { inserted: 0, requeued: 0, parked: 0, deferred: 0, errors: 0, remaining: 0 };
	if (!r) return { ...out, skipped: 'redis_unavailable' };

	let raw;
	try {
		raw = await r.lrange(DEAD_KEY, 0, limit - 1);
	} catch (err) {
		if (!err?.circuitOpen && !isRedisAuthError(err)) {
			console.warn('[x402-audit-drain] redis unavailable on lrange:', err?.message);
		}
		return { ...out, remaining: -1, skipped: 'redis_unavailable' };
	}
	if (!raw || raw.length === 0) return out;

	const startedAt = Date.now();
	const keep = []; // serialized items going back on the tail
	const due = [];
	for (const item of raw) {
		const env = parseEnvelope(item);
		if (!env) {
			const payload = { raw: typeof item === 'string' ? item : JSON.stringify(item) };
			if (await parkInDatabase(payload, 'unparseable', 'dead-letter item is not a valid envelope', 0, now)) out.parked += 1;
			else keep.push(typeof item === 'string' ? item : JSON.stringify(item));
			continue;
		}
		if (now >= env.lastFailedAt + backoffMs(env.attempts)) due.push(env);
		else { out.deferred += 1; keep.push(JSON.stringify(env)); }
	}

	for (let i = 0; i < due.length; i += FLUSH_BATCH) {
		const batch = due.slice(i, i + FLUSH_BATCH);
		if (Date.now() - startedAt > deadlineMs) {
			for (const env of batch) { out.deferred += 1; keep.push(JSON.stringify(env)); }
			continue;
		}
		try {
			await withTimeout(insertAuditRows(batch.map((e) => e.row)), insertTimeoutMs);
			out.inserted += batch.length;
		} catch (err) {
			out.errors += 1;
			for (const env of batch) {
				const next = makeEnvelope(env.row, err, env);
				if (next.attempts >= MAX_ATTEMPTS
					&& await parkInDatabase(next, 'max_attempts', next.error, next.attempts, next.firstFailedAt)) {
					out.parked += 1;
				} else {
					out.requeued += 1;
					keep.push(JSON.stringify(next));
				}
			}
		}
	}

	if (keep.length > 0) await r.rpush(DEAD_KEY, ...keep);
	await r.ltrim(DEAD_KEY, raw.length, -1);
	out.remaining = await r.llen(DEAD_KEY).catch(() => -1);
	return out;
}

/**
 * Operator-facing durability metric: how many audit rows are waiting in the
 * dead-letter list, how long the oldest has been failing, and how many have been
 * parked in the durable table (excluding migration dedupe copies).
 *
 * @returns {Promise<{ depth: number, oldestFailedAt: number|null, parked: number|null, bufferDepth: number }>}
 */
export async function getAuditDeadLetterStats() {
	const r = getRedis();
	let depth = 0;
	let oldestFailedAt = null;
	let bufferDepth = 0;
	if (r) {
		try {
			depth = Number(await r.llen(DEAD_KEY)) || 0;
			bufferDepth = Number(await r.llen(BUFFER_KEY)) || 0;
			if (depth > 0) {
				const sample = await r.lrange(DEAD_KEY, 0, 999);
				for (const item of sample) {
					const env = parseEnvelope(item);
					if (env && (oldestFailedAt === null || env.firstFailedAt < oldestFailedAt)) oldestFailedAt = env.firstFailedAt;
				}
			}
		} catch (err) {
			if (!err?.circuitOpen && !isRedisAuthError(err)) {
				console.warn('[x402-audit] dead-letter stats unavailable:', err?.message);
			}
		}
	}
	let parked = null;
	try {
		const rows = await sql(`SELECT count(*)::int AS n FROM ${DEAD_TABLE} WHERE reason <> 'dedupe'`);
		parked = rows?.[0]?.n ?? 0;
	} catch { parked = null; }
	return { depth, oldestFailedAt, parked, bufferDepth };
}

/**
 * Query the audit log with optional filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.route]
 * @param {string} [filters.payer]
 * @param {string} [filters.eventType]
 * @param {string} [filters.network]
 * @param {string} [filters.since]   — ISO 8601 timestamp
 * @param {number} [filters.limit]   — max rows (default 100, max 1000)
 * @param {number} [filters.offset]  — pagination offset (default 0)
 * @returns {Promise<Array>}
 */
export async function getAuditLog({
	route,
	payer,
	eventType,
	network,
	since,
	limit = 100,
	offset = 0,
} = {}) {
	const effectiveLimit = Math.min(Math.max(1, Number(limit) || 100), 1000);
	const effectiveOffset = Math.max(0, Number(offset) || 0);

	const rows = await sql`
		SELECT
			id, event_type, route, resource_url, payer, network,
			amount_atomics, asset, tx_hash, settlement_status,
			duration_ms, metadata, created_at
		FROM x402_audit_log
		WHERE
			(${route ?? null}::text IS NULL OR route = ${route ?? null})
			AND (${payer ?? null}::text IS NULL OR payer = ${payer ?? null})
			AND (${eventType ?? null}::text IS NULL OR event_type = ${eventType ?? null})
			AND (${network ?? null}::text IS NULL OR network = ${network ?? null})
			AND (${since ?? null}::timestamptz IS NULL OR created_at >= ${since ?? null}::timestamptz)
		ORDER BY created_at DESC
		LIMIT ${effectiveLimit}
		OFFSET ${effectiveOffset}
	`;
	return rows;
}

/**
 * Aggregate payment statistics for the analytics dashboard.
 *
 * @param {object} [opts]
 * @param {string} [opts.since]    — ISO 8601 timestamp
 * @param {string} [opts.groupBy]  — 'route' | 'network' | 'day' (default: all)
 * @returns {Promise<object>}
 */
export async function getPaymentStats({ since, groupBy } = {}) {
	const sinceTs = since || null;

	// Overall totals
	const [totals] = await sql`
		SELECT
			count(*)::int AS total_payments,
			coalesce(sum(
				CASE WHEN amount_atomics IS NOT NULL AND amount_atomics ~ '^[0-9]+$'
				THEN amount_atomics::numeric ELSE 0 END
			), 0) AS total_volume_atomics,
			count(DISTINCT payer)::int AS unique_payers
		FROM x402_audit_log
		WHERE event_type = 'payment_settled'
			AND (${sinceTs}::timestamptz IS NULL OR created_at >= ${sinceTs}::timestamptz)
	`;

	const totalVolume = totals.total_volume_atomics || 0;
	const totalPayments = totals.total_payments || 0;
	const uniquePayers = totals.unique_payers || 0;
	const avgPayment = totalPayments > 0
		? (Number(totalVolume) / totalPayments).toFixed(0)
		: '0';

	// By route
	const byRoute = await sql`
		SELECT
			route,
			count(*)::int AS count,
			coalesce(sum(
				CASE WHEN amount_atomics IS NOT NULL AND amount_atomics ~ '^[0-9]+$'
				THEN amount_atomics::numeric ELSE 0 END
			), 0)::text AS volume
		FROM x402_audit_log
		WHERE event_type = 'payment_settled'
			AND (${sinceTs}::timestamptz IS NULL OR created_at >= ${sinceTs}::timestamptz)
		GROUP BY route
		ORDER BY count DESC
	`;

	// By network
	const byNetwork = await sql`
		SELECT
			network,
			count(*)::int AS count
		FROM x402_audit_log
		WHERE event_type = 'payment_settled'
			AND (${sinceTs}::timestamptz IS NULL OR created_at >= ${sinceTs}::timestamptz)
		GROUP BY network
		ORDER BY count DESC
	`;

	// By day
	const byDay = await sql`
		SELECT
			to_char(created_at, 'YYYY-MM-DD') AS date,
			count(*)::int AS count,
			coalesce(sum(
				CASE WHEN amount_atomics IS NOT NULL AND amount_atomics ~ '^[0-9]+$'
				THEN amount_atomics::numeric ELSE 0 END
			), 0)::text AS volume
		FROM x402_audit_log
		WHERE event_type = 'payment_settled'
			AND (${sinceTs}::timestamptz IS NULL OR created_at >= ${sinceTs}::timestamptz)
		GROUP BY to_char(created_at, 'YYYY-MM-DD')
		ORDER BY date DESC
	`;

	// SIWX stats
	const [siwxStats] = await sql`
		SELECT
			count(*) FILTER (WHERE event_type = 'siwx_grant')::int AS grants,
			count(*) FILTER (WHERE event_type = 'siwx_access')::int AS accesses
		FROM x402_audit_log
		WHERE event_type IN ('siwx_grant', 'siwx_access')
			AND (${sinceTs}::timestamptz IS NULL OR created_at >= ${sinceTs}::timestamptz)
	`;

	// Bypass stats
	const bypassRows = await sql`
		SELECT
			coalesce((metadata->>'reason')::text, 'unknown') AS reason,
			count(*)::int AS count
		FROM x402_audit_log
		WHERE event_type = 'bypass_granted'
			AND (${sinceTs}::timestamptz IS NULL OR created_at >= ${sinceTs}::timestamptz)
		GROUP BY coalesce((metadata->>'reason')::text, 'unknown')
	`;
	const bypassByReason = {};
	let bypassTotal = 0;
	for (const r of bypassRows) {
		bypassByReason[r.reason] = r.count;
		bypassTotal += r.count;
	}

	// Failed payments count
	const [failedStats] = await sql`
		SELECT count(*)::int AS total_failed
		FROM x402_audit_log
		WHERE event_type = 'payment_failed'
			AND (${sinceTs}::timestamptz IS NULL OR created_at >= ${sinceTs}::timestamptz)
	`;

	// Format volume to USDC (6 decimals)
	function atomicsToUsdc(atomics) {
		const n = Number(atomics || 0);
		return (n / 1e6).toFixed(6);
	}

	return {
		total_payments: totalPayments,
		total_volume_usdc: atomicsToUsdc(totalVolume),
		unique_payers: uniquePayers,
		avg_payment_usdc: atomicsToUsdc(avgPayment),
		total_failed: failedStats.total_failed || 0,
		by_route: byRoute.map((r) => ({
			route: r.route,
			count: r.count,
			volume: atomicsToUsdc(r.volume),
		})),
		by_network: byNetwork.map((r) => ({
			network: r.network,
			count: r.count,
		})),
		by_day: byDay.map((r) => ({
			date: r.date,
			count: r.count,
			volume: atomicsToUsdc(r.volume),
		})),
		siwx_stats: {
			grants: siwxStats?.grants || 0,
			accesses: siwxStats?.accesses || 0,
		},
		bypass_stats: {
			total: bypassTotal,
			by_reason: bypassByReason,
		},
	};
}

/**
 * Count recent payments — used by /api/healthz for the x402 health block.
 * @param {number} [withinMinutes=60]
 * @returns {Promise<number>}
 */
export async function countRecentPayments(withinMinutes = 60) {
	try {
		const [row] = await sql`
			SELECT count(*)::int AS n
			FROM x402_audit_log
			WHERE event_type = 'payment_settled'
				AND created_at >= NOW() - (${withinMinutes} || ' minutes')::interval
		`;
		return row?.n || 0;
	} catch {
		return -1;
	}
}

/**
 * Promote a settled-payment audit row from `pending` to its final status once
 * the chain has answered.
 *
 * A payment that settled through the `settlement_pending` path is recorded with
 * `settlement_status = 'pending'`, because at response time nobody knew whether
 * it had landed. Revenue queries count `settlement_status = 'success'`, so a row
 * left pending forever is a payment that silently never appears in the books.
 * The reconcile cron (api/cron/x402-settlement-reconcile.js) calls this with the
 * chain's verdict.
 *
 * Scoped to rows still marked pending, so it can never rewrite a status that was
 * already decided, and keyed on the settlement signature, which is unique per
 * settled payment (settle-credit.js enforces that invariant).
 *
 * @param {object} args
 * @param {string} args.txHash       settlement signature
 * @param {'success'|'failed'} args.status  the chain's verdict
 * @returns {Promise<number>} rows promoted (0 when the payment was never pending)
 */
export async function promotePendingSettlementStatus({ txHash, status }) {
	if (!txHash || !status) return 0;
	try {
		const rows = await sql`
			UPDATE x402_audit_log
			SET settlement_status = ${status}
			WHERE tx_hash = ${txHash}
			  AND event_type = 'payment_settled'
			  AND settlement_status = 'pending'
			RETURNING id
		`;
		return rows?.length || 0;
	} catch (err) {
		// The books are reconcilable from x402_pending_settlements and the
		// facilitator log either way; a failed cosmetic promotion must not fail the
		// reconcile pass that already recorded the real verdict.
		console.warn('[x402-audit] settlement status promotion failed', err?.message || err);
		return 0;
	}
}
