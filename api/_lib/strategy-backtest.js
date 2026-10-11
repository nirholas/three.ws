// Historical strategy backtester — the honest part of the product.
//
// We are the only platform that can backtest a pump.fun strategy, because we are
// the only one that captured the structural history: pump_coin_intel (per-launch
// bundle/organic/concentration/quality/category signals) joined to
// pump_coin_outcomes (graduated / pumped / flat / rugged + ath_multiple + last
// market cap). This module REPLAYS a compiled strategy over that real captured
// universe using the EXACT same entry gate the live worker uses
// (scoreMint / scoreIntel) and the EXACT same exit priority (decideExit), so the
// projection matches live behaviour rather than a flattering fiction.
//
// What we DON'T do: synthesize launches, invent outcomes, or model a price path
// we never observed. We only know, per launch, the peak multiple (ath_multiple)
// and the last observed multiple. Exits are evaluated at those two real price
// points; entry slippage + price impact are modeled honestly from the recorded
// early-window liquidity. Every limit of the method (survivorship, labeling lag,
// sample size) is reported alongside the numbers — see the `caveats` field.

import { createHash } from 'node:crypto';
import { sql } from './db.js';
import { scoreMint, scoreIntel } from '../../workers/agent-sniper/scorer.js';
import { decideExit } from '../../workers/agent-sniper/exit-logic.js';
import { getLearnedWeights } from '../../workers/agent-sniper/intel/store.js';
import { normalizeStrategyConfig, researchGatesActive } from './strategy-schema.js';
import { historicalGateReport, judgeHistoricalGates } from './strategy-preview.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const MAX_CANDIDATES = 6000;

// Gate-relevant + exit-relevant strategy fields. Two strategies with the same
// values here would take the same trades and exit the same way, so the cache key
// is built from exactly these (plus window + network) — cosmetic differences
// (telegram chat id, enabled flag) never invalidate a cached run.
const HASH_FIELDS = [
	'trigger', 'per_trade_lamports', 'slippage_bps', 'max_price_impact_pct',
	'min_market_cap_usd', 'max_market_cap_usd', 'min_creator_graduated', 'max_creator_launches',
	'require_socials', 'require_sol_quote',
	'take_profit_pct', 'stop_loss_pct', 'trailing_stop_pct', 'max_hold_seconds',
	'min_quality_score', 'max_bundle_score', 'max_concentration_top1', 'avoid_dev_dump', 'allowed_categories',
	'research',
];

/**
 * A Strategy Object `research` block, normalized, or null when no gate is on (so
 * a strategy without research gates keeps its existing cache hash).
 */
export function sanitizeResearch(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const config = normalizeStrategyConfig({ research: raw });
	return researchGatesActive(config) ? config.research : null;
}

/** Stable hash of the trade-determining strategy fields + window + network. */
export function strategyHash(strategy, windowDays, network) {
	const norm = {};
	for (const k of HASH_FIELDS) {
		let v = strategy[k];
		if (Array.isArray(v)) v = [...v].map((x) => String(x).toLowerCase()).sort();
		norm[k] = v ?? null;
	}
	norm.__window = windowDays;
	norm.__network = network;
	return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 32);
}

function n(v) {
	if (v == null) return null;
	const x = Number(v);
	return Number.isFinite(x) ? x : null;
}
function quantile(sorted, q) {
	if (!sorted.length) return null;
	const pos = (sorted.length - 1) * q;
	const base = Math.floor(pos);
	const rest = pos - base;
	const lo = sorted[base];
	const hi = sorted[base + 1] != null ? sorted[base + 1] : lo;
	return lo + (hi - lo) * rest;
}

// Build the object scoreMint() expects from an intel+outcome row + creator priors.
function toMintEvent(row, entryMcUsd) {
	return {
		is_usdc_pair: false, // intel observation is SOL-curve; SOL-quote launches only
		market_cap_usd: entryMcUsd,
		creator_launches: n(row.creator_launches_prior),
		creator_graduated: n(row.creator_graduated_prior),
		twitter: row.twitter, telegram: row.telegram, website: row.website,
		initial_buy_sol: row.dev_buy_lamports != null ? Number(row.dev_buy_lamports) / LAMPORTS_PER_SOL : null,
	};
}

