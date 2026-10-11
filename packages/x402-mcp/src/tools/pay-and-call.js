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
// exceeds max_usd or MAX_PAY_USD, and (when REQUIRE_CONFIRM is on) require an
// explicit confirm:true. Payment + settlement are done by the real @x402/* libs.

import { z } from 'zod';

import { buildPayingFetch, decodeSettlement, probeChallenge, isThreeAccept, isUsdcAccept } from '../lib/x402-buyer.js';
import { MAX_PAY_USD, REQUIRE_CONFIRM, SOLANA_DEFAULT_SECRET, THREE_WS_BASE, HTTP_TIMEOUT_MS } from '../config.js';

// Split a challenge's Solana accepts into the two main assets so we can price
// and pay in the caller's chosen token.
function pickSolanaAccepts(accepts) {
	const sol = (Array.isArray(accepts) ? accepts : []).filter((a) => String(a.network || '').startsWith('solana'));
	return { sol, usdc: sol.find(isUsdcAccept) || null, three: sol.find(isThreeAccept) || null };
}

// USD value of a USDC accept (6-decimal atomic, or a "$x" string). Returns null
// when unknown — $THREE accepts have no USD price (their amount is a token count).
function usdFromAccept(a) {
	if (!a) return null;
	const raw = a.price ?? a.maxAmountRequired ?? a.amount;
	if (raw == null) return null;
	if (typeof raw === 'string' && raw.trim().startsWith('$')) return Number(raw.replace('$', '').trim());
	const atomics = Number(raw);
	return Number.isFinite(atomics) ? atomics / 1_000_000 : null;
}

