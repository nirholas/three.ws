// Backtest integrity: look-ahead audit, dataset manifests, prior causality,
// canary ordering, the research/live import wall, and the audit wired into the
// real entry gate.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	auditLookahead,
	checkPriorsCausal,
	buildDatasetManifest,
	isCompleteManifest,
	withReproducibility,
} from '../api/_lib/backtest-integrity.js';
import { createResearchContext, RESEARCH_MODULES } from '../api/_lib/research-context.js';
import { auditBacktestLookahead } from '../api/_lib/strategy-backtest.js';
import { orderProviders, canaryRank, CANARY_STALE_MS } from '../api/_lib/data-canary-health.js';
import { judgeCandle, judgePrices, KNOWN_CANDLE } from '../api/_lib/data-canaries.js';
import { findWallViolations } from '../scripts/lib/research-wall.mjs';

const bars = Array.from({ length: 60 }, (_, i) => ({ t: i, close: 100 + Math.sin(i / 5) * 10 + i * 0.1 }));

// Clean: decides from the bars up to and including its own index.
const cleanDecide = (visible, i) => {
	const window = visible.slice(Math.max(0, i - 4), i + 1);
	const sma = window.reduce((a, b) => a + b.close, 0) / window.length;
	return visible[i].close > sma ? 'buy' : 'hold';
};
// Look-ahead: peeks at the next bar's close.
const peekDecide = (visible, i) => {
	const next = visible[i + 1];
	return next && next.close > visible[i].close ? 'buy' : 'hold';
};

describe('auditLookahead', () => {
	it('passes a clean strategy', () => {
		const r = auditLookahead({ series: bars, decide: cleanDecide });
		expect(r.ok).toBe(true);
		expect(r.offending).toEqual([]);
		expect(r.checked).toBe(60);
	});

	it('fails a strategy that reads the next bar and reports the offending indexes', () => {
		const r = auditLookahead({ series: bars, decide: peekDecide });
		expect(r.ok).toBe(false);
		expect(r.offending.length).toBeGreaterThan(0);
		// The last decision has no next bar in either view, so it cannot differ.
		expect(r.offending).not.toContain(59);
		for (const i of r.offending) expect(i).toBeLessThan(59);
	});

	it('samples evenly but always includes the first and last decision on long series', () => {
		const long = Array.from({ length: 5000 }, (_, i) => ({ t: i, close: i }));
		const r = auditLookahead({ series: long, decide: (v, i) => v[i].close, maxChecks: 100 });
		expect(r.ok).toBe(true);
		expect(r.checked).toBeLessThanOrEqual(102);
		expect(r.total).toBe(5000);
	});

	it('treats a decision that throws on truncated data as a failure', () => {
		const r = auditLookahead({ series: bars, decide: (v, i) => v[i + 1].close });
		expect(r.ok).toBe(false);
		expect(r.errors).toBeGreaterThan(0);
	});
});

describe('checkPriorsCausal', () => {
	const mk = (priors) => priors.map((p, i) => ({ creator: 'c', prior: p, i }));
	it('accepts counters that rise with each earlier launch', () => {
		expect(checkPriorsCausal({ rows: mk([0, 1, 2, 5]), subjectOf: (r) => r.creator, priorOf: (r) => r.prior }).ok).toBe(true);
	});
	it('flags a counter that stalls or falls', () => {
		const r = checkPriorsCausal({ rows: mk([0, 1, 1, 0]), subjectOf: (x) => x.creator, priorOf: (x) => x.prior });
		expect(r.ok).toBe(false);
		expect(r.offending).toEqual([2, 3]);
	});
});

describe('dataset manifest', () => {
	const rows = [
		{ id: 'a', at: '2026-01-02T00:00:00Z', v: 1 },
		{ id: 'b', at: '2026-01-05T00:00:00Z', v: 2 },
	];
	const args = { id: 'ds', source: 'unit', project: (r) => [r.id, r.v], timeOf: (r) => r.at };

	it('records id, source, range, row count and a stable content hash', () => {
		const m = buildDatasetManifest({ ...args, rows });
		expect(isCompleteManifest(m)).toBe(true);
		expect(m.row_count).toBe(2);
		expect(m.range).toEqual({ from: '2026-01-02T00:00:00.000Z', to: '2026-01-05T00:00:00.000Z' });
		expect(buildDatasetManifest({ ...args, rows }).content_hash).toBe(m.content_hash);
	});

	it('changes the hash when any row changes', () => {
		const a = buildDatasetManifest({ ...args, rows });
		const b = buildDatasetManifest({ ...args, rows: [rows[0], { ...rows[1], v: 3 }] });
		expect(b.content_hash).not.toBe(a.content_hash);
	});

	it('marks a result without a manifest unreproducible and one with a manifest reproducible', () => {
		const old = withReproducibility({ ok: true, sample_size: 3 });
		expect(old.reproducible).toBe(false);
		expect(old.integrity.unreproducible_reason).toMatch(/manifest/);
		const m = buildDatasetManifest({ ...args, rows });
		expect(withReproducibility({ ok: true, integrity: { manifest: m } }).reproducible).toBe(true);
		expect(withReproducibility({ ok: true, integrity: { manifest: { id: 'x' } } }).reproducible).toBe(false);
	});

	it('exposes a frozen ResearchContext with no live capability', () => {
		const ctx = createResearchContext({ datasetId: 'ds', source: 'unit', rows, project: args.project, timeOf: args.timeOf });
		expect(Object.isFrozen(ctx)).toBe(true);
		expect(ctx.asOf('2026-01-03T00:00:00Z')).toHaveLength(1);
		const names = Object.keys(ctx).join(' ');
		expect(names).not.toMatch(/sign|wallet|order|send|swap|key/i);
	});
});

