// PATCH /api/admin/withdrawals/:id — advance withdrawal status (admin only)
// Allowed transitions: pending → processing, processing → completed | failed

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { requireAdmin } from '../../_lib/admin.js';
import { cors, json, method, wrap, error, readJson } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';
import { insertNotification } from '../../_lib/notify.js';

const TRANSITIONS = {
	pending: ['processing'],
	processing: ['completed', 'failed'],
};

const patchBody = z.object({
	status: z.enum(['processing', 'completed', 'failed']),
	tx_signature: z.string().trim().min(1).max(200).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'PATCH,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['PATCH'])) return;
	if (!(await requireAdmin(req, res))) return;

	const id = req.query?.id;
	const body = parse(patchBody, await readJson(req));
	const { status, tx_signature } = body;

	const [current] = await sql`
		select id, status from agent_withdrawals where id = ${id}
	`;

	if (!current) return error(res, 404, 'not_found', 'withdrawal not found');

	const allowed = TRANSITIONS[current.status] ?? [];
	if (!allowed.includes(status)) {
		return error(
			res,
			422,
			'invalid_transition',
			`cannot transition from '${current.status}' to '${status}'`,
		);
	}

	if (status === 'processing' && !tx_signature) {
		return error(res, 400, 'validation_error', 'tx_signature required when advancing to processing');
	}

	const [withdrawal] = await sql`
		update agent_withdrawals
		set
			status = ${status},
			tx_signature = coalesce(${tx_signature ?? null}, tx_signature),
			updated_at = now()
		where id = ${id}
		returning id, user_id, agent_id, amount, currency_mint, chain, to_address,
		          status, tx_signature, created_at, updated_at
	`;

	if (status === 'completed' || status === 'failed') {
		const notifType = status === 'completed' ? 'withdrawal_completed' : 'withdrawal_failed';
		insertNotification(withdrawal.user_id, notifType, {
			withdrawal_id: withdrawal.id,
			amount: Number(withdrawal.amount),
			currency_mint: withdrawal.currency_mint,
			chain: withdrawal.chain,
			to_address: withdrawal.to_address,
			tx_signature: withdrawal.tx_signature ?? null,
		});
	}

	return json(res, 200, { withdrawal });
});
