// Strategy match preview: "how many recent launches would this strategy have
// bought?" answered from real recorded history, never a guess.
//
// The Strategy Lab calls this on every slider change. It replays the launches
// the intel engine recorded over the last 1, 6, or 24 hours through the SAME two
// pure functions the live equipped-strategy runtime runs before a buy:
// `matchesEntry` (entry filter) and `evaluateResearchGates` (research gates), and
// counts how many coins each check removed.
//
// The history is read once per (network, window) and cached for a short TTL, so
// dragging a slider re-evaluates in memory instead of re-querying.
//
// Where history stands in for a live reading, the substitution is explicit:
//   holders          unique buyers recorded during the intel observation window
//   largest holder   intel concentration_top1 (share of net buys, curve excluded)
//   liquidity        net SOL bought into the curve during observation
//   market cap       derived from that liquidity with the pump.fun curve constants
//   dev history      the creator's launches recorded before this coin (+1 for the
//                    coin itself, matching the live count), and how many graduated
//   dev sold         intel dev_sold
//   security score,  the latest recorded firewall decision for the coin, when one
//   authorities      exists. Most coins were never assessed, so those coins are
//                    counted as "checked live at buy time" rather than matched or
//                    blocked: the runtime runs the firewall fresh on every buy.
// Coins are observed at the end of their intel window, not at the strategy's
// entry age, so the preview is a calibration aid, not a fill simulation.

import { sql } from './db.js';
import { solPriceUsd } from './sol-price.js';
import { matchesEntry, evaluateResearchGates, normalizeStrategyConfig } from './strategy-schema.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
// pump.fun bonding curve: 30 SOL virtual reserve, 1.073B virtual tokens, 1B supply.
const CURVE_VIRTUAL_SOL = 30;
const CURVE_K = CURVE_VIRTUAL_SOL * 1_073_000_000;
const SUPPLY = 1_000_000_000;

export const PREVIEW_WINDOWS = [1, 6, 24];
const CACHE_TTL_MS = 120_000;
const MAX_ROWS = 60_000;
const SAMPLE_SIZE = 8;
// Checks whose evidence history mostly lacks: an unknown here means "the
// firewall decides at buy time", not "blocked".
const LIVE_CHECKS = new Set(['security_min_score', 'require_no_mint_authority', 'require_no_freeze_authority']);

const _cache = new Map();

function num(v) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/** Market cap in SOL of a pump.fun curve holding `realSol` SOL of net buys. */
export function curveMarketCapSol(realSol) {
	const vSol = CURVE_VIRTUAL_SOL + Math.max(0, realSol);
	return (vSol * vSol * SUPPLY) / CURVE_K;
}

/** Estimated price impact (percent) of a `amountSol` buy into a curve holding `realSol`. */
export function curveImpactPct(amountSol, realSol) {
	const vSol = CURVE_VIRTUAL_SOL + Math.max(0, realSol);
	return (amountSol / vSol) * 100;
}

