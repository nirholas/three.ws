// Resolver contract for Event Markets: one module per source_kind, each returning
// { winnerOutcomeId, evidence } | { pending, reason } | { void, reason, evidence }.
// The arena fixtures are the real "Daily Arena, Oct 9" record (read from production
// by scripts/event-markets-resolve-dry-run.mjs); the other kinds have no finished
// record in production yet, so their fixtures follow the exact row shapes of
// bounties, program_rounds/program_submissions and pump_agent_* with synthetic ids.

import { describe, it, expect } from 'vitest';
import * as arena from '../api/_lib/event-markets/resolvers/arena_tournament.js';
import * as board from '../api/_lib/event-markets/resolvers/event_leaderboard.js';
import * as cohort from '../api/_lib/event-markets/resolvers/launch_cohort.js';
import * as round from '../api/_lib/event-markets/resolvers/build_round.js';
import * as bounty from '../api/_lib/event-markets/resolvers/bounty.js';
import { resolverFor, describeRule, RESOLVER_KINDS } from '../api/_lib/event-markets/resolvers/index.js';

const TID = '679e585e-6ef6-4258-a65b-f3b9ac2e3289';
const CROSSHAIR = '6287faf3-d41b-43cb-97bb-d305c1ac6e45';
const OTHER = '11111111-1111-4111-8111-111111111111';
const END = Date.parse('2026-10-10T00:00:00.000Z');

const tournament = (over = {}) => ({ id: TID, name: 'Daily Arena, Oct 9', status: 'closed', scoring: 'realized_pnl', starts_at: '2026-10-09T00:00:00.000Z', ends_at: '2026-10-10T00:00:00.000Z', ...over });
const standing = (agent_id, pnl, trades, rank) => ({ rank, agent_id, agent_name: agent_id === CROSSHAIR ? 'Crosshair' : 'Other', score_value: pnl, metrics: { realized_pnl_sol: pnl }, in_window_trades: trades, entry_status: 'active' });
const arenaDeps = (t, standings) => ({ getTournament: async () => t, loadStandings: async () => ({ computed_at: '2026-10-10T00:00:00.001Z', standings }) });
const arenaMarket = { source_kind: 'arena_tournament', source_ref: TID, outcomes: [{ id: 'o1', ref_kind: 'agent', ref_id: CROSSHAIR }, { id: 'o2', ref_kind: 'agent', ref_id: OTHER }] };

describe('registry', () => {
	it('has a resolver and a plain-language rule for every source kind but custom', () => {
		expect(RESOLVER_KINDS.sort()).toEqual(['arena_tournament', 'bounty', 'build_round', 'event_leaderboard', 'launch_cohort']);
		for (const k of RESOLVER_KINDS) {
			expect(typeof resolverFor(k).resolve).toBe('function');
			expect(describeRule({ source_kind: k, resolution_rule: { metric: 'volume' } }).length).toBeGreaterThan(40);
		}
		expect(resolverFor('custom')).toBeNull();
		expect(describeRule({ source_kind: 'custom' })).toMatch(/admin/);
	});
});

