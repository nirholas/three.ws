/**
 * The rivalry engine, pure logic tests.
 *
 * A matchup is public copy about two named traders, so what has to hold is not
 * that it renders but that it cannot lie: an overtake must be a real change of
 * places measured against the ledger as it stood at the cutoff, a gap must be a
 * distance rather than a signed number, the momentum line must name whoever
 * actually booked more inside the lookback, and a trader with too thin a record
 * must not appear on a board at all.
 */

import { describe, it, expect } from 'vitest';
import {
	groupByAgent, rankBoard, pairRivalries, rivalryCopy, sharedCoins, fmtSol, fmtGap, LOOKBACKS,
} from '../api/_lib/rivalries.js';

const LAM = 1e9;

/** A closed round-trip in the shape both position ledgers normalize to. */
function pos(agent, { id, pnlSol = 0, entry = 1, mint = 'MINTX', symbol = 'TICKER', close, name = 'Trader', image = null }) {
	return {
		id: String(id),
		agent_id: agent,
		agent_user_id: `user-${agent}`,
		agent_name: name,
		agent_avatar: image,
		agent_image: null,
		wallet: `wallet-${agent}`,
		mint,
		symbol,
		name: symbol,
		status: 'closed',
		exit_reason: pnlSol >= 0 ? 'take_profit' : 'stop_loss',
		entry_quote_lamports: String(Math.round(entry * LAM)),
		exit_quote_lamports: String(Math.round((entry + pnlSol) * LAM)),
		last_value_lamports: String(Math.round((entry + pnlSol) * LAM)),
		peak_value_lamports: String(Math.round((entry + Math.max(pnlSol, 0)) * LAM)),
		realized_pnl_lamports: String(Math.round(pnlSol * LAM)),
		realized_pnl_pct: (pnlSol / entry) * 100,
		buy_sig: `buy-${agent}-${id}`,
		sell_sig: `sell-${agent}-${id}`,
		opened_at: close,
		closed_at: close,
		moonbag_base_amount: null,
		moonbag_last_value_lamports: null,
		initials_recovered: null,
	};
}

const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const at = (hoursAgoFromNow, now) => new Date(now - hoursAgoFromNow * 3_600_000).toISOString();

describe('formatting', () => {
	it('signs P&L and never signs a gap', () => {
		expect(fmtSol(1.5)).toBe('+1.50 SOL');
		expect(fmtSol(0.5, 2)).toBe('+0.50 SOL');
		expect(fmtSol(-1.5)).toBe('-1.50 SOL');
		expect(fmtSol(0)).toBe('0.000 SOL');
		expect(fmtGap(-1.5)).toBe('1.50 SOL');
	});

	it('scales precision to the size of the number', () => {
		expect(fmtGap(0.125)).toBe('0.125 SOL');
		expect(fmtGap(12.5)).toBe('12.5 SOL');
		expect(fmtGap(125)).toBe('125 SOL');
	});
});

describe('rankBoard', () => {
	const now = T0;
	const rows = [
		...[1, 2, 3].map((i) => pos('a', { id: i, pnlSol: 1, close: at(48, now), name: 'Alpha' })),
		...[1, 2].map((i) => pos('b', { id: i, pnlSol: 5, close: at(48, now), name: 'Beta' })),
	];

	it('keeps a trader off the board below the settled-trade floor', () => {
		const board = rankBoard(groupByAgent(rows), { to: now });
		expect(board.map((r) => r.agent_id)).toEqual(['a']);
	});

	it('counts a thin record when the caller asks for momentum instead of a ranking', () => {
		const board = rankBoard(groupByAgent(rows), { to: now, minClosed: 1 });
		expect(board.map((r) => r.agent_id).sort()).toEqual(['a', 'b']);
	});

	it('excludes round-trips that closed outside the range', () => {
		const board = rankBoard(groupByAgent(rows), { from: now - 3_600_000, to: now, minClosed: 1 });
		expect(board).toEqual([]);
	});

	it('ranks from 1 with no gaps', () => {
		const board = rankBoard(groupByAgent(rows), { to: now, minClosed: 1 });
		expect(board.map((r) => r.rank)).toEqual([1, 2]);
	});
});

