// Event Markets scoring, streaks, seasons, fairness and the idempotent rollup.
// Pure scoring is tested directly; the rollup runs the real SQL and the real
// migrations in an in-process Postgres (PGlite).

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const EM = await import('../api/_lib/event-markets/index.js');
const S = await import('../api/_lib/event-markets/scoring.js');
const { PRIOR_POINTS_PER_OUTCOME: K } = await import('../api/_lib/event-markets/config.js');
const { oddsAtPickFromLog, runRollup, buildScoreRows } = await import('../api/_lib/event-markets/rollup.js');
const { rankedVerdict } = await import('../api/_lib/event-markets/fairness.js');
const { publicName, getLeaderboard, getSeasonRewards } = await import('../api/_lib/event-markets/leaderboard.js');

const mig = (name) => readFileSync(new URL(`../api/_lib/migrations/${name}`, import.meta.url), 'utf8');

const uid = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const ADMIN = uid(9);
const [ALICE, BOB, CARA, NEWBIE, BOT] = [uid(1), uid(2), uid(3), uid(4), uid(5)];
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`
		create table users (id uuid primary key, created_at timestamptz not null default now(), email_verified boolean not null default false,
			service_account boolean not null default false, deleted_at timestamptz, display_name text, username text, avatar_url text);
		create table user_wallets (id bigserial primary key, user_id uuid not null references users(id), address text not null,
			chain_type text not null default 'solana', is_primary boolean not null default false, last_used_at timestamptz, created_at timestamptz not null default now());
		create table user_badges (id bigserial primary key, user_id uuid not null references users(id) on delete cascade, code text not null, context jsonb, unlocked_at timestamptz not null default now());
		create unique index user_badges_uniq on user_badges (user_id, code);
		create table agent_identities (id uuid primary key);`);
	await holder.db.exec(mig('20261011020000_event_markets.sql'));
	await holder.db.exec(mig('20261012120000_event_market_agent_forecasting.sql'));
	await holder.db.exec(mig('20261012130000_event_market_resolution.sql'));
	await holder.db.exec(mig('20261012400000_event_market_scoring.sql'));
});

beforeEach(async () => {
	await holder.db.exec(`truncate event_market_season_payouts, event_market_stats, event_market_scores, event_market_pick_log,
		event_market_picks, event_market_outcomes, event_markets, user_badges, user_wallets, users cascade`);
	await holder.db.exec(`insert into users (id, created_at, email_verified, display_name, username) values
		('${ADMIN}', now() - interval '90 days', true, 'Admin', 'admin'),
		('${ALICE}', now() - interval '60 days', true, 'alice@example.com', 'alice'),
		('${BOB}', now() - interval '60 days', true, 'Bob', 'bob'),
		('${CARA}', now() - interval '60 days', true, 'Cara', null),
		('${NEWBIE}', now() - interval '1 hour', true, 'Newbie', 'newbie'),
		('${BOT}', now() - interval '60 days', true, 'Bot', 'bot');
		update users set service_account = true where id = '${BOT}';
		insert into user_wallets (user_id, address) values ('${CARA}', 'CaraWa11etAddr3ssSo1anaXXXXXXXXXXXXXXXXXX');`);
});

async function make(title = 'Who wins?', outcomes = ['Alpha', 'Beta', 'Gamma']) {
	return EM.createMarket({ title, source_kind: 'build_round', locks_at: inHours(2), outcomes: outcomes.map((label) => ({ label })), created_by: ADMIN });
}
const pick = (market, accountId, label, points = 50) =>
	EM.placePick({ market: market.id, accountId, outcomeId: market.outcomes.find((o) => o.label === label).id, points });
const resolve = (market, label) => EM.resolveMarket(market.id, market.outcomes.find((o) => o.label === label).id);
const rows = (q) => holder.db.query(q);

