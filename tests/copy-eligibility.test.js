/**
 * The copy-trading anti-gaming layer (api/_lib/copy-eligibility.js).
 *
 * Three defenses stand between a copier and the two ways copy-trading gets
 * gamed: a manufactured track record, and a leader who keeps trading on the way
 * down. These are the pure halves; tests/copy-subscribe-guards.test.js covers the
 * endpoint that enforces them.
 */

import { describe, it, expect, vi } from 'vitest';

// Synthetic addresses only, no real wallets. `resolveCreatorWallet` and
// `analyzeLinkage` are mocked below so `checkLeaderCreatorLinkage` is tested as
// pure orchestration, with no DB or RPC involved.
const LEADER = 'Leader1111111111111111111111111111111111111';
const CREATOR = 'Creator11111111111111111111111111111111111';

const H = vi.hoisted(() => ({ creatorWallet: null, pair: null, analyzeThrows: false }));
vi.mock('../api/_lib/cosmetics-economy.js', () => ({
	resolveCreatorWallet: async () => ({ wallet: H.creatorWallet, source: H.creatorWallet ? 'coin_launches' : 'none' }),
}));
vi.mock('@three-ws/wallet-linkage', () => ({
	analyzeLinkage: async (_connection, addresses) => {
		if (H.analyzeThrows) throw new Error('rpc unavailable');
		return { addresses, pairs: H.pair ? [H.pair] : [], complete: true };
	},
}));

import {
	BREAKER_REASON,
	LEADER_ELIGIBILITY,
	CREATOR_LINK_REASON,
	evaluateDrawdownBreaker,
	evaluateLeaderEligibility,
	evaluateLeaderCreatorLinkPair,
	checkLeaderCreatorLinkage,
	summarizeCopyProfile,
} from '../api/_lib/copy-eligibility.js';

const SOL = 1e9;
// A closed round-trip in the exact shape agent_sniper_positions hands back:
// lamport columns as bigint-safe values, closed_at as a timestamp.
const close = (pnlSol, entrySol, closedAt) => ({
	realized_pnl_lamports: Math.round(pnlSol * SOL),
	entry_quote_lamports: Math.round(entrySol * SOL),
	closed_at: closedAt,
});

const hoursAgo = (h) => new Date(Date.UTC(2026, 0, 10) - h * 3_600_000).toISOString();

describe('evaluateLeaderEligibility: the sybil bar on copyable status', () => {
	it('clears a leader with a real record', () => {
		const r = evaluateLeaderEligibility({ settled: 30, span_hours: 200, deployed_sol: 2.5 });
		expect(r.eligible).toBe(true);
		expect(r.unmet).toEqual([]);
		expect(r.met).toEqual({ settled: 30, span_hours: 200, deployed_sol: 2.5 });
	});

	it('refuses a leader with no history at all, naming every missing criterion', () => {
		const r = evaluateLeaderEligibility({ settled: 0, span_hours: 0, deployed_sol: 0 });
		expect(r.eligible).toBe(false);
		expect(r.unmet.map((u) => u.criterion).sort()).toEqual(['deployed_sol', 'settled', 'span_hours']);
		// The labels are what the UI shows, so they carry both numbers.
		expect(r.unmet.find((u) => u.criterion === 'settled').label).toBe('0 of 5 closed round-trips');
	});

	it('refuses a curve minted out of dust in one burst', () => {
		// The exact sybil shape: enough closes, but no elapsed time and no capital.
		const r = evaluateLeaderEligibility({ settled: 40, span_hours: 0.2, deployed_sol: 0.004 });
		expect(r.eligible).toBe(false);
		expect(r.unmet.map((u) => u.criterion).sort()).toEqual(['deployed_sol', 'span_hours']);
	});

	it('is a floor, not a curation filter: a losing leader with a real record still clears', () => {
		// Eligibility asks "is this record real?", never "is it good?". Hiding
		// losers is exactly the survivorship theater the whole surface refuses.
		expect(evaluateLeaderEligibility({ settled: 12, span_hours: 100, deployed_sol: 1 }).eligible).toBe(true);
	});

	it('treats missing fields as zero rather than passing them', () => {
		expect(evaluateLeaderEligibility({}).eligible).toBe(false);
		expect(evaluateLeaderEligibility().eligible).toBe(false);
	});

	it('holds the boundary exactly at the documented thresholds', () => {
		const at = {
			settled: LEADER_ELIGIBILITY.minSettled,
			span_hours: LEADER_ELIGIBILITY.minSpanHours,
			deployed_sol: LEADER_ELIGIBILITY.minDeployedSol,
		};
		expect(evaluateLeaderEligibility(at).eligible).toBe(true);
		expect(evaluateLeaderEligibility({ ...at, settled: at.settled - 1 }).eligible).toBe(false);
	});
});

