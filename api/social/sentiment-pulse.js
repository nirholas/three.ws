// POST /api/social/sentiment-pulse
//
// One-call sentiment pulse for a Solana token. Pulls the coin's live community
// commentary from two keyless sources, pump.fun callouts and Bluesky posts,
// and scores it with the in-repo lexicon scorer. Optionally accepts a list of
// additional text snippets to fold into the score (e.g. X posts the caller has
// already collected).
//
// Sources:
//   - pump.fun callouts, the feed the coin page renders via frontend-api-v3
//     `/callout/coin/:mint` (the older `/replies/:mint` and `/callout/top/:mint`
//     routes are gone), read through api/_lib/pump-callouts.js. Since
//     2026-11-21 pump.fun answers this route with 403 "Client not allowed" to
//     server-side callers; the read is kept so the pulse recovers by itself if
//     that changes, and its last-known-good copy is still served when present.
//   - Bluesky post search (api/_lib/bluesky-search.js): posts containing the
//     mint, plus posts writing the exact `$SYMBOL` cashtag. The ticker comes
//     from the request body or, when absent, from DexScreener's keyless token
//     read; without one only the mint is searched.
//
// This is the unauthenticated, no-key endpoint behind the paid
// `sentiment_pulse` MCP tool. Callers who already have the texts should hit
// /api/social/sentiment instead.
//
// Body:
//   {
//     token:       string,     // Solana SPL or pump.fun mint pubkey
//     symbol?:     string,     // the coin's ticker; looked up when omitted
//     limit?:      number,     // max posts per source (default 100, max 200;
//                              // pump.fun serves at most 100 per read)
//     extraTexts?: string[],   // additional snippets to score
//   }
//
// Response:
//   {
//     ok: true,
//     token,
//     overall: { score, posPct, negPct, neuPct, count, examples },
//     breakdown: { pumpfun: <result>, bluesky: <result>, extra: <result> },
//     sources: {
//       pumpfun, pumpfunStatus, pumpfunCount,
//       blueskyStatus, blueskyCount, blueskyQueries,
//       extraCount,
//     },
//     fetchedAt
//   }
//
// Each status is 'ok', 'stale' (a last-known-good copy) or 'unavailable'. When
// every live source is unavailable and the caller supplied nothing, the pulse
// answers 502 `upstream_unavailable`, never a fabricated neutral score. A coin
// that is simply quiet (sources up, zero posts) still answers 200 with
// `count: 0`, because an empty feed is data, not an outage.

import { z } from 'zod';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { calloutsToPosts, fetchPumpFunCallouts } from '../_lib/pump-callouts.js';
import { fetchBlueskyTokenPosts } from '../_lib/bluesky-search.js';
import { fetchTokenMarket } from '../_lib/token-market.js';

const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const bodySchema = z.object({
	token: z.string().regex(SOLANA_MINT_RE, 'token must be a base58 Solana mint pubkey'),
	symbol: z.string().trim().max(20).optional(),
	limit: z.number().int().min(1).max(200).optional(),
	extraTexts: z.array(z.string().max(2000)).max(200).optional(),
});

export { calloutsToPosts };

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let raw;
	try {
		raw = await readJson(req);
	} catch {
		return error(res, 400, 'validation_error', 'invalid json');
	}
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return error(res, 400, 'validation_error', parsed.error.issues[0]?.message ?? 'invalid body');
	}
	const { token, symbol, limit = 100, extraTexts = [] } = parsed.data;

	const { scoreSentiment } = await import('../../src/social/sentiment.js');

	const [pumpfun, bluesky] = await Promise.all([
		fetchPumpFunCallouts(token, limit),
		resolveSymbol(token, symbol).then((sym) => fetchBlueskyTokenPosts(token, { symbol: sym, limit })),
	]);
	const pumpfunPosts = pumpfun.error ? [] : pumpfun.posts;
	const blueskyPosts = bluesky.error ? [] : bluesky.posts;
	const extraPosts = extraTexts
		.map((t, i) => ({ id: `extra-${i}`, text: String(t).trim() }))
		.filter((p) => p.text);

	// With every live source down and nothing supplied by the caller there is
	// nothing to score. Scoring the empty set would answer "neutral, 100%" with
	// the same confidence as a real reading, so report the outage.
	if (pumpfun.error && bluesky.error && extraPosts.length === 0) {
		return error(res, 502, 'upstream_unavailable', `pump.fun: ${pumpfun.error}; bluesky: ${bluesky.error}`, {
			token,
			sources: ['pump.fun', 'bluesky'],
		});
	}

	const status = (r) => (r.error ? 'unavailable' : r.stale ? 'stale' : 'ok');
	const overall = scoreSentiment([...pumpfunPosts, ...blueskyPosts, ...extraPosts]);
	const breakdown = {
		pumpfun: pumpfun.error ? { error: pumpfun.error, count: 0 } : scoreSentiment(pumpfunPosts),
		bluesky: bluesky.error ? { error: bluesky.error, count: 0 } : scoreSentiment(blueskyPosts),
		extra: scoreSentiment(extraPosts),
	};

	return json(res, 200, {
		ok: true,
		token,
		overall,
		breakdown,
		sources: {
			pumpfun: pumpfun.error ? null : pumpfun.url,
			pumpfunStatus: status(pumpfun),
			pumpfunCount: pumpfunPosts.length,
			blueskyStatus: status(bluesky),
			blueskyCount: blueskyPosts.length,
			blueskyQueries: bluesky.queries,
			extraCount: extraPosts.length,
		},
		fetchedAt: new Date().toISOString(),
	});
});

// The caller's ticker when given, otherwise DexScreener's (keyless, cached with
// a last-known-good copy). A failed lookup only narrows Bluesky to the mint
// query, so it resolves to null instead of failing the pulse.
async function resolveSymbol(token, symbol) {
	if (symbol) return symbol;
	const market = await fetchTokenMarket(token, { chain: 'solana', security: false }).catch(() => null);
	return market?.symbol || null;
}
