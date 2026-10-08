// How a failed delivery is retried. Adapters wrap every platform refusal in a
// PlatformError that says whether trying again can help:
//
//   permanent    the platform will refuse the same call again (chat not found,
//                bot blocked or kicked, malformed request). Dead-letter now.
//   retryAfterMs the platform asked us to wait (HTTP 429). Retry no sooner.
//   neither      a transient failure (5xx, network, timeout). Retry with backoff.
//
// Anything that is not a PlatformError (a database blip, an LLM lane outage that
// escaped the core) is treated as transient.

export class PlatformError extends Error {
	/**
	 * @param {string} platform
	 * @param {string} message
	 * @param {{ status?:number|null, code?:string|number|null, permanent?:boolean, retryAfterMs?:number|null, cause?:unknown }} [info]
	 */
	constructor(platform, message, { status = null, code = null, permanent = false, retryAfterMs = null, cause } = {}) {
		super(`${platform}: ${message}`, cause ? { cause } : undefined);
		this.name = 'PlatformError';
		this.platform = platform;
		this.status = status;
		this.code = code;
		this.permanent = Boolean(permanent);
		this.retryAfterMs = retryAfterMs;
	}
}

/** A 4xx other than 408 and 429 means the same request will be refused again. */
export function isPermanentStatus(status) {
	return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * The delay before attempt `attempts + 1`: exponential from `baseMs`, capped at
 * `maxMs`, never shorter than what the platform asked for.
 */
export function backoffMs(attempts, { baseMs, maxMs, retryAfterMs = null }) {
	const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
	return Math.max(exp, Number(retryAfterMs) || 0);
}

/**
 * Decide what to do with a row whose handler threw.
 * @param {unknown} err
 * @param {{ attempts:number, maxAttempts:number, delivered:number, baseMs:number, maxMs:number }} ctx
 * @returns {{ deadLetter:boolean, retryAfterMs:number, reason:string }}
 */
export function classifyFailure(err, { attempts, maxAttempts, delivered, baseMs, maxMs }) {
	// Something already reached the chat. Running the event again would repeat
	// that message (and, for a conversation, a whole agent turn), so the row is
	// parked instead of retried.
	if (delivered > 0) return { deadLetter: true, retryAfterMs: 0, reason: 'partially_delivered' };
	if (err instanceof PlatformError && err.permanent) return { deadLetter: true, retryAfterMs: 0, reason: 'permanent' };
	if (attempts >= maxAttempts) return { deadLetter: true, retryAfterMs: 0, reason: 'attempts_exhausted' };
	const retryAfterMs = backoffMs(attempts, { baseMs, maxMs, retryAfterMs: err instanceof PlatformError ? err.retryAfterMs : null });
	return { deadLetter: false, retryAfterMs, reason: 'transient' };
}

/** A short, log-safe description of an error: never a message body. */
export function errorSummary(err) {
	if (err instanceof PlatformError) return { error: err.message, status: err.status, code: err.code, permanent: err.permanent };
	return { error: String(err?.message || err).slice(0, 300), code: err?.code ?? null };
}
