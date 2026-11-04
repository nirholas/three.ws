// agent-sniper, paid-intel entries (decision_mode = 'paid_intel').
//
// This arm buys its entry signals from the platform's own x402 storefront, with
// USDC from the arm's own wallet, before every decision cycle:
//
//   1. Recent launches   GET  /api/x402/pump-agent-audit?limit=10&sort=newest
//   2. Volume anomaly    POST /api/x402/crypto-intel {topic:'pump_volume_anomaly'}
//   3. Trending score    POST /api/x402/crypto-intel {topic:'pump_trending'}
//
// Entry rule: a candidate must be a fresh launch whose quality passes (signal 1)
// AND be confirmed by at least `minAgree` signals in total (default two: launch
// quality plus a positive-side volume anomaly or a trending hit). The bias is
// fewer, better entries: at most ONE buy per cycle (concurrency one).
//
// Skip semantics: if any purchase fails (endpoint down, wallet dry, 402
// mismatch, spend cap reached) the cycle is skipped and the reason is logged.
// The arm NEVER falls back to the unpaid version of the same data: this module
// has no code path that fetches a signal endpoint without going through
// payX402, and a response that did not settle a payment (free: true, or no
// transaction signature) is treated as a failed purchase.
//
// Every decision, buy or skip, lands in sniper_paid_intel_decisions with the
// x402 receipts (endpoint, atomic price, transaction signature) that paid for
// it, and the executor copies the receipts into the reasoning ledger entry of
// any resulting trade. The non-negotiable safety rails (Mayhem exclusion, the
// firewall round trip, budgets, headroom, spend policy) still apply at the
// executeBuy chokepoint exactly as for every other arm.

import { sql } from '../../api/_lib/db.js';
import { log } from './log.js';
import { loadAgentKeypair } from './keys.js';
import { executeBuy } from './executor.js';
import { cachedStrategies } from './strategy-store.js';
import { payX402, bootstrapSolanaContext } from '../../api/_lib/x402/pay.js';

export const PAID_INTEL_MODE = 'paid_intel';

export function isPaidIntel(strat) {
	return (strat?.decision_mode || 'rules') === PAID_INTEL_MODE;
}

const DEFAULT_ORIGIN = 'https://three.ws';
const DEFAULT_CYCLE_MS = 300_000;
// A launch older than this is past the snipe window; the audit feed is newest
// first, so this only trims the tail of a slow cycle.
const MAX_LAUNCH_AGE_MS = 15 * 60_000;

/** The three signal purchases, in the order they are made. */
export function signalPlan(origin) {
	return [
		{
			name: 'launches',
			url: `${origin}/api/x402/pump-agent-audit?limit=10&sort=newest`,
			method: 'GET',
			body: null,
		},
		{
			name: 'anomaly',
			url: `${origin}/api/x402/crypto-intel`,
			method: 'POST',
			body: { topic: 'pump_volume_anomaly' },
		},
		{
			name: 'trending',
			url: `${origin}/api/x402/crypto-intel`,
			method: 'POST',
			body: { topic: 'pump_trending' },
		},
	];
}

function num(v) {
	const n = typeof v === 'string' ? parseFloat(v) : v;
	return Number.isFinite(n) ? n : null;
}

function trendingMintSet(trending) {
	const out = new Set();
	for (const m of Array.isArray(trending?.trending_mints) ? trending.trending_mints : []) {
		const mint = typeof m === 'string' ? m : m?.mint;
		if (mint) out.add(mint);
	}
	if (trending?.top_mint) out.add(trending.top_mint);
	return out;
}

/**
 * Launch-quality signal for one candidate: it is in the freshly paid-for
 * recent-launches cohort, is young enough to still be snipeable, carries
 * at least the cohort's average initial liquidity, and sits inside the
 * strategy's own market-cap band when one is set.
 */
export function launchQualityPasses(launch, cohortAvgLiquidity, strat, nowMs) {
	if (!launch?.mint) return false;
	const created = num(launch.created_at);
	if (created != null && nowMs - created > MAX_LAUNCH_AGE_MS) return false;
	const liq = num(launch.liquidity_sol);
	if (liq == null || liq <= 0) return false;
	if (cohortAvgLiquidity != null && liq < cohortAvgLiquidity) return false;
	const mcap = num(launch.market_cap_usd);
	const minCap = num(strat?.min_market_cap_usd);
	const maxCap = num(strat?.max_market_cap_usd);
	if (mcap != null && minCap != null && mcap < minCap) return false;
	if (mcap != null && maxCap != null && mcap > maxCap) return false;
	return true;
}

/**
 * Decide from the three purchased signals. Pure: no network, no clock besides
 * the injected `nowMs`.
 *
 * @returns {{ candidates: Array<{ mint, symbol, name, market_cap_usd, liquidity_sol,
 *   agreeing: string[], agree: number, pass: boolean }>, best: object|null }}
 */