describe('scorePick', () => {
	it('pays a heavy favourite little, floored at the minimum multiplier', () => {
		expect(S.scorePick({ correct: true, points: 100, odds: 0.95 })).toBe(10);
		expect(S.scorePick({ correct: true, points: 100, odds: 0.9 })).toBe(11);
	});
	it('pays an upset a lot, capped at the maximum multiplier', () => {
		expect(S.scorePick({ correct: true, points: 100, odds: 0.1 })).toBe(900);
		expect(S.scorePick({ correct: true, points: 100, odds: 0.01 })).toBe(1000);
	});
	it('falls back to the even prior when there are no odds, never an invented favourite', () => {
		expect(S.pickProbability(undefined, 4)).toBe(0.25);
		expect(S.scorePick({ correct: true, points: 100, odds: null, outcomeCount: 4 })).toBe(300);
		expect(S.scorePick({ correct: true, points: 100, odds: 0, outcomeCount: 2 })).toBe(100);
	});
	it('charges the stake for a wrong call and always pays at least 1 for a right one', () => {
		expect(S.scorePick({ correct: false, points: 40, odds: 0.2 })).toBe(-40);
		expect(S.scorePick({ correct: true, points: 1, odds: 0.99 })).toBe(1);
	});
	it('is monotonic: the less likely the pick, the more a win pays', () => {
		const pays = [0.9, 0.7, 0.5, 0.3, 0.1].map((odds) => S.scorePick({ correct: true, points: 100, odds }));
		expect([...pays].sort((a, b) => a - b)).toEqual(pays);
	});
});

describe('seasons', () => {
	it('keys a season by UTC quarter, like the points budget', () => {
		expect(S.seasonFor('2026-11-15T00:00:00Z').id).toBe('2026-Q4');
		expect(S.seasonById('2026-Q4', Date.parse('2027-01-01T00:00:00Z')).ended).toBe(true);
		expect(S.seasonById('2026-Q4', Date.parse('2026-12-31T23:59:59Z')).ended).toBe(false);
		expect(S.seasonById('2026-13')).toBeNull();
	});
});

describe('computeStats', () => {
	const call = (i, correct, delta, odds = 0.5) => ({ market_id: `m${i}`, correct, delta, odds_at_pick: odds, settled_at: new Date(2026, 9, i + 1).toISOString() });
	it('counts streaks and resets the current one on a miss', () => {
		const s = S.computeStats([call(1, true, 50), call(2, true, 50), call(3, true, 50), call(4, false, -50), call(5, true, 50)]);
		expect(s).toMatchObject({ calls: 5, hits: 4, longest_streak: 3, current_streak: 1 });
	});
	it('never lets the running score go below zero', () => {
		const s = S.computeStats([call(1, false, -80), call(2, true, 30), call(3, false, -50)]);
		expect(s.score).toBe(0);
		expect(S.computeStats([call(1, false, -80), call(2, true, 120)]).score).toBe(120);
	});
	it('tracks the best call and average odds, independent of input order', () => {
		const a = [call(1, true, 40, 0.8), call(2, true, 300, 0.2), call(3, false, -10, 0.5)];
		const s = S.computeStats(a);
		expect(s.best_call_delta).toBe(300);
		expect(s.best_call_market).toBe('m2');
		expect(s.avg_odds).toBeCloseTo(0.5);
		expect(S.computeStats([...a].reverse())).toEqual(s);
	});
	it('is empty-safe', () => {
		expect(S.computeStats([])).toMatchObject({ calls: 0, hits: 0, score: 0, avg_odds: null, current_streak: 0 });
	});
});

