// /api/agents/:id/solana
// GET    — return the agent's Solana address + SOL balance (owner only).
// POST   — provision a Solana wallet for this agent if it doesn't have one.
//          Idempotent: returns the existing address if already provisioned.
//
// The encrypted secret never leaves the server. Signing is done by the
// pump.fun action endpoints in api/agents/pumpfun/*.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { generateSolanaAgentWallet } from '../_lib/agent-wallet.js';
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
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

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

	let meta = { ...(row.meta || {}) };

	if (req.method === 'POST' && !meta.solana_address) {
		const sol = await generateSolanaAgentWallet();
		meta = { ...meta, solana_address: sol.address, encrypted_solana_secret: sol.encrypted_secret };
		await sql`
			UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}
		`;
	}

	if (!meta.solana_address) {
		return error(res, 404, 'not_found', 'agent has no solana wallet — POST to provision');
	}

	const network = (req.query?.network || new URL(req.url, 'http://x').searchParams.get('network') || 'mainnet').toString();
	let lamports = null;
	try {
		const conn = solanaConnection(network === 'devnet' ? 'devnet' : 'mainnet');
		lamports = await conn.getBalance(new PublicKey(meta.solana_address));
	} catch (err) {
		console.error('[agents/solana] balance fetch failed', err);
	}

	return json(res, 200, {
		data: {
			address: meta.solana_address,
			network,
			lamports,
			sol: lamports == null ? null : lamports / 1e9,
		},
	});
}
