// Buyer-side fetch helper with spending-cap enforcement (USE-22).
//
// Wraps the standard 402 dance into one call, with `caps` enforcement
// installed via the lifecycle-style enforceCap → commit / rollback
// transaction so caps are honored even for callers that aren't using
// the @x402/fetch SDK directly.
//
// Usage:
//   const { ok, response, payment, settled } = await buyerFetch(url, {
//     method: 'POST',
//     body: { url: 'https://three.ws/avatar.glb' },
//     caps: {
//       address: '0xMyAgent',
//       maxPerCall: '50000',     // $0.05 per call
//       maxPerHour: '1000000',   // $1/hr
//       maxPerDay:  '5000000',   // $5/day
//     },
//     signPayment,               // ({ requirement }) => paymentPayload
//   });
//
// `signPayment` is supplied by the caller because signing logic varies
// (EIP-712 transferWithAuthorization for Base, signed VersionedTransaction
// for Solana, contract call for BSC). This module owns the cap check +
// header dance + settlement parsing only.

import { enforceCap, commit, releaseUnusedCap, rollbackReservation } from './x402-spending-cap.js';
import { BUILDER_CODE } from './x402-builder-code.js';
import { env } from './env.js';

function selectRequirement(challenge, prefer, preferScheme) {
	let accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
	// `preferScheme: 'upto'` takes an escrow-backed offer when one is advertised
	// (pay the measured charge, not the cap); otherwise the list is unchanged.
	if (preferScheme && accepts.some((a) => a.scheme === preferScheme)) {
		accepts = accepts.filter((a) => a.scheme === preferScheme);
	}
	if (typeof prefer === 'function') {
		const picked = prefer(accepts);
		if (picked) return picked;
	}
	if (typeof prefer === 'string') {
		const found = accepts.find((a) => a.network === prefer);
		if (found) return found;
	}
	return accepts[0] || null;
}

function ensureBuilderCodeEcho(challenge, paymentPayload) {
	const declared = challenge?.extensions?.[BUILDER_CODE];
	const declaredA = declared?.info?.a;
	if (!declaredA) return paymentPayload;
	const existing = paymentPayload.extensions || {};
	const existingBlock = existing[BUILDER_CODE] || {};
	const echo = { ...existingBlock, a: declaredA };
	if (env.X402_BUILDER_CODE_WALLET && !echo.w) {
		echo.w = env.X402_BUILDER_CODE_WALLET;
	}
	paymentPayload.extensions = { ...existing, [BUILDER_CODE]: echo };
	return paymentPayload;
}

function bodyToInit(method, body, headers = {}) {
	if (body == null) return { method, headers };
	if (typeof body === 'string' || body instanceof ArrayBuffer || body instanceof Uint8Array) {
		return { method, headers, body };
	}
	return {
		method,
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	};
}

function b64encode(obj) {
	return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function b64decode(s) {
	if (!s) return null;
	try {
		return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

// One-shot paid request. Returns:
//   { ok: true,  result, response, payment, settled }
//   { ok: false, abort: true, reason }      — cap rejected; no network call
//   { ok: false, status, error }            — server returned non-2xx
export async function buyerFetch(url, opts = {}) {
	const {
		method = 'GET',
		body,
		headers,
		caps,
		signPayment,
		preferNetwork,
		preferScheme,
		fetchImpl = globalThis.fetch,
	} = opts;

	if (typeof signPayment !== 'function') {
		throw new Error('buyerFetch: signPayment({ requirement }) callback is required');
	}

	const init = bodyToInit(method, body, headers);
	const probe = await fetchImpl(url, init);
	if (probe.status !== 402) {
		const text = await probe.text();
		const parsed = safeJson(text);
		return {
			ok: probe.ok,
			status: probe.status,
			result: parsed ?? text,
			response: probe,
		};
	}

	const challenge =
		safeJson(await probe.text()) ||
		(() => {
			// Some servers only emit the body on the PAYMENT-REQUIRED header.
			const header = probe.headers.get('payment-required');
			return header ? b64decode(header) : null;
		})();
	if (!challenge || !Array.isArray(challenge.accepts)) {
		return { ok: false, status: 402, error: 'invalid_402_body' };
	}

	const requirement = selectRequirement(challenge, preferNetwork, preferScheme);
	if (!requirement) {
		return { ok: false, status: 402, error: 'no_acceptable_requirement' };
	}

	let reservation = null;
	if (caps) {
		const verdict = await enforceCap({ requirement, opts: caps });
		if (verdict.abort) {
			return { ok: false, abort: true, reason: verdict.reason };
		}
		reservation = verdict.reservation;
	}

	try {
		let paymentPayload;
		try {
			paymentPayload = await signPayment({ requirement, challenge });
		} catch (err) {
			if (reservation) await rollbackReservation(reservation);
			throw err;
		}
		ensureBuilderCodeEcho(challenge, paymentPayload);

		const xPayment = b64encode(paymentPayload);
		const paid = await fetchImpl(url, {
			...init,
			headers: { ...(init.headers || {}), 'X-PAYMENT': xPayment },
		});
		const paidText = await paid.text();
		const paidJson = safeJson(paidText) ?? paidText;
		if (!paid.ok) {
			if (reservation) await rollbackReservation(reservation);
			return {
				ok: false,
				status: paid.status,
				error: paidJson?.error || `HTTP ${paid.status}`,
				result: paidJson,
				response: paid,
			};
		}
		const settled = b64decode(paid.headers.get('x-payment-response'));
		if (reservation && requirement.scheme === 'upto' && settled?.amount != null) {
			reservation = await releaseUnusedCap(reservation, requirement, settled.amount);
		}
		if (reservation) {
			await commit(reservation, {
				network: requirement.network,
				asset: requirement.asset,
				settlement: settled,
			});
		}
		return {
			ok: true,
			result: paidJson,
			response: paid,
			payment: paymentPayload,
			settled,
		};
	} catch (err) {
		if (reservation) {
			await rollbackReservation(reservation).catch(() => undefined);
		}
		throw err;
	}
}

function safeJson(text) {
	if (typeof text !== 'string' || !text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

// ── BNB Chain (MPP / b402) buyer ────────────────────────────────────────────
// Re-exported from the same surface so an agent that already imports the x402
// buyer can also pay MPP-protected endpoints on BNB Chain (eip155:56/97) with
// the same 402 → pay → retry ergonomics. MPP is x402 v2, so the only real
// difference is the network + an EIP-3009 credential signed by @bnb-chain/mpp.
//
//   import { buyerFetch, mppFetch } from './x402-buyer-fetch.js';
//   // Solana/Base:  await buyerFetch(url, { signPayment, caps });
//   // BNB Chain:    await mppFetch(url, { method: 'GET' }, { account, maxSpend: '20000' });
export { mppFetch, MPP_BUYER_NETWORKS, MppBuyerError } from './bnb/mpp-buyer.js';