describe('rankAccounts and badges', () => {
	it('orders by score, hits, fewer calls, and shares a rank on a full tie', () => {
		const out = S.rankAccounts([
			{ account_id: 'a', score: 100, hits: 2, calls: 3 },
			{ account_id: 'b', score: 100, hits: 2, calls: 3 },
			{ account_id: 'c', score: 100, hits: 3, calls: 5 },
			{ account_id: 'd', score: 500, hits: 1, calls: 1 },
		], { minCalls: 3 });
		expect(out.map((e) => [e.account_id, e.rank])).toEqual([['c', 1], ['a', 2], ['b', 2]]);
	});
	it('awards first-correct, upset and 5-in-a-row from the call history', () => {
		const win = (i, odds) => ({ market_id: `m${i}`, correct: true, delta: 50, odds_at_pick: odds, settled_at: new Date(2026, 9, i + 1).toISOString() });
		expect(S.pickBadgesFor([])).toEqual([]);
		expect(S.pickBadgesFor([{ ...win(1, 0.6), correct: false }])).toEqual([]);
		expect(S.pickBadgesFor([win(1, 0.6)])).toEqual(['em_first_correct']);
		expect(S.pickBadgesFor([win(1, 0.2)])).toEqual(['em_first_correct', 'em_upset_call']);
		expect(S.pickBadgesFor([1, 2, 3, 4, 5].map((i) => win(i, 0.5)))).toContain('em_streak_5');
	});
	it('maps a final rank to its reward tier', () => {
		expect(S.rewardForRank(1).three).toBe(50000);
		expect(S.rewardForRank(3).three).toBe(25000);
		expect(S.rewardForRank(10).three).toBe(10000);
		expect(S.rewardForRank(11)).toBeNull();
	});
});

describe('fairness', () => {
	const base = { created_at: '2026-01-01T00:00:00Z', email_verified: true, wallets: 0, service_account: false };
	const at = Date.parse('2026-06-01T00:00:00Z');
	it('ranks an aged, verified account', () => expect(rankedVerdict(base, at)).toEqual({ ranked: true, reason: null }));
	it('does not rank an account younger than the minimum age at pick time', () => {
		expect(rankedVerdict({ ...base, created_at: '2026-05-31T20:00:00Z' }, at).reason).toBe('account_too_new');
	});
	it('needs a verified email or a linked wallet', () => {
		expect(rankedVerdict({ ...base, email_verified: false }, at).reason).toBe('unverified_account');
		expect(rankedVerdict({ ...base, email_verified: false, wallets: 1 }, at).ranked).toBe(true);
	});
	it('excludes service accounts and unknown accounts', () => {
		expect(rankedVerdict({ ...base, service_account: true }, at).reason).toBe('service_account');
		expect(rankedVerdict(undefined, at).reason).toBe('unknown_account');
	});
});

describe('publicName', () => {
	it('never returns an email', () => {
		expect(publicName({ display_name: 'alice@example.com', username: 'alice', id: 'x' })).toBe('alice');
		expect(publicName({ display_name: 'alice@example.com', username: null, wallet: 'AbcdEFGHijklmnopQRSTuvwxyz123456', id: 'x' })).toBe('Abcd…3456');
		expect(publicName({ display_name: 'a@b.co', id: '1234-5678-abcd' })).toMatch(/^Forecaster /);
		expect(publicName({ display_name: 'Cara', id: 'x' })).toBe('Cara');
	});
});

describe('oddsAtPickFromLog', () => {
	const ids = ['a', 'b', 'c'];
	it('uses the odds right before the pick, without the account\'s own earlier pick', () => {
		const log = [
			{ outcome_id: 'a', account_id: 'u1', points: 100, action: 'place' },
			{ outcome_id: 'b', account_id: 'u2', points: 50, action: 'place' },
			{ outcome_id: 'b', account_id: 'u1', points: 100, action: 'change' },
		];
		const odds = oddsAtPickFromLog(log, ids);
		expect(odds.get('u1')).toBeCloseTo((50 + K) / (50 + 3 * K), 5);
		expect(oddsAtPickFromLog(log.slice(0, 1), ids).get('u1')).toBeCloseTo(1 / 3, 5);
	});
	it('forgets a withdrawn pick', () => {
		const odds = oddsAtPickFromLog([
			{ outcome_id: 'a', account_id: 'u1', points: 10, action: 'place' },
			{ outcome_id: 'a', account_id: 'u1', points: 10, action: 'withdraw' },
		], ids);
		expect(odds.has('u1')).toBe(false);
	});
});