describe('evaluateDrawdownBreaker: the copier\'s circuit breaker', () => {
	it('does nothing when the copier set no limit', () => {
		expect(evaluateDrawdownBreaker({ max_drawdown_pct: null }, 90).breached).toBe(false);
		expect(evaluateDrawdownBreaker({}, 90).breached).toBe(false);
	});

	it('treats a zero or negative limit as opted out, never as "pause immediately"', () => {
		expect(evaluateDrawdownBreaker({ max_drawdown_pct: 0 }, 5).breached).toBe(false);
		expect(evaluateDrawdownBreaker({ max_drawdown_pct: -10 }, 5).breached).toBe(false);
	});

	it('holds while the leader is inside the limit', () => {
		const r = evaluateDrawdownBreaker({ max_drawdown_pct: 40 }, 39.9);
		expect(r.breached).toBe(false);
		expect(r.drawdown_pct).toBe(39.9);
		expect(r.limit_pct).toBe(40);
	});

	it('trips at the limit and explains itself in the copier\'s own numbers', () => {
		const r = evaluateDrawdownBreaker({ max_drawdown_pct: 40 }, 52.348);
		expect(r.breached).toBe(true);
		expect(r.drawdown_pct).toBe(52.35);
		expect(r.detail).toContain('52.35%');
		expect(r.detail).toContain('40%');
	});

	it('never auto-pauses on an unmeasurable leader', () => {
		// A null drawdown means no capital was ever deployed. Pausing on "unknown"
		// would freeze every subscription the moment a leader's history is thin;
		// the eligibility bar is what keeps a history-less leader uncopyable.
		expect(evaluateDrawdownBreaker({ max_drawdown_pct: 10 }, null).breached).toBe(false);
	});

	it('exports the reason the fanout records and the resume path keys off', () => {
		expect(BREAKER_REASON).toBe('leader_drawdown_breach');
	});
});

describe('summarizeCopyProfile: the equity curve both defenses read', () => {
	it('returns an honest empty record for a leader who has closed nothing', () => {
		expect(summarizeCopyProfile([])).toMatchObject({
			settled: 0, deployed_sol: 0, span_hours: 0, max_drawdown_pct: null,
		});
	});

	it('measures peak-to-trough drawdown as a share of capital deployed', () => {
		// Equity walks +1 → +3 → +1 → +2 on 4 SOL deployed: peak 3, trough 1,
		// so the worst drawdown is 2 SOL of the 4 deployed = 50%.
		const rows = [
			close(1, 1, hoursAgo(96)),
			close(2, 1, hoursAgo(72)),
			close(-2, 1, hoursAgo(48)),
			close(1, 1, hoursAgo(24)),
		];
		const p = summarizeCopyProfile(rows);
		expect(p.settled).toBe(4);
		expect(p.deployed_sol).toBe(4);
		expect(p.realized_pnl_sol).toBe(2);
		expect(p.max_drawdown_sol).toBe(2);
		expect(p.max_drawdown_pct).toBe(50);
		expect(p.span_hours).toBe(72);
	});

	it('reports zero drawdown for a leader who never gave back a peak', () => {
		const p = summarizeCopyProfile([close(1, 1, hoursAgo(48)), close(1, 1, hoursAgo(24))]);
		expect(p.max_drawdown_sol).toBe(0);
		expect(p.max_drawdown_pct).toBe(0);
	});

	it('leaves drawdown undefined rather than 0% when no capital was deployed', () => {
		// 0% would read as "this leader never drew down", which is a lie about a
		// leader who never risked anything.
		expect(summarizeCopyProfile([close(0, 0, hoursAgo(1))]).max_drawdown_pct).toBe(null);
	});

	it('caps drawdown at 100% of deployed capital', () => {
		const p = summarizeCopyProfile([close(5, 0.1, hoursAgo(48)), close(-5, 0.1, hoursAgo(24))]);
		expect(p.max_drawdown_pct).toBe(100);
	});

	it('spans the real window even when rows arrive out of order', () => {
		const p = summarizeCopyProfile([close(1, 1, hoursAgo(10)), close(1, 1, hoursAgo(100))]);
		expect(p.span_hours).toBe(90);
	});
});

