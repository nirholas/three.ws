// Two-sided referral activation rewards + viral-funnel math.
//
// The referral system attributes signups (users.referred_by_id) and accrues
// commission on a referred user's confirmed PURCHASES (api/_lib/referrals.js,
// users.referral_earnings_total). That rewards the referrer only when the
// referred user spends money — it does nothing at the activation moment and
// gives the new user no reason to stick.
//
// This module closes that gap: the instant a referred user reaches their first
// win (api/_lib/activation.js → markActivated), BOTH sides are granted platform
// credits toward the paid lanes. Credits ride the existing ledger
// (api/_lib/credits.js, kind='grant', ref_type='referral_activation') so the
// grant is atomic, idempotent, and shows up in the user's credits history with
// no new balance table.
//
// Everything here is best-effort: a reward failure can never break the
// activation it is reacting to. Callers fire-and-forget.

import { createHash } from 'crypto';
import { sql } from './db.js';
import { creditAccount } from './credits.js';
import { recordEvent } from './usage.js';
import { insertNotification } from './notify.js';

// ── Config ─────────────────────────────────────────────────────────────────────
// Reward amounts and abuse caps are env-tunable so growth can dial the loop
// without a redeploy. Defaults are deliberately modest: enough to be felt as a
// real welcome / thank-you, small enough that farming is unprofitable under the
// per-referrer monthly cap.

/**
 * Parse referral-reward config from an env-like object. Pure — no I/O — so the
 * defaults and clamps are unit-testable. Negative or non-finite inputs fall back
 * to the default; amounts are clamped to a sane ceiling so a fat-fingered env
 * var can't mint a fortune.
 *
 * @param {Record<string,string|undefined>} [e]
 * @returns {{ enabled: boolean, referredUsd: number, referrerUsd: number, monthlyCap: number, dailyCap: number }}
 */
export function parseRewardConfig(e = process.env) {
	const num = (raw, dflt, max) => {
		const v = Number.parseFloat(raw);
		if (!Number.isFinite(v) || v < 0) return dflt;
		return Math.min(v, max);
	};
	const int = (raw, dflt, max) => {
		const v = Number.parseInt(raw, 10);
		if (!Number.isFinite(v) || v < 0) return dflt;
		return Math.min(v, max);
	};
	// Off by default unless explicitly disabled — the loop should run in prod.
	const enabled = String(e.REFERRAL_REWARDS_ENABLED ?? 'true').toLowerCase() !== 'false';
	return {
		enabled,
		referredUsd: num(e.REFERRAL_REFERRED_REWARD_USD, 1.0, 100),
		referrerUsd: num(e.REFERRAL_REFERRER_REWARD_USD, 2.0, 100),
		// Max rewarded activations a single referrer can earn per rolling 30 days.
		// Caps farm-and-burn rings without throttling a genuinely viral member —
		// raise via env for a real influencer.
		monthlyCap: int(e.REFERRAL_ACTIVATION_MONTHLY_CAP, 200, 100_000),
		// Max rewarded activations per referrer per rolling day, so a scripted ring
		// cannot spend the whole monthly allowance in one burst.
		dailyCap: int(e.REFERRAL_ACTIVATION_DAILY_CAP, 20, 100_000),
	};
}

// ── Viral funnel math (pure) ─────────────────────────────────────────────────────

/**
 * k-factor: the number of NEW referred signups each sharing user brings in over
 * a window. k > 1 is self-sustaining viral growth. Defined as
 * referred-signups ÷ distinct-sharers (users who drove at least one tracked
 * referral visit in the window). Returns 0 when nobody shared.
 *
 * @param {{ signups: number, sharers: number }} args
 * @returns {number} k, rounded to 3 decimals
 */
export function computeKFactor({ signups, sharers }) {
	const s = Number(signups) || 0;
	const n = Number(sharers) || 0;
	if (n <= 0) return 0;
	return Math.round((s / n) * 1000) / 1000;
}

/**
 * Safe conversion rate (0..1, 3 decimals). 0 when the denominator is 0.
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
export function conversionRate(numerator, denominator) {
	const a = Number(numerator) || 0;
	const b = Number(denominator) || 0;
	if (b <= 0) return 0;
	return Math.round((a / b) * 1000) / 1000;
}

/**
 * Deterministic, non-reversible visitor fingerprint for referral-visit dedup.
 * Hashes IP + user-agent + code so the same person hitting the same link is
 * counted once per day — without ever storing the raw IP/UA. Code is folded in
 * so the same visitor on two different links counts as two visits (correct: two
 * distinct shares reached them).
 *
 * @param {{ ip?: string, ua?: string, code: string }} args
 * @returns {string} 64-char hex sha256
 */
export function referralVisitorHash({ ip = '', ua = '', code = '' }) {
	return createHash('sha256')
		.update(`${ip}|${ua}|${String(code).toUpperCase()}`)
		.digest('hex');
}

// ── Reward grant (write side) ────────────────────────────────────────────────────

