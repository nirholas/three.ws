// Retry + bounded-timeout guard for standalone, idempotent DB writes.
//
// Neon's HTTP driver does a `fetch` per query. On Vercel, cold connections and
// momentary network blips surface as `NeonDbError: Error connecting to database:
// fetch failed` — a connection-level failure where the request never reached
// Postgres, so no statement ran. These are transient and safe to retry (the
// query is never half-applied: a failed connect can't have committed a write).
// SQL errors (constraint violations, syntax, 22021 NUL, etc.) are deterministic
// and surface unchanged.
//
// A second failure mode is worse than a clean error: a Neon connection that
// neither errors nor returns. The HTTP `fetch` can stall (DNS, TLS, a wedged
// compute waking from scale-to-zero), and a serverless function that awaits it
// burns its whole wall-clock budget and is killed by the platform with no error
// the caller can react to. So every attempt here runs under a bounded deadline:
// if the query outlives `timeoutMs` (total across attempts) we reject with a
// `DbTimeoutError` instead of hanging. A timeout is classified transient — but
// because the deadline is the *total* budget, a timed-out attempt has by
// definition consumed the remaining budget, so the loop exits and surfaces the
// timeout rather than retrying a query that is merely slow.
//
// This lives apart from db.js on purpose: the bare `sql` tagged template must
// keep returning Neon's lazy query object so callers can still batch them with
// `sql.transaction([...])`, and most tests mock `db.js` directly — keeping the
// retry wrapper here means it loads its real implementation regardless. Use it
// around standalone, idempotent statements where a transient blip otherwise
// drops data — e.g. the fire-and-forget audit/usage writes.

const MAX_DB_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [150, 400];

// Total wall-clock budget for a guarded call across all attempts. Sized well
// under a serverless function's typical execution limit so a stalled Neon
// connection is abandoned with a coded error long before the platform kills the
// whole invocation. Override per-call via `withDbRetry(run, { timeoutMs })`;
// pass `0`/`Infinity` to disable (e.g. a deliberately long-running maintenance
// query that owns its own deadline).
const DEFAULT_DB_TIMEOUT_MS = 15_000;

// Thrown when a guarded DB call outlives its deadline. Coded so callers can
// distinguish "the DB is slow/wedged" from "the query was rejected", and so
// isTransientConnError can classify it without string matching.
export class DbTimeoutError extends Error {
	constructor(ms) {
		super(`db query exceeded ${ms}ms deadline`);
		this.name = 'DbTimeoutError';
		this.code = 'DB_TIMEOUT';
	}
}

function isTransientConnError(err) {
	if (err?.code === 'DB_TIMEOUT') return true;
	const msg = `${err?.message || ''} ${err?.sourceError?.message || ''} ${err?.cause?.message || ''}`;
	return /fetch failed|connecting to database|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|terminat/i.test(
		msg,
	);
}

// Race a promise-returning thunk against a deadline. The timer is always
// cleared, so a settled query never leaves a dangling handle keeping the event
// loop (or a serverless freeze) alive. `ms <= 0` or a non-finite `ms` disables
// the bound and just runs the thunk. `budgetMs` is the figure the error
// reports: withDbRetry races each attempt against what is left of the call's
// budget, but the operator reading the log needs the budget the caller set.
export function withDbTimeout(run, ms = DEFAULT_DB_TIMEOUT_MS, budgetMs = ms) {
	if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve().then(run);
	let timer;
	const deadline = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new DbTimeoutError(budgetMs)), ms);
	});
	return Promise.race([Promise.resolve().then(run), deadline]).finally(() => clearTimeout(timer));
}

export async function withDbRetry(run, { timeoutMs = DEFAULT_DB_TIMEOUT_MS } = {}) {
	const bounded = Number.isFinite(timeoutMs) && timeoutMs > 0;
	const deadline = bounded ? Date.now() + timeoutMs : Infinity;
	let lastErr;
	for (let attempt = 0; attempt < MAX_DB_ATTEMPTS; attempt++) {
		const remaining = bounded ? deadline - Date.now() : Infinity;
		if (bounded && remaining <= 0) throw lastErr ?? new DbTimeoutError(timeoutMs);
		try {
			return await withDbTimeout(run, remaining, timeoutMs);
		} catch (err) {
			lastErr = err;
			if (attempt === MAX_DB_ATTEMPTS - 1 || !isTransientConnError(err)) throw err;
			const backoff = RETRY_BACKOFF_MS[attempt] ?? 400;
			// Never sleep past the deadline — a backoff that overruns the budget
			// would just delay the inevitable timeout throw on the next iteration.
			const left = bounded ? deadline - Date.now() : Infinity;
			if (bounded && left <= 0) throw err;
			await new Promise((r) => setTimeout(r, bounded ? Math.min(backoff, left) : backoff));
		}
	}
	throw lastErr;
}
