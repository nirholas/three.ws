// Neon serverless Postgres. HTTP-based, works in edge + node runtimes.
// Use `sql` as a tagged template for one-shot queries; use `tx()` for transactions.

import { neon, neonConfig } from '@neondatabase/serverless';
import { env } from './env.js';

neonConfig.fetchConnectionCache = true;

export const sql = neon(env.DATABASE_URL);

// Simple retry for transient network errors — Neon drops idle HTTPS quickly.
export async function query(strings, ...values) {
	let lastErr;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return await sql(strings, ...values);
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
