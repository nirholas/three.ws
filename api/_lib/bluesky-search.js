// Bluesky post search: a keyless source of community commentary about a token.
//
// Bluesky's public AppView answers app.bsky.feed.searchPosts without an account
// or key. The api.bsky.app host serves it to unauthenticated callers; the
// public.api.bsky.app mirror answers 403 to the same request (verified
// 2026-11-25), so the host is configurable but defaults to the one that works.
//
// Two queries describe a Solana token:
//   1. The mint address itself. Unambiguous: a post containing the mint is
//      about that coin, whatever it says.
//   2. The ticker, when one is known. Search is full-text and drops the `$`, so
//      a ticker query returns every post using the word ("three", "wif"). Only
//      posts that write the exact cashtag (`$SYMBOL`, not `$SYMBOLX`) are kept,
//      and tickers shorter than three characters are not searched at all,
//      because cashtags that short collide across many unrelated coins.
//
// The read never throws. An upstream failure returns `{ error }` unless a
// last-known-good copy for the same mint and ticker survives, which is served
// as `{ stale: true }`, the same contract as api/_lib/pump-callouts.js.

import { fetchUpstreamJson } from './upstream-fetch.js';
import { cacheWrapLastGood } from './cache.js';

const APPVIEW = (process.env.BLUESKY_APPVIEW_URL || 'https://api.bsky.app').replace(/\/+$/, '');
const SEARCH_PATH = '/xrpc/app.bsky.feed.searchPosts';
const PAGE_MAX = 100;
const TIMEOUT_MS = 6_000;
const LIVE_TTL_S = 120;
const LKG_TTL_S = 1800;

const SYMBOL_RE = /^[A-Za-z0-9]{3,10}$/;

/** The ticker to search for, or null when it is missing, too short, or has no letter. */
export function searchableSymbol(symbol) {
	const s = String(symbol ?? '').trim().replace(/^\$/, '');
	return SYMBOL_RE.test(s) && /[A-Za-z]/.test(s) ? s.toUpperCase() : null;
}

/** True when `text` contains the exact cashtag `$SYMBOL` (case-insensitive). */
export function mentionsCashtag(text, symbol) {
	const re = new RegExp(`(^|[^A-Za-z0-9_$])\\$${symbol}(?![A-Za-z0-9_])`, 'i');
	return re.test(String(text || ''));
}

export function searchUrl(q, limit) {
	const u = new URL(`${APPVIEW}${SEARCH_PATH}`);
	u.searchParams.set('q', q);
	u.searchParams.set('limit', String(Math.max(1, Math.min(PAGE_MAX, limit))));
	u.searchParams.set('sort', 'latest');
	return u.toString();
}

function toPost(p) {
	const text = String(p?.record?.text || '').trim().slice(0, 2000);
	const ts = p?.record?.createdAt || p?.indexedAt;
	const at = Date.parse(ts);
	return {
		id: p?.uri ? String(p.uri) : undefined,
		ts: Number.isFinite(at) ? new Date(at).toISOString() : undefined,
		text,
		author: p?.author?.handle ? String(p.author.handle) : undefined,
		_at: Number.isFinite(at) ? at : 0,
	};
}

async function search(q, limit) {
	const body = await fetchUpstreamJson(
		searchUrl(q, limit),
		{ headers: { accept: 'application/json' } },
		{ name: 'bluesky:search', timeoutMs: TIMEOUT_MS, attempts: 2 },
	);
	return Array.isArray(body?.posts) ? body.posts : [];
}

/**
 * Recent Bluesky posts about a token, newest first, de-duplicated by post uri.
 *
 * @param {string} mint
 * @param {{ symbol?: string|null, limit?: number }} [opts]
 * @returns {Promise<{ posts: object[], queries: string[], stale?: true } | { error: string, queries: string[] }>}
 */
export async function fetchBlueskyTokenPosts(mint, { symbol = null, limit = 100 } = {}) {
	const sym = searchableSymbol(symbol);
	const queries = sym ? [mint, `$${sym}`] : [mint];
	const cap = Math.max(1, Math.min(200, Math.floor(limit) || 1));
	const key = `bsky:token:${mint}:${sym || ''}:${cap}`;
	try {
		const { value, stale } = await cacheWrapLastGood(
			key,
			LIVE_TTL_S,
			async () => {
				const reads = await Promise.allSettled(sym ? [search(mint, cap), search(sym, PAGE_MAX)] : [search(mint, cap)]);
				// One query answering is enough to report what Bluesky says; every
				// query failing is an outage.
				if (reads.every((r) => r.status === 'rejected')) throw reads[0].reason;
				const byMint = reads[0].status === 'fulfilled' ? reads[0].value : [];
				const byTag = reads[1]?.status === 'fulfilled' ? reads[1].value.filter((p) => mentionsCashtag(p?.record?.text, sym)) : [];
				const seen = new Set();
				return [...byMint, ...byTag]
					.map(toPost)
					.filter((p) => p.text && !(p.id && seen.has(p.id)) && (p.id ? seen.add(p.id) : true))
					.sort((a, b) => b._at - a._at)
					.slice(0, cap)
					.map(({ _at, ...post }) => post);
			},
			{ staleTtlSeconds: LKG_TTL_S, withMeta: true },
		);
		return stale ? { posts: value, queries, stale: true } : { posts: value, queries };
	} catch (err) {
		return { error: err?.message || 'Bluesky search unreachable', queries };
	}
}
