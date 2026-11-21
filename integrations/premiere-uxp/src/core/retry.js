'use strict';

const { ApiError, normalise } = require('./errors');

/** Cooperative cancellation: UXP has no guaranteed AbortController, so work checks this between steps. */
class CancelToken {
	constructor() {
		this.cancelled = false;
		this.listeners = [];
	}
	cancel() {
		if (this.cancelled) return;
		this.cancelled = true;
		for (const fn of this.listeners.splice(0)) fn();
	}
	onCancel(fn) {
		if (this.cancelled) fn();
		else this.listeners.push(fn);
	}
	throwIfCancelled() {
		if (this.cancelled) throw new ApiError('cancelled', 'Cancelled.');
	}
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn(attempt)` with exponential backoff while the failure is retryable.
 * `attempts` is the total number of tries.
 */
async function withRetry(fn, { attempts = 4, baseMs = 500, maxMs = 8000, sleep = realSleep, token, onRetry } = {}) {
	let last;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (token) token.throwIfCancelled();
		try {
			return await fn(attempt);
		} catch (raw) {
			const err = normalise(raw);
			last = err;
			if (err.code === 'cancelled' || !err.retryable || attempt === attempts) throw err;
			if (onRetry) onRetry(err, attempt);
			await sleep(Math.min(maxMs, baseMs * 2 ** (attempt - 1)));
		}
	}
	throw last;
}

/** Run `worker(item)` over `items` with at most `limit` in flight; stops scheduling on the first failure. */
async function runPool(items, limit, worker, token) {
	const queue = items.slice();
	let failure = null;
	const lanes = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
		while (!failure && queue.length) {
			if (token) token.throwIfCancelled();
			const item = queue.shift();
			try {
				await worker(item);
			} catch (err) {
				failure = failure || err;
			}
		}
	});
	await Promise.all(lanes);
	if (failure) throw failure;
}

module.exports = { CancelToken, withRetry, runPool, realSleep };