async function loadHistory(network, hours) {
	const key = `${network}:${hours}`;
	const hit = _cache.get(key);
	if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.v;
	const rows = await sql`
		WITH recent AS (
			SELECT mint, creator, first_seen_at, twitter, telegram, website, dev_sold, unique_buyers,
			       buy_volume_lamports, sell_volume_lamports, signals->>'concentration_top1' AS top1
			FROM pump_coin_intel
			WHERE network = ${network} AND first_seen_at >= now() - (${hours} || ' hours')::interval
			ORDER BY first_seen_at DESC
			LIMIT ${MAX_ROWS}
		),
		hist AS (
			SELECT i.mint,
			       COUNT(*) OVER w AS launches_prior,
			       COUNT(*) FILTER (WHERE o.graduated) OVER w AS graduated_prior
			FROM pump_coin_intel i
			LEFT JOIN pump_coin_outcomes o ON o.mint = i.mint
			WHERE i.network = ${network}
			  AND i.creator IN (SELECT DISTINCT creator FROM recent WHERE creator IS NOT NULL)
			WINDOW w AS (PARTITION BY i.creator ORDER BY i.first_seen_at ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
		),
		fw AS (
			SELECT DISTINCT ON (f.mint) f.mint, f.score,
			       (SELECT c->'detail' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.checks) = 'array' THEN f.checks ELSE '[]'::jsonb END) c
			        WHERE c->>'name' = 'mint_authority' LIMIT 1) AS fw_authority
			FROM firewall_decisions f
			WHERE f.network = ${network} AND f.side = 'buy' AND f.mint IN (SELECT mint FROM recent)
			ORDER BY f.mint, f.created_at DESC
		)
		SELECT r.*, h.launches_prior, h.graduated_prior, fw.score AS fw_score, fw.fw_authority,
		       (m.mint IS NOT NULL) AS three_ws_launch
		FROM recent r
		LEFT JOIN hist h ON h.mint = r.mint
		LEFT JOIN fw ON fw.mint = r.mint
		LEFT JOIN pump_agent_mints m ON m.mint = r.mint AND m.network = ${network}
	`;
	const solUsd = await solPriceUsd().catch(() => null);
	const v = { rows, solUsd: num(solUsd), at: new Date().toISOString() };
	_cache.set(key, { t: Date.now(), v });
	return v;
}

// The firewall's mint_authority check detail: { mint_authority, freeze_authority }.
function authorityFromDetail(detail) {
	if (!detail || typeof detail !== 'object' || !('mint_authority' in detail) || !('freeze_authority' in detail)) return { known: false };
	return { known: true, mint_authority: detail.mint_authority, freeze_authority: detail.freeze_authority };
}

/** Turn one recorded intel row into the (launch, report) pair the live evaluators read. */
export function historyToCandidate(row, solUsd) {
	const netSol = Math.max(0, (num(row.buy_volume_lamports) || 0) - (num(row.sell_volume_lamports) || 0)) / LAMPORTS_PER_SOL;
	const mcSol = curveMarketCapSol(netSol);
	const launchesPrior = num(row.launches_prior);
	const graduatedPrior = num(row.graduated_prior);
	const launch = {
		mint: row.mint,
		creator: row.creator,
		created_at: row.first_seen_at ? new Date(row.first_seen_at).getTime() : null,
		liquidity_sol: netSol,
		market_cap_usd: solUsd ? mcSol * solUsd : null,
		twitter: row.twitter, telegram: row.telegram, website: row.website,
		creator_launches: launchesPrior == null ? null : launchesPrior + 1,
		creator_graduated: graduatedPrior,
		is_usdc_pair: false,
		three_ws_launch: row.three_ws_launch === true,
	};
	const report = historicalGateReport(row, { netSol, marketCapUsd: launch.market_cap_usd });
	return { launch, report, netSol };
}

/**
 * Judge recorded evidence with the live research-gate evaluator. A gate whose
 * evidence history lacks (security score, authorities) is not a block: the live
 * runtime runs the firewall fresh at buy time, so it is reported as `live`.
 * Any other unknown fails closed exactly as it does live.
 * @returns {{ blocked: string|null, live: boolean, evaluation: object }}
 */
export function judgeHistoricalGates(config, report) {
	const evaluation = evaluateResearchGates(config, report);
	const hard = evaluation.checks.find((c) => c.status === 'fail' || (c.status === 'unknown' && !LIVE_CHECKS.has(c.check)));
	return {
		blocked: hard ? hard.check : null,
		live: !hard && evaluation.checks.some((c) => c.status === 'unknown'),
		evaluation,
	};
}

/** The research-gate report for a recorded intel row (backtest and preview share it). */
export function historicalGateReport(row, { netSol, marketCapUsd = null } = {}) {
	const top1 = num(row.top1 ?? row.signals?.concentration_top1);
	const launchesPrior = num(row.launches_prior ?? row.creator_launches_prior);
	const graduatedPrior = num(row.graduated_prior ?? row.creator_graduated_prior);
	const sol = netSol ?? Math.max(0, (num(row.buy_volume_lamports) || 0) - (num(row.sell_volume_lamports) || 0)) / LAMPORTS_PER_SOL;
	return {
		mint: row.mint,
		liquidity: { sol, market_cap_usd: marketCapUsd },
		holders: { count: num(row.unique_buyers), top_holder_pct: top1 == null ? null : top1 * 100 },
		authority: authorityFromDetail(row.fw_authority),
		security: { score: num(row.fw_score) },
		dev: {
			creator: row.creator,
			launches: launchesPrior == null ? null : launchesPrior + 1,
			graduated: graduatedPrior,
			sold: typeof row.dev_sold === 'boolean' ? row.dev_sold : null,
		},
	};
}

