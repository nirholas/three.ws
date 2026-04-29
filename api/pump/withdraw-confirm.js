// POST /api/pump/withdraw-confirm
// Verify the withdraw tx landed and acknowledge it. Symmetric with
// accept-payment-confirm / launch-confirm. The on-chain tx is the canonical
// receipt — we do not persist a row, only verify ownership + tx success.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { verifySignature } from '../_lib/pump.js';

const bodySchema = z.object({
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	tx_signature: z.string().min(80).max(100),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	const [row] = await sql`
		select id, mint, user_id, agent_authority, network from pump_agent_mints
		where mint=${body.mint} and network=${body.network} limit 1
	`;
	if (!row) return error(res, 404, 'not_found', 'agent mint not registered');
	if (row.user_id !== user.id) return error(res, 403, 'forbidden', 'not your agent');

	let tx;
	try {
		tx = await verifySignature({ network: body.network, signature: body.tx_signature });
	} catch (e) {
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}

	const accountKeys = tx.transaction.message.accountKeys.map((k) =>
		(k.pubkey || k).toString(),
	);
	if (!accountKeys.includes(body.mint)) {
		return error(res, 422, 'mint_not_in_tx', 'mint not present in tx accounts');
	}
	if (row.agent_authority && !accountKeys.includes(row.agent_authority)) {
		return error(res, 422, 'authority_not_in_tx', 'agent authority not present in tx');
	}

	return json(res, 200, {
		ok: true,
		mint: body.mint,
		network: body.network,
		tx_signature: body.tx_signature,
		slot: tx.slot ?? null,
		block_time: tx.blockTime ?? null,
	});
});
