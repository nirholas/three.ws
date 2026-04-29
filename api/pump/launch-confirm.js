// POST /api/pump/launch-confirm
// Verifies the launch tx landed and persists the pump_agent_mints row.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { verifySignature } from '../_lib/pump.js';

const bodySchema = z.object({
	prep_id: z.string().min(8),
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

	const [pending] = await sql`
		select id, payload from agent_registrations_pending
		where user_id=${user.id} and payload->>'prep_id'=${body.prep_id}
		  and expires_at > now()
		order by created_at desc limit 1
	`;
	if (!pending) return error(res, 404, 'not_found', 'prep not found or expired');
	const p = pending.payload;
	if (p.kind !== 'pump_launch') return error(res, 400, 'wrong_kind', 'prep is not a pump launch');

	let tx;
	try {
		tx = await verifySignature({ network: p.network, signature: body.tx_signature });
	} catch (e) {
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}
	const accountKeys = tx.transaction.message.accountKeys.map((k) =>
		(k.pubkey || k).toString(),
	);
	if (!accountKeys.includes(p.mint)) {
		return error(res, 422, 'mint_not_in_tx', 'mint pubkey not present in tx');
	}

	const [existing] = await sql`
		select id from pump_agent_mints where mint=${p.mint} and network=${p.network} limit 1
	`;
	if (existing) return error(res, 409, 'conflict', 'mint already registered');

	const [row] = await sql`
		insert into pump_agent_mints
			(agent_id, user_id, network, mint, name, symbol, agent_authority, buyback_bps)
		values
			(${p.agent_id}, ${user.id}, ${p.network}, ${p.mint},
			 ${p.name}, ${p.symbol}, ${p.wallet_address}, ${p.buyback_bps})
		returning id, mint, network, buyback_bps, created_at
	`;

	await sql`delete from agent_registrations_pending where id=${pending.id}`;

	return json(res, 201, {
		ok: true,
		pump_agent_mint: row,
		tx_signature: body.tx_signature,
	});
});
