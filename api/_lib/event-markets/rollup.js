// Event Markets rollup: turns resolved markets into scores, stats, ranks, badges
// and season payout proposals. Called by api/cron/event-markets-rollup.js.
//
// Idempotent end to end. A settled pick is written to event_market_scores once
// (primary key market_id + account_id, insert ... on conflict do nothing), stats
// are recomputed from that ledger only for the seasons that gained rows, badges
// are unique per (user, code), and payout proposals are unique per (season,
// account). A rerun with nothing new changes nothing. Paying a proposal is
// owner-gated and is never done here.

import { sql } from '../db.js';
import { unlockBadge } from '../streaks.js';
import { impliedOdds } from './index.js';
import { loadAccountSignals, rankedVerdict } from './fairness.js';
import {
	CONFIG, clampStake, scorePick, pickProbability, seasonFor, seasonById, computeStats, rankAccounts, pickBadgesFor, rewardForRank,
} from './scoring.js';

const MARKET_BATCH = 200;

/**
 * Fallback for a pick that carries no odds_at_pick (placed before the column
 * existed): the odds each account saw when it made its standing pick, replayed from the
 * append-only pick log with the same impliedOdds the market page uses. The odds
 * are those of the market right before the pick, without the account's own
 * earlier pick, so staking on an outcome never lowers its own payout. PURE.
 * @param {{outcome_id:string, account_id:string, points:number, action:string}[]} log ordered by id
 * @param {string[]} outcomeIds
 * @returns {Map<string, number>} account id -> probability of the picked outcome at pick time
 */
export function oddsAtPickFromLog(log, outcomeIds) {
	const live = new Map();
	const seen = new Map();
	for (const e of log) {
		if (e.action === 'withdraw' || e.action === 'void') {
			live.delete(e.account_id);
			seen.delete(e.account_id);
			continue;
		}
		live.delete(e.account_id);
		const tally = new Map(outcomeIds.map((id) => [id, { id, points: 0, picks: 0 }]));
		for (const p of live.values()) {
			const t = tally.get(p.outcome_id);
			if (t) {
				t.points += p.points;
				t.picks += 1;
			}
		}
		const share = impliedOdds([...tally.values()]).outcomes.find((o) => o.outcome_id === e.outcome_id)?.share;
		seen.set(e.account_id, Number(share));
		live.set(e.account_id, { outcome_id: e.outcome_id, points: e.points });
	}
	return seen;
}

/** Ledger rows for picks on resolved markets that have not been scored. PURE. */
export function buildScoreRows(picks, oddsByMarket, verdictFor) {
	return picks.map((p) => {
		const stored = p.odds_at_pick == null ? null : Number(p.odds_at_pick);
		const odds = pickProbability(stored ?? oddsByMarket.get(p.market_id)?.get(p.account_id), p.outcome_count);
		const correct = p.outcome_id === p.winner_outcome_id;
		const verdict = verdictFor(p);
		const settled = p.resolved_at || p.updated_at;
		return {
			market_id: p.market_id,
			account_id: p.account_id,
			source_kind: p.source_kind,
			season_id: seasonFor(p.locks_at).id,
			correct,
			points_staked: clampStake(p.points),
			odds_at_pick: odds,
			delta: scorePick({ correct, points: p.points, odds, outcomeCount: p.outcome_count }),
			ranked: verdict.ranked,
			unranked_reason: verdict.reason,
			settled_at: new Date(settled).toISOString(),
		};
	});
}

async function settleResolvedMarkets() {
	const markets = await sql`
		select distinct m.id, m.resolved_at
		from event_markets m
		join event_market_picks k on k.market_id = m.id and k.agent_id is null
		where m.status = 'resolved' and m.winner_outcome_id is not null
		  and not exists (select 1 from event_market_scores s where s.market_id = m.id and s.account_id = k.account_id)
		order by m.resolved_at nulls last, m.id
		limit ${MARKET_BATCH}
	`;
	if (!markets.length) return { inserted: 0, accounts: new Set(), seasons: new Set() };
	const ids = markets.map((m) => m.id);
	const picks = await sql`
		select k.market_id, k.account_id, k.outcome_id, k.points, k.created_at as picked_at, k.odds_at_pick, k.ranked,
		       m.source_kind, m.locks_at, m.updated_at, m.resolved_at, m.winner_outcome_id,
		       (select count(*)::int from event_market_outcomes o where o.market_id = m.id) as outcome_count
		from event_market_picks k
		join event_markets m on m.id = k.market_id
		where k.market_id = any(${ids}::uuid[]) and k.agent_id is null
		  and not exists (select 1 from event_market_scores s where s.market_id = k.market_id and s.account_id = k.account_id)
	`;
	const outcomes = await sql`select id, market_id from event_market_outcomes where market_id = any(${ids}::uuid[])`;
	const log = await sql`
		select market_id, outcome_id, account_id, points, action
		from event_market_pick_log where market_id = any(${ids}::uuid[]) order by id asc
	`;
	const outcomeIds = new Map();
	for (const o of outcomes) outcomeIds.set(o.market_id, [...(outcomeIds.get(o.market_id) || []), o.id]);
	const logByMarket = new Map();
	for (const e of log) logByMarket.set(e.market_id, [...(logByMarket.get(e.market_id) || []), e]);
	const oddsByMarket = new Map(ids.map((id) => [id, oddsAtPickFromLog(logByMarket.get(id) || [], outcomeIds.get(id) || [])]));

	const unranked = picks.filter((p) => !p.ranked);
	const signals = await loadAccountSignals([...new Set(unranked.map((p) => p.account_id))]);
	const verdictFor = (p) => (p.ranked ? { ranked: true, reason: null } : { ranked: false, reason: rankedVerdict(signals.get(p.account_id), p.picked_at).reason || 'unranked_at_pick' });
	const rows = buildScoreRows(picks, oddsByMarket, verdictFor);
	return writeScores(rows);
}

