// Event Markets leaderboard reads. Stats are rolled up by rollup.js; nothing here
// computes a score. Names are never an email: a profile name if it is not
// email-shaped, else the username, else a shortened linked wallet, else an
// anonymous forecaster tag from the account id.

import { sql } from '../db.js';
import { CONFIG, seasonFor, seasonById, rewardForRank } from './scoring.js';
import { SOURCE_KINDS } from './index.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const EMAILISH = /@|^\S+\.\S+$/;

/** A public-safe display name. PURE. */
export function publicName({ display_name, username, wallet, id }) {
	const dn = String(display_name || '').trim();
	if (dn && !EMAILISH.test(dn)) return dn.slice(0, 40);
	if (username) return String(username);
	if (wallet) return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
	return `Forecaster ${String(id).replace(/-/g, '').slice(0, 6)}`;
}

function shape(r, viewerId) {
	return {
		rank: r.rank == null ? null : n(r.rank),
		name: publicName({ display_name: r.display_name, username: r.username, wallet: r.wallet, id: r.account_id }),
		username: r.username || null,
		profile: r.username ? `/u/${encodeURIComponent(r.username)}` : null,
		avatar: r.avatar_url || null,
		score: n(r.score),
		calls: n(r.calls),
		hits: n(r.hits),
		hit_rate: n(r.calls) ? n(r.hits) / n(r.calls) : null,
		avg_odds: r.avg_odds == null ? null : n(r.avg_odds),
		best_call: n(r.best_call_delta),
		current_streak: n(r.current_streak),
		longest_streak: n(r.longest_streak),
		is_me: !!viewerId && r.account_id === viewerId,
	};
}


/**
 * The board for a scope. `season` is 'YYYY-Qn' or null for the current season;
 * `scope` 'all' reads all-time. The viewer's own row is pinned as `me` even
 * outside the top rows.
 */
export async function getLeaderboard({ scope = 'season', season = null, sourceKind = 'all', limit = 25, viewerId = null, now = Date.now() } = {}) {
	if (sourceKind !== 'all' && !SOURCE_KINDS.includes(sourceKind)) return { error: 'invalid_source_kind' };
	const seasonInfo = scope === 'season' ? (season ? seasonById(season, now) : seasonFor(now)) : null;
	if (scope === 'season' && !seasonInfo) return { error: 'invalid_season' };
	const seasonId = seasonInfo ? seasonInfo.id : '';
	const lim = Math.min(100, Math.max(1, Math.round(n(limit)) || 25));
	const rows = await sql`
		select s.account_id, s.rank, s.score, s.calls, s.hits, s.avg_odds, s.best_call_delta, s.current_streak, s.longest_streak,
		       u.display_name, u.username, u.avatar_url,
		       (select w.address from user_wallets w where w.user_id = u.id and w.chain_type = 'solana' order by w.is_primary desc, w.created_at limit 1) as wallet
		from event_market_stats s join users u on u.id = s.account_id
		where s.scope_kind = ${scope === 'season' ? 'season' : 'all'} and s.season_id = ${seasonId} and s.source_kind = ${sourceKind}
		  and u.deleted_at is null
		  and ((s.rank is not null and s.rank <= ${lim}) or s.account_id = ${viewerId})
		order by s.rank asc nulls last, s.account_id
	`;
	const all = rows.map((r) => shape(r, viewerId));
	return {
		scope: scope === 'season' ? 'season' : 'all',
		season: seasonInfo,
		source_kind: sourceKind,
		min_calls_to_rank: scope === 'season' ? CONFIG.seasons.min_calls_to_rank : 1,
		leaders: all.filter((r) => r.rank != null && r.rank <= lim),
		me: all.find((r) => r.is_me) || null,
	};
}

/** Seasons that have any ranked activity, newest first. */
export async function listSeasons(now = Date.now()) {
	const rows = await sql`select distinct season_id from event_market_stats where scope_kind = 'season' and source_kind = 'all' order by season_id desc`;
	const cur = seasonFor(now);
	const ids = new Set(rows.map((r) => r.season_id));
	ids.add(cur.id);
	return [...ids].sort().reverse().map((id) => seasonById(id, now));
}

/** One account's all-time stats plus its rank in the current season. */
export async function getAccountStats(accountId, now = Date.now()) {
	const season = seasonFor(now);
	const rows = await sql`
		select s.account_id, s.rank, s.score, s.calls, s.hits, s.avg_odds, s.best_call_delta, s.current_streak, s.longest_streak,
		       u.display_name, u.username, u.avatar_url,
		       (select w.address from user_wallets w where w.user_id = u.id and w.chain_type = 'solana' order by w.is_primary desc, w.created_at limit 1) as wallet, s.scope_kind, s.season_id
		from event_market_stats s join users u on u.id = s.account_id
		where s.account_id = ${accountId} and s.source_kind = 'all'
		  and ((s.scope_kind = 'all') or (s.scope_kind = 'season' and s.season_id = ${season.id}))
	`;
	const all = rows.find((r) => r.scope_kind === 'all');
	const cur = rows.find((r) => r.scope_kind === 'season');
	return {
		season,
		all_time: all ? shape(all, accountId) : null,
		season_standing: cur ? shape(cur, accountId) : null,
	};
}

/**
 * The published reward list for a season that has ended: rank, public name,
 * $THREE amount and perk. Wallet addresses are not published. Status shows whether
 * the owner has approved or paid it; until then it is a proposal.
 */
export async function getSeasonRewards(seasonId, now = Date.now()) {
	const season = seasonById(seasonId, now);
	if (!season) return { error: 'invalid_season' };
	if (!season.ended) return { season, published: false, rewards: [] };
	const rows = await sql`
		select p.rank, p.amount, p.token, p.chain, p.perk, p.status, p.account_id, u.display_name, u.username,
		       (select w.address from user_wallets w where w.user_id = u.id and w.chain_type = 'solana' order by w.is_primary desc, w.created_at limit 1) as wallet
		from event_market_season_payouts p join users u on u.id = p.account_id
		where p.season_id = ${season.id}
		order by p.rank, p.account_id
	`;
	return {
		season,
		published: true,
		settlement: CONFIG.rewards.settlement,
		rewards: rows.map((r) => ({
			rank: n(r.rank),
			name: publicName({ display_name: r.display_name, username: r.username, wallet: r.wallet, id: r.account_id }),
			profile: r.username ? `/u/${encodeURIComponent(r.username)}` : null,
			amount: n(r.amount),
			token: r.token,
			chain: r.chain,
			perk: r.perk,
			status: r.status,
		})),
		tiers: CONFIG.rewards.tiers.map((t) => ({ ...t, ranks: t.from_rank === t.to_rank ? `${t.from_rank}` : `${t.from_rank}-${t.to_rank}` })),
	};
}

export { rewardForRank };