// Build the object scoreIntel() expects. smart_money is intentionally absent —
// it's a live graph read we did not capture historically, so scoreIntel skips
// the smart-money gate (computed:false), exactly as it does for a brand-new coin.
export function toIntelRecord(row) {
	const s = { ...(row.signals || {}) };
	if (s.bundle_score == null && row.bundle_score != null) s.bundle_score = Number(row.bundle_score);
	if (s.organic_score == null && row.organic_score != null) s.organic_score = Number(row.organic_score);
	if (s.dev_sold == null) s.dev_sold = row.dev_sold === true;
	return {
		quality_score: n(row.quality_score),
		signals: s,
		category: row.category || null,
		twitter: row.twitter, telegram: row.telegram, website: row.website,
		risk_flags: Array.isArray(row.risk_flags) ? row.risk_flags : [],
		smart_money: null,
	};
}

/**
 * Model the realized return of one entered launch, honestly, from the two real
 * price points we recorded: the peak multiple (ath_multiple) and the terminal
 * multiple (last market cap / entry market cap).
 *
 * Entry cost is inflated by slippage + a price-impact estimate; exit proceeds are
 * deflated by slippage. Exits use the live decideExit priority at the peak (for
 * take-profit) and at the terminal price (for stop / trailing / hold).
 */
export function simulateTrade(strategy, peakMult, terminalMult, impactPct) {
	const slip = (n(strategy.slippage_bps) ?? 500) / 10_000;
	const entryPenalty = (1 + slip) * (1 + impactPct / 100);

	const EV = LAMPORTS_PER_SOL; // notional entry value; ROI is unit-free
	const posLike = {
		entry_quote_lamports: String(EV),
		stop_loss_pct: strategy.stop_loss_pct,
		trailing_stop_pct: strategy.trailing_stop_pct,
		take_profit_pct: strategy.take_profit_pct,
		max_hold_seconds: null, // no replay clock — terminal price IS the hold/timeout exit
	};

	let exitReason;
	let exitMult;
	const peakVal = peakMult * EV;
	// Rising phase: only take-profit can trigger as price climbs to the peak.
	if (decideExit(posLike, peakVal, peakVal) === 'take_profit') {
		exitReason = 'take_profit';
		exitMult = 1 + Number(strategy.take_profit_pct) / 100;
	} else {
		// Decline phase: stop-loss → trailing-stop priority, evaluated at terminal.
		const r = decideExit(posLike, terminalMult * EV, peakVal);
		if (r === 'stop_loss') { exitReason = 'stop_loss'; exitMult = 1 - Number(strategy.stop_loss_pct) / 100; }
		else if (r === 'trailing_stop') { exitReason = 'trailing_stop'; exitMult = peakMult * (1 - Number(strategy.trailing_stop_pct) / 100); }
		else { exitReason = 'timeout'; exitMult = terminalMult; } // held to max hold / end of observation
	}

	exitMult = Math.max(0, exitMult);
	const grossRatio = (exitMult * (1 - slip)) / entryPenalty;
	const roiPct = (grossRatio - 1) * 100;
	return { roiPct, exitReason, impactPct };
}

/**
 * Run the backtest. Read-only. Never throws on thin data — returns an honest
 * "insufficient data" verdict instead of a flattering number.
 *
 * @param {object} strategy   compiled strategy (api/sniper/strategy.js shape)
 * @param {object} [opts]
 * @param {number} [opts.windowDays=30]
 * @param {string} [opts.network='mainnet']
 * @returns {Promise<object>} metrics + sample trades + sample_size + caveats
 */
