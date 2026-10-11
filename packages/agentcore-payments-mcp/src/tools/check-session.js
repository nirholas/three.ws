// `check_payment_session` — inspect a session's budget, spend, and status.
//
// Returns remaining budget, status, expiry, and recent payment executions.
// Use before a pay_with_session call to confirm sufficient budget remains.

import { z } from 'zod';
import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'check_payment_session',
	title: 'Check a payment session\'s budget and status',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	description:
		'Inspect a payment session: budget, amount spent, remaining budget, status (active/exhausted/expired/cancelled), ' +
		'expiry time, allowlist, and per-tx ceiling. Optionally include recent payment executions. ' +
		'Requires THREE_WS_SESSION (only the session owner can read it). ' +
		'Use this to see how much budget one session has left before paying; for every session at once call list_payment_sessions.',
	inputSchema: {
		session_id: z.string().uuid()
			.describe('UUID of the payment session to inspect.'),
		include_executions: z.boolean().default(false)
			.describe('If true, include the 10 most recent payment executions for this session.'),
	},
	async handler(args) {
		const [sessionData, execData] = await Promise.all([
			apiRequest(`/api/pay/session/${args.session_id}`, { auth: true }),
			args.include_executions
				? apiRequest(`/api/pay/session/${args.session_id}/executions`, {
						auth: true,
						query: { limit: '10' },
					})
				: Promise.resolve(null),
		]);

		return {
			ok: true,
			session: sessionData.session,
			...(execData ? { recent_executions: execData.items } : {}),
		};
	},
};
