/**
 * GET /api/agents/wallet-embed?id=<agentId>[&network=mainnet]
 *
 * The public, cross-origin wallet card that powers the agent's wallet wherever
 * its avatar appears OFF three.ws — the `<agent-3d wallet>` web component on a
 * stranger's blog, the avatar SDK viewer, an IRL/AR card, the walk world, the
 * chat app. It is served `Access-Control-Allow-Origin: *` (no credentials) so
 * any embedding origin can read it, and it exposes ONLY public data:
 *
 *   • the agent's public custodial Solana receive address (+ vanity pattern)
 *   • its live balance: total USD, native SOL, and the $THREE / USDC breakdown
 *   • lifetime tips received (count + USD) — the real, screenshot-worthy headline
 *   • name, avatar thumbnail, and the canonical three.ws deep links (open / tip)
 *
 * It never returns a secret key, an owner-only field, or anything that could
 * move funds — an embed is the visitor view by construction. Role (owner vs
 * visitor) is NEVER asserted by the embedding host; it is derived only from a
 * real three.ws session on three.ws itself, so this endpoint has no concept of
 * ownership at all.
 *
 * Rate-limited per IP (`walletEmbedIp`) and short-TTL cached so the open
 * endpoint can't be turned into a balance-scraping relay. The Solana balance
 * read reuses the same cached `getBalances` path the in-app chip uses, so an
 * embed and the profile page never disagree on a number.
 */

import { sql } from '../_lib/db.js';
import { cors, wrap, json, method, error, rateLimited } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { isUuid } from '../_lib/validate.js';
import { thumbnailUrl } from '../_lib/r2.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getBalances, walletUsdTotal } from '../_lib/balances.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// CDN-readable for embed crawlers; short browser cache, longer at the edge.
const CACHE = 'public, max-age=30, s-maxage=120, stale-while-revalidate=60';

// Through the /cdn/<key> proxy, which reads R2 and the GCS fallback bucket
// alike; the bucket's raw domain serves only objects that live in R2.
function avatarThumbnailUrl(thumbKey, visibility) {
	if (visibility !== 'public' && visibility !== 'unlisted') return null;
	return thumbnailUrl(thumbKey);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.walletEmbedIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://x');
	const id = (url.searchParams.get('id') || '').trim();
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	if (!isUuid(id)) return error(res, 400, 'bad_request', 'id must be an agent UUID');

	let row;
	try {
		[row] = await sql`
			SELECT i.id, i.name, i.meta,
			       a.thumbnail_key, a.visibility
			FROM agent_identities i
			LEFT JOIN avatars a ON a.id = i.avatar_id AND a.deleted_at IS NULL
			WHERE i.id = ${id} AND i.deleted_at IS NULL
			LIMIT 1
		`;
	} catch {
		return error(res, 503, 'unavailable', 'could not read the agent right now — try again');
	}
	if (!row) return error(res, 404, 'not_found', 'agent not found');

	const meta = row.meta || {};
	const address = meta.solana_address || null;
	const origin = env.APP_ORIGIN || 'https://three.ws';

	// No wallet yet — still a real, honest response so the embed can render a
	// clean "wallet provisioning" identity rather than a broken widget.
	if (!address || !BASE58_RE.test(String(address))) {
		res.setHeader('cache-control', CACHE);
		return json(res, 200, {
			data: {
				agentId: id,
				name: row.name || null,
				avatar: avatarThumbnailUrl(row.thumbnail_key, row.visibility),
				address: null,
				network,
				openUrl: `${origin}/agent/${id}`,
			},
		});
	}

	// Live balance via the shared cached path (Helius DAS → public RPC fallback),
	// plus lifetime tips from the durable custody ledger. Both tolerate failure:
	// a balance read error yields nulls (the embed shows the address without a
	// value) rather than a 5xx, honoring "no broken widget".
	let balanceUsd = null, sol = null, three = null, usdc = null;
	try {
		const balances = await getBalances({ chain: 'solana', address });
		if (balances) {
			balanceUsd = walletUsdTotal(balances);
			sol = balances.native?.amount ?? null;
			for (const t of balances.tokens || []) {
				if (t.mint === THREE_MINT) three = t.amount;
				else if (t.mint === USDC_MINT) usdc = t.amount;
			}
		}
	} catch {
		/* balance unavailable — render identity-only, never a 5xx */
	}

	let tipsCount = 0, tipsUsd = 0;
	try {
		const [agg] = await sql`
			SELECT COUNT(*)::int AS n, COALESCE(SUM(usd), 0)::float8 AS usd
			FROM agent_custody_events
			WHERE agent_id = ${id} AND event_type = 'tip' AND status = 'confirmed'
		`;
		tipsCount = agg?.n ?? 0;
		tipsUsd = agg?.usd ?? 0;
	} catch {
		/* tip ledger unavailable — omit the headline stat, keep the card */
	}

	const prefix = meta.solana_vanity_prefix || null;
	const suffix = meta.solana_vanity_suffix || null;

	res.setHeader('cache-control', CACHE);
	return json(res, 200, {
		data: {
			agentId: id,
			name: row.name || null,
			avatar: avatarThumbnailUrl(row.thumbnail_key, row.visibility),
			address: String(address),
			vanity: prefix || suffix ? { prefix, suffix } : null,
			network,
			balanceUsd,
			sol,
			three,
			usdc,
			tips: { count: tipsCount, usd: tipsUsd },
			explorerUrl: `https://solscan.io/account/${address}`,
			openUrl: `${origin}/agent/${id}`,
			walletUrl: `${origin}/agent/${id}/wallet`,
			tipUrl: `${origin}/agent/${id}/wallet#tip`,
		},
	});
});