export async function runBacktest(strategy, { windowDays = 30, network = 'mainnet' } = {}) {
	const days = Math.max(1, Math.min(365, Math.floor(windowDays) || 30));
	const weights = strategy.trigger === 'intel_confirmed' ? await getLearnedWeights(network).catch(() => null) : null;

	// One scan: window functions compute each creator's PRIOR launch/graduation
	// counts across their full captured history (temporally correct — only coins
	// the creator launched before this one count), then we keep rows inside the
	// window that carry a real, non-'unknown' outcome label.
	const rows = await sql`
		WITH base AS (
			SELECT
				i.mint, i.symbol, i.name, i.creator, i.first_seen_at,
				i.twitter, i.telegram, i.website,
				i.dev_buy_lamports, i.dev_sold, i.buy_volume_lamports, i.sell_volume_lamports, i.unique_buyers,
				i.signals, i.bundle_score, i.organic_score, i.quality_score,
				i.category, i.risk_flags,
				o.graduated, o.outcome, o.ath_multiple, o.ath_market_cap_usd, o.last_market_cap_usd,
				COUNT(*) OVER w AS creator_launches_prior,
				COUNT(*) FILTER (WHERE o.graduated) OVER w AS creator_graduated_prior
			FROM pump_coin_intel i
			LEFT JOIN pump_coin_outcomes o ON o.mint = i.mint
			WHERE i.network = ${network}
			WINDOW w AS (PARTITION BY i.creator ORDER BY i.first_seen_at ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
		)
		SELECT * FROM base
		WHERE first_seen_at >= now() - (${days} || ' days')::interval
		  AND outcome IS NOT NULL AND outcome <> 'unknown'
		ORDER BY first_seen_at ASC
		LIMIT ${MAX_CANDIDATES}
	`;

	const universeSize = rows.length;
	const useIntel = strategy.trigger === 'intel_confirmed';
	const perTradeSol = Number(BigInt(strategy.per_trade_lamports || '0')) / LAMPORTS_PER_SOL;
	const stakeSol = perTradeSol > 0 ? perTradeSol : 0.1; // notional stake for drawdown/exposure when unset
	const perTradeLamports = stakeSol * LAMPORTS_PER_SOL;

	const entries = [];
	const skip = { gate: 0, research: 0, no_price: 0, impact: 0 };
	// Research gates: the same evaluator the live runtime runs before a buy,
	// judged on what was recorded. Gates history cannot replay are counted, not faked.
	const researchConfig = strategy.research ? { research: strategy.research } : null;
	const researchBlockedBy = {};
	let researchLive = 0;
	const outcomeCounts = { graduated: 0, pumped: 0, flat: 0, rugged: 0 };

	for (const row of rows) {
		const athMult = n(row.ath_multiple);
		const athMcUsd = n(row.ath_market_cap_usd);
		const entryMcUsd = athMult != null && athMult > 0 && athMcUsd != null ? athMcUsd / athMult : null;

		// Entry gate — the SAME function the live worker runs.
		const verdict = useIntel
			? scoreIntel(toIntelRecord(row), strategy, weights)
			: scoreMint(toMintEvent(row, entryMcUsd), strategy);
		if (!verdict.pass) { skip.gate++; continue; }
		if (researchConfig) {
			const gate = judgeHistoricalGates(researchConfig, historicalGateReport(row));
			if (gate.blocked) {
				skip.research++;
				researchBlockedBy[gate.blocked] = (researchBlockedBy[gate.blocked] || 0) + 1;
				continue;
			}
			if (gate.live) researchLive++;
		}

		// Need a real peak multiple to simulate; without it we cannot honestly model a fill.
		if (athMult == null || athMult <= 0) { skip.no_price++; continue; }

		// Price-impact estimate from recorded early-window buy liquidity. Skip the
		// breaker only when we have no liquidity to estimate against (missing data,
		// not a green light). Mirrors the live max_price_impact_pct circuit breaker.
		const earlyLiq = n(row.buy_volume_lamports);
		const impactPct = earlyLiq != null && earlyLiq > 0
			? Math.min(100, (100 * perTradeLamports) / (perTradeLamports + earlyLiq))
			: 0;
		const maxImpact = n(strategy.max_price_impact_pct);
		if (maxImpact != null && impactPct > maxImpact) { skip.impact++; continue; }

		// Terminal multiple relative to entry. Rugged → near-zero residual.
		const lastMcUsd = n(row.last_market_cap_usd);
		let terminalMult;
		if (entryMcUsd != null && entryMcUsd > 0 && lastMcUsd != null) terminalMult = Math.max(0, lastMcUsd / entryMcUsd);
		else if (row.outcome === 'rugged') terminalMult = 0;
		else terminalMult = 1;

		const sim = simulateTrade(strategy, athMult, terminalMult, impactPct);
		if (row.outcome in outcomeCounts) outcomeCounts[row.outcome]++;
		entries.push({
			mint: row.mint,
			symbol: row.symbol || null,
			name: row.name || null,
			outcome: row.outcome,
			category: row.category || null,
			entry_mc_usd: entryMcUsd != null ? Math.round(entryMcUsd) : null,
			ath_multiple: Number(athMult.toFixed(3)),
			roi_pct: Number(sim.roiPct.toFixed(2)),
			exit_reason: sim.exitReason,
			price_impact_pct: Number(sim.impactPct.toFixed(2)),
			win: sim.roiPct > 0,
			first_seen_at: row.first_seen_at,
		});
	}

	const taken = entries.length;
	const caveats = buildCaveats({ universeSize, taken, days, network, useIntel, researchLive, research: !!researchConfig });

	if (taken === 0) {
		return {
			ok: true,
			window_days: days,
			network,
			trigger: strategy.trigger,
			sample_size: 0,
			universe_size: universeSize,
			insufficient_data: true,
			message: universeSize === 0
				? `No labeled launch history captured for ${network} in the last ${days} days yet. Backtest will sharpen as the intel engine logs more outcomes.`
				: `None of the ${universeSize.toLocaleString()} labeled launches in the last ${days} days passed these filters. They may be too strict — loosen one and re-run.`,
			skipped: skip,
			research_blocked_by: researchBlockedBy,
			caveats,
		};
	}

	// ── metrics ────────────────────────────────────────────────────────────────
	const rois = entries.map((e) => e.roi_pct);
	const sortedRois = [...rois].sort((a, b) => a - b);
	const wins = entries.filter((e) => e.win).length;
	const winRate = wins / taken;
	const ev = rois.reduce((a, b) => a + b, 0) / taken;

	// Drawdown on the chronological equity curve (entries are first_seen ASC),
	// fixed stake per trade. Reports the worst peak-to-trough dip in SOL and %.
	let equity = 0, peak = 0, maxDrop = 0, maxDropPct = 0;
	for (const e of entries) {
		equity += stakeSol * (e.roi_pct / 100);
		if (equity > peak) peak = equity;
		const drop = peak - equity;
		if (drop > maxDrop) { maxDrop = drop; maxDropPct = peak > 0 ? (drop / peak) * 100 : 0; }
	}

	const exitBreakdown = {};
	for (const e of entries) exitBreakdown[e.exit_reason] = (exitBreakdown[e.exit_reason] || 0) + 1;

	const byRoi = [...entries].sort((a, b) => b.roi_pct - a.roi_pct);
	const sampleHits = byRoi.slice(0, 4);
	const sampleMisses = byRoi.slice(-4).reverse().filter((e) => !sampleHits.includes(e));

	const totalInvestedSol = stakeSol * taken;

	return {
		ok: true,
		window_days: days,
		network,
		trigger: strategy.trigger,
		insufficient_data: false,
		sample_size: taken,
		universe_size: universeSize,
		skipped: skip,
		research_blocked_by: researchBlockedBy,
		research_live_checked: researchLive,
		stake_sol: Number(stakeSol.toFixed(4)),
		stake_assumed: perTradeSol <= 0,
		metrics: {
			entries: taken,
			win_rate: Number(winRate.toFixed(4)),
			wins,
			losses: taken - wins,
			expected_value_pct: Number(ev.toFixed(2)),
			roi_median_pct: Number((quantile(sortedRois, 0.5) ?? 0).toFixed(2)),
			roi_p10_pct: Number((quantile(sortedRois, 0.1) ?? 0).toFixed(2)),
			roi_p90_pct: Number((quantile(sortedRois, 0.9) ?? 0).toFixed(2)),
			roi_best_pct: Number(sortedRois[sortedRois.length - 1].toFixed(2)),
			roi_worst_pct: Number(sortedRois[0].toFixed(2)),
			total_invested_sol: Number(totalInvestedSol.toFixed(4)),
			net_pnl_sol: Number((stakeSol * rois.reduce((a, b) => a + b, 0) / 100).toFixed(4)),
			max_drawdown_sol: Number(maxDrop.toFixed(4)),
			max_drawdown_pct: Number(maxDropPct.toFixed(2)),
			exit_breakdown: exitBreakdown,
			outcome_distribution: outcomeCounts,
		},
		sample_hits: sampleHits,
		sample_misses: sampleMisses,
		caveats,
		ran_at: null, // stamped by the caller (Date.now is unavailable inside workflows)
	};
}

