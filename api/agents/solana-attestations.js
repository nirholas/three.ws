/**
 * GET /api/agents/solana-attestations?asset=<pubkey>&kind=feedback|validation|task|accept|revoke|dispute|all&network=devnet|mainnet
 *
 * Reads three.ws ERC-8004-style attestations about a Solana agent from the
 * indexer cache. Falls back to a live RPC crawl + upsert when the cache is
 * cold for a given agent (first read warms it).
 *
 * Schema discovery: /.well-known/agent-attestation-schemas
 */

import { sql } from '../_lib/db.js';
import { PublicKey } from '@solana/web3.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { KIND_MAP, crawlAgentAttestations } from '../_lib/solana-attestations.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url     = new URL(req.url, `http://${req.headers.host}`);
	const asset   = url.searchParams.get('asset');
	const kindArg = url.searchParams.get('kind') || 'all';
	const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'devnet';
	const limit   = Math.min(Number(url.searchParams.get('limit') || 100), 500);
	const includeRevoked = url.searchParams.get('include_revoked') === '1';

	if (!asset) return error(res, 400, 'validation_error', 'asset query param required');
	try { new PublicKey(asset); }
	catch { return error(res, 400, 'validation_error', 'invalid asset pubkey'); }

	const wantKind = kindArg === 'all' ? null : KIND_MAP[kindArg];
	if (kindArg !== 'all' && !wantKind) {
		return error(res, 400, 'validation_error',
			'kind must be one of: feedback, validation, task, accept, revoke, dispute, all');
	}

	// Cold-cache warm-up: if this agent has never been crawled, do it inline once.
	const [cursor] = await sql`
		select last_indexed_at from solana_attestations_cursor where agent_asset = ${asset} limit 1
	`;
	if (!cursor) {
		const [agent] = await sql`
			select wallet_address as owner from agent_identities
			where meta->>'sol_mint_address' = ${asset} and deleted_at is null
			limit 1
		`;
		try {
			await crawlAgentAttestations({
				agentAsset: asset, network,
				ownerWallet: agent?.owner || null,
			});
		} catch (e) {
			// don't fail the read; cache will be empty until cron runs
		}
	}

	const rows = wantKind
		? await sql`
			select signature, slot, block_time, attester, kind, payload,
				   verified, revoked, disputed
			from solana_attestations
			where agent_asset = ${asset} and network = ${network} and kind = ${wantKind}
			  and (${includeRevoked} or revoked = false)
			order by slot desc
			limit ${limit}
		`
		: await sql`
			select signature, slot, block_time, attester, kind, payload,
				   verified, revoked, disputed
			from solana_attestations
			where agent_asset = ${asset} and network = ${network}
			  and (${includeRevoked} or revoked = false)
			order by slot desc
			limit ${limit}
		`;

	return json(res, 200, {
		data: rows,
		agent: asset,
		network,
		kind: kindArg,
		count: rows.length,
		last_indexed_at: cursor?.last_indexed_at || null,
	});
});