describe('arena_tournament', () => {
	it('names rank 1 of the final standings and stores what it read', async () => {
		const r = await arena.resolve(arenaMarket, { now: END + 1000, deps: arenaDeps(tournament(), [standing(CROSSHAIR, 0.005817, 23, 1), standing(OTHER, 0.001, 9, 2)]) });
		expect(r.winnerOutcomeId).toBe('o1');
		expect(r.evidence).toMatchObject({ tournament_id: TID, status: 'closed', scoring: 'realized_pnl', entrants: 2 });
		expect(r.evidence.winner).toMatchObject({ agent_id: CROSSHAIR, name: 'Crosshair', closed_trades: 23 });
	});
	it('waits while the window is open and while the board is not frozen', async () => {
		expect((await arena.resolve(arenaMarket, { now: END - 1, deps: arenaDeps(tournament(), []) })).reason).toBe('event_running');
		expect((await arena.resolve(arenaMarket, { now: END + 1, deps: arenaDeps(tournament({ status: 'live' }), []) })).reason).toBe('awaiting_finalization');
	});
	it('voids a cancelled tournament, a missing one and a bad reference', async () => {
		expect((await arena.resolve(arenaMarket, { now: END + 1, deps: arenaDeps(tournament({ status: 'cancelled' }), []) })).reason).toBe('event_cancelled');
		expect((await arena.resolve(arenaMarket, { now: END + 1, deps: arenaDeps(null, []) })).reason).toBe('source_missing');
		expect((await arena.resolve({ ...arenaMarket, source_ref: 'nope' }, { now: END + 1, deps: arenaDeps(null, []) })).reason).toBe('invalid_source_ref');
	});
	it('voids when nobody traded', async () => {
		const r = await arena.resolve(arenaMarket, { now: END + 1, deps: arenaDeps(tournament(), [standing(CROSSHAIR, 0, 0, null), standing(OTHER, 0, 0, null)]) });
		expect(r).toMatchObject({ void: true, reason: 'no_data' });
	});
	it('voids an exact tie on score, realized P&L and trade count, but not a tie broken by trades', async () => {
		const tied = await arena.resolve(arenaMarket, { now: END + 1, deps: arenaDeps(tournament(), [standing(CROSSHAIR, 0.002, 10, 1), standing(OTHER, 0.002, 10, 1)]) });
		expect(tied).toMatchObject({ void: true, reason: 'tie' });
		const broken = await arena.resolve(arenaMarket, { now: END + 1, deps: arenaDeps(tournament(), [standing(CROSSHAIR, 0.002, 12, 1), standing(OTHER, 0.002, 10, 2)]) });
		expect(broken.winnerOutcomeId).toBe('o1');
	});
	it('voids when the winner is not one of the market outcomes', async () => {
		const r = await arena.resolve({ ...arenaMarket, outcomes: [{ id: 'o2', ref_kind: 'agent', ref_id: OTHER }] }, { now: END + 1, deps: arenaDeps(tournament(), [standing(CROSSHAIR, 0.1, 5, 1)]) });
		expect(r).toMatchObject({ void: true, reason: 'winner_not_an_outcome' });
	});
});

describe('event_leaderboard', () => {
	const wallet = 'So1anaWa11etAddressForTestsOnly1111111111111';
	const m = { source_kind: 'event_leaderboard', source_ref: 'build-week', resolves_at: '2026-10-10T00:00:00Z', resolution_rule: {}, outcomes: [{ id: 'w1', ref_kind: 'wallet', ref_id: wallet }] };
	const deps = (ranked, durable = true) => ({ eventConfig: () => null, readEventRecords: async () => ({ records: ranked, durable }), rankEventBoard: (r) => r });
	it('is pending before the window ends', async () => {
		expect((await board.resolve(m, { now: END - 1, deps: deps([]) })).reason).toBe('event_running');
	});
	it('names rank 1 and hashes account keys in the evidence', async () => {
		const r = await board.resolve(m, { now: END + 1, deps: deps([{ rank: 1, account: wallet, name: 'A', runs: 3, cash: 120, lastAt: END - 5 }]) });
		expect(r.winnerOutcomeId).toBe('w1');
		expect(JSON.stringify(r.evidence)).not.toContain(wallet);
		expect(r.evidence.top[0].account_ref).toMatch(/^[0-9a-f]{12}$/);
	});
	it('voids an event nobody played', async () => {
		expect(await board.resolve(m, { now: END + 1, deps: deps([]) })).toMatchObject({ void: true, reason: 'no_data' });
	});
});

