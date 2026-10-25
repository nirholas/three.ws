// Platform-side ceilings for autonomous A2A payments.
//
// The A2A rail signs with a platform-held payer key, not the caller's wallet, and
// the mandate that authorizes a payment is self-issued by the caller. Neither the
// mandate nor the agent's own spend limits (which default to unset) can therefore
// be the last line of defence: a user could issue themselves a huge mandate and
// point the payer key at a peer they run. These ceilings are set by the platform,
// cannot be widened by a mandate or by agent meta, and bound both what one user
// and what the whole payer wallet can send in a day.
//
// Amounts are USDC atomics (6 decimals). Overrides come from the environment so
// ops can raise them without a deploy of new code.

import { release, reserve } from './spend-ledger.js';

function atomicsFromEnv(name, fallback) {
	const raw = process.env[name];
	if (raw == null || raw === '') return fallback;
	const n = Number(raw);
	return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

const DAY_SEC = 24 * 60 * 60;

export function platformLimits() {
	return {
		maxMandateAtomics: atomicsFromEnv('A2A_PLATFORM_MAX_MANDATE_ATOMICS', 100_000_000), // $100
		perCallAtomics: atomicsFromEnv('A2A_PLATFORM_PER_CALL_ATOMICS', 25_000_000), // $25
		perUserDailyAtomics: atomicsFromEnv('A2A_PLATFORM_USER_DAILY_ATOMICS', 50_000_000), // $50
		platformDailyAtomics: atomicsFromEnv('A2A_PLATFORM_DAILY_ATOMICS', 500_000_000), // $500
	};
}

export class PlatformCeilingError extends Error {
	constructor(code, message, detail = {}) {
		super(message);
		this.name = 'PlatformCeilingError';
		this.code = code;
		this.status = 403;
		this.detail = detail;
	}
}

const userKey = (userId) => `platform:user-day:${userId}`;
const PLATFORM_KEY = 'platform:payer-day';

/**
 * Reserve `amount` against the per-call, per-user daily and payer-wide daily
 * ceilings. Throws PlatformCeilingError (nothing left reserved) when any is hit.
 * On success the caller owns the reservation and must releasePlatformCeiling it
 * if the payment does not settle.
 */
export async function reservePlatformCeiling({ userId, amount }) {
	const limits = platformLimits();
	const amt = Number(amount);
	if (!Number.isSafeInteger(amt) || amt <= 0) {
		throw new PlatformCeilingError('invalid_amount', 'payment amount is not a usable atomic amount');
	}
	if (amt > limits.perCallAtomics) {
		throw new PlatformCeilingError(
			'platform_per_call_exceeded',
			'this payment is over the platform per-call ceiling for autonomous payments',
			{ amount: String(amt), cap: String(limits.perCallAtomics) },
		);
	}
	const user = await reserve(userKey(userId), amt, limits.perUserDailyAtomics, DAY_SEC);
	if (!user.ok) {
		throw new PlatformCeilingError(
			'platform_user_daily_exceeded',
			'your autonomous payments would exceed the platform daily ceiling',
			{ spent: String(user.spent), cap: String(user.cap) },
		);
	}
	const platform = await reserve(PLATFORM_KEY, amt, limits.platformDailyAtomics, DAY_SEC);
	if (!platform.ok) {
		await release(userKey(userId), amt);
		throw new PlatformCeilingError(
			'platform_daily_exceeded',
			'autonomous payments are temporarily capped platform-wide, try again later',
			{},
		);
	}
}

export async function releasePlatformCeiling({ userId, amount }) {
	const amt = Number(amount);
	await release(userKey(userId), amt);
	await release(PLATFORM_KEY, amt);
}
