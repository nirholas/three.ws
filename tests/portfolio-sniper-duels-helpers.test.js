// The pure logic under the portfolio, launch-alert, sniper, signal and duel
// tools: the launch_match matcher and its schema, the realized-P&L curve and
// series thinning, the P&L digest, exact lamport conversion, the challenge
// view, the subscription knobs, and the alert owner fan-out.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));

const { sql } = await import('../api/_lib/db.js');
const { insertNotification } = await import('../api/_lib/notify.js');
const { compileNamePattern, launchMatchesRule, buildLaunchMatchPayload, describeLaunchFilters } = await import('../api/_lib/pump-alert-eval.js');
const { createRuleSchema, validateUpdate, normalizeForKind } = await import('../api/alerts/_rules.js');
const { realizedCurve, bucketSnapshots, pnlDigest } = await import('../api/_lib/portfolio-history.js');
const { solToLamports, lamportsToSol } = await import('../api/_lib/sniper-control.js');
const { challengeView } = await import('../api/_lib/duel-challenges.js');
const { subscriptionKnobs } = await import('../api/_lib/signal-subscription-control.js');
const { deliverAlert } = await import('../api/_lib/alert-delivery.js');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const rule = (filters) => ({ id: 'r1', kind: 'launch_match', filters });
const launch = (over = {}) => ({
	mint: MINT, name: 'Three Cat', symbol: 'TCAT', market_cap_usd: 12_000, quality_score: 72,
	creator_launches: 3, creator_graduated: 1, risk_flags: ['sniped'], has_socials: true, ...over,
});

describe('compileNamePattern', () => {
	it('matches anywhere without a star, anchored with one, case-insensitively', () => {
		expect(compileNamePattern('dog')('HOTDOG')).toBe(true);
		expect(compileNamePattern('dog*')('HOTDOG')).toBe(false);
		expect(compileNamePattern('*dog')('HOTDOG')).toBe(true);
		expect(compileNamePattern('cat|dog')('Hotdogs')).toBe(true);
	});

	it('treats every regex metacharacter except * and | as a literal', () => {
		const m = compileNamePattern('a.b(c)+');
		expect(m('a.b(c)+')).toBe(true);
		expect(m('axb(c)')).toBe(false);
		expect(compileNamePattern('  |  ')).toBe(null);
	});
});

describe('launchMatchesRule', () => {
	it('returns every filter that held when the launch passes them all', () => {
		const held = launchMatchesRule(rule({
			name_pattern: '*cat*', min_market_cap_usd: 5000, max_market_cap_usd: 50_000, min_safety_score: 60,
			min_creator_graduated: 1, max_creator_launches: 5, exclude_risk_flags: ['dev_dumped'], require_socials: true,
		}), launch());
		expect(held).toEqual([
			'name matches "*cat*"', 'mcap >= $5,000', 'mcap <= $50,000', 'safety 72 >= 60',
			'creator graduated 1', 'creator launches 3 <= 5', 'none of dev_dumped', 'has socials',
		]);
	});

	it('matches the symbol when the name misses', () => {
		expect(launchMatchesRule(rule({ name_pattern: 'tcat' }), launch({ name: 'Other' }))).toEqual(['name matches "tcat"']);
	});

	it('misses on any failing filter', () => {
		expect(launchMatchesRule(rule({ max_market_cap_usd: 10_000 }), launch())).toBe(null);
		expect(launchMatchesRule(rule({ exclude_risk_flags: ['sniped'] }), launch())).toBe(null);
		expect(launchMatchesRule(rule({ min_safety_score: 80 }), launch())).toBe(null);
		expect(launchMatchesRule(rule({ require_socials: true }), launch({ has_socials: false }))).toBe(null);
	});

	it('treats missing launch data as a miss, never a silent pass', () => {
		expect(launchMatchesRule(rule({ min_market_cap_usd: 0 }), launch({ market_cap_usd: null }))).toBe(null);
		expect(launchMatchesRule(rule({ min_safety_score: 0 }), launch({ quality_score: undefined }))).toBe(null);
		expect(launchMatchesRule(rule({ max_creator_launches: 10 }), launch({ creator_launches: null }))).toBe(null);
	});

	it('only applies to launch_match rules', () => {
		expect(launchMatchesRule({ kind: 'new_mint', filters: {} }, launch())).toBe(null);
	});

	it('builds a payload that links the coin and carries what matched', () => {
		const p = buildLaunchMatchPayload({ id: 'r1' }, launch({ first_seen_at: '2026-10-10T00:00:00Z' }), ['safety 72 >= 60']);
		expect(p).toMatchObject({ kind: 'launch_match', event_id: `launch:${MINT}`, safety_score: 72, matched: ['safety 72 >= 60'], link: `/coin/${MINT}`, at: '2026-10-10T00:00:00.000Z' });
	});

	it('describes a filter set in plain language', () => {
		expect(describeLaunchFilters({ name_pattern: 'cat', min_market_cap_usd: 5000, max_market_cap_usd: 50_000, require_socials: true }))
			.toBe('"cat" · $5k to $50k · socials');
	});
});