async function writeScores(rows) {
	const inserted = await sql`
		insert into event_market_scores (market_id, account_id, source_kind, season_id, correct, points_staked, odds_at_pick, delta, ranked, unranked_reason, settled_at)
		select * from unnest(
			${rows.map((r) => r.market_id)}::uuid[], ${rows.map((r) => r.account_id)}::uuid[], ${rows.map((r) => r.source_kind)}::text[],
			${rows.map((r) => r.season_id)}::text[], ${rows.map((r) => r.correct)}::boolean[], ${rows.map((r) => r.points_staked)}::int[],
			${rows.map((r) => r.odds_at_pick)}::numeric[], ${rows.map((r) => r.delta)}::int[], ${rows.map((r) => r.ranked)}::boolean[],
			${rows.map((r) => r.unranked_reason)}::text[], ${rows.map((r) => r.settled_at)}::timestamptz[]
		)
		on conflict (market_id, account_id) do nothing
		returning account_id, season_id
	`;
	return {
		inserted: inserted.length,
		accounts: new Set(inserted.map((r) => r.account_id)),
		seasons: new Set(inserted.map((r) => r.season_id)),
	};
}

/** Stats rows for one scope: every source kind plus 'all', ranked. PURE. */
export function statsForScope(ledger, { scope_kind, season_id }) {
	const inScope = ledger.filter((r) => r.ranked && (scope_kind === 'all' || r.season_id === season_id));
	const kinds = ['all', ...new Set(inScope.map((r) => r.source_kind))];
	const minCalls = scope_kind === 'season' ? CONFIG.seasons.min_calls_to_rank : 1;
	const out = [];
	for (const kind of kinds) {
		const byAccount = new Map();
		for (const r of inScope) {
			if (kind !== 'all' && r.source_kind !== kind) continue;
			if (!byAccount.has(r.account_id)) byAccount.set(r.account_id, []);
			byAccount.get(r.account_id).push(r);
		}
		const entries = [...byAccount].map(([account_id, rows]) => ({ account_id, ...computeStats(rows) }));
		const ranked = new Map(rankAccounts(entries, { minCalls }).map((e) => [e.account_id, e.rank]));
		for (const e of entries) {
			out.push({ scope_kind, season_id: scope_kind === 'all' ? '' : season_id, source_kind: kind, ...e, rank: ranked.get(e.account_id) ?? null });
		}
	}
	return out;
}

async function writeStats(rows) {
	for (let i = 0; i < rows.length; i += 500) {
		const b = rows.slice(i, i + 500);
		await sql`
			insert into event_market_stats (scope_kind, season_id, source_kind, account_id, calls, hits, score, avg_odds, best_call_delta, best_call_market, current_streak, longest_streak, rank, updated_at)
			select *, now() from unnest(
				${b.map((r) => r.scope_kind)}::text[], ${b.map((r) => r.season_id)}::text[], ${b.map((r) => r.source_kind)}::text[],
				${b.map((r) => r.account_id)}::uuid[], ${b.map((r) => r.calls)}::int[], ${b.map((r) => r.hits)}::int[], ${b.map((r) => r.score)}::int[],
				${b.map((r) => r.avg_odds)}::numeric[], ${b.map((r) => r.best_call_delta)}::int[], ${b.map((r) => r.best_call_market)}::uuid[],
				${b.map((r) => r.current_streak)}::int[], ${b.map((r) => r.longest_streak)}::int[], ${b.map((r) => r.rank)}::int[]
			)
			on conflict (scope_kind, season_id, source_kind, account_id) do update set
				calls = excluded.calls, hits = excluded.hits, score = excluded.score, avg_odds = excluded.avg_odds,
				best_call_delta = excluded.best_call_delta, best_call_market = excluded.best_call_market,
				current_streak = excluded.current_streak, longest_streak = excluded.longest_streak,
				rank = excluded.rank, updated_at = now()
		`;
	}
}

async function awardPickBadges(accountIds) {
	const fresh = [];
	for (const accountId of accountIds) {
		const rows = await sql`
			select market_id, correct, odds_at_pick, delta, settled_at
			from event_market_scores where account_id = ${accountId} and ranked
		`;
		for (const code of pickBadgesFor(rows)) {
			if (await unlockBadge(accountId, code)) fresh.push({ accountId, code });
		}
	}
	return fresh;
}

