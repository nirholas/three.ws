// Neon serverless Postgres. HTTP-based, works in edge + node runtimes.
// Use `sql` as a tagged template for one-shot queries; use `tx()` for transactions.

import { neon, neonConfig } from '@neondatabase/serverless';
import { env } from './env.js';

neonConfig.fetchConnectionCache = true;

// Lazy Neon client — instantiating requires DATABASE_URL. Keeping it lazy lets
// this module be imported (transitively) by endpoints that don't touch the DB
// even when DATABASE_URL isn't configured.
let _sql;
function getSql() {
	if (!_sql) _sql = neon(env.DATABASE_URL);
	return _sql;
}
export const sql = new Proxy(function () {}, {
	apply(_t, _this, args) { return getSql()(...args); },
	get(_t, prop) { return getSql()[prop]; },
});

// Simple retry for transient network errors — Neon drops idle HTTPS quickly.
export async function query(strings, ...values) {
	let lastErr;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return await getSql()(strings, ...values);
		} catch (err) {
			lastErr = err;
			if (!isRetryable(err)) throw err;
		}
	}
	throw lastErr;
}

function isRetryable(err) {
	const msg = String(err?.message || '').toLowerCase();
	return msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout');
}
