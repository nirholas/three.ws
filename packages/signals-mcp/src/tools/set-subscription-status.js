// `set_subscription_status` — control an existing subscription: resume, pause,
// stop, or instantly KILL it (halt all further pay/trade). Account-scoped write,
// idempotent (setting a state repeatedly leaves the same state).
//
// Wraps POST /api/signals/subscribe { id, status } / { id, killed }.

import { z } from 'zod';

import { apiRequest, requireApiKey } from '../lib/api.js';

export const def = {
	name: 'set_subscription_status',
	title: 'Resume, pause, stop, or kill a subscription',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Control an existing signal subscription owned by the authenticated account.\n' +
		'  • active  — (re)activate it; this also CLEARS any kill flag so it resumes paying/mirroring.\n' +
		'  • paused  — stop delivering for now; the kill flag (if set) is left untouched.\n' +
		'  • stopped — stop the subscription (soft — its delivery history is kept).\n' +
		'  • killed  — INSTANT kill switch: halts everything immediately; the kill is honoured before any ' +
		'payment or trade can fire. Use this to stop a live subscription from spending or trading right now.\n' +
		'Idempotent — setting the same state again is a no-op. Get the subscription `id` from get_subscriptions. ' +
		'Requires THREE_WS_API_KEY.',
	inputSchema: {
		subscription_id: z
			.number()
			.int()
			.positive()
			.describe('Numeric subscription id (the `id` from get_subscriptions).'),
		state: z
			.enum(['active', 'paused', 'stopped', 'killed'])
			.describe('Target state: active (resume + clear kill), paused, stopped, or killed (instant halt of all pay/trade).'),
	},
	async handler(args) {
		requireApiKey();
		const id = Number(args?.subscription_id);
		const state = args?.state;
		const body = state === 'killed' ? { id, killed: true } : { id, status: state };

		const data = await apiRequest('/api/signals/subscribe', { method: 'POST', body });
		const subscription = data?.subscription ?? null;
		return {
			ok: true,
			subscription,
			state: subscription ? (subscription.killed ? 'killed' : subscription.status) : state,
		};
	},
};