function buildCaveats({ universeSize, taken, days, network, useIntel, researchLive = 0, research = false }) {
	const c = [];
	c.push('Replayed over real captured launches only — no synthetic data. Exits are modeled at the recorded peak and final price, not a full tick-by-tick path.');
	c.push('Survivorship/labeling: only coins observed long enough to be labeled are included, and outcomes lag launch by design, so very recent launches are excluded.');
	if (researchLive > 0) c.push(`${researchLive} entered launches had no recorded firewall decision, so the security and authority gates could not be replayed for them; live, the firewall checks every buy.`);
	if (research) c.push('Research gates are judged on evidence recorded over the whole observation window (holders are unique buyers seen, liquidity is net SOL bought into the curve), which includes buying after an early entry. Live, a gate only sees what exists at buy time, so treat gated results as optimistic.');
	if (useIntel) c.push('Smart-money gates are skipped in backtest (the live wallet-graph read was not captured historically); all other gates match live exactly.');
	let confidence = 'high';
	if (taken < 10) { confidence = 'low'; c.push(`Only ${taken} matching launches — treat these numbers as directional, not predictive. Widen the window or loosen filters for a stronger read.`); }
	else if (taken < 30) { confidence = 'medium'; c.push(`${taken} matching launches is a modest sample — the distribution is indicative but still noisy.`); }
	return { confidence, items: c, universe_size: universeSize, window_days: days, network };
}

