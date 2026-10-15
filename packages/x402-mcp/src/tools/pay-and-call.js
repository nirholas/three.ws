// `pay_and_call` — pay an x402 endpoint in USDC from the local Solana wallet and
// return its result. EXECUTION tool: it moves real money.
//
// Two payment modes:
//   1. Self-custodial (default): signs with SOLANA_SECRET_KEY / `secret` arg.
//   2. Session-governed: when `session_token` is supplied, routes through the
//      three.ws /api/pay/execute endpoint — the platform wallet signs, and the
//      session's budget/allowlist/per-tx policy is enforced. No key needed.
//
// Guards before any payment: probe the 402 to read the Solana price, refuse if it
// exceeds max_usd or MAX_PAY_USD (and (when REQUIRE_CONFIRM is on) require an
// explicit confirm:true. Payment + settlement are done by the real @x402/* libs.
// The actual probe/pay/settle/ledger logic lives in ../lib/pay-core.js, shared
// with every named tool in named-services.js.

import { z } from 'zod';

import { payUrl } from '../lib/pay-core.js';

export const def = {
	name: 'pay_and_call',
	title: 'Pay an x402 endpoint in USDC or $THREE and return its result',
	// Moves real funds — irreversible transfer.
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'Call a paid x402 endpoint and settle the payment automatically, then return the result. Use this after inspect_endpoint has shown the price and the user has approved paying it; a settled payment cannot be undone.\n\nTwo modes:\n• Self-custodial (default): signs with SOLANA_SECRET_KEY or `secret` arg; you hold the key.\n• Session-governed: pass `session_token` (a three.ws Payment Session token); the platform wallet signs on your behalf; the session\'s budget, allowlist, and per-tx cap are enforced by the platform. No private key required. Supports Solana USDC and Base USDC sessions.\n\nPay in USDC (default) or, when the endpoint advertises it, in $THREE (set token:"three"). Bounded by max_usd and the MAX_PAY_USD cap; refuses before any money moves if the price is over the cap. With REQUIRE_CONFIRM on, the call refuses until re-issued with confirm:true.\n\nIf a named tool already covers this endpoint (weather_forecast, domain_rdap_check, etc, see tools.json), prefer it: it carries a fixed description and price ceiling, which a model composes more reliably than a raw URL.',
	inputSchema: {
		url: z.string().url().describe('The x402 endpoint to pay and call.'),
		method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method.'),
		body: z.record(z.any()).optional().describe('JSON body for POST requests.'),
		session_token: z
			.string()
			.optional()
			.describe('three.ws Payment Session token (pss_…). When provided, the platform wallet pays — no local key needed. Overrides `secret`.'),
		token: z
			.enum(['usdc', 'three'])
			.default('usdc')
			.describe('Settlement token. "usdc" (default) or "three" — the $THREE platform token; the endpoint must advertise it. Ignored when session_token is set.'),
		max_usd: z
			.number()
			.positive()
			.optional()
			.describe('Hard ceiling for THIS call in USD. Can only lower the MAX_PAY_USD cap, never raise it.'),
		secret: z.string().optional().describe('Per-call base58 signer override (defaults to SOLANA_SECRET_KEY). Ignored when session_token is set.'),
		confirm: z.boolean().optional().describe('Must be true to execute when REQUIRE_CONFIRM is on.'),
		idempotency_key: z.string().optional().describe('Deduplication key for this call. Recommended when using session_token to avoid double-charges on retries.'),
	},
	async handler(args) {
		const url = String(args?.url ?? '').trim();
		return payUrl(url, { ...args, toolName: 'pay_and_call' });
	},
};
