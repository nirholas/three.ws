// Referral credit for picks made through an entrant's share link. A link carries
// ?ref=<referral code>. The first pick an account makes through it credits the
// referrer; the credit is once per referred account, ever, and a self-referral
// credits nothing.

import { sql } from '../db.js';
import { entrantConfig } from './entrant-config.js';

/** The account behind a referral code, or null. */
export async function accountForRefCode(code) {
	const c = String(code || '').trim().toUpperCase();
	if (!/^[A-Z0-9]{3,20}$/.test(c)) return null;
	const [row] = await sql`select id from users where upper(referral_code) = ${c} and deleted_at is null limit 1`;
	return row?.id || null;
}

/**
 * Credit the referrer for `pick` when it is the referred account's first pick
 * and arrived through a valid, non-self link.
 * @returns {Promise<{ credited: boolean, points: number }>}
 */
export async function creditReferral({ pick, referrerId, referredId }) {
	if (!referrerId || referrerId === referredId) return { credited: false, points: 0 };
	await sql`
		insert into event_market_pick_referrals (market_id, account_id, referrer_id)
		values (${pick.market_id}, ${referredId}, ${referrerId})
		on conflict (market_id, account_id) do nothing`;
	const [row] = await sql`
		insert into event_market_point_credits (account_id, kind, points, market_id, referred_account_id)
		values (${referrerId}, 'referral', ${entrantConfig().credit_points}, ${pick.market_id}, ${referredId})
		on conflict (referred_account_id) where kind = 'referral' do nothing
		returning points`;
	return row ? { credited: true, points: row.points } : { credited: false, points: 0 };
}

export async function referralPointsFor(accountId) {
	const [row] = await sql`select coalesce(sum(points), 0)::int as points, count(*)::int as credits from event_market_point_credits where account_id = ${accountId} and kind = 'referral'`;
	return { points: row.points, credits: row.credits };
}
