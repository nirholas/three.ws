// `cancel_payment_session` — cancel a session and refund un-spent budget to credits.

import { z } from 'zod';
import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'cancel_payment_session',
	title: 'Cancel a payment session and refund unused budget',
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
	description:
		'Cancel an active payment session. The un-spent portion of the budget is immediately refunded ' +
		'to your credit balance. Already-completed payments are not reversed. ' +
		'Idempotent, safe to call on an already-cancelled session. Requires THREE_WS_SESSION. ' +
		'Use this when an agent no longer needs its budget, to stop further spending and reclaim the rest.',
	inputSchema: {
		session_id: z.string().uuid()
			.describe('UUID of the session to cancel.'),
	},
	async handler(args) {
		const data = await apiRequest(`/api/pay/session/${args.session_id}`, {
			method: 'DELETE',
			auth: true,
		});

		return {
			ok: true,
			cancelled: data.cancelled,
			session_id: data.session_id,
			refunded_usd: data.refunded_usd,
			note: data.refunded_usd > 0
				? `$${data.refunded_usd.toFixed(4)} has been returned to your credit balance.`
				: 'No budget remained to refund (session was fully spent).',
		};
	},
};