const entryReasonKey = (reasons) => String(reasons?.[0] || 'filtered').split(':')[0];

/**
 * Count how many recorded launches a strategy config would have bought.
 *
 * @param {object} rawConfig  any Strategy Object config (normalized here)
 * @param {{ hours?: number, network?: string }} [opts]
 */
export async function previewStrategyMatches(rawConfig, { hours = 6, network = 'mainnet' } = {}) {
	const config = normalizeStrategyConfig(rawConfig);
	const h = PREVIEW_WINDOWS.includes(Number(hours)) ? Number(hours) : 6;
	const net = network === 'devnet' ? 'devnet' : 'mainnet';
	const { rows, solUsd, at } = await loadHistory(net, h);

	const amountSol = config.sizing.amount_sol;
	const impactCap = config.sizing.max_price_impact_bps == null ? null : config.sizing.max_price_impact_bps / 100;
	const entryRejects = {};
	const blockedBy = {};
	let passedEntry = 0;
	let passedResearch = 0;
	let liveCheck = 0;
	let impactBlocked = 0;
	let matched = 0;
	const sample = [];

	for (const row of rows) {
		const { launch, report, netSol } = historyToCandidate(row, solUsd);
		// Evaluate as if seen the moment it launched: the age gate is a live-timing
		// rule, and every recorded coin was young when the runtime would have seen it.
		const entry = matchesEntry(config, launch, launch.created_at ?? Date.now());
		if (!entry.pass) {
			const k = entryReasonKey(entry.reasons);
			entryRejects[k] = (entryRejects[k] || 0) + 1;
			continue;
		}
		passedEntry++;
		const gate = judgeHistoricalGates(config, report);
		if (gate.blocked) {
			blockedBy[gate.blocked] = (blockedBy[gate.blocked] || 0) + 1;
			continue;
		}
		passedResearch++;
		if (impactCap != null && curveImpactPct(amountSol, netSol) > impactCap) {
			impactBlocked++;
			continue;
		}
		const pendingLive = gate.live;
		if (pendingLive) liveCheck++;
		else matched++;
		if (sample.length < SAMPLE_SIZE) {
			sample.push({
				mint: row.mint,
				seen_at: row.first_seen_at,
				holders: report.holders.count,
				top_holder_pct: report.holders.top_holder_pct == null ? null : Number(report.holders.top_holder_pct.toFixed(1)),
				liquidity_sol: Number(netSol.toFixed(2)),
				live_check: pendingLive,
			});
		}
	}

	const caveats = [
		'Coins are scored as they stood at the end of their intel observation window, not at your entry age.',
		'Holders are unique buyers recorded during observation; the live gate reads the indexer holder count.',
		'Liquidity and market cap are derived from net SOL bought into the curve.',
	];
	if (config.research.security_min_score != null || config.research.require_no_mint_authority || config.research.require_no_freeze_authority) {
		caveats.push('Most coins have no recorded firewall decision, so security and authority gates are counted as checked live at buy time.');
	}
	if (rows.length >= MAX_ROWS) caveats.push(`Only the newest ${MAX_ROWS} launches in the window were scanned.`);

	return {
		network: net,
		window_hours: h,
		universe: rows.length,
		passed_entry: passedEntry,
		passed_research: passedResearch,
		impact_blocked: impactBlocked,
		matched,
		live_check: liveCheck,
		would_buy: matched + liveCheck,
		entry_rejects: entryRejects,
		blocked_by: blockedBy,
		sample,
		sol_usd: solUsd,
		history_at: at,
		caveats,
	};
}