describe('evaluateLeaderCreatorLinkPair (pure band decision)', () => {
	it('treats a missing pair as not linked', () => {
		expect(evaluateLeaderCreatorLinkPair(null)).toEqual({ linked: false, score: null, band: null, topSignal: null });
	});
	it('trips at the default "strong" band', () => {
		expect(evaluateLeaderCreatorLinkPair({ score: 70, band: 'strong', topSignal: 'solana-fee-payer' }).linked).toBe(true);
		expect(evaluateLeaderCreatorLinkPair({ score: 90, band: 'confirmed', topSignal: 'solana-fee-payer' }).linked).toBe(true);
	});
	it('does not trip below the default band', () => {
		expect(evaluateLeaderCreatorLinkPair({ score: 30, band: 'weak', topSignal: 'direct-transfer' }).linked).toBe(false);
		expect(evaluateLeaderCreatorLinkPair({ score: 0, band: 'none', topSignal: null }).linked).toBe(false);
	});
	it('honors a custom band threshold', () => {
		const pair = { score: 30, band: 'weak', topSignal: 'direct-transfer' };
		expect(evaluateLeaderCreatorLinkPair(pair).linked).toBe(false);
		expect(evaluateLeaderCreatorLinkPair(pair, { band: 'weak' }).linked).toBe(true);
	});
});

describe('checkLeaderCreatorLinkage (refuse a leader who is secretly the creator)', () => {
	it('is not linked when the leader has no known trading wallet', async () => {
		const r = await checkLeaderCreatorLinkage({ leaderWallet: null, mint: 'Mint111', connection: {} });
		expect(r.linked).toBe(false);
	});

	it('is not linked when the coin has no resolvable creator', async () => {
		H.creatorWallet = null;
		const r = await checkLeaderCreatorLinkage({ leaderWallet: LEADER, mint: 'Mint111', connection: {} });
		expect(r.linked).toBe(false);
		expect(r.creator).toBeNull();
	});

	it('is not linked when the leader IS the on-record creator (nothing to detect, no RPC call needed)', async () => {
		H.creatorWallet = LEADER;
		const r = await checkLeaderCreatorLinkage({ leaderWallet: LEADER, mint: 'Mint111', connection: {} });
		expect(r.linked).toBe(false);
	});

	it('refuses a leader whose wallet scores as the same controller as the creator', async () => {
		H.creatorWallet = CREATOR;
		H.pair = { a: LEADER, b: CREATOR, score: 92, band: 'confirmed', topSignal: 'solana-fee-payer' };
		const r = await checkLeaderCreatorLinkage({ leaderWallet: LEADER, mint: 'Mint111', connection: {} });
		expect(r.linked).toBe(true);
		expect(r.creator).toBe(CREATOR);
		expect(r.score).toBe(92);
		expect(r.topSignal).toBe('solana-fee-payer');
	});

	it('is not linked when the score falls below the warn band', async () => {
		H.creatorWallet = CREATOR;
		H.pair = { a: LEADER, b: CREATOR, score: 10, band: 'weak', topSignal: 'direct-transfer' };
		const r = await checkLeaderCreatorLinkage({ leaderWallet: LEADER, mint: 'Mint111', connection: {} });
		expect(r.linked).toBe(false);
	});

	it('fails closed (not linked) when the linkage scorer errors, never blocking on a data outage', async () => {
		H.creatorWallet = CREATOR;
		H.analyzeThrows = true;
		const r = await checkLeaderCreatorLinkage({ leaderWallet: LEADER, mint: 'Mint111', connection: {} });
		expect(r.linked).toBe(false);
		H.analyzeThrows = false;
	});

	it('exports a stable machine reason for the follower-facing skip', () => {
		expect(CREATOR_LINK_REASON).toBe('leader_linked_to_creator');
	});
});
