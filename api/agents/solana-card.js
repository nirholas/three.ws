/**
 * GET /api/agents/solana-card?asset=<pubkey>
 *
 * A2A-compatible agent discovery card for a Solana-registered agent.
 * Same role as ERC-8004's agent manifest: any third-party agent can fetch
 * this URL, learn the agent's identity + skills + how to attest about it.
 *
 * Also served at /a/sol/<asset>/.well-known/agent-card.json (see vercel.json).
 */

import { sql } from '../_lib/db.js';
import { PublicKey } from '@solana/web3.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { env } from '../_lib/env.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, `http://${req.headers.host}`);
	const asset = url.searchParams.get('asset');
	if (!asset) return error(res, 400, 'validation_error', 'asset required');
	try { new PublicKey(asset); }
	catch { return error(res, 400, 'validation_error', 'invalid asset pubkey'); }

	const [a] = await sql`
		select id, name, description, skills, wallet_address as owner, meta, avatar_id
		from agent_identities
		where meta->>'sol_mint_address' = ${asset} and deleted_at is null limit 1
	`;
	if (!a) return error(res, 404, 'not_found', 'agent not found');

	const network = a.meta?.network || 'mainnet';
	const origin  = env.APP_ORIGIN;

	// Pump.fun off-chain signals — most-recent + per-kind counts. Best-effort:
	// the table is optional and may not exist in every deployment.
	let pumpfun = null;
	try {
		const rows = await sql`
			select kind, count(*)::int as n, max(seen_at) as last_seen
			from pumpfun_signals
			where agent_asset = ${asset}
			group by kind
		`;
		if (rows.length > 0) {
			const byKind = {};
			let total = 0;
			let last = null;
			for (const r of rows) {
				byKind[r.kind] = { count: r.n, last_seen: r.last_seen };
				total += r.n;
				if (!last || (r.last_seen && r.last_seen > last)) last = r.last_seen;
			}
			pumpfun = {
				signal_count: total,
				by_kind: byKind,
				last_seen: last,
				feed_url: `${origin}/api/agents/pumpfun-feed`,
			};
		}
	} catch {
		// pumpfun_signals table not present — omit the block entirely.
	}

	return json(res, 200, {
		schema_version: '1.0',
		// A2A core
		name:        a.name,
		description: a.description,
		// three.ws extensions
		identity: {
			chain:        'solana',
			network,
			asset_pubkey: asset,                 // Metaplex Core NFT = agent ID
			owner:        a.owner,
			passport_url: `${origin}/agent-passport.html?asset=${asset}&network=${network}`,
		},
		skills: a.skills || [],
		endpoints: {
			chat:        `${origin}/api/agents/${a.id}/chat`,
			attestations: `${origin}/api/agents/solana-attestations?asset=${asset}&network=${network}`,
			reputation:  `${origin}/api/agents/solana-reputation?asset=${asset}&network=${network}`,
		},
		attestation: {
			schemas_url: `${origin}/.well-known/agent-attestation-schemas`,
			transport:   'spl-memo',
			memo_program: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
			usage: 'Sign an SPL Memo tx with one of the published schemas as JSON, including this asset_pubkey as a non-signer key.',
		},
		...(pumpfun ? { pumpfun } : {}),
	}, { 'cache-control': 'public, max-age=120', 'access-control-allow-origin': '*' });
});
