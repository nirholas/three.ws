// `quote_session_payment`: the quote that must run before pay_with_session.
//
// Probes the endpoint for its live x402 price through /api/pay/simulate (one
// unpaid request, exactly what any x402 client does before deciding to pay) and,
// when a session id is supplied, replays that price through the session's own
// remaining budget, per-transaction ceiling and host allowlist. Nothing is
// signed, no credit moves, no row is written.

import { z } from 'zod';
import { apiRequest } from '../lib/api.js';
import { THREE_WS_SESSION } from '../config.js';

// Wide enough to price any single call when no session policy is supplied.
const PRICE_ONLY_POLICY = { budget_usd: 1000, max_per_tx_usd: null, allowed_hosts: [], expiry_seconds: 3600 };

export const def = {
	name: 'quote_session_payment',
	title: 'Quote an x402 payment against a payment session (no funds move)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Quote pay_with_session before it runs: the live x402 price of the endpoint and, when you pass session_id ' +
		'(with THREE_WS_SESSION set), whether that session would settle it: its remaining budget, per-transaction ' +
		'ceiling and host allowlist, and the budget left afterwards. Makes one unpaid probe request and moves ' +
		'nothing. Show the price to the user, get a clear yes, then call pay_with_session with the same url and ' +
		'method, the returned quote_id and confirm_payment: true.',
	inputSchema: {
		url: z.string().url().describe('The x402 endpoint URL that will be paid.'),
		method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method. Default: GET.'),
		body: z.record(z.any()).optional().describe('JSON body for POST requests (some endpoints price by body).'),
		session_id: z.string().uuid().optional().describe('The payment session that will pay. Needs THREE_WS_SESSION.'),
	},
	async handler(args) {
		let session = null;
		let policy = PRICE_ONLY_POLICY;
		if (args.session_id) {
			if (!THREE_WS_SESSION) {
				throw Object.assign(new Error('session_id needs THREE_WS_SESSION so the session can be read.'), { code: 'no_session' });
			}
			({ session } = await apiRequest(`/api/pay/session/${args.session_id}`, { auth: true }));
			policy = {
				budget_usd: Number(session.remaining_usd ?? session.budget_usd),
				max_per_tx_usd: session.max_per_tx_usd ?? null,
				allowed_hosts: session.allowed_hosts ?? [],
				expiry_seconds: 3600,
				network: session.network ?? 'solana',
			};
		}
		const sim = await apiRequest('/api/pay/simulate', {
			method: 'POST',
			body: { policy, calls: [{ url: args.url, method: args.method ?? 'GET', ...(args.body ? { body: args.body } : {}) }] },
		});
		const step = sim.timeline?.[0] ?? null;
		return {
			ok: true,
			url: args.url,
			method: args.method ?? 'GET',
			price_usd: step?.amount_usd ?? null,
			pricing: step?.pricing ?? null,
			outcome: step?.outcome ?? 'unpriced',
			...(session
				? {
						session: { id: args.session_id, status: session.status, remaining_usd: session.remaining_usd, max_per_tx_usd: session.max_per_tx_usd, allowed_hosts: session.allowed_hosts },
						// The simulator lifts a budget under the session minimum, so the
						// remaining balance is checked here against the real number.
						would_settle:
							step?.outcome === 'free' ||
							(step?.outcome === 'settles' && Number(step.amount_usd) <= Number(session.remaining_usd)),
						refused_by: step?.rejected_by ?? null,
						reason: step?.reason ?? null,
						remaining_after_usd: step?.remaining_after_usd ?? null,
					}
				: {}),
		};
	},
};