describe('launch_match rule schema', () => {
	it('accepts a filter-only rule', () => {
		const r = createRuleSchema.safeParse({ kind: 'launch_match', filters: { name_pattern: 'cat', exclude_risk_flags: ['bundle_launch'] } });
		expect(r.success).toBe(true);
	});

	it('needs at least one filter, a sane cap band, and no target', () => {
		const paths = (body) => createRuleSchema.safeParse(body).error?.issues.map((i) => i.path.join('.'));
		expect(paths({ kind: 'launch_match', filters: {} })).toContain('filters');
		expect(paths({ kind: 'launch_match', filters: { require_socials: false } })).toContain('filters');
		expect(paths({ kind: 'launch_match', filters: { min_market_cap_usd: 10, max_market_cap_usd: 5 } })).toContain('filters.min_market_cap_usd');
		expect(paths({ kind: 'launch_match', target_mint: MINT, filters: { name_pattern: 'x' } })).toContain('kind');
	});

	it('rejects unknown filter keys and unknown risk flags', () => {
		expect(createRuleSchema.safeParse({ kind: 'launch_match', filters: { colour: 'blue' } }).success).toBe(false);
		expect(createRuleSchema.safeParse({ kind: 'launch_match', filters: { exclude_risk_flags: ['spooky'] } }).success).toBe(false);
	});

	it('clears filters when a rule leaves the launch_match kind, and drops null filters on it', () => {
		expect(normalizeForKind({ kind: 'graduation', filters: { name_pattern: 'x' } }).filters).toBe(null);
		expect(normalizeForKind({ kind: 'launch_match', filters: { name_pattern: 'x', min_safety_score: null } }).filters).toEqual({ name_pattern: 'x' });
		const r = validateUpdate({ kind: 'launch_match', filters: { name_pattern: 'x' }, deliver_in_app: true }, { filters: {} });
		expect(r.ok).toBe(false);
	});
});

describe('realizedCurve', () => {
	const pos = (day, lamports, status = 'closed') => ({ status, closed_at: new Date(Date.UTC(2026, 9, day, 12)).toISOString(), realized_pnl_lamports: lamports });

	it('accumulates closes per UTC day, oldest first, with USD when a price is known', () => {
		const curve = realizedCurve([pos(3, -0.5e9), pos(1, 1e9), pos(1, 0.25e9), pos(2, 0, 'open')], { solUsd: 100 });
		expect(curve).toEqual([
			{ date: '2026-10-01', cumulative_realized_sol: 1.25, cumulative_realized_usd: 125, trades_closed: 2 },
			{ date: '2026-10-03', cumulative_realized_sol: 0.75, cumulative_realized_usd: 75, trades_closed: 1 },
		]);
	});

	it('hides days before the window but keeps their P&L in the running total', () => {
		const curve = realizedCurve([pos(1, 1e9), pos(5, 1e9)], { sinceMs: Date.UTC(2026, 9, 4) });
		expect(curve).toEqual([{ date: '2026-10-05', cumulative_realized_sol: 2, cumulative_realized_usd: null, trades_closed: 1 }]);
	});
});

describe('bucketSnapshots', () => {
	it('leaves a short series alone and thins a long one keeping both ends exact', () => {
		const rows = Array.from({ length: 101 }, (_, i) => i);
		expect(bucketSnapshots(rows.slice(0, 5), 10)).toHaveLength(5);
		const thin = bucketSnapshots(rows, 5);
		expect(thin).toEqual([0, 25, 50, 75, 100]);
	});
});

describe('pnlDigest', () => {
	it('totals realized and unrealized, prices them, and ranks open winners and losers', () => {
		const d = pnlDigest({
			agent: { id: 'a' }, network: 'mainnet', sol_usd: 100,
			net_worth: { sol: 5, usd: 500, realized_pnl_sol: 1, unrealized_pnl_sol: -0.25 },
			holdings: [
				{ mint: 'm1', symbol: 'A', unrealized_sol: 0.5 },
				{ mint: 'm2', symbol: 'B', unrealized_sol: -0.75 },
				{ mint: 'm3', symbol: 'C', unrealized_sol: 0.1 },
				{ isNative: true, unrealized_sol: null },
			],
			attribution: [{ source: 'sniper' }],
			metrics: { closed_count: 4, open_count: 3, win_rate: 0.5 },
		});
		expect(d.totals).toMatchObject({ realized_sol: 1, unrealized_sol: -0.25, total_sol: 0.75, total_usd: 75, realized_usd: 100 });
		expect(d.top_winners.map((h) => h.symbol)).toEqual(['A', 'C']);
		expect(d.top_losers.map((h) => h.symbol)).toEqual(['B']);
		expect(d.performance).toMatchObject({ closed_trades: 4, open_trades: 3, win_rate: 0.5, roi_pct: null });
		expect(d.by_source).toEqual([{ source: 'sniper' }]);
	});

	it('reports no total when neither side is known', () => {
		expect(pnlDigest({ net_worth: {}, sol_usd: null }).totals.total_sol).toBe(null);
	});
});