export const def = {
	name: 'pay_and_call',
	title: 'Pay an x402 endpoint in USDC or $THREE and return its result',
	// Moves real funds — irreversible transfer.
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'Call a paid x402 endpoint and settle the payment automatically, then return the result. Use this after inspect_endpoint has shown the price and the user has approved paying it; a settled payment cannot be undone.\n\nTwo modes:\n• Self-custodial (default): signs with SOLANA_SECRET_KEY or `secret` arg; you hold the key.\n• Session-governed: pass `session_token` (a three.ws Payment Session token); the platform wallet signs on your behalf; the session\'s budget, allowlist, and per-tx cap are enforced by the platform. No private key required. Supports Solana USDC and Base USDC sessions.\n\nPay in USDC (default) or, when the endpoint advertises it, in $THREE (set token:"three"). Bounded by max_usd and the MAX_PAY_USD cap; refuses before any money moves if the price is over the cap. With REQUIRE_CONFIRM on, the call refuses until re-issued with confirm:true.',
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
		const method = args?.method === 'POST' ? 'POST' : 'GET';

		// ── Session-governed mode ───────────────────────────────────────────
		// When a session_token is provided, delegate everything to the three.ws
		// /api/pay/execute endpoint: probing, governance, signing, and settlement.
		// No local wallet needed.
		const sessionToken = args?.session_token || process.env.PAYMENT_SESSION_TOKEN || '';
		if (sessionToken) {
			const ceiling = Math.min(MAX_PAY_USD, args?.max_usd ?? Infinity);

			if (REQUIRE_CONFIRM && args?.confirm !== true) {
				// We don't know the exact price without probing — let the user confirm intent.
				return {
					ok: false,
					error: 'confirm_required',
					message: `This will spend up to $${ceiling} (session-governed) on ${url}. Re-issue with confirm:true to proceed (or set REQUIRE_CONFIRM=0).`,
					mode: 'session',
					url,
				};
			}

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
			let res, text;
			try {
				res = await fetch(`${THREE_WS_BASE}/api/pay/execute`, {
					method: 'POST',
					signal: controller.signal,
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({
						session_token: sessionToken,
						url,
						method,
						body: args?.body ?? undefined,
						idempotency_key: args?.idempotency_key ?? undefined,
					}),
				});
				text = await res.text();
			} catch (err) {
				throw Object.assign(new Error(`Session payment failed: ${err?.message}`), {
					code: 'session_execute_failed',
				});
			} finally {
				clearTimeout(timer);
			}

			let result;
			try { result = text ? JSON.parse(text) : null; } catch { result = text; }

			if (!res.ok) {
				throw Object.assign(
					new Error(result?.message || result?.error || `Session execute returned HTTP ${res.status}`),
					{ code: result?.code || 'session_execute_failed', status: res.status, body: result },
				);
			}

			return { ...result, mode: 'session' };
		}

		// ── Self-custodial mode ─────────────────────────────────────────────
		const secret = args?.secret || SOLANA_DEFAULT_SECRET;
		if (!secret) {
			throw Object.assign(
				new Error('No signer configured. Set SOLANA_SECRET_KEY / pass `secret`, or provide a `session_token` for session-governed payments.'),
				{ code: 'no_signer' },
			);
		}

		// Probe first so we never pay blind and can enforce the cap pre-payment.
		const probe = await probeChallenge(url, { method, body: args?.body });
		if (!probe.paid) {
			return {
				ok: true,
				paid: false,
				url,
				note: 'Endpoint is not paywalled — called directly, no payment needed.',
				status: probe.status,
				result: probe.result,
			};
		}

		const token = args?.token === 'three' ? 'three' : 'usdc';
		const { sol, usdc, three } = pickSolanaAccepts(probe.accepts);
		if (!sol.length) {
			throw Object.assign(new Error('Endpoint has no Solana (solana:*) payment option this wallet can settle.'), {
				code: 'no_solana_requirement',
			});
		}
		if (token === 'three' && !three) {
			throw Object.assign(new Error('Endpoint does not advertise a $THREE payment option — retry with token:"usdc".'), {
				code: 'three_not_offered',
			});
		}
		const priceUsd = usdFromAccept(usdc);
		const ceiling = Math.min(MAX_PAY_USD, args?.max_usd ?? Infinity);
		if (priceUsd != null && priceUsd > ceiling) {
			throw Object.assign(
				new Error(`Price $${priceUsd} exceeds the cap $${ceiling}. Raise max_usd / MAX_PAY_USD to allow it.`),
				{ code: 'over_cap', price_usd: priceUsd, cap_usd: ceiling },
			);
		}
		const threeAmount = token === 'three' ? String(three.amount ?? three.maxAmountRequired ?? three.price ?? '') : null;
		const spendLabel = token === 'three' ? `${threeAmount} atomic $THREE` : `$${priceUsd ?? '?'} USDC`;
		if (REQUIRE_CONFIRM && args?.confirm !== true) {
			return {
				ok: false,
				error: 'confirm_required',
				message: `This will spend up to ${spendLabel} on ${url}. Re-issue with confirm:true to proceed (or set REQUIRE_CONFIRM=0).`,
				mode: 'self_custodial',
				token,
				price_usd: priceUsd,
				...(threeAmount ? { three_amount: threeAmount } : {}),
				url,
			};
		}

		const { payingFetch, address } = await buildPayingFetch(secret, { preferToken: token });
		const init = {
			method,
			headers: { accept: 'application/json', ...(args?.body !== undefined ? { 'content-type': 'application/json' } : {}) },
			body: args?.body !== undefined ? JSON.stringify(args.body) : undefined,
		};
		const res = await payingFetch(url, init);
		const text = await res.text();
		let result;
		try {
			result = text ? JSON.parse(text) : null;
		} catch {
			result = text;
		}
		if (!res.ok) {
			throw Object.assign(new Error(`Paid call to ${url} returned HTTP ${res.status}`), {
				code: 'call_failed',
				status: res.status,
				body: result,
			});
		}
		const settlement = await decodeSettlement(res);
		return {
			ok: true,
			paid: true,
			mode: 'self_custodial',
			url,
			payer: address,
			token,
			price_usd: priceUsd,
			...(threeAmount ? { three_amount: threeAmount } : {}),
			settlement,
			result,
		};
	},
};
