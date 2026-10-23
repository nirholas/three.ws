// Transient-failure handling for Robinhood Chain RPC reads.
//
// The public RPC (rpc.mainnet.chain.robinhood.com) sheds load by answering a
// perfectly valid `eth_getLogs` with JSON-RPC -32602 "Missing or invalid
// parameters". Measured live: the identical range that failed succeeds on the
// next attempt, every time. viem never retries -32602 (it classifies it as a
// caller mistake, not a server condition), so a single shed request aborts a
// whole cold-start backfill. Everything that reads logs or blocks in bulk goes
// through withRpcRetry.

const RETRYABLE_CODES = new Set([
	-1, // viem "unknown error"
	-32005, // limit exceeded
	-32603, // internal error
	-32602, // this RPC's load-shed response (see above)
	429, // some providers return the HTTP code in the JSON-RPC body
]);

const RETRYABLE_STATUS = new Set([408, 413, 429, 500, 502, 503, 504]);

const RETRYABLE_TEXT = /(fetch failed|socket hang up|econnreset|etimedout|econnrefused|eai_again|enotfound|timed out|timeout|rate limit|too many requests|service unavailable|bad gateway)/i;

/** True when an RPC error is a server-side/transient condition worth retrying. */
export function isTransientRpcError(err) {
	if (!err) return false;
	if (err.name === 'AbortError') return false;
	for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
		if (typeof e.code === 'number' && RETRYABLE_CODES.has(e.code)) return true;
		if (typeof e.status === 'number' && RETRYABLE_STATUS.has(e.status)) return true;
		if (typeof e.code === 'string' && RETRYABLE_TEXT.test(e.code)) return true;
		if (typeof e.message === 'string' && RETRYABLE_TEXT.test(e.message)) return true;
	}
	return false;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });

/**
 * Run an RPC read, retrying transient failures with exponential backoff + jitter.
 * A non-transient error (bad ABI, malformed address) throws on the first attempt
 * so real bugs stay loud.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseDelayMs?: number, onRetry?: (info: { attempt: number, delayMs: number, error: Error }) => void }} [opts]
 * @returns {Promise<T>}
 */
export async function withRpcRetry(fn, { attempts = 4, baseDelayMs = 300, onRetry } = {}) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (attempt === attempts || !isTransientRpcError(err)) throw err;
			const delayMs = Math.round(baseDelayMs * 2 ** (attempt - 1) * (1 + Math.random() * 0.4));
			onRetry?.({ attempt, delayMs, error: err });
			await sleep(delayMs);
		}
	}
	throw lastError;
}

/**
 * Milliseconds the provider asked us to wait ("limit will reset in 60 seconds"),
 * or null when the error is not a rate limit. A backoff of a couple of seconds
 * cannot outlast that window, so bulk scans wait it out instead of aborting.
 */
export function rateLimitWaitMs(err) {
	for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
		const text = String(e.message || '');
		if (e.code !== 429 && e.status !== 429 && !/rate limit/i.test(text)) continue;
		const secs = Number(/reset in (\d+)\s*s/i.exec(text)?.[1]);
		return Math.min(Number.isFinite(secs) && secs > 0 ? secs : 10, 65) * 1000;
	}
	return null;
}

/**
 * withRpcRetry plus waiting out a provider rate limit. For reads that must not
 * be silently dropped (a launch whose transaction could not be fetched would
 * otherwise vanish from the board).
 */
export async function withRpcPatience(fn, { maxRateLimitWaits = 20, sleep: wait = sleep, ...retryOpts } = {}) {
	for (let waits = 0; ; waits++) {
		try {
			return await withRpcRetry(fn, retryOpts);
		} catch (err) {
			const ms = rateLimitWaitMs(err);
			if (ms === null || waits >= maxRateLimitWaits) throw err;
			await wait(ms);
		}
	}
}