describe('lamport conversion', () => {
	it('converts exactly, without float drift', () => {
		expect(solToLamports(0.1)).toBe('100000000');
		expect(solToLamports(1.000000001)).toBe('1000000001');
		expect(solToLamports('2.5')).toBe('2500000000');
		expect(lamportsToSol('1500000000')).toBe(1.5);
	});

	it('refuses zero, negatives, garbage and dust below one lamport', () => {
		for (const bad of [0, -1, 'x', NaN, Infinity, 1e-10]) expect(solToLamports(bad)).toBe(null);
	});
});

describe('challengeView', () => {
	const row = {
		id: 'c1', status: 'pending', network: 'mainnet', window_kind: 'day', challenger_user: 'u1', challenged_user: 'u2',
		challenger_agent: 'a1', challenged_agent: 'a2', challenger_name: 'Scout', challenged_name: 'Rival',
		expires_at: '2026-10-12T00:00:00Z', created_at: '2026-10-10T00:00:00Z', responded_at: null, market_id: null,
	};

	it('lets only the challenged owner respond and only the challenger cancel', () => {
		expect(challengeView(row, 'u2')).toMatchObject({ your_role: 'challenged', can_respond: true, can_cancel: false });
		expect(challengeView(row, 'u1')).toMatchObject({ your_role: 'challenger', can_respond: false, can_cancel: true });
		expect(challengeView(row, 'u3')).toMatchObject({ your_role: null, can_respond: false, can_cancel: false });
		expect(challengeView({ ...row, status: 'accepted', market_id: 'd1' }, 'u2')).toMatchObject({ can_respond: false, duel_url: '/duels/d1' });
	});
});

describe('subscriptionKnobs', () => {
	it('defaults to paper and clamps every size into the mirror engine range', () => {
		expect(subscriptionKnobs({})).toEqual({
			mode: 'simulate', billing: 'per_signal', baseSol: 0.05, sizeScaling: 1, maxPerTrade: 0.25, slippageBps: 300, firewallLevel: 'block', copyExits: true,
		});
		const k = subscriptionKnobs({ base_sol: 999, max_per_trade_sol: 0, slippage_bps: 9999, copy_exits: false, mode: 'anything' });
		expect(k).toMatchObject({ mode: 'simulate', baseSol: 10, maxPerTrade: 0.001, slippageBps: 5000, copyExits: false });
	});
});

describe('deliverAlert owner fan-out', () => {
	const alertRule = (over = {}) => ({ id: 'r1', user_id: 'u1', deliver_in_app: true, webhook_url: null, telegram_chat: null, ...over });
	const payload = { kind: 'launch_match', mint: MINT, symbol: 'TCAT', market_cap_usd: 12_000, matched: [] };

	beforeEach(() => vi.clearAllMocks());

	it('goes through the platform notification fan-out and names every channel reached', async () => {
		insertNotification.mockResolvedValue({ id: 'n1', delivered: { push: 2, telegram: 1, apns: 0 } });
		const res = await deliverAlert(alertRule(), payload);
		expect(insertNotification).toHaveBeenCalledWith('u1', 'pump_alert', expect.objectContaining({ link: `/coin/${MINT}`, summary: expect.any(String) }));
		expect(res.in_app).toEqual({ attempted: true, ok: true, detail: 'bell, push x2, telegram x1' });
		expect(res.webhook.attempted).toBe(false);
		expect(res.telegram.attempted).toBe(false);
	});

	it('does not post twice to a rule chat that is already a paired notify chat', async () => {
		insertNotification.mockResolvedValue({ id: 'n1', delivered: { telegram: 1 } });
		sql.mockResolvedValueOnce([{ ok: 1 }]);
		const res = await deliverAlert(alertRule({ telegram_chat: '12345' }), payload);
		expect(res.telegram).toEqual({ attempted: true, ok: true, detail: 'sent_via_paired_chat' });
	});

	it('reports a muted owner instead of a false success', async () => {
		insertNotification.mockResolvedValue({ id: null, in_app: false, delivered: {} });
		const res = await deliverAlert(alertRule(), payload);
		expect(res.in_app).toEqual({ attempted: true, ok: false, detail: 'muted_by_preferences' });
	});

	it('keeps a fan-out failure on its own channel', async () => {
		insertNotification.mockRejectedValue(new Error('db down'));
		const res = await deliverAlert(alertRule(), payload);
		expect(res.in_app).toMatchObject({ attempted: true, ok: false });
		expect(res.in_app.detail).toContain('db down');
	});

	it('skips the owner channel when the rule turned it off', async () => {
		const res = await deliverAlert(alertRule({ deliver_in_app: false }), payload);
		expect(insertNotification).not.toHaveBeenCalled();
		expect(res.in_app.attempted).toBe(false);
	});
});
