// Shared payment core for pay_and_call and every named tool in
// named-services.js: probe, enforce the spend cap, require confirm, settle,
// and record the spend in the local ledger. One implementation so a named
// tool (e.g. weather_go_no_go) and the generic pay_and_call behave identically
// for the same URL.

import { buildPayingFetch, decodeSettlement, probeChallenge, isThreeAccept, isUsdcAccept } from './x402-buyer.js';
import { recordSpend } from './ledger.js';
import { MAX_PAY_USD, REQUIRE_CONFIRM, SOLANA_DEFAULT_SECRET, THREE_WS_BASE, HTTP_TIMEOUT_MS } from '../config.js';

// Split a challenge's Solana accepts into the two main assets so we can price
// and pay in the caller's chosen token.
function pickSolanaAccepts(accepts) {
	const sol = (Array.isArray(accepts) ? accepts : []).filter((a) => String(a.network || '').startsWith('solana'));
	return { sol, usdc: sol.find(isUsdcAccept) || null, three: sol.find(isThreeAccept) || null };
}

// USD value of a USDC accept (6-decimal atomic, or a "$x" string). Returns null
// when unknown; $THREE accepts have no USD price (their amount is a token count).
function usdFromAccept(a) {
	if (!a) return null;
	const raw = a.price ?? a.maxAmountRequired ?? a.amount;
	if (raw == null) return null;
	if (typeof raw === 'string' && raw.trim().startsWith('$')) return Number(raw.replace('$', '').trim());
	const atomics = Number(raw);
	return Number.isFinite(atomics) ? atomics / 1_000_000 : null;
}

/**
 * Pay a single x402 URL and return its result, exactly as pay_and_call does.
 * @param {string} url
 * @param {object} args
 * @param {'GET'|'POST'} [args.method]
 * @param {object} [args.body]
 * @param {string} [args.session_token]
 * @param {'usdc'|'three'} [args.token]
 * @param {number} [args.max_usd]
 * @param {string} [args.secret]
 * @param {boolean} [args.confirm]
 * @param {string} [args.idempotency_key]
 * @param {string} [args.toolName] Named-tool name, for the ledger only.
 */
export async function payUrl(url, args = {}) {
	const method = args.method === 'POST' ? 'POST' : 'GET';

	// ── Session-governed mode ───────────────────────────────────────────────
	const sessionToken = args.session_token || process.env.PAYMENT_SESSION_TOKEN || '';
	if (sessionToken) {
		const ceiling = Math.min(MAX_PAY_USD, args.max_usd ?? Infinity);

		if (REQUIRE_CONFIRM && args.confirm !== true) {
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
					body: args.body ?? undefined,
					idempotency_key: args.idempotency_key ?? undefined,
				}),
			});
			text = await res.text();
		} catch (err) {
			throw Object.assign(new Error(`Session payment failed: ${err?.message}`), { code: 'session_execute_failed' });
		} finally {
			clearTimeout(timer);
		}

		let result;
		try {
			result = text ? JSON.parse(text) : null;
		} catch {
			result = text;
		}

		if (!res.ok) {
			throw Object.assign(new Error(result?.message || result?.error || `Session execute returned HTTP ${res.status}`), {
				code: result?.code || 'session_execute_failed',
				status: res.status,
				body: result,
			});
		}

		await recordSpend({
			tool: args.toolName,
			url,
			amountUsd: typeof result?.price_usd === 'number' ? result.price_usd : null,
			token: args.token === 'three' ? 'three' : 'usdc',
			network: result?.network ?? 'solana',
			settlement: result?.settlement ?? null,
		});

		return { ...result, mode: 'session' };
	}

	// ── Self-custodial mode ─────────────────────────────────────────────────
	const secret = args.secret || SOLANA_DEFAULT_SECRET;
	if (!secret) {
		throw Object.assign(
			new Error('No signer configured. Set SOLANA_SECRET_KEY / pass `secret`, or provide a `session_token` for session-governed payments.'),
			{ code: 'no_signer' },
		);
	}

	// Probe first so we never pay blind and can enforce the cap pre-payment.
	const probe = await probeChallenge(url, { method, body: args.body });
	if (!probe.paid) {
		return {
			ok: true,
			paid: false,
			url,
			note: 'Endpoint is not paywalled, called directly, no payment needed.',
			status: probe.status,
			result: probe.result,
		};
	}

	const token = args.token === 'three' ? 'three' : 'usdc';
	const { sol, usdc, three } = pickSolanaAccepts(probe.accepts);
	if (!sol.length) {
		throw Object.assign(new Error('Endpoint has no Solana (solana:*) payment option this wallet can settle.'), {
			code: 'no_solana_requirement',
		});
	}
	if (token === 'three' && !three) {
		throw Object.assign(new Error('Endpoint does not advertise a $THREE payment option, retry with token:"usdc".'), {
			code: 'three_not_offered',
		});
	}
	const priceUsd = usdFromAccept(usdc);
	const ceiling = Math.min(MAX_PAY_USD, args.max_usd ?? Infinity);
	if (priceUsd != null && priceUsd > ceiling) {
		throw Object.assign(new Error(`Price $${priceUsd} exceeds the cap $${ceiling}. Raise max_usd / MAX_PAY_USD to allow it.`), {
			code: 'over_cap',
			price_usd: priceUsd,
			cap_usd: ceiling,
		});
	}
	const threeAmount = token === 'three' ? String(three.amount ?? three.maxAmountRequired ?? three.price ?? '') : null;
	const spendLabel = token === 'three' ? `${threeAmount} atomic $THREE` : `$${priceUsd ?? '?'} USDC`;
	if (REQUIRE_CONFIRM && args.confirm !== true) {
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
		headers: { accept: 'application/json', ...(args.body !== undefined ? { 'content-type': 'application/json' } : {}) },
		body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
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

	await recordSpend({
		tool: args.toolName,
		url,
		amountUsd: priceUsd,
		token,
		network: usdc?.network || three?.network || 'solana',
		settlement,
	});

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
}
