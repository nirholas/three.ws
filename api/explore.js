/**
 * GET /api/explore — paginated directory of ERC-8004 agents + public avatars.
 *
 * Query params:
 *   only3d=1       — only rows where has_3d = true (avatars are always 3D)
 *   chain=<id>     — filter by chainId (excludes public avatars; they're off-chain)
 *   q=<text>       — name/description substring
 *   cursor=<iso>   — created_at/registered_at ISO string for pagination
 *   limit=<int>    — page size, default 24, max 60
 *   source=<all|onchain|avatar> — restrict feed to one source. Default 'all'.
 */

import { sql } from './_lib/db.js';
import { cors, json, method, wrap, error } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { CHAIN_BY_ID, tokenExplorerUrl, addressExplorerUrl } from './_lib/erc8004-chains.js';
import { publicUrl } from './_lib/r2.js';
import { DEMO_AVATARS } from './_lib/demo-avatars.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const only3d = url.searchParams.get('only3d') === '1';
	const chainId = parseInt(url.searchParams.get('chain') || '', 10);
	const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
	const cursor = url.searchParams.get('cursor');
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '24', 10), 1), 60);
	const sourceFilter = url.searchParams.get('source') || 'all';

	const cursorDate = cursor ? new Date(cursor) : null;
	if (cursor && isNaN(cursorDate?.getTime())) {
		return error(res, 400, 'validation_error', 'cursor must be an ISO date');
	}

	// Setting a chainId implicitly excludes avatars (they're off-chain).
	const includeOnchain = sourceFilter !== 'avatar';
	const includeAvatars = sourceFilter !== 'onchain' && !Number.isFinite(chainId);

	// Filter construction via template fragments kept inline because Neon's
	// tagged-template driver doesn't compose them the way pg.Client does; a
	// single query with optional predicates guarded by nulls is clearer.
	const onchainRows = includeOnchain
		? await sql`
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
	`
		: [];

	const avatarRows = includeAvatars
		? await sql`
		SELECT id, slug, name, description, storage_key, thumbnail_key, tags, created_at
		FROM avatars
		WHERE deleted_at IS NULL
		  AND visibility = 'public'
		  AND (${q || null}::text IS NULL OR (
		       coalesce(name,'') ILIKE ${'%' + q + '%'}
		    OR coalesce(description,'') ILIKE ${'%' + q + '%'}
		  ))
		  AND (${cursorDate ? cursorDate.toISOString() : null}::timestamptz IS NULL OR created_at < ${cursorDate ? cursorDate.toISOString() : null}::timestamptz)
		ORDER BY created_at DESC
		LIMIT ${limit + 1}
	`
		: [];

	const onchainItems = onchainRows.map((r) => {
		const chain = CHAIN_BY_ID[r.chain_id];
		return {
			kind: 'onchain',
			sortDate: r.registered_at,
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
			viewerUrl: r.glb_url ? `/#model=${encodeURIComponent(r.glb_url)}` : null,
			services: (r.services || []).map((s) => ({
				name: s?.name || null,
				endpoint: s?.endpoint || null,
				version: s?.version || null,
			})),
		};
	});

	const avatarItems = avatarRows.map((r) => {
		const glb = publicUrl(r.storage_key);
		return {
			kind: 'avatar',
			sortDate: r.created_at,
			avatarId: r.id,
			slug: r.slug,
			name: r.name,
			description: r.description || '',
			image: r.thumbnail_key ? publicUrl(r.thumbnail_key) : null,
			glbUrl: glb,
			has3d: true,
			tags: r.tags || [],
			createdAt: r.created_at,
			viewerUrl: `/#model=${encodeURIComponent(glb)}`,
		};
	});

	// Inject demo avatars on the first page when the source allows avatars.
	// Filter by query if one is set so search still feels correct.
	if (includeAvatars && !cursorDate) {
		const qLower = q.toLowerCase();
		const matching = q
			? DEMO_AVATARS.filter(
					(a) =>
						a.name.toLowerCase().includes(qLower) ||
						a.description.toLowerCase().includes(qLower),
				)
			: DEMO_AVATARS;
		avatarItems.push(...matching);
	}

	// Merge by date desc, but guarantee avatars surface on page 1 so the
	// onchain firehose doesn't drown them. Reserve up to a third of the page
	// for avatars when both sources are present and this is the first page.
	const onchainSorted = [...onchainItems].sort(
		(a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime(),
	);
	const avatarSorted = [...avatarItems].sort(
		(a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime(),
	);

	let merged;
	if (!cursorDate && onchainSorted.length && avatarSorted.length) {
		const avatarQuota = Math.min(avatarSorted.length, Math.max(1, Math.ceil(limit / 3)));
		const avatarHead = avatarSorted.slice(0, avatarQuota);
		const avatarTail = avatarSorted.slice(avatarQuota);
		const rest = [...onchainSorted, ...avatarTail].sort(
			(a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime(),
		);
		merged = [...avatarHead, ...rest];
	} else {
		merged = [...onchainSorted, ...avatarSorted].sort(
			(a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime(),
		);
	}

	const hasMore = merged.length > limit;
	const items = merged.slice(0, limit);
	const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].sortDate : null;

	// Totals (cheap counts; merged feed total = onchain + public avatars).
	const [{ total: onchainTotal }] = await sql`
		SELECT count(*)::text as total FROM erc8004_agents_index WHERE active = true
	`;
	const [{ total3d: onchain3d }] = await sql`
		SELECT count(*)::text as total3d FROM erc8004_agents_index WHERE active = true AND has_3d = true
	`;
	const [{ total: avatarTotal }] = await sql`
		SELECT count(*)::text as total FROM avatars WHERE deleted_at IS NULL AND visibility = 'public'
	`;
	const avatarCount = Number(avatarTotal) + DEMO_AVATARS.length;
	const allTotal = Number(onchainTotal) + avatarCount;
	const threeDTotal = Number(onchain3d) + avatarCount;

	return json(res, 200, {
		items,
		nextCursor,
		totals: {
			all: allTotal,
			threeD: threeDTotal,
			onchain: Number(onchainTotal),
			avatars: avatarCount,
		},
	});
});

function shortAddr(a) {
	if (!a || a.length < 10) return a || '';
	return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
