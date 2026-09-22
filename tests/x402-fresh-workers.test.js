// Tests for the x402 fresh-wallet workers lane: the pure planning module
// (api/_lib/x402/fresh-workers/plan.js), the job catalog's binding to the ring
// catalog (jobs.js), and the wiring that makes the lane actually run
// (economy-tick TARGETS, the direct cron handler file). No DB, no chain.
//
// What these lock down:
//   • config gates: defaults, the kill switch, junk-tolerant parsing.
//   • the SOL a fresh wallet is given is exactly rent-exemption + two fees.
//   • the tick plan: a forge job on every Nth tick, datasets in rotation,
//     per-tick zero buys nothing, the daily cap trims in order.
//   • funding math + funder headroom never dip under the sponsor floor.
//   • the sweep drains a wallet to exactly zero.
//   • reclaim verdicts: wait / sweep / stranded / skip.
//   • every data job resolves against the ring catalog with a positive price.
//   • the forge prompt walk changes with the seed.
//   • the lane is fired by the economy heartbeat and has a routable handler.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	freshWorkersConfig, walletSolLamports, planTickJobs, fitJobsToBudget, fundingRequirement,
	funderHeadroom, sweepAmountLamports, classifyReclaim, trimPayload,
	RENT_EXEMPT_FALLBACK_LAMPORTS, ATA_RENT_LAMPORTS, BASE_FEE_LAMPORTS,
} from '../api/_lib/x402/fresh-workers/plan.js';
import { DATA_JOBS, DATA_JOB_SLUGS, resolveDataJob, resolveForgeJob, resolveJob } from '../api/_lib/x402/fresh-workers/jobs.js';
import { forgePropForSeed } from '../api/_lib/x402/pipelines/forge-content.js';
import { bySlug } from '../api/_lib/x402/ring-catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ENV_KEYS = [
	'X402_FRESH_WORKERS_ENABLED', 'X402_FRESH_WORKERS_PER_TICK', 'X402_FRESH_WORKERS_FORGE_EVERY_N_TICKS',
	'X402_FRESH_WORKERS_DAILY_CAP_ATOMIC', 'X402_FRESH_WORKERS_TICK_BUDGET_MS', 'X402_FRESH_WORKERS_RECLAIM_AFTER_S',
	'X402_FRESH_WORKERS_MAX_SWEEP_ATTEMPTS', 'X402_FRESH_WORKERS_MEMBERSHIP_HOURS', 'X402_RING_MAX_FEE_PER_TX_LAMPORTS',
];

describe('fresh workers config', () => {
	const saved = {};
	beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
	afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

	it('is on by default and only "false" turns it off', () => {
		expect(freshWorkersConfig({}).enabled).toBe(true);
		expect(freshWorkersConfig({ X402_FRESH_WORKERS_ENABLED: 'FALSE' }).enabled).toBe(false);
		expect(freshWorkersConfig({ X402_FRESH_WORKERS_ENABLED: '0' }).enabled).toBe(true);
	});

	it('has sane defaults and tolerates junk', () => {
		const d = freshWorkersConfig({});
		expect(d.perTick).toBe(3);
		expect(d.forgeEveryNTicks).toBe(10);
		expect(d.dailyCapAtomic).toBe(40_000_000);
		expect(d.tickBudgetMs).toBe(50_000);
		expect(d.reclaimAfterS).toBe(90);
		expect(d.maxSweepAttempts).toBe(20);
		expect(d.membershipWindowHours).toBe(36);
		const j = freshWorkersConfig({ X402_FRESH_WORKERS_PER_TICK: 'abc', X402_FRESH_WORKERS_FORGE_EVERY_N_TICKS: '0', X402_FRESH_WORKERS_TICK_BUDGET_MS: '1' });
		expect(j.perTick).toBe(3);
		expect(j.forgeEveryNTicks).toBe(1);
		expect(j.tickBudgetMs).toBe(10_000);
	});
});

