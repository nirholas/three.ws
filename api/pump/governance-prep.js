// POST /api/pump/governance-prep
//
// Builds an unsigned `updateBuybackBps` ix for the agent owner. Frontend signs
// + submits with the agent authority wallet. Reputation-tied governance hook:
// admins can also drive this from server via PUMP_GOVERNANCE_RELAYER_KEY (off
// by default) when an agent's reputation drops below threshold — we expose
// that path as POST /api/admin/pump/governance instead, separately.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import {
	getPumpAgentOffline,
	buildUnsignedTxBase64,
	solanaPubkey,
} from '../_lib/pump.js';

const bodySchema = z.object({
	mint: z.string().min(32).max(44),
	authority_wallet: z.string().min(32).max(44),
	new_buyback_bps: z.number().int().min(0).max(10_000),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const authority = solanaPubkey(body.authority_wallet);
	if (!authority) return error(res, 400, 'validation_error', 'invalid authority_wallet');

	const [row] = await sql`
		select id, user_id, agent_authority from pump_agent_mints
		where mint=${body.mint} and network=${body.network} limit 1
	`;
	if (!row) return error(res, 404, 'not_found', 'agent mint not registered');
	if (row.user_id !== user.id) return error(res, 403, 'forbidden', 'not your agent');
	if (row.agent_authority && row.agent_authority !== body.authority_wallet) {
		return error(res, 403, 'forbidden', 'authority does not match');
	}

	const { offline } = await getPumpAgentOffline({ network: body.network, mint: body.mint });
	const ix = await offline.updateBuybackBps(
		{ authority, buybackBps: body.new_buyback_bps },
		{}, // UpdateBuybackBpsOptions — empty default
	);

	const txBase64 = await buildUnsignedTxBase64({
		network: body.network,
		payer: authority,
		instructions: [ix],
	});

	return json(res, 201, {
		mint: body.mint,
		network: body.network,
		new_buyback_bps: body.new_buyback_bps,
		tx_base64: txBase64,
		instructions:
			'Sign with the agent authority wallet, submit, then optionally PATCH the local row via /api/agents/:id to refresh display.',
	});
});