/**
 * Grant the two-sided activation reward when a referred user reaches their first
 * win. Idempotent and abuse-guarded:
 *
 *   • No-op for organic users (no referrer attributed).
 *   • The referred-side grant is keyed `referral:activation:referred:<id>` and the
 *     referrer-side grant `referral:activation:referrer:<id>` — both keyed on the
 *     REFERRED user's id, so each fires exactly once ever (the credit ledger's
 *     unique idempotency_key enforces this even under concurrent activations).
 *   • Self-referral is structurally impossible (referred_by_id can't be self),
 *     but we re-check and skip anyway.
 *   • The referrer reward is skipped once they've earned `monthlyCap` activation
 *     rewards in the trailing 30 days — farming N throwaway accounts past the cap
 *     earns the ring nothing. The referred-side welcome credit still applies (it's
 *     one-time per real account and harmless).
 *
 * Never throws — wraps all work so it can't break the activation that triggered
 * it. Returns a summary for logging/telemetry.
 *
 * @param {{ referredUserId: string }} args
 * @returns {Promise<{ granted: boolean, reason?: string, referredCredited?: boolean, referrerCredited?: boolean, referrerCapped?: boolean }>}
 */
export async function grantReferralActivationReward({ referredUserId }) {
	const cfg = parseRewardConfig();
	if (!cfg.enabled) return { granted: false, reason: 'disabled' };
	if (!referredUserId) return { granted: false, reason: 'no_user' };

	try {
		const [user] = await sql`
			select id, referred_by_id, display_name, username
			from users
			where id = ${referredUserId} and deleted_at is null
		`;
		if (!user) return { granted: false, reason: 'user_not_found' };
		if (user.referred_by_id == null) return { granted: false, reason: 'organic' };
		const referrerId = user.referred_by_id;
		if (String(referrerId) === String(referredUserId)) {
			return { granted: false, reason: 'self_referral' };
		}

		const [referrer] = await sql`
			select id, display_name, username from users
			where id = ${referrerId} and deleted_at is null
		`;
		// Referrer deleted/closed since signup — still welcome the new user.
		const referrerLive = !!referrer;

		const referredName = user.display_name || user.username || null;
		const referrerName = referrer?.display_name || referrer?.username || null;

		// 1) Welcome credit for the newly-activated referred user.
		let referredCredited = false;
		if (cfg.referredUsd > 0) {
			const r = await creditAccount({
				userId: referredUserId,
				amountUsd: cfg.referredUsd,
				kind: 'grant',
				action: 'referral.activation',
				refType: 'referral_activation',
				refId: String(referredUserId),
				idempotencyKey: `referral:activation:referred:${referredUserId}`,
				meta: { role: 'referred', referrer_user_id: String(referrerId) },
			});
			referredCredited = !r.replay;
			if (referredCredited) {
				recordEvent({
					userId: referredUserId,
					kind: 'referral_activation',
					meta: { role: 'referred', amount_usd: cfg.referredUsd, referrer_user_id: String(referrerId) },
				});
				insertNotification(referredUserId, 'referral_reward', {
					role: 'referred',
					amount_usd: cfg.referredUsd,
					from_name: referrerName,
				});
			}
		}

		// 2) Thank-you credit for the referrer — capped per rolling 30 days.
		let referrerCredited = false;
		let referrerCapped = false;
		if (referrerLive && cfg.referrerUsd > 0) {
			const [{ count }] = await sql`
				select count(*)::int as count from credit_ledger
				where user_id = ${referrerId}
				  and ref_type = 'referral_activation'
				  and kind = 'grant'
				  and created_at > now() - interval '30 days'
			`;
			const [{ count: dayCount }] = await sql`
				select count(*)::int as count from credit_ledger
				where user_id = ${referrerId}
				  and ref_type = 'referral_activation'
				  and kind = 'grant'
				  and created_at > now() - interval '1 day'
			`;
			if (Number(count) >= cfg.monthlyCap || Number(dayCount) >= cfg.dailyCap) {
				referrerCapped = true;
			} else {
				const r = await creditAccount({
					userId: referrerId,
					amountUsd: cfg.referrerUsd,
					kind: 'grant',
					action: 'referral.activation',
					refType: 'referral_activation',
					refId: String(referredUserId),
					idempotencyKey: `referral:activation:referrer:${referredUserId}`,
					meta: { role: 'referrer', referred_user_id: String(referredUserId) },
				});
				referrerCredited = !r.replay;
				if (referrerCredited) {
					recordEvent({
						userId: referrerId,
						kind: 'referral_activation',
						meta: { role: 'referrer', amount_usd: cfg.referrerUsd, referred_user_id: String(referredUserId) },
					});
					insertNotification(referrerId, 'referral_reward', {
						role: 'referrer',
						amount_usd: cfg.referrerUsd,
						referred_name: referredName,
					});
				}
			}
		}

		return { granted: referredCredited || referrerCredited, referredCredited, referrerCredited, referrerCapped };
	} catch (err) {
		console.error('[referral-rewards] grant failed', err?.message);
		return { granted: false, reason: 'error' };
	}
}