describe('launch_cohort', () => {
	const A = 'SyntheticMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
	const B = 'SyntheticMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
	const m = (rule = {}) => ({ source_kind: 'launch_cohort', source_ref: 'c1', opens_at: '2026-10-01T00:00:00Z', resolves_at: '2026-10-10T00:00:00Z', resolution_rule: { metric: 'volume', ...rule }, outcomes: [{ id: 'a', label: 'A', ref_kind: 'project', ref_id: A }, { id: 'b', label: 'B', ref_kind: 'project', ref_id: B }] });
	const deps = (volume) => ({
		launches: async () => [{ mint_id: 1, mint: A, symbol: 'AAA' }, { mint_id: 2, mint: B, symbol: 'BBB' }],
		volume: async () => volume,
		marketCap: async () => [],
		holders: async () => [],
	});
	it('picks the highest volume from our own trade records', async () => {
		const r = await cohort.resolve(m(), { now: END + 1, deps: deps([{ mint_id: 1, lamports: 2e9, trades: 4 }, { mint_id: 2, lamports: 5e9, trades: 9 }]) });
		expect(r.winnerOutcomeId).toBe('b');
		expect(r.evidence.ranking[0]).toMatchObject({ mint: B, value: 5, trades: 9 });
	});
	it('voids a tie, an empty cohort and an invalid metric; waits before the measure time', async () => {
		expect(await cohort.resolve(m(), { now: END + 1, deps: deps([{ mint_id: 1, lamports: 3e9, trades: 1 }, { mint_id: 2, lamports: 3e9, trades: 2 }]) })).toMatchObject({ void: true, reason: 'tie' });
		expect(await cohort.resolve(m(), { now: END + 1, deps: deps([]) })).toMatchObject({ void: true, reason: 'no_data' });
		expect(await cohort.resolve(m({ metric: 'followers' }), { now: END + 1, deps: deps([]) })).toMatchObject({ void: true, reason: 'invalid_rule' });
		expect((await cohort.resolve(m(), { now: END - 1, deps: deps([]) })).reason).toBe('cohort_running');
	});
});

describe('build_round', () => {
	const m = { source_kind: 'build_round', source_ref: 'round-7', resolution_rule: {}, outcomes: [{ id: 'p1', ref_kind: 'agent', ref_id: 'agent-1' }, { id: 'p2', ref_kind: 'agent', ref_id: 'agent-2' }] };
	const deps = (status, winners) => ({ round: async () => ({ id: 'r7', slug: 'round-7', status, ends_at: '2026-10-01T00:00:00Z' }), winners: async () => winners });
	it('waits through judging, then names the first-place submission', async () => {
		expect((await round.resolve(m, { deps: deps('judging', []) })).reason).toBe('judging');
		const r = await round.resolve(m, { deps: deps('closed', [{ id: 's1', agent_id: 'agent-2', track_id: 't', title: 'x', score: 91 }]) });
		expect(r.winnerOutcomeId).toBe('p2');
	});
	it('breaks a multi-winner round by score, voids equal scores and a round with no winner', async () => {
		const two = (a, b) => [{ id: 's1', agent_id: 'agent-1', score: a }, { id: 's2', agent_id: 'agent-2', score: b }];
		expect((await round.resolve(m, { deps: deps('closed', two(80, 90)) })).winnerOutcomeId).toBe('p2');
		expect(await round.resolve(m, { deps: deps('closed', two(80, 80)) })).toMatchObject({ void: true, reason: 'tie' });
		expect(await round.resolve(m, { deps: deps('closed', []) })).toMatchObject({ void: true, reason: 'no_winner_recorded' });
	});
});

describe('bounty', () => {
	const BID = '22222222-2222-4222-8222-222222222222';
	const SID = '33333333-3333-4333-8333-333333333333';
	const m = { source_kind: 'bounty', source_ref: BID, outcomes: [{ id: 'x', ref_kind: 'project', ref_id: SID }] };
	const deps = (b) => ({ bounty: async () => b, submission: async () => ({ id: SID, bounty_id: BID, status: 'accepted', created_at: '2026-10-02T00:00:00Z' }) });
	it('names the submission the poster accepted', async () => {
		const r = await bounty.resolve(m, { deps: deps({ id: BID, title: 't', status: 'closed', winner_submission_id: SID, submission_count: 3 }) });
		expect(r.winnerOutcomeId).toBe('x');
		expect(r.evidence.winner_submission_id).toBe(SID);
	});
	it('waits for the poster, voids a deleted bounty and a close without a winner', async () => {
		expect((await bounty.resolve(m, { deps: deps({ id: BID, status: 'open' }) })).reason).toBe('awaiting_poster');
		expect(await bounty.resolve(m, { deps: deps({ id: BID, status: 'open', deleted_at: '2026-10-03T00:00:00Z' }) })).toMatchObject({ void: true, reason: 'event_cancelled' });
		expect(await bounty.resolve(m, { deps: deps({ id: BID, status: 'closed', winner_submission_id: null }) })).toMatchObject({ void: true, reason: 'no_winner_recorded' });
	});
});