describe('wallet SOL budget', () => {
	it('is rent exemption plus the worst-case pay fee plus the sweep fee', () => {
		expect(walletSolLamports({ rentExemptLamports: RENT_EXEMPT_FALLBACK_LAMPORTS, maxPayFeeLamports: 10_000 }))
			.toBe(890_880 + 10_000 + BASE_FEE_LAMPORTS);
	});
});

describe('tick plan', () => {
	const slugs = ['a', 'b', 'c', 'd'];
	it('puts the forge job first on every Nth tick and fills with datasets in rotation', () => {
		expect(planTickJobs({ tickSeq: 10, perTick: 3, forgeEveryNTicks: 10, dataSlugs: slugs, cursor: 0 }))
			.toEqual([{ kind: 'forge', slug: 'forge' }, { kind: 'data', slug: 'a' }, { kind: 'data', slug: 'b' }]);
		expect(planTickJobs({ tickSeq: 11, perTick: 3, forgeEveryNTicks: 10, dataSlugs: slugs, cursor: 2 }))
			.toEqual([{ kind: 'data', slug: 'c' }, { kind: 'data', slug: 'd' }, { kind: 'data', slug: 'a' }]);
	});
	it('buys nothing at per-tick zero and never exceeds per-tick', () => {
		expect(planTickJobs({ tickSeq: 10, perTick: 0, forgeEveryNTicks: 10, dataSlugs: slugs, cursor: 0 })).toEqual([]);
		expect(planTickJobs({ tickSeq: 10, perTick: 1, forgeEveryNTicks: 10, dataSlugs: slugs, cursor: 0 })).toEqual([{ kind: 'forge', slug: 'forge' }]);
	});
	it('trims to the daily cap in order and reports what it dropped', () => {
		const jobs = [{ p: 150_000 }, { p: 1_000 }, { p: 1_000 }];
		const fit = fitJobsToBudget({ jobs, priceOf: (j) => j.p, dailySpentAtomic: 39_900_000, dailyCapAtomic: 40_000_000 });
		expect(fit.kept).toEqual([{ p: 1_000 }, { p: 1_000 }]);
		expect(fit.dropped).toEqual([{ p: 150_000 }]);
		expect(fit.remainingAtomic).toBe(98_000);
	});
});

describe('funding math', () => {
	it('sums one job price per wallet in USDC and per-wallet SOL plus ATA rent plus one tx fee', () => {
		const need = fundingRequirement({ jobs: [{ p: 1_000 }, { p: 150_000 }], priceOf: (j) => j.p, solPerWalletLamports: 905_880 });
		expect(need.wallets).toBe(2);
		expect(need.usdcAtomic).toBe(151_000);
		expect(need.solLamports).toBe(2 * (905_880 + ATA_RENT_LAMPORTS) + BASE_FEE_LAMPORTS);
		expect(fundingRequirement({ jobs: [], priceOf: () => 0, solPerWalletLamports: 1 }).solLamports).toBe(0);
	});
	it('never lets the funder dip under the sponsor floor', () => {
		expect(funderHeadroom({ balanceLamports: 10_000_000, floorLamports: 2_000_000, needLamports: 8_000_000 })).toEqual({ ok: true, spendable: 8_000_000, shortfall: 0 });
		expect(funderHeadroom({ balanceLamports: 10_000_000, floorLamports: 2_000_000, needLamports: 8_000_001 })).toEqual({ ok: false, spendable: 8_000_000, shortfall: 1 });
		expect(funderHeadroom({ balanceLamports: 1_000_000, floorLamports: 2_000_000, needLamports: 1 }).ok).toBe(false);
	});
	it('the sweep sends everything but the base fee, ending at zero', () => {
		expect(sweepAmountLamports({ balanceLamports: 900_880 })).toBe(895_880);
		expect(sweepAmountLamports({ balanceLamports: 4_000 })).toBe(0);
	});
});

