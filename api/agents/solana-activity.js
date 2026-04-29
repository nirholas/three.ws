// /api/agents/:id/solana/activity?network=mainnet|devnet&limit=20
//
// Returns recent on-chain activity for the agent's Solana wallet:
//   • signatures (most-recent first), with slot, blockTime, success/failure,
//     SOL delta from this address's perspective, and a short description.
// Owner-only.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { solanaConnection } from '../_lib/agent-pumpfun.js';
import { PublicKey } from '@solana/web3.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default async function handler(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [row] = await sql`
		SELECT id, user_id, meta FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const address = row.meta?.solana_address;
	if (!address) return error(res, 404, 'not_found', 'agent has no solana wallet');

	const url = new URL(req.url, 'http://x');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);

	let signatures = [];
	try {
		const conn = solanaConnection(network);
		const pk = new PublicKey(address);
		const sigs = await conn.getSignaturesForAddress(pk, { limit });

		// Fetch parsed details in batches to compute SOL deltas.
		const parsed = await conn.getParsedTransactions(
			sigs.map((s) => s.signature),
			{ maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
		);

		signatures = sigs.map((s, i) => {
			const tx = parsed[i];
			let lamportDelta = null;
			let summary = null;
			if (tx?.meta && tx?.transaction) {
				const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey?.toString());
				const idx = keys.indexOf(address);
				if (idx >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
					lamportDelta = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
				}
				const ix = tx.transaction.message.instructions?.[0];
				if (ix?.parsed?.type) summary = ix.parsed.type;
				else if (ix?.programId) summary = `program ${ix.programId.toString().slice(0, 6)}…`;
			}
			return {
				signature: s.signature,
				slot: s.slot,
				block_time: s.blockTime ?? null,
				success: !s.err && !tx?.meta?.err,
				error: s.err || tx?.meta?.err || null,
				lamport_delta: lamportDelta,
				sol_delta: lamportDelta == null ? null : lamportDelta / 1e9,
				summary,
			};
		});
	} catch (err) {
		console.error('[agents/solana-activity] RPC fetch failed', err);
		return error(res, 502, 'rpc_error', 'failed to fetch on-chain activity');
	}

	return json(res, 200, {
		data: {
			address,
			network,
			signatures,
		},
	});
}
