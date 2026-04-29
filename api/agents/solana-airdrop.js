// /api/agents/:id/solana/airdrop  (POST, devnet only)
//
// Owner-only. Requests a 1 SOL devnet airdrop to the agent's wallet.
// Mainnet rejected — there's no mainnet faucet.
// Heavily rate-limited to avoid faucet abuse.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { solanaConnection } from '../_lib/agent-pumpfun.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { recordEvent } from '../_lib/usage.js';

const AIRDROP_LAMPORTS = LAMPORTS_PER_SOL; // 1 SOL

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default async function handler(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

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

	let signature;
	try {
		const conn = solanaConnection('devnet');
		signature = await conn.requestAirdrop(new PublicKey(address), AIRDROP_LAMPORTS);
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		console.error('[agents/solana-airdrop] failed', err);
		// Devnet faucet often runs dry — surface as 502 not 500.
		return error(res, 502, 'faucet_unavailable',
			err?.message?.includes('429') || err?.message?.includes('limit')
				? 'Devnet faucet is rate-limited — try again in a minute.'
				: `Devnet airdrop failed: ${err?.message || 'unknown'}`);
	}

	recordEvent({
		userId: auth.userId,
		agentId: id,
		kind: 'solana_airdrop',
		tool: 'devnet',
		status: 'ok',
		meta: { address, signature, lamports: AIRDROP_LAMPORTS },
	});

	return json(res, 200, {
		data: {
			signature,
			address,
			network: 'devnet',
			lamports: AIRDROP_LAMPORTS,
			sol: AIRDROP_LAMPORTS / 1e9,
		},
	});
}
