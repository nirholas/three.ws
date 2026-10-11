// `pay_with_session` — pay an x402 endpoint using a payment session token.
//
// The agent proposes spend; governance enforces policy. No private key required.
// The platform's wallet signs the Solana USDC transfer on behalf of the session.
//
// Governance checks (in order, before any money moves):
//   1. Token verified (HMAC checked server-side)
//   2. Session is active and not expired
//   3. Target URL host is in the session's allowlist (if one was set)
//   4. Payment amount does not exceed the per-transaction ceiling (if set)
//   5. Remaining budget is sufficient (atomic, race-safe)

import { z } from 'zod';
import { apiRequest } from '../lib/api.js';
import { PAYMENT_SESSION_TOKEN } from '../config.js';

export const def = {
	name: 'pay_with_session',
	title: 'Pay an x402 endpoint via a payment session',
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'Execute an x402 micropayment against a paid API or MCP endpoint using a Payment Session token. ' +
		'The platform signs the Solana USDC transfer — no private key needed by the agent. ' +
		'Governance enforces budget limits, URL allowlists, and per-tx ceilings before any money moves. ' +
		'Endpoints that respond without a 402 are called for free. ' +
		'Returns the endpoint\'s response + payment receipt. ' +
		'Uses PAYMENT_SESSION_TOKEN env var if token is not passed inline. ' +
		'Use this after quote_session_payment returns a price the user has explicitly approved; it moves real USDC.',
	inputSchema: {
		url: z.string().url()
			.describe('The x402 endpoint URL to pay and call.'),
		method: z.enum(['GET', 'POST']).default('GET')
			.describe('HTTP method. Default: GET.'),
		body: z.record(z.any()).optional()
			.describe('JSON body for POST requests.'),
		token: z.string().optional()
			.describe('Payment session token (starts with "pss_"). Falls back to PAYMENT_SESSION_TOKEN env var.'),
		idempotency_key: z.string().max(128).optional()
			.describe('Optional idempotency key to prevent double-billing on retries.'),
	},
	async handler(args) {
		const token = args.token || PAYMENT_SESSION_TOKEN;
		if (!token) {
			throw Object.assign(
				new Error(
					'No payment session token provided. Pass `token` inline or set PAYMENT_SESSION_TOKEN. ' +
						'Create a session with create_payment_session first.',
				),
				{ code: 'no_token' },
			);
		}

		const data = await apiRequest('/api/pay/execute', {
			method: 'POST',
			body: {
				session_token: token,
				url: args.url,
				method: args.method ?? 'GET',
				body: args.body ?? null,
				idempotency_key: args.idempotency_key ?? null,
			},
		});

		if (!data.paid) {
			return {
				ok: true,
				paid: false,
				note: data.note ?? 'Endpoint served a free response — no payment was required.',
				result: data.result,
			};
		}

		return {
			ok: true,
			paid: true,
			result: data.result,
			payment: data.payment,
			session: data.session,
			duration_ms: data.duration_ms,
		};
	},
};
