/**
 * GET /api/explore — paginated directory of every ERC-8004 agent we've indexed.
 *
 * Query params:
 *   only3d=1       — only rows where has_3d = true
 *   chain=<id>     — filter by chainId
 *   q=<text>       — name/description substring
 *   cursor=<iso>   — registered_at ISO string for pagination (older rows)
 *   limit=<int>    — page size, default 24, max 60
 */

import { sql } from './_lib/db.js';
import { cors, json, method, wrap, error } from './_lib/http.js';
import { CHAIN_BY_ID, tokenExplorerUrl, addressExplorerUrl } from './_lib/erc8004-chains.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const only3d = url.searchParams.get('only3d') === '1';
	const chainId = parseInt(url.searchParams.get('chain') || '', 10);
	const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
	const cursor = url.searchParams.get('cursor');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '24', 10), 1), 60);

	const cursorDate = cursor ? new Date(cursor) : null;
	if (cursor && isNaN(cursorDate?.getTime())) {
		return error(res, 400, 'validation_error', 'cursor must be an ISO date');
	}

	// Filter construction via template fragments kept inline because Neon's
	// tagged-template driver doesn't compose them the way pg.Client does; a
	// single query with optional predicates guarded by nulls is clearer.
	const rows = await sql`
		SELECT chain_id, agent_id, owner, name, description, image, glb_url,
		       has_3d, x402_support, registered_at, registered_tx,
		       services, agent_uri
		FROM erc8004_agents_index
		WHERE active = true
		  AND (${only3d ? true : null}::boolean IS NULL OR has_3d = true)
		  AND (${Number.isFinite(chainId) ? chainId : null}::integer IS NULL OR chain_id = ${Number.isFinite(chainId) ? chainId : null})
		  AND (${q || null}::text IS NULL OR (
		       coalesce(name,'') ILIKE ${'%' + q + '%'}
		    OR coalesce(description,'') ILIKE ${'%' + q + '%'}
		  ))
		  AND (${cursorDate ? cursorDate.toISOString() : null}::timestamptz IS NULL OR registered_at < ${cursorDate ? cursorDate.toISOString() : null}::timestamptz)
		ORDER BY registered_at DESC NULLS LAST
		LIMIT ${limit + 1}
	`;

	const hasMore = rows.length > limit;
	const page = rows.slice(0, limit);

	const items = page.map((r) => {
		const chain = CHAIN_BY_ID[r.chain_id];
		return {
			chainId: r.chain_id,
			chainName: chain?.name || `Chain ${r.chain_id}`,
			chainShortName: chain?.name || `#${r.chain_id}`,
			agentId: r.agent_id,
			owner: r.owner,
			ownerShort: shortAddr(r.owner),
			name: r.name || `Agent #${r.agent_id}`,
			description: r.description || '',
			image: r.image || null,
			glbUrl: r.glb_url || null,
			has3d: r.has_3d,
			x402Support: r.x402_support,
			registeredAt: r.registered_at,
			tokenExplorerUrl: tokenExplorerUrl(r.chain_id, r.agent_id),
			ownerExplorerUrl: addressExplorerUrl(r.chain_id, r.owner),
			viewerUrl: r.glb_url
				? `/#model=${encodeURIComponent(r.glb_url)}`
				: null,
			services: (r.services || []).map((s) => ({
				name: s?.name || null,
				endpoint: s?.endpoint || null,
				version: s?.version || null,
			})),
		};
	});

	const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].registered_at : null;

	// Totals (cheap: single bool-filtered count).
	const [{ total }] = await sql`
		SELECT count(*)::text as total FROM erc8004_agents_index WHERE active = true
	`;
	const [{ total3d }] = await sql`
		SELECT count(*)::text as total3d FROM erc8004_agents_index WHERE active = true AND has_3d = true
	`;

	return json(res, 200, {
		items,
		nextCursor,
		totals: { all: Number(total), threeD: Number(total3d) },
	});
});

function shortAddr(a) {
	if (!a || a.length < 10) return a || '';
	return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