describe('rollup against a resolved market', () => {
	it('scores each pick once, with odds at pick time, ranking by fairness', async () => {
		const m = await make();
		await pick(m, ALICE, 'Alpha', 100);
		await pick(m, BOB, 'Beta', 100);
		await pick(m, CARA, 'Gamma', 100);
		await pick(m, NEWBIE, 'Gamma', 100);
		await resolve(m, 'Gamma');

		const first = await runRollup();
		expect(first.scored).toBe(4);
		const scores = await rows(`select account_id, correct, delta, ranked, unranked_reason, odds_at_pick::float as odds from event_market_scores order by settled_at, account_id`);
		const cara = scores.find((r) => r.account_id === CARA);
		expect(cara).toMatchObject({ correct: true, ranked: true });
		expect(cara.odds).toBeLessThan(0.34);
		expect(cara.delta).toBeGreaterThan(100);
		expect(scores.find((r) => r.account_id === ALICE)).toMatchObject({ correct: false, delta: -100 });
		expect(scores.find((r) => r.account_id === NEWBIE)).toMatchObject({ ranked: false, unranked_reason: 'account_too_new' });
		const badges = await rows(`select user_id, code from user_badges`);
		expect(badges.map((b) => [b.user_id, b.code]).sort()).toEqual([[CARA, 'em_first_correct'], [CARA, 'em_upset_call']]);
	});

	it('is idempotent: a second run writes nothing and changes nothing', async () => {
		const m = await make();
		await pick(m, ALICE, 'Alpha');
		await pick(m, BOB, 'Beta');
		await resolve(m, 'Alpha');
		await runRollup();
		const snapshot = async () => JSON.stringify([
			await rows('select * from event_market_scores order by market_id, account_id'),
			await rows('select scope_kind, season_id, source_kind, account_id, calls, hits, score, rank from event_market_stats order by 1,2,3,4'),
			await rows('select user_id, code from user_badges order by 1,2'),
		]);
		const before = await snapshot();
		const second = await runRollup();
		expect(second.scored).toBe(0);
		expect(await snapshot()).toBe(before);
		expect((await runRollup({ full: true })).scored).toBe(0);
		expect(await snapshot()).toBe(before);
	});

	it('builds streaks across markets and resets on a miss', async () => {
		const results = ['Alpha', 'Alpha', 'Beta', 'Alpha'];
		for (const [i, winner] of results.entries()) {
			const m = await make(`Round ${i}`);
			await pick(m, ALICE, 'Alpha');
			await resolve(m, winner);
			await holder.db.exec(`update event_markets set resolved_at = now() + interval '${i} minutes' where id = '${m.id}'`);
		}
		await runRollup();
		const [stats] = await rows(`select calls, hits, current_streak, longest_streak, score, rank from event_market_stats where account_id = '${ALICE}' and scope_kind = 'all' and source_kind = 'all'`);
		expect(stats).toMatchObject({ calls: 4, hits: 3, current_streak: 1, longest_streak: 2 });
		const [season] = await rows(`select rank from event_market_stats where account_id = '${ALICE}' and scope_kind = 'season' and source_kind = 'all'`);
		expect(season.rank).toBe(1);
	});

	it('does not score agent picks or void markets', async () => {
		const m = await make();
		await pick(m, ALICE, 'Alpha');
		await EM.voidMarket(m.id, 'event cancelled');
		expect((await runRollup()).scored).toBe(0);
	});

	it('re-scores after an admin override deletes the ledger rows, and drops stale stats', async () => {
		const m = await make();
		await pick(m, ALICE, 'Alpha');
		await pick(m, BOB, 'Beta');
		await resolve(m, 'Alpha');
		await runRollup();
		await holder.db.exec(`delete from event_market_scores where market_id = '${m.id}'`);
		await holder.db.exec(`update event_markets set winner_outcome_id = (select id from event_market_outcomes where market_id = '${m.id}' and label = 'Beta') where id = '${m.id}'`);
		await runRollup();
		const scores = await rows(`select account_id, correct from event_market_scores`);
		expect(scores.find((r) => r.account_id === BOB).correct).toBe(true);
		expect(scores.find((r) => r.account_id === ALICE).correct).toBe(false);
		const [bob] = await rows(`select hits from event_market_stats where account_id = '${BOB}' and scope_kind = 'all' and source_kind = 'all'`);
		expect(bob.hits).toBe(1);
	});

	it('finalizes an ended season: top-10 badges and a payout proposal table, nothing paid', async () => {
		for (let i = 0; i < S.CONFIG.seasons.min_calls_to_rank; i += 1) {
			const m = await make(`Round ${i}`);
			await pick(m, CARA, 'Alpha');
			await pick(m, BOB, 'Beta');
			await resolve(m, 'Alpha');
		}
		const season = S.seasonFor(Date.now());
		const later = Date.parse(season.end) + 86_400_000;
		const mid = await runRollup({ now: Date.now() });
		expect(mid.endedSeasons).toEqual([]);
		expect((await rows('select count(*)::int as n from event_market_season_payouts'))[0].n).toBe(0);

		const res = await runRollup({ now: later });
		expect(res.endedSeasons).toContain(season.id);
		const payouts = await rows(`select rank, amount::float as amount, token, chain, status, wallet_address, account_id from event_market_season_payouts order by rank`);
		expect(payouts).toEqual([{ rank: 1, amount: 50000, token: '$THREE', chain: 'solana', status: 'proposed', wallet_address: 'CaraWa11etAddr3ssSo1anaXXXXXXXXXXXXXXXXXX', account_id: CARA }]);
		const codes = (await rows(`select code from user_badges where user_id = '${CARA}' order by code`)).map((r) => r.code);
		expect(codes).toEqual(expect.arrayContaining(['em_season_champion', 'em_season_top10']));
		const again = await runRollup({ now: later });
		expect(again.payoutProposals).toBe(0);
		expect((await rows('select count(*)::int as n from event_market_season_payouts'))[0].n).toBe(1);
		const published = await getSeasonRewards(season.id, later);
		expect(published.rewards[0]).toMatchObject({ rank: 1, name: 'Cara', amount: 50000, status: 'proposed' });
		expect(JSON.stringify(published)).not.toContain('CaraWa11et');
	});
});