export function evaluateSignals({ launches, anomaly, trending, strat, nowMs = Date.now(), minAgree = 2 }) {
	const list = Array.isArray(launches?.launches) ? launches.launches : [];
	const liqs = list.map((l) => num(l?.liquidity_sol)).filter((v) => v != null && v > 0);
	const avg = num(launches?.avg_initial_liquidity_sol) ?? (liqs.length ? liqs.reduce((a, b) => a + b, 0) / liqs.length : null);
	const trendSet = trendingMintSet(trending);
	const need = Math.min(3, Math.max(2, Math.round(minAgree)));

	const candidates = list.filter((l) => l?.mint).map((l) => {
		const agreeing = [];
		if (launchQualityPasses(l, avg, strat, nowMs)) agreeing.push('launch_quality');
		if (anomaly?.anomaly === true && anomaly.mint === l.mint && (anomaly.signal || 'bullish') === 'bullish') agreeing.push('volume_anomaly');
		if (trendSet.has(l.mint) && (trending?.signal || 'bullish') !== 'bearish') agreeing.push('trending');
		const hasLaunch = agreeing.includes('launch_quality');
		return {
			mint: l.mint,
			symbol: l.symbol || null,
			name: l.name || null,
			market_cap_usd: num(l.market_cap_usd),
			liquidity_sol: num(l.liquidity_sol),
			agreeing,
			agree: agreeing.length,
			pass: hasLaunch && agreeing.length >= need,
		};
	});

	const passing = candidates
		.filter((c) => c.pass)
		.sort((a, b) => b.agree - a.agree || (b.liquidity_sol || 0) - (a.liquidity_sol || 0));
	return { candidates, best: passing[0] || null };
}

/**
 * Buy the three signals through payX402. Stops at the first failure and
 * reports which one failed and why; receipts holds every payment that DID
 * settle so the spend is still accounted for.
 */
export async function purchaseSignals({ origin, pay, ctx, remainingCapAtomic }) {
	const receipts = [];
	const data = {};
	let spent = 0;
	for (const step of signalPlan(origin)) {
		const cap = remainingCapAtomic - spent;
		if (cap <= 0) return { ok: false, reason: 'intel_budget_exhausted', failedAt: step.name, receipts, data, spent };
		let out;
		try {
			out = await pay({
				url: step.url, method: step.method, body: step.body,
				buyer: ctx.buyer, conn: ctx.conn, blockhash: ctx.blockhash, mintInfo: ctx.mintInfo,
				remainingCap: cap,
				userAgent: 'threews-sniper-paid-intel/1.0',
			});
		} catch (err) {
			return { ok: false, reason: `pay_threw:${String(err?.message || err).slice(0, 80)}`, failedAt: step.name, receipts, data, spent };
		}
		if (!out?.paid || !out.success || !out.txSig) {
			const why = out?.errorMsg || (out?.free ? 'endpoint_did_not_charge' : 'payment_not_settled');
			return { ok: false, reason: `purchase_failed:${step.name}:${why}`, failedAt: step.name, receipts, data, spent };
		}
		spent += Number(out.amountAtomic) || 0;
		receipts.push({ signal: step.name, endpoint: step.url, amount_atomic: Number(out.amountAtomic) || 0, tx_sig: out.txSig });
		data[step.name] = out.responseBody;
	}
	return { ok: true, reason: null, failedAt: null, receipts, data, spent };
}

async function spentTodayAtomic(strategyId) {
	const [r] = await sql`
		SELECT coalesce(sum(intel_spend_atomic), 0)::text AS spent
		FROM sniper_paid_intel_decisions
		WHERE strategy_id = ${strategyId} AND ts >= date_trunc('day', now())
	`;
	return Number(r?.spent ?? 0);
}

async function decidedMints(strategyId) {
	const rows = await sql`
		SELECT DISTINCT mint FROM sniper_paid_intel_decisions
		WHERE strategy_id = ${strategyId} AND mint IS NOT NULL AND decision = 'buy'
	`;
	return new Set(rows.map((r) => r.mint));
}

async function recordDecisionRow(strat, row) {
	try {
		await sql`
			INSERT INTO sniper_paid_intel_decisions
				(strategy_id, agent_id, network, mint, decision, reason, agreeing_signals, intel_spend_atomic, intel_signal_receipts)
			VALUES (${strat.id}, ${strat.agent_id}, ${strat.network || 'mainnet'}, ${row.mint ?? null}, ${row.decision},
			        ${row.reason ?? null}, ${row.agreeing ?? []}, ${row.spend ?? null}, ${JSON.stringify(row.receipts ?? [])}::jsonb)
		`;
	} catch (err) {
		log.warn('paid-intel decision write failed', { agent: strat.agent_id, err: err?.message });
	}
}

const defaultDeps = {
	pay: payX402,
	bootstrap: bootstrapSolanaContext,
	loadKeypair: loadAgentKeypair,
	spentToday: spentTodayAtomic,
	alreadyBought: decidedMints,
	record: recordDecisionRow,
	now: () => Date.now(),
};

