// Event Markets fairness: decides, when a pick is placed, whether it counts toward
// the leaderboard and rewards (placePick stamps the verdict on the pick). Everyone
// can play and change a pick until lock; only accounts that pass these checks are
// ranked, so spinning up throwaway accounts to farm the board earns nothing.
// Thresholds: data/event-market-scoring.json. One account, one pick per market
// is enforced by a unique key on the picks table. Agent calls never reach this
// ledger: they are scored on the forecaster board.

import { sql } from '../db.js';
import { CONFIG } from './scoring.js';

/**
 * Pure verdict over the signals loaded for an account.
 * @param {{created_at:string|number, email_verified:boolean, wallets:number, service_account:boolean}} account
 * @returns {{ranked:boolean, reason:string|null}}
 */
export function rankedVerdict(account, now = Date.now(), cfg = CONFIG.fairness) {
	if (!account) return { ranked: false, reason: 'unknown_account' };
	if (cfg.exclude_service_accounts && account.service_account) return { ranked: false, reason: 'service_account' };
	const ageHours = (new Date(now).getTime() - new Date(account.created_at).getTime()) / 3_600_000;
	if (!(ageHours >= cfg.min_account_age_hours)) return { ranked: false, reason: 'account_too_new' };
	if (cfg.require_linked_wallet_or_verified_email && !account.email_verified && !(account.wallets > 0)) {
		return { ranked: false, reason: 'unverified_account' };
	}
	return { ranked: true, reason: null };
}

/** Fairness signals for many accounts at once, keyed by account id. */
export async function loadAccountSignals(accountIds) {
	if (!accountIds.length) return new Map();
	const rows = await sql`
		select u.id, u.created_at, u.email_verified, coalesce(u.service_account, false) as service_account,
		       (select count(*)::int from user_wallets w where w.user_id = u.id) as wallets
		from users u where u.id = any(${accountIds}::uuid[]) and u.deleted_at is null
	`;
	return new Map(rows.map((r) => [r.id, r]));
}

/** Load one account's signals and return its ranked verdict. */
export async function rankedStatusFor(accountId, at = Date.now()) {
	const signals = await loadAccountSignals([accountId]);
	return rankedVerdict(signals.get(accountId), at);
}

export const UNRANKED_MESSAGES = Object.freeze({
	account_too_new: `Your pick is saved, but picks only count toward the leaderboard from accounts at least ${CONFIG.fairness.min_account_age_hours} hours old when the pick is placed.`,
	unverified_account: 'Your pick is saved, but it only counts toward the leaderboard once you verify your email or link a wallet.',
	service_account: 'Service accounts do not appear on the leaderboard.',
	unknown_account: 'Your pick is saved, but this account cannot be ranked.',
});