/** Look up the freshest cached backtest for a hash within TTL. */
export async function getCachedBacktest(hash, ttlMinutes = 30) {
	try {
		const [row] = await sql`
			SELECT metrics, sample_size, ran_at FROM strategy_backtests
			WHERE strategy_hash = ${hash}
			  AND ran_at > now() - (${Math.max(1, ttlMinutes)} || ' minutes')::interval
			ORDER BY ran_at DESC LIMIT 1
		`;
		return row ? { ...row.metrics, sample_size: row.sample_size, ran_at: row.ran_at, cached: true } : null;
	} catch {
		return null;
	}
}

/** Persist a backtest snapshot (and link it to an agent when armed-context known). */
export async function saveBacktest({ hash, agentId = null, userId = null, network, windowDays, result }) {
	try {
		const [row] = await sql`
			INSERT INTO strategy_backtests (strategy_hash, agent_id, user_id, network, window_days, metrics, sample_size)
			VALUES (${hash}, ${agentId}, ${userId}, ${network}, ${windowDays}, ${JSON.stringify(result)}::jsonb, ${result.sample_size || 0})
			RETURNING ran_at
		`;
		return row?.ran_at || null;
	} catch (err) {
		console.warn('[strategy-backtest] save failed:', err?.message);
		return null;
	}
}

/** Latest backtest snapshot linked to an agent — powers projected-vs-realized. */
export async function getLatestBacktestForAgent(agentId, network = 'mainnet') {
	try {
		const [row] = await sql`
			SELECT metrics, sample_size, window_days, ran_at FROM strategy_backtests
			WHERE agent_id = ${agentId} AND network = ${network}
			ORDER BY ran_at DESC LIMIT 1
		`;
		return row || null;
	} catch {
		return null;
	}
}