describe('pairRivalries', () => {
	const board = (rows) => rows.map((r, i) => ({ rank: i + 1, top_coins: [], ...r }));
	const nowBoard = board([
		{ agent_id: 'a', name: 'Alpha', score: 70, realized_pnl_sol: 9 },
		{ agent_id: 'b', name: 'Beta', score: 60, realized_pnl_sol: 6.5 },
		{ agent_id: 'c', name: 'Gamma', score: 50, realized_pnl_sol: 2 },
	]);

	it('calls a change of places an overtake and keeps it first', () => {
		const past = board([
			{ agent_id: 'b', name: 'Beta', score: 65, realized_pnl_sol: 6 },
			{ agent_id: 'a', name: 'Alpha', score: 55, realized_pnl_sol: 4 },
			{ agent_id: 'c', name: 'Gamma', score: 50, realized_pnl_sol: 2 },
		]);
		const since = board([{ agent_id: 'a', name: 'Alpha', score: 60, realized_pnl_sol: 5 }]);
		const out = pairRivalries({ now: nowBoard, past, since, window: '7d', lookback: '24h' });
		expect(out[0].kind).toBe('overtake');
		expect(out[0].leader.agent_id).toBe('a');
		expect(out[0].chaser.agent_id).toBe('b');
		expect(out[0].headline).toBe('Alpha passed Beta on the 7d board.');
	});

	it('calls an unchanged order a chase and reports the gap unsigned', () => {
		const past = nowBoard;
		const out = pairRivalries({ now: nowBoard, past, since: [], window: '7d', lookback: '24h' });
		const chase = out.find((r) => r.chaser.agent_id === 'b');
		expect(chase.kind).toBe('chase');
		expect(chase.gap_sol).toBeCloseTo(2.5, 6);
		expect(chase.headline).toBe('Beta is 2.50 SOL behind Alpha.');
	});

	it('calls a trader who was not on the past board a debut', () => {
		const past = board([
			{ agent_id: 'b', name: 'Beta', score: 60, realized_pnl_sol: 6 },
			{ agent_id: 'c', name: 'Gamma', score: 50, realized_pnl_sol: 2 },
		]);
		const out = pairRivalries({ now: nowBoard, past, since: [], window: '7d', lookback: '24h' });
		expect(out[0].kind).toBe('debut');
		expect(out[0].headline).toBe('Alpha arrived at number 1 on the 7d board, above Beta.');
	});

	it('honours the limit and emits one matchup per adjacent pair', () => {
		const out = pairRivalries({ now: nowBoard, past: nowBoard, since: [], window: '7d', lookback: '24h' });
		expect(out).toHaveLength(2);
		expect(pairRivalries({ now: nowBoard, past: nowBoard, since: [], window: '7d', lookback: '24h', limit: 1 })).toHaveLength(1);
	});

	it('links both profiles and a ghost-copy of the leader', () => {
		const [r] = pairRivalries({ now: nowBoard, past: nowBoard, since: [], window: '7d', lookback: '24h', limit: 1 });
		expect(r.links.leader_profile).toBe('/trader/a');
		expect(r.links.chaser_profile).toBe('/trader/b');
		expect(r.links.ghost_copy_leader).toBe('/ghost-copy?leader=a&window=7d');
	});
});

