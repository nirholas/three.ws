/**
 * Strategy Object v2: research gates, price-impact cap, ask/auto mode.
 *
 * Money-adjacent, so the invariants that keep an autonomous buyer honest are
 * pinned here without a DB or a model:
 *   - every research gate passes, fails, fails closed on unknown data, and
 *     stays out of the way when switched off,
 *   - v1 configs fold into v2 without losing a setting, and mode defaults to ask,
 *   - a strategy's impact cap can only tighten its agent's breaker,
 *   - the approval payload hash is canonical, so an approval cannot be replayed
 *     against a different buy,
 *   - the gate report fetches only the sections a strategy gates on,
 *   - the historical judge treats firewall-only checks as "checked at buy",
 *   - the natural-language compiler emits, explains and clamps the new fields.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/llm.js', () => ({ llmConfigured: () => false, llmComplete: vi.fn() }));

import {
	normalizeStrategyConfig,
	evaluateResearchGates,
	effectivePriceImpactPct,
	launchSources,
	researchGatesActive,
	matchesEntry,
	STRATEGY_CONFIG_DEFAULTS,
} from '../api/_lib/strategy-schema.js';
import { sectionsNeeded, topHolderPctExcluding, buildGateReport, riskNotesFromReport } from '../api/_lib/strategy-research.js';
import { canonicalJson, payloadHash, buildStrategyBuyPayload } from '../api/_lib/strategy-approvals.js';
import { curveMarketCapSol, curveImpactPct, historyToCandidate, judgeHistoricalGates, historicalGateReport } from '../api/_lib/strategy-preview.js';
import { sanitizeResearch, strategyHash } from '../api/_lib/strategy-backtest.js';
import { compileStrategyFromText } from '../api/_lib/strategy-compiler.js';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const CREATOR = 'THREEsynthetic11111111111111111111111111111';

function cfg(research = {}, extra = {}) {
	return normalizeStrategyConfig({ ...extra, research });
}

function fullReport(over = {}) {
	return {
		holders: { count: 120, top_holder_pct: 8 },
		liquidity: { sol: 12 },
		security: { score: 82 },
		authority: { known: true, mint_authority: null, freeze_authority: null },
		dev: { launches: 2, graduated: 1, sold: false },
		...over,
	};
}

const statusOf = (ev, check) => ev.checks.find((c) => c.check === check)?.status;

describe('evaluateResearchGates: each gate', () => {
	const cases = [
		{ check: 'min_holders', research: { min_holders: 100 }, fail: { holders: { count: 40, top_holder_pct: 8 } }, unknown: { holders: { count: null, top_holder_pct: 8 } } },
		{ check: 'max_top_holder_pct', research: { max_top_holder_pct: 20 }, fail: { holders: { count: 120, top_holder_pct: 35 } }, unknown: { holders: { count: 120, top_holder_pct: null } } },
		{ check: 'min_liquidity_sol', research: { min_liquidity_sol: 5 }, fail: { liquidity: { sol: 1.5 } }, unknown: { liquidity: { sol: null } } },
		{ check: 'security_min_score', research: { security_min_score: 60 }, fail: { security: { score: 30 } }, unknown: { security: { score: null } } },
		{ check: 'require_no_mint_authority', research: { require_no_mint_authority: true }, fail: { authority: { known: true, mint_authority: 'Auth111', freeze_authority: null } }, unknown: { authority: { known: false } } },
		{ check: 'require_no_freeze_authority', research: { require_no_freeze_authority: true }, fail: { authority: { known: true, mint_authority: null, freeze_authority: 'Auth111' } }, unknown: { authority: { known: false } } },
		{ check: 'dev_max_launches', research: { dev_history: { max_launches: 3 } }, fail: { dev: { launches: 14, graduated: 1, sold: false } }, unknown: { dev: { launches: null, graduated: 1, sold: false } } },
		{ check: 'dev_min_graduated', research: { dev_history: { min_graduated: 1 } }, fail: { dev: { launches: 2, graduated: 0, sold: false } }, unknown: { dev: { launches: 2, graduated: null, sold: false } } },
		{ check: 'dev_block_sold', research: { dev_history: { block_dev_sold: true } }, fail: { dev: { launches: 2, graduated: 1, sold: true } }, unknown: { dev: { launches: 2, graduated: 1, sold: null } } },
	];

	for (const c of cases) {
		describe(c.check, () => {
			const config = cfg(c.research);

			it('passes a coin that meets it', () => {
				const ev = evaluateResearchGates(config, fullReport());
				expect(statusOf(ev, c.check)).toBe('pass');
				expect(ev.pass).toBe(true);
				expect(ev.blocked_by).toEqual([]);
			});

			it('blocks a failing coin and names the check with a reason', () => {
				const ev = evaluateResearchGates(config, fullReport(c.fail));
				expect(ev.pass).toBe(false);
				expect(ev.blocked_by).toHaveLength(1);
				const b = ev.blocked_by[0];
				expect(b.check).toBe(c.check);
				expect(b.status).toBe('fail');
				expect(typeof b.reason).toBe('string');
				expect(b.reason.length).toBeGreaterThan(10);
				expect(b.label).toBeTruthy();
			});

			it('fails closed when the data is unknown', () => {
				const ev = evaluateResearchGates(config, fullReport(c.unknown));
				expect(ev.pass).toBe(false);
				expect(ev.blocked_by[0].check).toBe(c.check);
				expect(ev.blocked_by[0].status).toBe('unknown');
				expect(ev.blocked_by[0].reason).toMatch(/could not be verified/);
			});

			it('is ignored when switched off, even with failing or missing data', () => {
				const off = cfg({});
				expect(statusOf(evaluateResearchGates(off, fullReport(c.fail)), c.check)).toBe('off');
				expect(evaluateResearchGates(off, fullReport(c.unknown)).pass).toBe(true);
			});
		});
	}

	it('reports every failing gate, not just the first', () => {
		const config = cfg({ min_holders: 100, min_liquidity_sol: 5, dev_history: { block_dev_sold: true } });
		const ev = evaluateResearchGates(config, fullReport({ holders: { count: 3, top_holder_pct: 5 }, liquidity: { sol: 0.2 }, dev: { sold: true } }));
		expect(ev.blocked_by.map((b) => b.check).sort()).toEqual(['dev_block_sold', 'min_holders', 'min_liquidity_sol']);
	});

	it('an empty report blocks every enabled gate and passes a gate-free strategy', () => {
		const all = cfg({
			min_holders: 1, max_top_holder_pct: 50, min_liquidity_sol: 1, security_min_score: 10,
			require_no_mint_authority: true, require_no_freeze_authority: true,
			dev_history: { max_launches: 5, min_graduated: 0, block_dev_sold: true },
		});
		expect(evaluateResearchGates(all, {}).blocked_by).toHaveLength(9);
		expect(evaluateResearchGates(cfg({}), {}).pass).toBe(true);
	});

	it('the boundary value passes (min is inclusive, ceiling is inclusive)', () => {
		const config = cfg({ min_holders: 120, max_top_holder_pct: 8, min_liquidity_sol: 12, security_min_score: 82, dev_history: { max_launches: 2, min_graduated: 1 } });
		expect(evaluateResearchGates(config, fullReport()).pass).toBe(true);
	});
});

describe('normalizeStrategyConfig: v2 shape and v1 compatibility', () => {
	it('defaults mode to ask and stamps version 2', () => {
		const c = normalizeStrategyConfig({});
		expect(c.version).toBe(2);
		expect(c.mode).toBe('ask');
		expect(STRATEGY_CONFIG_DEFAULTS.mode).toBe('ask');
		expect(normalizeStrategyConfig({ mode: 'yolo' }).mode).toBe('ask');
		expect(normalizeStrategyConfig({ mode: 'auto' }).mode).toBe('auto');
	});

	it('folds legacy entry creator and liquidity filters into the research gates', () => {
		const c = normalizeStrategyConfig({ entry: { min_liquidity_sol: 4, max_creator_launches: 3, min_creator_graduated: 1 } });
		expect(c.research.min_liquidity_sol).toBe(4);
		expect(c.research.dev_history.max_launches).toBe(3);
		expect(c.research.dev_history.min_graduated).toBe(1);
	});

	it('the research value wins and both halves are written back identical', () => {
		const c = normalizeStrategyConfig({
			entry: { min_liquidity_sol: 4, max_creator_launches: 9 },
			research: { min_liquidity_sol: 7, dev_history: { max_launches: 2 } },
		});
		expect(c.research.min_liquidity_sol).toBe(7);
		expect(c.entry.min_liquidity_sol).toBe(7);
		expect(c.research.dev_history.max_launches).toBe(2);
		expect(c.entry.max_creator_launches).toBe(2);
	});

	it('accepts camelCase keys and stores snake_case', () => {
		const c = normalizeStrategyConfig({
			sizing: { maxPriceImpactBps: 250 },
			research: { minHolders: 75, maxTopHolderPct: 15, requireNoMintAuthority: true, devHistory: { blockDevSold: true, maxLaunches: 4 } },
		});
		expect(c.sizing.max_price_impact_bps).toBe(250);
		expect(c.research.min_holders).toBe(75);
		expect(c.research.max_top_holder_pct).toBe(15);
		expect(c.research.require_no_mint_authority).toBe(true);
		expect(c.research.dev_history.block_dev_sold).toBe(true);
		expect(c.research.dev_history.max_launches).toBe(4);
	});

	it('normalizes sources: unknown dropped, duplicates removed, every source means all', () => {
		expect(normalizeStrategyConfig({ entry: { sources: ['THREE_WS_LAUNCH', 'three_ws_launch', 'nope'] } }).entry.sources).toEqual(['three_ws_launch']);
		expect(normalizeStrategyConfig({ entry: { sources: ['pump_curve', 'three_ws_launch'] } }).entry.sources).toEqual([]);
		expect(normalizeStrategyConfig({ entry: { sources: 'three_ws_launch' } }).entry.sources).toEqual([]);
	});

	it('researchGatesActive is false until a gate is switched on', () => {
		expect(researchGatesActive(cfg({}))).toBe(false);
		expect(researchGatesActive(cfg({ require_no_freeze_authority: true }))).toBe(true);
		expect(researchGatesActive(cfg({ dev_history: { min_graduated: 0 } }))).toBe(true);
	});

	it('is idempotent', () => {
		const once = cfg({ min_holders: 50, dev_history: { max_launches: 3 } }, { mode: 'auto', sizing: { max_price_impact_bps: 400 } });
		expect(normalizeStrategyConfig(once)).toEqual(once);
	});
});

describe('price impact and sources', () => {
	it('a strategy can only tighten its agent breaker', () => {
		const tight = normalizeStrategyConfig({ sizing: { max_price_impact_bps: 300 } });
		const loose = normalizeStrategyConfig({ sizing: { max_price_impact_bps: 2000 } });
		const none = normalizeStrategyConfig({});
		expect(effectivePriceImpactPct(tight, 10)).toBe(3);
		expect(effectivePriceImpactPct(loose, 10)).toBe(10);
		expect(effectivePriceImpactPct(none, 10)).toBe(10);
		expect(effectivePriceImpactPct(tight, null)).toBe(3);
		expect(effectivePriceImpactPct(none, null)).toBe(null);
	});

	it('tags three.ws launches and filters entry by source', () => {
		expect(launchSources({})).toEqual(['pump_curve']);
		expect(launchSources({ three_ws_launch: true })).toEqual(['pump_curve', 'three_ws_launch']);
		const only = normalizeStrategyConfig({ entry: { sources: ['three_ws_launch'], max_age_minutes: 600 } });
		const launch = { mint: MINT, created_at: Date.now() - 60_000, liquidity_sol: 10, market_cap_usd: 9000, is_usdc_pair: false };
		expect(matchesEntry(only, launch, Date.now()).pass).toBe(false);
		expect(matchesEntry(only, { ...launch, three_ws_launch: true }, Date.now()).pass).toBe(true);
	});
});

describe('topHolderPctExcluding', () => {
	it('excludes the bonding curve and rescales to circulating supply', () => {
		const top = [{ owner: 'CURVE', pct: 80 }, { owner: 'A', pct: 5 }, { owner: 'B', pct: 2 }];
		expect(topHolderPctExcluding(top, 'CURVE')).toBeCloseTo(25, 6);
	});

	it('matches the curve by token account address too', () => {
		expect(topHolderPctExcluding([{ address: 'CURVE', pct: 50 }, { owner: 'A', pct: 10 }], 'CURVE')).toBeCloseTo(20, 6);
	});

	it('returns null with no usable rows', () => {
		expect(topHolderPctExcluding([], 'CURVE')).toBe(null);
		expect(topHolderPctExcluding(null, 'CURVE')).toBe(null);
		expect(topHolderPctExcluding([{ owner: 'CURVE', pct: 100 }], 'CURVE')).toBe(null);
	});
});

describe('approval payload', () => {
	it('canonicalJson is key-order independent and drops undefined', () => {
		expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { y: 1, x: 0 }] }, z: undefined }))
			.toBe(canonicalJson({ a: { c: [3, { x: 0, y: 1 }], d: 2 }, b: 1 }));
		expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
	});

	it('the payload hash binds every field of the buy', () => {
		const config = normalizeStrategyConfig({ sizing: { amount_sol: 0.1, max_slippage_bps: 800, max_price_impact_bps: 350 } });
		const p = buildStrategyBuyPayload({ equip: { id: 'eq1', strategy_id: 's1' }, agentId: 'ag1', config, network: 'mainnet', mint: MINT, idempotencyKey: 'k1' });
		expect(p).toEqual({
			kind: 'strategy_buy', agent_id: 'ag1', equip_id: 'eq1', strategy_id: 's1', network: 'mainnet',
			mint: MINT, side: 'buy', amount_sol: 0.1, slippage_bps: 800, max_price_impact_pct: 3.5, idempotency_key: 'k1',
		});
		const h = payloadHash(p);
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(payloadHash({ ...p })).toBe(h);
		expect(payloadHash({ ...p, amount_sol: 0.2 })).not.toBe(h);
		expect(payloadHash({ ...p, mint: CREATOR })).not.toBe(h);
	});

	it('a strategy with no impact cap carries null, not NaN', () => {
		const p = buildStrategyBuyPayload({ equip: { id: 'e', strategy_id: 's' }, agentId: 'a', config: normalizeStrategyConfig({}), network: 'devnet', mint: MINT, idempotencyKey: 'k' });
		expect(p.max_price_impact_pct).toBe(null);
	});
});

function fakeDeps(over = {}) {
	const calls = { holders: 0, safety: 0, creator: 0, intel: 0 };
	const deps = {
		readIntel: async () => { calls.intel++; return { dev_sold: false, signals: {} }; },
		composeTokenHolders: async () => { calls.holders++; return { status: 'ok', holderCount: 140, sources: ['indexer'], top: [{ owner: 'CURVE', pct: 60 }, { owner: 'W', pct: 8 }] }; },
		bondingCurveOwner: async () => 'CURVE',
		assessTradeSafety: async () => {
			calls.safety++;
			return { score: 77, verdict: 'allow', reasons: ['Simulated buy succeeded.'], checks: [{ name: 'mint_authority', detail: { mint_authority: null, freeze_authority: null } }] };
		},
		enrichCreatorStats: async (l) => { calls.creator++; l.creator_launches = 3; l.creator_graduated = 1; },
		...over,
	};
	return { deps, calls };
}

const LAUNCH = { mint: MINT, name: 'Synthetic', symbol: 'SYN', creator: CREATOR, liquidity_sol: 9, market_cap_usd: 12000 };

describe('buildGateReport', () => {
	it('fetches only the sections a strategy gates on', async () => {
		expect(sectionsNeeded(cfg({ min_liquidity_sol: 2 }))).toEqual({ holders: false, security: false, dev: false });
		expect(sectionsNeeded(cfg({ min_holders: 10 })).holders).toBe(true);
		expect(sectionsNeeded(cfg({ require_no_mint_authority: true })).security).toBe(true);
		expect(sectionsNeeded(cfg({ dev_history: { block_dev_sold: true } })).dev).toBe(true);
		expect(sectionsNeeded(cfg({}), { forApproval: true })).toEqual({ holders: true, security: true, dev: true });

		const { deps, calls } = fakeDeps();
		const { report } = await buildGateReport({ config: cfg({ min_liquidity_sol: 2 }), launch: LAUNCH }, deps);
		expect(calls).toMatchObject({ holders: 0, safety: 0, creator: 0 });
		expect(report.liquidity.sol).toBe(9);
		expect(report.holders.skipped).toBe(true);
		expect(evaluateResearchGates(cfg({ min_liquidity_sol: 2 }), report).pass).toBe(true);
	});

	it('assembles every section from the readers and the gates read it', async () => {
		const config = cfg({ min_holders: 100, max_top_holder_pct: 25, security_min_score: 60, require_no_mint_authority: true, require_no_freeze_authority: true, dev_history: { max_launches: 5, min_graduated: 1, block_dev_sold: true } });
		const { deps } = fakeDeps();
		const { report, assessment } = await buildGateReport({ config, launch: LAUNCH, payer: CREATOR }, deps);
		expect(report.holders.count).toBe(140);
		expect(report.holders.top_holder_pct).toBe(20);
		expect(report.security.score).toBe(77);
		expect(report.authority).toMatchObject({ known: true, mint_authority: null, freeze_authority: null });
		expect(report.dev).toMatchObject({ launches: 3, graduated: 1, sold: false });
		expect(assessment.score).toBe(77);
		const ev = evaluateResearchGates(config, report);
		expect(ev.pass).toBe(true);
		const notes = riskNotesFromReport(report, ev);
		expect(notes.some((n) => /Firewall score 77/.test(n))).toBe(true);
		expect(notes.join(' ')).not.toMatch(/Synthetic|SYN/);
	});

	it('a reader that throws leaves its fields unknown, so its gate fails closed', async () => {
		const config = cfg({ min_holders: 10, security_min_score: 50 });
		const { deps } = fakeDeps({
			composeTokenHolders: async () => { throw new Error('indexer down'); },
			assessTradeSafety: async () => { throw new Error('rpc down'); },
		});
		const { report } = await buildGateReport({ config, launch: LAUNCH }, deps);
		const ev = evaluateResearchGates(config, report);
		expect(ev.pass).toBe(false);
		expect(ev.blocked_by.map((b) => [b.check, b.status])).toEqual([['min_holders', 'unknown'], ['security_min_score', 'unknown']]);
	});

	it('prefers the intel engine top-holder share over the on-chain walk', async () => {
		const { deps } = fakeDeps({ readIntel: async () => ({ dev_sold: true, signals: { concentration_top1: 0.31 } }) });
		const { report } = await buildGateReport({ config: cfg({ max_top_holder_pct: 25 }), launch: LAUNCH }, deps);
		expect(report.holders.top_holder_pct).toBe(31);
		expect(report.holders.source.top_holder_pct).toBe('pump_coin_intel');
		expect(evaluateResearchGates(cfg({ max_top_holder_pct: 25 }), report).blocked_by[0].check).toBe('max_top_holder_pct');
	});
});

describe('preview and backtest history', () => {
	it('curve math matches the bonding-curve constant-product formula', () => {
		expect(curveMarketCapSol(0)).toBeCloseTo((30 * 30 * 1e9) / (30 * 1.073e9), 6);
		expect(curveMarketCapSol(10)).toBeGreaterThan(curveMarketCapSol(0));
		expect(curveMarketCapSol(-5)).toBe(curveMarketCapSol(0));
		expect(curveImpactPct(0.3, 0)).toBeCloseTo(1, 6);
		expect(curveImpactPct(0.3, 30)).toBeCloseTo(0.5, 6);
	});

	it('turns a recorded intel row into the live launch and report shapes', () => {
		const row = {
			mint: MINT, creator: CREATOR, first_seen_at: '2026-10-10T00:00:00Z',
			buy_volume_lamports: '6000000000', sell_volume_lamports: '1000000000',
			unique_buyers: 44, top1: '0.12', dev_sold: false, launches_prior: 2, graduated_prior: 1,
			fw_score: 70, fw_authority: { mint_authority: null, freeze_authority: null }, three_ws_launch: true,
		};
		const { launch, report, netSol } = historyToCandidate(row, 150);
		expect(netSol).toBe(5);
		expect(launch.liquidity_sol).toBe(5);
		expect(launch.creator_launches).toBe(3);
		expect(launch.market_cap_usd).toBeCloseTo(curveMarketCapSol(5) * 150, 6);
		expect(launchSources(launch)).toContain('three_ws_launch');
		expect(report.holders).toEqual({ count: 44, top_holder_pct: 12 });
		expect(report.authority.known).toBe(true);
		expect(report.dev).toMatchObject({ launches: 3, graduated: 1, sold: false });
	});

	it('firewall-only checks missing from history are live, any other unknown blocks', () => {
		const row = { mint: MINT, unique_buyers: 80, top1: 0.1, dev_sold: false, buy_volume_lamports: 5e9, sell_volume_lamports: 0 };
		const report = historicalGateReport(row, {});
		const live = judgeHistoricalGates(cfg({ min_holders: 50, security_min_score: 60, require_no_mint_authority: true }), report);
		expect(live.blocked).toBe(null);
		expect(live.live).toBe(true);
		const hard = judgeHistoricalGates(cfg({ dev_history: { max_launches: 3 } }), report);
		expect(hard.blocked).toBe('dev_max_launches');
		const fail = judgeHistoricalGates(cfg({ min_holders: 100, security_min_score: 60 }), report);
		expect(fail.blocked).toBe('min_holders');
		const clean = judgeHistoricalGates(cfg({ min_holders: 50 }), report);
		expect(clean).toMatchObject({ blocked: null, live: false });
	});

	it('sanitizeResearch is null with no gates, so the backtest cache hash is unchanged', () => {
		expect(sanitizeResearch(null)).toBe(null);
		expect(sanitizeResearch({})).toBe(null);
		expect(sanitizeResearch({ min_holders: null, require_no_mint_authority: false })).toBe(null);
		const g = sanitizeResearch({ minHolders: 60, devHistory: { blockDevSold: true } });
		expect(g.min_holders).toBe(60);
		expect(g.dev_history.block_dev_sold).toBe(true);

		const base = { trigger: 'new_mint', per_trade_lamports: '100000000', stop_loss_pct: 30 };
		const h0 = strategyHash(base, 30, 'mainnet');
		expect(strategyHash({ ...base, research: null }, 30, 'mainnet')).toBe(h0);
		expect(strategyHash({ ...base, research: g }, 30, 'mainnet')).not.toBe(h0);
	});
});

describe('compileStrategyFromText: v2 round trip', () => {
	it('emits and explains research gates, impact, sources and ask mode', async () => {
		const r = await compileStrategyFromText(
			'Buy three.ws launches with at least 150 holders, 5 sol liquidity, security score 70, renounced mint and renounced freeze authority, 3% price impact, 0.2 sol per trade, stop loss 35%, ask me first',
		);
		expect(r.ok).toBe(true);
		const so = r.strategy_object;
		expect(so.version).toBe(2);
		expect(so.mode).toBe('ask');
		expect(so.entry.sources).toEqual(['three_ws_launch']);
		expect(so.sizing.amount_sol).toBe(0.2);
		expect(so.sizing.max_price_impact_bps).toBe(300);
		expect(so.research.min_holders).toBe(150);
		expect(so.research.min_liquidity_sol).toBe(5);
		expect(so.research.security_min_score).toBe(70);
		expect(so.research.require_no_mint_authority).toBe(true);
		expect(so.research.require_no_freeze_authority).toBe(true);
		expect(so.exits.stop_loss_pct).toBe(35);

		const fields = r.explanations.map((e) => e.field);
		for (const f of ['mode', 'entry.sources', 'sizing.amount_sol', 'sizing.max_price_impact_bps', 'research.min_holders', 'research.min_liquidity_sol', 'research.security_min_score', 'research.require_no_mint_authority', 'research.require_no_freeze_authority']) {
			expect(fields).toContain(f);
		}
		for (const e of r.explanations) expect(e.why.length).toBeGreaterThan(10);

		// Round trip: the compiled object is already normalized and evaluates as stored.
		expect(normalizeStrategyConfig(so)).toEqual(so);
		const bad = evaluateResearchGates(so, fullReport({ holders: { count: 20, top_holder_pct: 5 } }));
		expect(bad.blocked_by[0].check).toBe('min_holders');
	});

	it('defaults to ask and only goes auto when the owner says so', async () => {
		const ask = await compileStrategyFromText('snipe new launches 0.1 sol each stop loss 30%');
		expect(ask.strategy_object.mode).toBe('ask');
		const auto = await compileStrategyFromText('snipe new launches automatically, 0.1 sol each, stop loss 30%');
		expect(auto.strategy_object.mode).toBe('auto');
	});

	it('clamps price impact to the agent breaker and says so', async () => {
		const r = await compileStrategyFromText('snipe with 40% price impact, 0.1 sol per trade, stop loss 30%', { tradeLimits: { max_price_impact_pct: 6 } });
		expect(r.strategy_object.sizing.max_price_impact_bps).toBe(600);
		expect(r.clamped.join(' ')).toMatch(/6% safety breaker/);
		expect(effectivePriceImpactPct(r.strategy_object, 6)).toBe(6);
	});

	it('carries creator filters into dev_history', async () => {
		const r = await compileStrategyFromText("creators who've graduated at least 2 coins, no dev dump, stop loss 30%");
		expect(r.strategy_object.research.dev_history.min_graduated).toBe(2);
		expect(r.strategy_object.research.dev_history.block_dev_sold).toBe(true);
		expect(r.strategy_object.entry.min_creator_graduated).toBe(2);
	});
});
