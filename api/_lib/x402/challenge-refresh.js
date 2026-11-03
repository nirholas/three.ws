// api/_lib/x402/challenge-refresh.js
//
// One bounded recovery for a paid call that comes back 402.
//
// A 402 AFTER a payment header was attached means the endpoint refused the
// payment it was handed. The common cause is a challenge that moved between the
// probe and the payment: a price change, a rotated payTo or fee payer. The
// autonomous loop used to record `http_402` and wait out the cooldown. This
// helper re-fetches the challenge once and pays again, but only against a
// challenge that DIFFERS from the one just rejected, so:
//   - a requirement is never reused across a price change;
//   - an unchanged challenge is never paid twice (it would be rejected again);
//   - only 402 triggers it. A 5xx may mean the payment settled, so a signed
//     payment is never replayed after anything but a clean refusal;
//   - the re-probe is the only idempotent request that is retried.
//
// Pure of I/O: the caller supplies `pay` and `reprobe`, so it is unit-testable
// without a network.

import { parseSolanaAccept } from './pay.js';

/**
 * True when two Solana accepts differ in anything a payment is bound to.
 * @param {object|null} a
 * @param {object|null} b
 */
export function challengeChanged(a, b) {
	if (!a || !b) return true;
	return (
		String(a.amount ?? '') !== String(b.amount ?? '') ||
		a.asset !== b.asset ||
		a.payTo !== b.payTo ||
		a.network !== b.network ||
		(a.extra?.feePayer ?? null) !== (b.extra?.feePayer ?? null)
	);
}

/**
 * Admission checks a challenge must pass before the loop signs a payment for it.
 * The same gates the first payment passed, re-applied to a refreshed challenge
 * because its price may be higher.
 * @param {object|null} accept
 * @param {{ usdcMint: string, remainingCap: number, payerUsdcAtomic: number|null }} limits
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function payableChallenge(accept, { usdcMint, remainingCap, payerUsdcAtomic }) {
	if (!accept) return { ok: false, reason: 'no_solana_accept' };
	if (!usdcMint || accept.asset !== usdcMint) return { ok: false, reason: 'unexpected_asset' };
	if (!accept.extra?.feePayer) return { ok: false, reason: 'missing_fee_payer' };
	const amount = Number(accept.amount || 0);
	if (amount > remainingCap) return { ok: false, reason: 'cap_would_exceed' };
	if (payerUsdcAtomic !== null && amount > payerUsdcAtomic) {
		return { ok: false, reason: 'insufficient_payer_usdc' };
	}
	return { ok: true };
}

/**
 * Pay `accept`; on a 402 refusal, re-fetch the challenge once and pay again if it
 * changed and is still payable.
 *
 * @param {object} p
 * @param {object} p.accept     the Solana accept the first payment is built from
 * @param {{ usdcMint: string, remainingCap: number, payerUsdcAtomic: number|null }} p.limits
 * @param {(accept: object) => Promise<{ status: number, ok: boolean }>} p.pay
 *        builds, signs and sends a payment for the given accept
 * @param {() => Promise<{ status: number, body: any }>} p.reprobe
 *        fetches a fresh unpaid challenge
 * @param {(accept: object) => Promise<{ ok: boolean, reason?: string }>} [p.admit]
 *        extra gate run on the refreshed accept (the loop's fee-budget admission,
 *        which depends on the fee payer the new challenge names)
 * @returns {Promise<{ paidRes: object, accept: object, refreshed: boolean, refreshSkipped?: string }>}
 */
export async function payWithChallengeRefresh({ accept, limits, pay, reprobe, admit }) {
	const first = await pay(accept);
	if (first.status !== 402) return { paidRes: first, accept, refreshed: false };

	let fresh;
	try {
		fresh = await reprobe();
	} catch {
		return { paidRes: first, accept, refreshed: false, refreshSkipped: 'reprobe_failed' };
	}
	if (fresh?.status !== 402) {
		return { paidRes: first, accept, refreshed: false, refreshSkipped: 'reprobe_not_a_challenge' };
	}

	const freshAccept = parseSolanaAccept(fresh.body);
	if (freshAccept && !challengeChanged(accept, freshAccept)) {
		return { paidRes: first, accept, refreshed: false, refreshSkipped: 'challenge_unchanged' };
	}
	const verdict = payableChallenge(freshAccept, limits);
	if (!verdict.ok) {
		return { paidRes: first, accept, refreshed: false, refreshSkipped: verdict.reason };
	}

	if (admit) {
		const admission = await admit(freshAccept);
		if (!admission.ok) {
			return {
				paidRes: first,
				accept,
				refreshed: false,
				refreshSkipped: admission.reason || 'admission_refused',
			};
		}
	}

	const second = await pay(freshAccept);
	return { paidRes: second, accept: freshAccept, refreshed: true };
}