/**
 * One decision cycle for one paid_intel strategy. Returns
 * `{ status: 'skipped'|'no_entry'|'buy', reason, mint?, receipts }`.
 * `deps` exists so the payment boundary can be injected in tests; app code
 * runs with the real payX402.
 */
export async function runPaidIntelCycle({ strat, origin = process.env.SNIPER_PAID_INTEL_ORIGIN || DEFAULT_ORIGIN, deps = {} }) {
	const d = { ...defaultDeps, ...deps };
	const skip = async (reason, receipts = [], spend = 0) => {
		log.info('paid-intel cycle skipped', { agent: strat.agent_id, reason });
		await d.record(strat, { decision: 'skip', reason, receipts, spend: spend || null });
		return { status: 'skipped', reason, receipts };
	};

	const cap = num(strat.intel_daily_cap_atomic);
	if (cap == null || cap <= 0) return skip('no_intel_budget');

	const spentBefore = await d.spentToday(strat.id);
	const remaining = cap - spentBefore;
	if (remaining <= 0) return skip('intel_budget_exhausted');

	const wallet = await d.loadKeypair(strat.agent_id, strat.user_id, 'sniper_paid_intel');
	if (!wallet) return skip('no_wallet');

	let ctx;
	try {
		ctx = await d.bootstrap({ buyer: wallet.keypair });
	} catch (err) {
		return skip(`bootstrap_failed:${String(err?.message || err).slice(0, 80)}`);
	}

	const purchase = await purchaseSignals({ origin, pay: d.pay, ctx, remainingCapAtomic: remaining });
	if (!purchase.ok) return skip(purchase.reason, purchase.receipts, purchase.spent);

	const verdict = evaluateSignals({
		launches: purchase.data.launches,
		anomaly: purchase.data.anomaly,
		trending: purchase.data.trending,
		strat,
		nowMs: d.now(),
	});

	const bought = await d.alreadyBought(strat.id);
	const entry = verdict.best && !bought.has(verdict.best.mint) ? verdict.best : null;

	// Every candidate the cycle evaluated is recorded with the receipts that paid
	// for the evaluation, so each ledger row traces back to its x402 signatures.
	// The cycle's spend rides on the first row only, so a daily sum never double counts.
	let first = true;
	for (const c of verdict.candidates) {
		await d.record(strat, {
			mint: c.mint,
			decision: entry && entry.mint === c.mint ? 'buy' : 'pass',
			reason: c.pass ? (entry && entry.mint === c.mint ? 'agreement' : 'not_best_or_already_bought') : 'below_agreement',
			agreeing: c.agreeing,
			receipts: purchase.receipts,
			spend: first ? purchase.spent : null,
		});
		first = false;
	}
	if (first) {
		await d.record(strat, { decision: 'pass', reason: 'no_candidates', receipts: purchase.receipts, spend: purchase.spent });
	}

	if (!entry) return { status: 'no_entry', reason: 'no_agreement', receipts: purchase.receipts };
	return {
		status: 'buy', reason: 'agreement', receipts: purchase.receipts,
		mint: {
			mint: entry.mint, symbol: entry.symbol, name: entry.name, market_cap_usd: entry.market_cap_usd,
			entry_trigger: 'paid_intel',
			trigger_ref: purchase.receipts[0]?.tx_sig || null,
			score: entry.agree / 3,
			paidIntel: { agreeing: entry.agreeing, spend_atomic: purchase.spent, receipts: purchase.receipts },
		},
	};
}

/**
 * Start the per-arm cycle loop. Shares the worker's buy queue + throttle, so a
 * paid-intel buy flows through the same executeBuy chokepoint as every arm.
 * Overlap-guarded: a slow cycle never stacks. Returns a stop function.
 */
export function startPaidIntelWatch({ cfg, queue, throttle, isHalted }) {
	const cycleMs = Math.max(60_000, Number(process.env.SNIPER_PAID_INTEL_CYCLE_MS) || DEFAULT_CYCLE_MS);
	let busy = false;
	const tick = async () => {
		if (busy || isHalted()) return;
		busy = true;
		try {
			const arms = cachedStrategies().filter((s) => isPaidIntel(s) && s.network === cfg.network);
			for (const strat of arms) {
				if (isHalted()) break;
				const result = await runPaidIntelCycle({ strat }).catch((err) => {
					log.error('paid-intel cycle failed', { agent: strat.agent_id, err: err?.message });
					return null;
				});
				if (result?.status !== 'buy') continue;
				log.info('paid-intel buy', { agent: strat.agent_id, mint: result.mint.mint, agreeing: result.mint.paidIntel.agreeing, receipts: result.receipts.length });
				queue.push(async () => {
					await executeBuy({ cfg, strat, throttle, mint: result.mint });
				});
			}
		} finally {
			busy = false;
		}
	};
	const timer = setInterval(() => { tick(); }, cycleMs);
	return () => clearInterval(timer);
}
