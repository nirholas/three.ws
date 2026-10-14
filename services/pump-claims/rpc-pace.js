/**
 * The free public RPC lane (the default in cloudbuild.yaml) throttles well
 * under one `getParsedTransaction` per signature run back-to-back: measured
 * against mainnet on 2026-10-14, an unpaced walk hit `429 Too Many Requests`
 * within a couple hundred calls even after the SDK's own built-in retries
 * gave up. Shared by backfill.js's long walk and index.js's gap-fill so
 * neither silently dies on a busy free lane.
 */

const MAX_429_RETRIES = 6;

export function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generic backoff for any single RPC call on the free lane: `connection`'s own
 * built-in retry (web3.js retries a 429 a few times internally) gives up long
 * before this walk is done, so every call that runs in a loop -- not just
 * getParsedTransaction -- needs its own longer-horizon retry on top of it.
 */
export async function withRpcBackoff(fn, sleepFn = sleep) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const is429 = /429|Too Many Requests/i.test(err?.message || '');
			if (!is429 || attempt >= MAX_429_RETRIES) throw err;
			await sleepFn(Math.min(8000, 500 * 2 ** attempt));
		}
	}
}

export async function getParsedTransactionWithBackoff(connection, signature, opts, sleepFn = sleep) {
	return withRpcBackoff(() => connection.getParsedTransaction(signature, opts), sleepFn);
}