describe('entry gate audit on the real scorer', () => {
	const row = (i, creator, prior) => ({
		mint: `THREEsynthetic${i}`,
		creator,
		first_seen_at: new Date(Date.UTC(2026, 0, 1 + i)),
		outcome: 'flat',
		ath_multiple: 2,
		ath_market_cap_usd: 40000,
		last_market_cap_usd: 20000,
		creator_launches_prior: prior,
		creator_graduated_prior: 0,
		signals: {},
		risk_flags: [],
	});
	const strategy = { trigger: 'new_mint', slippage_bps: 500, require_sol_quote: true, min_market_cap_usd: 5000 };

	it('passes when each launch is judged on its own recorded fields', () => {
		const rows = [row(0, 'cA', 0), row(1, 'cB', 0), row(2, 'cA', 1)];
		const r = auditBacktestLookahead(rows, strategy);
		expect(r.ok).toBe(true);
		expect(r.priors_causal).toBe(true);
	});

	it('fails when creator history counters go backwards', () => {
		const rows = [row(0, 'cA', 2), row(1, 'cA', 0)];
		const r = auditBacktestLookahead(rows, strategy);
		expect(r.ok).toBe(false);
		expect(r.priors_causal).toBe(false);
		expect(r.priors_offending).toEqual([1]);
	});
});

describe('canaries', () => {
	const now = 1_800_000_000_000;
	const ok = { ok: true, checked_at: now - 1000 };
	const bad = { ok: false, checked_at: now - 1000 };

	it('orders healthy sources first, unknown next in configured order, failing last', () => {
		const providers = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
		const out = orderProviders(providers, { a: bad, b: null, c: ok, d: null }, now).map((p) => p.name);
		expect(out).toEqual(['c', 'b', 'd', 'a']);
	});

	it('never drops a provider and treats a stale verdict as unknown', () => {
		const providers = [{ name: 'a' }, { name: 'b' }];
		const stale = { ok: false, checked_at: now - CANARY_STALE_MS - 1 };
		expect(canaryRank(stale, now)).toBe(1);
		expect(orderProviders(providers, { a: stale, b: bad }, now)).toHaveLength(2);
	});

	it('judges the known candle', () => {
		const good = { time: KNOWN_CANDLE.time, open: 188.82, high: 194.99, low: 187.6, close: 193.84 };
		expect(judgeCandle(good).ok).toBe(true);
		expect(judgeCandle({ ...good, time: good.time + 86400 }).ok).toBe(false);
		expect(judgeCandle({ ...good, close: 150 }).ok).toBe(false);
		expect(judgeCandle({ ...good, high: 100 }).ok).toBe(false);
		expect(judgeCandle(null).ok).toBe(false);
	});

	it('flags a price that disagrees with the median and one that is missing', () => {
		const j = judgePrices({ a: 190, b: 191, c: 192, d: 400, e: null });
		expect(j.a.ok && j.b.ok && j.c.ok).toBe(true);
		expect(j.d.ok).toBe(false);
		expect(j.e.ok).toBe(false);
	});
});

describe('research/live wall', () => {
	const root = process.cwd();

	it('no research module reaches a live execution module', () => {
		const { violations, visited } = findWallViolations(RESEARCH_MODULES, { root });
		expect(visited).toBeGreaterThan(RESEARCH_MODULES.length);
		expect(violations.map((v) => `${v.entry} -> ${v.chain.join(' > ')}`)).toEqual([]);
	});

	it('fails when a research file imports an execution module (transitively)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'wall-'));
		mkdirSync(join(dir, 'api/_lib'), { recursive: true });
		writeFileSync(join(dir, 'api/_lib/execution-engine.js'), 'export const submit = () => {};\n');
		writeFileSync(join(dir, 'api/_lib/helper.js'), "import { submit } from './execution-engine.js';\nexport const h = submit;\n");
		writeFileSync(join(dir, 'api/_lib/research-x.js'), "import { h } from './helper.js';\nexport const x = h;\n");
		const { violations } = findWallViolations(['api/_lib/research-x.js'], { root: dir });
		expect(violations).toHaveLength(1);
		expect(violations[0].target).toBe('api/_lib/execution-engine.js');
		expect(violations[0].chain).toEqual(['api/_lib/research-x.js', 'api/_lib/helper.js', 'api/_lib/execution-engine.js']);
	});

	it('fails on a dynamic import and on a signing package', () => {
		const dir = mkdtempSync(join(tmpdir(), 'wall-'));
		mkdirSync(join(dir, 'api/_lib'), { recursive: true });
		writeFileSync(join(dir, 'api/_lib/wallet-sign.js'), 'export const s = 1;\n');
		writeFileSync(join(dir, 'api/_lib/r1.js'), "export const f = () => import('./wallet-sign.js');\n");
		writeFileSync(join(dir, 'api/_lib/r2.js'), "import { Keypair } from '@solana/web3.js';\nexport const k = Keypair;\n");
		expect(findWallViolations(['api/_lib/r1.js'], { root: dir }).violations).toHaveLength(1);
		expect(findWallViolations(['api/_lib/r2.js'], { root: dir }).violations).toHaveLength(1);
	});
});