describe('rivalryCopy momentum line', () => {
	const base = {
		kind: 'chase', window: '7d', lookback: '24h', gap_sol: 2.5,
		leader: { name: 'Alpha', rank: 1 }, chaser: { name: 'Beta', rank: 2 },
	};

	it('names the chaser when the chaser booked more', () => {
		const { subline } = rivalryCopy({ ...base, since: { leader_pnl_sol: 0.5, chaser_pnl_sol: 2 } });
		expect(subline).toBe('Beta booked +2.00 SOL in the last 24 hours against +0.50 SOL, and is closing.');
	});

	it('names the leader when the leader booked more', () => {
		const { subline } = rivalryCopy({ ...base, since: { leader_pnl_sol: 3, chaser_pnl_sol: -1 } });
		expect(subline).toBe('Alpha booked +3.00 SOL in the last 24 hours against -1.00 SOL, and is pulling away.');
	});

	it('says nothing settled rather than implying movement', () => {
		const { subline } = rivalryCopy({ ...base, since: { leader_pnl_sol: 0, chaser_pnl_sol: 0 } });
		expect(subline).toBe('Neither has settled a trade in the last 24 hours. The gap stands at 2.50 SOL.');
	});

	it('never says a trader booked zero when they were not in the market', () => {
		const idle = rivalryCopy({ ...base, since: { leader_pnl_sol: -0.05, chaser_pnl_sol: 0 } });
		expect(idle.subline).toBe('Beta has not settled a trade in the last 24 hours. Alpha booked -0.050 SOL.');
		const other = rivalryCopy({ ...base, since: { leader_pnl_sol: 0, chaser_pnl_sol: 1.2 } });
		expect(other.subline).toBe('Alpha has not settled a trade in the last 24 hours. Beta booked +1.20 SOL.');
	});

	it('does not call a trader "behind" when they hold more SOL than the trader above them', () => {
		const out = rivalryCopy({ ...base, gap_sol: -0.021, gap_score: 4, since: { leader_pnl_sol: 1, chaser_pnl_sol: 1 } });
		expect(out.headline).toBe('Beta has out-earned Alpha by 0.021 SOL and still ranks below.');
	});

	it('calls a dead-level P&L level, and points at the score', () => {
		const out = rivalryCopy({ ...base, gap_sol: 0, gap_score: -3, since: { leader_pnl_sol: 1, chaser_pnl_sol: 1 } });
		expect(out.headline).toBe('Beta and Alpha are level on P&L, 3 apart on score.');
	});

	it('writes neither banned dash character into any line it produces', () => {
		// The repo bans both glyphs everywhere it writes, and this copy is written
		// into a public page, so the ban is asserted rather than assumed. Matched by
		// code point so this test file does not contain the characters it forbids.
		const BANNED = /[\u2014\u2013]/;
		for (const kind of ['overtake', 'debut', 'chase']) {
			const { headline, subline } = rivalryCopy({ ...base, kind, since: { leader_pnl_sol: 1, chaser_pnl_sol: 1 } });
			expect(headline).not.toMatch(BANNED);
			expect(subline).not.toMatch(BANNED);
		}
	});
});

describe('sharedCoins', () => {
	it('reports only coins that appear in both traders top earners', () => {
		const a = { top_coins: [{ mint: 'M1', symbol: 'ONE', pnl_sol: 3 }, { mint: 'M2', symbol: 'TWO', pnl_sol: 1 }] };
		const b = { top_coins: [{ mint: 'M2', symbol: 'TWO', pnl_sol: -0.4 }, { mint: 'M9', symbol: 'NINE', pnl_sol: 2 }] };
		expect(sharedCoins(a, b)).toEqual([
			{ mint: 'M2', symbol: 'TWO', leader_pnl_sol: 1, chaser_pnl_sol: -0.4 },
		]);
	});

	it('returns nothing rather than guessing when there is no overlap', () => {
		expect(sharedCoins({ top_coins: [{ mint: 'M1' }] }, { top_coins: [{ mint: 'M2' }] })).toEqual([]);
		expect(sharedCoins({}, {})).toEqual([]);
	});
});

describe('lookbacks', () => {
	it('exposes the windows the endpoint validates against', () => {
		expect([...LOOKBACKS.keys()]).toEqual(['1h', '24h', '7d']);
		expect(LOOKBACKS.get('24h')).toBe(86_400_000);
	});
});
