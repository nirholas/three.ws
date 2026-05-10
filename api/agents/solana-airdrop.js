import { getSessionUser } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, error, json, method, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { recordEvent } from '../_lib/usage.js';
import { solanaConnection } from '../_lib/agent-pumpfun.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('id') || req.query?.id;

	const [row] = await sql`SELECT id, user_id, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== user.id) return error(res, 403, 'forbidden', 'not your agent');

	const address = row.meta?.solana_address;
	if (!address) return error(res, 404, 'not_found', 'agent has no solana wallet');

	let signature;
	try {
		const conn = solanaConnection('devnet');
		signature = await conn.requestAirdrop(new PublicKey(address), LAMPORTS_PER_SOL);
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		return error(res, 502, 'faucet_unavailable', err?.message || 'devnet airdrop failed');
	}

	recordEvent({ userId: user.id, agentId, kind: 'solana_airdrop', tool: 'devnet', status: 'ok', meta: { address, signature } });
	return json(res, 200, { data: { signature, address, network: 'devnet', lamports: LAMPORTS_PER_SOL, sol: 1 } });
});
