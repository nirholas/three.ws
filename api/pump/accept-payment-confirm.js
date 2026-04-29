// POST /api/pump/accept-payment-confirm
// Verify the acceptPayment tx landed; mark the payment row confirmed.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { verifySignature } from '../_lib/pump.js';

const bodySchema = z.object({
	payment_id: z.string().uuid(),
	tx_signature: z.string().min(80).max(100),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'auth required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const [payment] = await sql`
		select p.*, m.mint, m.network from pump_agent_payments p
		join pump_agent_mints m on m.id = p.mint_id
		where p.id=${body.payment_id} limit 1
	`;
	if (!payment) return error(res, 404, 'not_found', 'payment not found');
	if (payment.status === 'confirmed')
		return error(res, 409, 'already_confirmed', 'payment already confirmed');

	let tx;
	try {
		tx = await verifySignature({ network: payment.network, signature: body.tx_signature });
	} catch (e) {
		await sql`update pump_agent_payments set status='failed' where id=${payment.id}`;
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}

	const accountKeys = tx.transaction.message.accountKeys.map((k) =>
		(k.pubkey || k).toString(),
	);
	if (!accountKeys.includes(payment.mint)) {
		return error(res, 422, 'mint_not_in_tx', 'agent mint not in tx accounts');
	}

	await sql`
		update pump_agent_payments
		set status='confirmed', tx_signature=${body.tx_signature}, confirmed_at=now()
		where id=${payment.id}
	`;

	return json(res, 200, {
		ok: true,
		payment_id: payment.id,
		invoice_id: payment.invoice_id,
		tx_signature: body.tx_signature,
	});
});