/** Badges and payout proposals for seasons that have ended. */
async function finalizeEndedSeasons(now) {
	const seasonRows = await sql`select distinct season_id from event_market_stats where scope_kind = 'season' and source_kind = 'all'`;
	const ended = seasonRows.map((r) => seasonById(r.season_id, now)).filter((s) => s && s.ended);
	let badges = 0;
	let proposals = 0;
	for (const season of ended) {
		const top = await sql`
			select s.account_id, s.rank, s.score, u.deleted_at
			from event_market_stats s join users u on u.id = s.account_id
			where s.scope_kind = 'season' and s.season_id = ${season.id} and s.source_kind = 'all'
			  and s.rank is not null and s.score > 0 and s.rank <= ${CONFIG.badges.season_top_n} and u.deleted_at is null
			order by s.rank, s.account_id
		`;
		for (const r of top) {
			if (await unlockBadge(r.account_id, 'em_season_top10', { season: season.id, rank: r.rank })) badges += 1;
			if (r.rank === 1 && (await unlockBadge(r.account_id, 'em_season_champion', { season: season.id }))) badges += 1;
		}
		const rewarded = top.filter((r) => rewardForRank(r.rank));
		for (const r of rewarded) {
			const tier = rewardForRank(r.rank);
			const [wallet] = await sql`
				select address from user_wallets where user_id = ${r.account_id} and chain_type = 'solana'
				order by is_primary desc, last_used_at desc nulls last, created_at limit 1
			`;
			const ins = await sql`
				insert into event_market_season_payouts (season_id, rank, account_id, wallet_address, amount, token, chain, perk, note)
				values (${season.id}, ${r.rank}, ${r.account_id}, ${wallet?.address ?? null}, ${tier.three}, ${CONFIG.rewards.token}, ${CONFIG.rewards.chain}, ${tier.perk},
				        ${wallet ? null : 'No linked Solana wallet: the winner must link one before this can be paid.'})
				on conflict (season_id, account_id) do nothing
				returning account_id
			`;
			proposals += ins.length;
		}
	}
	return { badges, proposals, endedSeasons: ended.map((s) => s.id) };
}

/**
 * Seasons whose stored stats no longer match the ledger, e.g. after an admin
 * override deleted a market's scores so the winner can be re-scored. Compares
 * ranked-call counts per season in the ledger with the sum of calls in stats.
 */
async function staleSeasons() {
	const rows = await sql`
		select coalesce(l.season_id, t.season_id) as season_id, coalesce(l.n, 0) as ledger, coalesce(t.n, 0) as stored
		from (select season_id, count(*)::int as n from event_market_scores where ranked group by season_id) l
		full join (select season_id, sum(calls)::int as n from event_market_stats where scope_kind = 'season' and source_kind = 'all' group by season_id) t
		  on t.season_id = l.season_id
	`;
	return rows.filter((r) => r.ledger !== r.stored).map((r) => r.season_id);
}

/**
 * Run the rollup. `full` recomputes every season and the all-time scope from the
 * ledger even when nothing new settled (used after a scoring-config change).
 */
export async function runRollup({ now = Date.now(), full = false } = {}) {
	const settled = await settleResolvedMarkets();
	const seasons = new Set(settled.seasons);
	for (const id of await staleSeasons()) seasons.add(id);
	if (full) {
		for (const r of await sql`select distinct season_id from event_market_scores`) seasons.add(r.season_id);
	}
	let statRows = 0;
	if (seasons.size || full) {
		const ledger = await sql`
			select market_id, account_id, source_kind, season_id, correct, odds_at_pick, delta, ranked, settled_at
			from event_market_scores where ranked
		`;
		const rows = [
			...statsForScope(ledger, { scope_kind: 'all', season_id: '' }),
			...[...seasons].flatMap((id) => statsForScope(ledger, { scope_kind: 'season', season_id: id })),
		];
		await clearStaleStats(ledger, seasons);
		await writeStats(rows);
		statRows = rows.length;
	}
	const accounts = full
		? new Set((await sql`select distinct account_id from event_market_scores where ranked`).map((r) => r.account_id))
		: settled.accounts;
	const fresh = accounts.size ? await awardPickBadges(accounts) : [];
	const fin = await finalizeEndedSeasons(now);
	return { scored: settled.inserted, statRows, badgesAwarded: fresh.length + fin.badges, payoutProposals: fin.proposals, endedSeasons: fin.endedSeasons };
}

/** Remove stats rows for accounts that no longer have any ranked call in a recomputed scope. */
async function clearStaleStats(ledger, seasons) {
	const keep = (seasonId) => new Set(ledger.filter((r) => seasonId === '' || r.season_id === seasonId).map((r) => r.account_id));
	for (const [scope, seasonId] of [['all', ''], ...[...seasons].map((id) => ['season', id])]) {
		const accounts = [...keep(seasonId)];
		await sql`
			delete from event_market_stats
			where scope_kind = ${scope} and season_id = ${seasonId} and not (account_id = any(${accounts}::uuid[]))
		`;
	}
}