describe('leaderboard read', () => {
	it('pins the viewer outside the top rows and never exposes an email', async () => {
		for (let i = 0; i < 3; i += 1) {
			const m = await make(`Round ${i}`);
			await pick(m, ALICE, 'Alpha');
			await pick(m, BOB, 'Beta');
			await resolve(m, 'Alpha');
		}
		await runRollup();
		const board = await getLeaderboard({ scope: 'season', limit: 1, viewerId: BOB });
		expect(board.leaders).toHaveLength(1);
		expect(board.leaders[0].name).toBe('alice');
		expect(board.me).toMatchObject({ is_me: true, name: 'Bob', calls: 3, hits: 0 });
		expect(JSON.stringify(board)).not.toContain('@');
		expect((await getLeaderboard({ sourceKind: 'nope' })).error).toBe('invalid_source_kind');
		const all = await getLeaderboard({ scope: 'all', sourceKind: 'build_round' });
		expect(all.leaders[0]).toMatchObject({ rank: 1, calls: 3, hits: 3 });
	});
});

describe('buildScoreRows', () => {
	it('keeps the ledger deterministic for a pick without logged odds', () => {
		const out = buildScoreRows(
			[{ market_id: 'm', account_id: 'a', outcome_id: 'o1', winner_outcome_id: 'o1', points: 50, source_kind: 'bounty', locks_at: '2026-11-02T00:00:00Z', resolved_at: '2026-11-03T00:00:00Z', outcome_count: 4 }],
			new Map(),
			() => ({ ranked: true, reason: null }),
		);
		expect(out[0]).toMatchObject({ season_id: '2026-Q4', odds_at_pick: 0.25, delta: 150, ranked: true });
	});
});
