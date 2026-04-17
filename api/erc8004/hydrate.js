/**
 * GET /api/erc8004/hydrate
 * Fetch all on-chain agents owned by the user's linked wallets.
 * Returns list of discovered agents with alreadyImported flag.
 */

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	// Get user's linked wallets.
	const wallets = await sql`
		SELECT address FROM user_wallets
		WHERE user_id = ${session.id}
	`;

	if (wallets.length === 0) {
		return json(res, 200, { agents: [] });
	}

	const walletAddresses = wallets.map((w) => w.address.toLowerCase());

	// Query erc8004_agents_index for agents owned by these wallets.
	const indexRows = await sql`
		SELECT chain_id, agent_id, owner, name, description, image, glb_url
		FROM erc8004_agents_index
		WHERE lower(owner) = ANY(${walletAddresses})
		AND active = true
		ORDER BY registered_at DESC NULLS LAST
	`;

	// For each index row, check if already imported by this user.
	const agents = [];
	for (const row of indexRows) {
		const [imported] = await sql`
			SELECT id FROM agent_identities
			WHERE user_id = ${session.id}
			  AND erc8004_agent_id = ${BigInt(row.agent_id)}
			  AND chain_id = ${row.chain_id}
			  AND deleted_at IS NULL
		`;

		agents.push({
			chainId: row.chain_id,
			agentId: row.agent_id,
			name: row.name || `Agent #${row.agent_id}`,
			description: row.description || '',
			image: row.image || null,
			glbUrl: row.glb_url || null,
			owner: row.owner,
			alreadyImported: !!imported,
		});
	}

	return json(res, 200, { agents });
});
