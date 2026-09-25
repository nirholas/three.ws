// pump.fun callouts: the live community commentary a coin page renders from
// frontend-api-v3 `/callout/top/:mint` (the retired `/replies/:mint` route
// 404s for every mint). Each entry carries the poster's thesis, handle and
// timestamp. Shared by POST /api/social/sentiment-pulse (lexicon scoring) and
// the Sentiment Scout (quoted as evidence), so both read the same feed through
// the shared pump.fun fetch helper (identified user-agent, bounded timeout,
// one retry on a rate limit or 5xx).

import { PUMP_FRONTEND_BASE, pumpFetchJson } from './pump-feed-fetch.js';

const FETCH_TIMEOUT_MS = 8000;

/**
 * Map raw pump.fun callout rows into the scorer's post shape, newest first.
 * Rows with no thesis carry no sentiment and are dropped rather than counted
 * as neutral, which would drag every score toward zero.
 *
 * @param {any[]} callouts
 * @param {number} limit
 * @returns {Array<{ id?: string, ts?: string, text: string, author?: string }>}
 */
export function calloutsToPosts(callouts, limit) {
	if (!Array.isArray(callouts)) return [];
	return callouts
		.map((c) => {
			const at = Number(c?.createdAt);
			const ms = Number.isFinite(at) && at > 0 ? at : null;
			return {
				id: c?.calloutId ? String(c.calloutId) : undefined,
				ts: ms ? new Date(ms).toISOString() : undefined,
				text: String(c?.thesis || '').trim().slice(0, 2000),
				author: c?.username ? String(c.username) : undefined,
				_at: ms ?? 0,
			};
		})
		.filter((p) => p.text)
		.sort((a, b) => b._at - a._at)
		.slice(0, limit)
		.map(({ _at, ...post }) => post);
}

/**
 * Fetch a coin's most recent pump.fun callouts. Never throws: an upstream
 * failure is reported as `{ error, url }` for the handler to surface.
 */
export async function fetchPumpFunCallouts(mint, limit, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
	const url =
		`${PUMP_FRONTEND_BASE}/callout/top/${encodeURIComponent(mint)}` +
		`?limit=${limit}&sortBy=TIMESTAMP&sortOrder=DESC`;
	const { ok, status, body } = await pumpFetchJson(url, { timeoutMs });
	if (!ok) {
		return { error: status ? `pump.fun returned ${status}` : 'pump.fun unreachable', url };
	}
	const rows = Array.isArray(body?.callouts) ? body.callouts : Array.isArray(body) ? body : [];
	return { posts: calloutsToPosts(rows, limit), url };
}
