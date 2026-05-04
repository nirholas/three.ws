import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { json, error, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';

const BIRDEYE_API_KEY = env.BIRDEYE_API_KEY;

async function fetchWithCache(url, options, ttl = 60) {
	// A real implementation would use Redis or a similar external cache
	// For now, this is a placeholder
	const resp = await fetch(url, options);
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`API error (${resp.status}): ${text}`);
	}
	return resp.json();
}

export default wrap(async (req, res) => {
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized');

	const agentId = new URL(req.url, 'http://x').searchParams.get('agent_id');
	if (!agentId) return error(res, 400, 'missing agent_id');

	const [agent] = await sql`
		SELECT meta FROM agent_identities
		WHERE id = ${agentId} AND user_id = ${user.id} AND deleted_at IS NULL
	`;

	if (!agent) return error(res, 404, 'agent not found');

	const tokenMint = agent.meta?.token?.mint;
	if (!tokenMint) return error(res, 404, 'token not launched for this agent');

	const headers = { 'X-API-KEY': BIRDEYE_API_KEY };

	try {
		const [price, history] = await Promise.all([
			fetchWithCache(`https://public-api.birdeye.so/defi/price?address=${tokenMint}`, { headers }),
			fetchWithCache(`https://public-api.birdeye.so/defi/txs/latest?address=${tokenMint}`, { headers })
		]);

		return json(res, 200, {
			price: price.data,
			history: history.data.items,
		});

	} catch (e) {
		console.error(`[pump-dashboard] Error fetching token data for ${tokenMint}:`, e);
		return error(res, 502, 'bad_gateway', 'Failed to fetch on-chain data');
	}
});
