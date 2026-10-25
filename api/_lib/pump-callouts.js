// pump.fun callouts: the live community commentary a coin page renders from
// frontend-api-v3 `/callout/coin/:mint`. Both earlier routes are gone: the
// `/replies/:mint` comments route and, since 2026-10, `/callout/top/:mint`,
// which now answers "Cannot GET" for every mint (that removal is what turned
// every sentiment pulse into a 502). Each entry carries the poster's thesis,
// optional handle and timestamp. Shared by POST /api/social/sentiment-pulse (lexicon scoring) and
// the Sentiment Scout (quoted as evidence), so both read the same feed through
// the shared pump.fun fetch helper (identified user-agent, bounded timeout,
// one retry on a rate limit or 5xx).
//
// A last-known-good tier (cacheWrapLastGood, same pattern as
// pump-feed-fetch.js's readThroughFeed and pump-bonding.js's getBondingStatus)
// backs the fetch: Cloudflare now answers this route's calls with a bare 403
// for some mints, and without a cache tier that 403 propagated straight to a
// 502 even for a mint read successfully moments earlier.

import { PUMP_FRONTEND_BASE, pumpFetchJson } from './pump-feed-fetch.js';
import { cacheWrapLastGood } from './cache.js';

const FETCH_TIMEOUT_MS = 8000;

// pump.fun rejects `limit` above 100 with a 400 ("limit must not be greater
// than 100"), so a larger caller limit is clamped rather than failing the read.
export const PUMP_CALLOUT_PAGE_MAX = 100;

// Live cache: collapses repeat polls of the same mint+limit into one upstream
// fetch. Last-known-good: survives a Cloudflare 403/rate-limit window so a
// mint with a prior successful fetch degrades to stale data, never a 502.
const LIVE_TTL_S = Number(process.env.PUMP_CALLOUTS_TTL_S || 25);
const LKG_TTL_S = Number(process.env.PUMP_BONDING_LKG_TTL_S || 1800);

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
 * failure is reported as `{ error, url }` for the handler to surface, unless
 * a last-known-good copy for this mint+limit survives, in which case that
 * stale copy is served instead (`{ posts, url, stale: true }`).
 */
export async function fetchPumpFunCallouts(mint, limit, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
	const pageLimit = Math.max(1, Math.min(PUMP_CALLOUT_PAGE_MAX, Math.floor(limit) || 1));
	const url = `${PUMP_FRONTEND_BASE}/callout/coin/${encodeURIComponent(mint)}?limit=${pageLimit}`;
	const key = `pump:callouts:${mint}:${pageLimit}`;

	try {
		const { value, stale } = await cacheWrapLastGood(
			key,
			LIVE_TTL_S,
			async () => {
				const { ok, status, body } = await pumpFetchJson(url, { timeoutMs });
				if (!ok) {
					throw new Error(status ? `pump.fun returned ${status}` : 'pump.fun unreachable');
				}
				const rows = Array.isArray(body?.callouts) ? body.callouts : Array.isArray(body) ? body : [];
				return calloutsToPosts(rows, limit);
			},
			{ staleTtlSeconds: LKG_TTL_S, withMeta: true },
		);
		return stale ? { posts: value, url, stale: true } : { posts: value, url };
	} catch (err) {
		return { error: err?.message || 'pump.fun unreachable', url };
	}
}