describe('reclaim verdicts', () => {
	const base = { attempts: 0, nowMs: 1_000_000, reclaimAfterS: 90, maxSweepAttempts: 20 };
	it('skips terminal and just-minted rows', () => {
		for (const state of ['closed', 'fund_failed', 'stranded', 'minted']) {
			expect(classifyReclaim({ ...base, state, updatedAtMs: 0 })).toBe('skip');
		}
	});
	it('waits on rows a live tick still owns, sweeps stale ones, strands exhausted ones', () => {
		expect(classifyReclaim({ ...base, state: 'paid', updatedAtMs: 1_000_000 - 30_000 })).toBe('wait');
		expect(classifyReclaim({ ...base, state: 'paid', updatedAtMs: 1_000_000 - 120_000 })).toBe('sweep');
		expect(classifyReclaim({ ...base, state: 'sweep_failed', updatedAtMs: 0, attempts: 20 })).toBe('stranded');
	});
});

describe('payload trimming', () => {
	it('bounds arrays and keeps scalars', () => {
		const big = { total: 1, items: Array.from({ length: 200 }, (_, i) => ({ i })), nested: { list: Array.from({ length: 100 }, (_, i) => i) } };
		const t = trimPayload(big, { maxItems: 40 });
		expect(t.total).toBe(1);
		expect(t.items).toHaveLength(40);
		expect(t.nested.list).toHaveLength(40);
	});
	it('falls back to a key list when even the trimmed form is too large', () => {
		const huge = { blob: 'x'.repeat(100_000) };
		expect(trimPayload(huge, { maxBytes: 1_000 })).toEqual({ truncated: true, keys: ['blob'] });
		expect(trimPayload(null)).toEqual({ value: null });
	});
});

describe('job catalog', () => {
	it('every data job is a real ring-catalog entry with a positive price and a resolvable request', () => {
		expect(new Set(DATA_JOB_SLUGS).size).toBe(DATA_JOB_SLUGS.length);
		for (const j of DATA_JOBS) {
			expect(bySlug(j.slug), `ring catalog lacks ${j.slug}`).toBeTruthy();
			const r = resolveDataJob(j.slug);
			expect(['GET', 'POST']).toContain(r.method);
			expect(r.path.startsWith('/api/x402/')).toBe(true);
			expect(r.priceAtomic).toBeGreaterThan(0);
			expect(r.title).toBe(j.title);
			if (r.method === 'GET') expect(r.body).toBeNull();
		}
		expect(() => resolveDataJob('no-such-job')).toThrow(/unknown data job/);
	});
	it('the forge job buys a standard-tier generation with a seed-dependent prompt', () => {
		const a = resolveForgeJob(1);
		const b = resolveForgeJob(2);
		expect(a.kind).toBe('forge');
		expect(a.path).toBe('/api/x402/forge');
		expect(a.body.tier).toBe('standard');
		expect(a.priceAtomic).toBe(150_000);
		expect(a.body.prompt).not.toBe(b.body.prompt);
		expect(resolveForgeJob(7).body.prompt).toBe(resolveForgeJob(7).body.prompt);
		expect(resolveJob({ kind: 'data', slug: 'market-global' }, 1).slug).toBe('market-global');
	});
	it('the seeded prop walk covers more than one category', () => {
		const cats = new Set(Array.from({ length: 40 }, (_, i) => forgePropForSeed(i).category));
		expect(cats.size).toBeGreaterThan(1);
	});
});

describe('wiring', () => {
	it('the economy heartbeat fires the lane and the handler file exists', () => {
		const tick = readFileSync(join(ROOT, 'api/cron/economy-tick.js'), 'utf8');
		expect(tick).toMatch(/path: '\/api\/cron\/x402-fresh-workers'/);
		expect(existsSync(join(ROOT, 'api/cron/x402-fresh-workers.js'))).toBe(true);
	});
	it('the migration and the code-side DDL guard declare the same tables', () => {
		const sql = readFileSync(join(ROOT, 'api/_lib/migrations/20260922100000_x402_fresh_workers.sql'), 'utf8');
		expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS x402_fresh_wallets/);
		expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS x402_data_desk/);
		const wallets = readFileSync(join(ROOT, 'api/_lib/x402/fresh-workers/wallets.js'), 'utf8');
		expect(wallets).toMatch(/CREATE TABLE IF NOT EXISTS x402_fresh_wallets/);
	});
});
