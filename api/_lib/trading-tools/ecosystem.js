// Ecosystem-wide Solana signals: macro readings, top movers and anomalies.
//
// get_market_signals answers "what is this one token doing". This module answers
// the question the per-token code cannot: "what is the whole Solana launch
// ecosystem doing right now, and what stands out". Every number is derived from
// data the platform already ingests around the clock:
//
//   pump_coin_intel        every launchpad coin the pump feed sees, with its
//                          first-90s order flow (buys, sells, buyers, dev sells)
//   pumpfun_graduations    every bonding-curve graduation onto a DEX pool
//   pump_coin_outcomes     the labelled fate of each coin (graduated, rugged)
//   coin_smart_money       proven-wallet participation per coin
//   oracle_conviction(_history)  the Oracle's fused conviction score per coin
//   SOL/USD                the sol-price failover ladder
//
// Each signal carries its own inputs (source table, window bounds, sample size)
// and the timestamp it was computed at, so an agent can judge how much to trust
// it. A source that has gone quiet is reported as stale rather than as a zero.
//
// Token names and symbols come from the issuer and are untrusted data: they are
// returned as fields and never interpreted.

import { sql } from '../db.js';
import { cacheWrap } from '../cache.js';
import { solPriceUsd, solChange24hPct } from '../sol-price.js';
import { ToolInputError } from './market.js';

export const ECOSYSTEM_WINDOWS = Object.freeze({ '15m': 15, '1h': 60, '6h': 360, '24h': 1440 });
export const ECOSYSTEM_SECTIONS = Object.freeze(['macro', 'movers', 'anomalies']);

const LAMPORTS = 1e9;
const MOVER_LIMIT = 10;
// A source whose newest row is older than this is reported stale, not as zero.
const STALE_AFTER_MIN = 30;
// |z| at or above this flags an hourly metric as anomalous.
const Z_FLAG = 2;
// A coin is a volume outlier at or above this percentile of its window, and
// never below the absolute floor (a quiet window's p99.5 is not news).
const OUTLIER_PCTL = 0.995;
const OUTLIER_FLOOR_SOL = 25;
const MIN_OUTLIER_SAMPLE = 100;

const num = (v) => (v == null ? null : Number(v));
const round = (v, dp = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(dp)));
const sol = (lamports) => (lamports == null ? null : round(Number(lamports) / LAMPORTS, 4));
const pctChange = (cur, prev) => (prev > 0 ? round(((cur - prev) / prev) * 100, 2) : null);
const ratio = (a, b) => (b > 0 ? round(a / b, 4) : null);

function windowMinutes(window) {
	const minutes = ECOSYSTEM_WINDOWS[window];
	if (!minutes) {
		throw new ToolInputError('bad_window', `window must be one of ${Object.keys(ECOSYSTEM_WINDOWS).join(', ')}`, { window });
	}
	return minutes;
}

function interval(minutes) {
	return `${minutes} minutes`;
}

function iso(ts) {
	return ts ? new Date(ts).toISOString() : null;
}

/** Population mean and standard deviation. */
export function meanSd(values) {
	const xs = values.filter((v) => Number.isFinite(v));
	if (!xs.length) return { mean: null, sd: null, n: 0 };
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
	return { mean, sd: Math.sqrt(variance), n: xs.length };
}

/** z-score of the latest value against the baseline series; null when undefined. */
export function zScore(latest, baseline) {
	const { mean, sd, n } = meanSd(baseline);
	if (n < 6 || sd == null || sd === 0 || !Number.isFinite(latest)) return { z: null, mean, sd, n };
	return { z: (latest - mean) / sd, mean, sd, n };
}

/**
 * Hourly anomaly detection: compare the latest complete hour against the 23
 * hours before it. Buckets are complete hours only, so a half-filled current
 * hour never reads as a collapse.
 */
export function hourlyAnomalies(buckets, metrics, asOf) {
	const ordered = [...buckets].sort((a, b) => new Date(a.hour) - new Date(b.hour));
	if (ordered.length < 7) return [];
	const latest = ordered[ordered.length - 1];
	const baseline = ordered.slice(0, -1);
	const out = [];
	for (const m of metrics) {
		const series = baseline.map((b) => m.value(b));
		const x = m.value(latest);
		const { z, mean, sd, n } = zScore(x, series);
		if (z == null || Math.abs(z) < Z_FLAG) continue;
		out.push({
			kind: 'metric_spike',
			id: `${m.id}_${z > 0 ? 'high' : 'low'}`,
			metric: m.id,
			label: m.label,
			direction: z > 0 ? 'above_normal' : 'below_normal',
			value: round(x, 4),
			baseline_mean: round(mean, 4),
			baseline_sd: round(sd, 4),
			z: round(z, 2),
			inputs: { source: m.source, hour: iso(latest.hour), baseline_hours: n, rule: `|z| >= ${Z_FLAG} vs prior ${n} complete hours` },
			as_of: asOf,
		});
	}
	return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

// ── queries ──────────────────────────────────────────────────────────────────

async function launchWindowStats(minutes) {
	const [row] = await sql`
		select
			count(*) filter (where first_seen_at > now() - ${interval(minutes)}::interval) as cur_n,
			count(*) filter (where first_seen_at <= now() - ${interval(minutes)}::interval) as prev_n,
			coalesce(sum(buy_volume_lamports) filter (where first_seen_at > now() - ${interval(minutes)}::interval), 0) as cur_buy,
			coalesce(sum(sell_volume_lamports) filter (where first_seen_at > now() - ${interval(minutes)}::interval), 0) as cur_sell,
			coalesce(sum(buy_volume_lamports) filter (where first_seen_at <= now() - ${interval(minutes)}::interval), 0) as prev_buy,
			coalesce(sum(sell_volume_lamports) filter (where first_seen_at <= now() - ${interval(minutes)}::interval), 0) as prev_sell,
			count(*) filter (where first_seen_at > now() - ${interval(minutes)}::interval and dev_sold) as cur_dev_sold,
			count(*) filter (where first_seen_at <= now() - ${interval(minutes)}::interval and dev_sold) as prev_dev_sold,
			count(*) filter (where first_seen_at > now() - ${interval(minutes)}::interval and smart_money_count > 0) as cur_smart,
			count(*) filter (where first_seen_at > now() - ${interval(minutes)}::interval and quality_score >= 50) as cur_quality,
			avg(quality_score) filter (where first_seen_at > now() - ${interval(minutes)}::interval) as cur_avg_quality,
			count(*) filter (where first_seen_at > now() - ${interval(minutes)}::interval and 'sniped' = any(risk_flags)) as cur_sniped,
			max(first_seen_at) as newest
		from pump_coin_intel
		where network = 'mainnet' and first_seen_at > now() - ${interval(minutes * 2)}::interval
	`;
	return row;
}

async function categoryRotation(minutes) {
	return sql`
		select coalesce(category, 'unclassified') as category,
			count(*) filter (where first_seen_at > now() - ${interval(minutes)}::interval) as cur_n,
			count(*) filter (where first_seen_at <= now() - ${interval(minutes)}::interval) as prev_n
		from pump_coin_intel
		where network = 'mainnet' and first_seen_at > now() - ${interval(minutes * 2)}::interval
		group by 1
		order by 2 desc
		limit 12
	`;
}

async function graduationStats(minutes) {
	const [row] = await sql`
		select
			count(*) filter (where seen_at > now() - ${interval(minutes)}::interval) as cur_n,
			count(*) filter (where seen_at <= now() - ${interval(minutes)}::interval) as prev_n,
			max(seen_at) as newest
		from pumpfun_graduations
		where seen_at > now() - ${interval(minutes * 2)}::interval
	`;
	return row;
}

async function cohortOutcomes() {
	const [row] = await sql`
		select count(*) as launched,
			count(o.mint) as labeled,
			count(*) filter (where o.graduated) as graduated,
			count(*) filter (where o.rugged) as rugged
		from pump_coin_intel i
		left join pump_coin_outcomes o using (mint)
		where i.network = 'mainnet'
			and i.first_seen_at between now() - interval '48 hours' and now() - interval '24 hours'
	`;
	return row;
}

async function smartMoneyStats(minutes) {
	const [row] = await sql`
		select count(*) filter (where smart_wallet_count > 0) as coins_with_smart,
			count(*) as coins_scored,
			coalesce(sum(proven_buy_lamports), 0) as proven_buy,
			coalesce(sum(total_buy_lamports), 0) as total_buy,
			max(scored_at) as newest
		from coin_smart_money
		where network = 'mainnet' and scored_at > now() - ${interval(minutes)}::interval
	`;
	return row;
}

async function convictionTiers(minutes) {
	return sql`
		select tier, count(*) as n, avg(score) as avg_score, max(scored_at) as newest
		from oracle_conviction
		where network = 'mainnet' and scored_at > now() - ${interval(minutes)}::interval
		group by tier
		order by n desc
	`;
}

async function hourlyBuckets() {
	return sql`
		select date_trunc('hour', first_seen_at) as hour,
			count(*) as launches,
			coalesce(sum(buy_volume_lamports), 0) as buy,
			coalesce(sum(sell_volume_lamports), 0) as sell,
			count(*) filter (where dev_sold) as dev_sold
		from pump_coin_intel
		where network = 'mainnet'
			and first_seen_at >= date_trunc('hour', now()) - interval '24 hours'
			and first_seen_at < date_trunc('hour', now())
		group by 1
		order by 1
	`;
}

async function hourlyGraduations() {
	return sql`
		select date_trunc('hour', seen_at) as hour, count(*) as graduations
		from pumpfun_graduations
		where seen_at >= date_trunc('hour', now()) - interval '24 hours'
			and seen_at < date_trunc('hour', now())
		group by 1
	`;
}

async function inflowMovers(minutes) {
	return sql`
		select mint, symbol, name, category, buy_count, sell_count, unique_buyers,
			buy_volume_lamports, sell_volume_lamports, dev_sold, quality_score,
			risk_flags, smart_money_count, first_seen_at
		from pump_coin_intel
		where network = 'mainnet' and first_seen_at > now() - ${interval(minutes)}::interval
		order by (coalesce(buy_volume_lamports, 0) - coalesce(sell_volume_lamports, 0)) desc nulls last
		limit ${MOVER_LIMIT}
	`;
}

async function smartMoneyMovers(minutes) {
	return sql`
		select mint, symbol, name, category, smart_money_score, smart_wallet_count,
			proven_buy_lamports, total_buy_lamports, graduated, scored_at
		from coin_smart_money
		where network = 'mainnet' and scored_at > now() - ${interval(minutes)}::interval
			and smart_wallet_count > 0
		order by proven_buy_lamports desc nulls last
		limit ${MOVER_LIMIT}
	`;
}

async function highConviction(minutes) {
	return sql`
		select mint, symbol, name, score, tier, rug_risk, upside, smart_wallet_count, category, scored_at
		from oracle_conviction
		where network = 'mainnet' and scored_at > now() - ${interval(minutes)}::interval
		order by score desc, scored_at desc
		limit ${MOVER_LIMIT}
	`;
}

async function recentGraduations(minutes) {
	return sql`
		select g.mint, coalesce(g.symbol, i.symbol) as symbol, coalesce(g.name, i.name) as name,
			g.pool, g.seen_at, i.quality_score, i.smart_money_count, i.category
		from pumpfun_graduations g
		left join pump_coin_intel i on i.mint = g.mint
		where g.seen_at > now() - ${interval(minutes)}::interval
		order by i.smart_money_count desc nulls last, i.quality_score desc nulls last, g.seen_at desc
		limit ${MOVER_LIMIT}
	`;
}

/**
 * The window's buy-volume percentile cut plus the candidate coins that could
 * clear it (or carry a smart-money cluster). The percentile is computed in the
 * database over every coin in the window, so a busy 24h window is not sampled.
 */
async function windowOutlierCandidates(minutes) {
	const [stats] = await sql`
		select count(*) as sample,
			percentile_disc(${OUTLIER_PCTL}) within group (order by buy_volume_lamports) as cut
		from pump_coin_intel
		where network = 'mainnet' and first_seen_at > now() - ${interval(minutes)}::interval
			and buy_volume_lamports > 0
	`;
	const sample = Number(stats.sample);
	const cut = stats.cut == null ? null : Number(stats.cut);
	const threshold = Math.max(cut ?? 0, OUTLIER_FLOOR_SOL * LAMPORTS);
	const rows = await sql`
		select mint, symbol, name, buy_volume_lamports, sell_volume_lamports, unique_buyers,
			dev_sold, smart_money_count, risk_flags, first_seen_at
		from pump_coin_intel
		where network = 'mainnet' and first_seen_at > now() - ${interval(minutes)}::interval
			and (buy_volume_lamports >= ${threshold} or smart_money_count >= 3)
		order by buy_volume_lamports desc nulls last
		limit 200
	`;
	return { sample, cut, rows };
}

// ── assembly ─────────────────────────────────────────────────────────────────

function freshness(newest, asOfMs) {
	if (!newest) return { newest_row_at: null, stale: true };
	const ageMin = (asOfMs - new Date(newest).getTime()) / 60000;
	return { newest_row_at: iso(newest), age_minutes: round(ageMin, 1), stale: ageMin > STALE_AFTER_MIN };
}

function signal(id, label, value, extra, inputs, asOf) {
	return { id, label, value, ...extra, inputs, as_of: asOf };
}

async function buildMacro(window, minutes, asOf, asOfMs) {
	const [launch, cats, grads, cohort, smart, tiers, solUsd, solChg] = await Promise.all([
		launchWindowStats(minutes),
		categoryRotation(minutes),
		graduationStats(minutes),
		cohortOutcomes(),
		smartMoneyStats(minutes),
		convictionTiers(minutes),
		solPriceUsd().catch(() => null),
		solChange24hPct().catch(() => null),
	]);
	const win = { window, minutes };
	const curN = Number(launch.cur_n);
	const prevN = Number(launch.prev_n);
	const curBuy = Number(launch.cur_buy);
	const curSell = Number(launch.cur_sell);
	const prevBuy = Number(launch.prev_buy);
	const prevSell = Number(launch.prev_sell);
	const feedFresh = freshness(launch.newest, asOfMs);
	const launchInputs = { source: 'pump_coin_intel', ...win, compared_to: 'the equal window before it', sample: curN, ...feedFresh };

	const signals = [
		signal('sol_price', 'SOL/USD', round(num(solUsd), 4), { change_24h_pct: round(num(solChg), 2) },
			{ source: 'sol-price failover ladder' }, asOf),
		signal('launch_rate', 'New launchpad coins in window', curN,
			{ previous: prevN, change_pct: pctChange(curN, prevN), per_hour: round((curN / minutes) * 60, 1) }, launchInputs, asOf),
		signal('launch_buy_pressure', 'Buy / sell SOL in launches (first 90s of each coin)', ratio(curBuy, curSell),
			{ buy_sol: sol(curBuy), sell_sol: sol(curSell), net_sol: sol(curBuy - curSell), previous: ratio(prevBuy, prevSell) },
			launchInputs, asOf),
		signal('dev_dump_share', 'Share of new coins whose dev sold in the first 90s', ratio(Number(launch.cur_dev_sold), curN),
			{ previous: ratio(Number(launch.prev_dev_sold), prevN), count: Number(launch.cur_dev_sold) }, launchInputs, asOf),
		signal('snipe_share', 'Share of new coins flagged as sniped', ratio(Number(launch.cur_sniped), curN),
			{ count: Number(launch.cur_sniped) }, launchInputs, asOf),
		signal('quality_share', 'Share of new coins scoring 50+ on launch quality', ratio(Number(launch.cur_quality), curN),
			{ avg_quality: round(num(launch.cur_avg_quality), 1), count: Number(launch.cur_quality) }, launchInputs, asOf),
		signal('smart_money_share', 'Share of new coins with a proven wallet buying', ratio(Number(launch.cur_smart), curN),
			{ count: Number(launch.cur_smart) }, launchInputs, asOf),
		signal('graduation_rate', 'Coins graduating onto a DEX pool in window', Number(grads.cur_n),
			{ previous: Number(grads.prev_n), change_pct: pctChange(Number(grads.cur_n), Number(grads.prev_n)),
				per_hour: round((Number(grads.cur_n) / minutes) * 60, 1), share_of_launches: ratio(Number(grads.cur_n), curN) },
			{ source: 'pumpfun_graduations', ...win, compared_to: 'the equal window before it', ...freshness(grads.newest, asOfMs) }, asOf),
		signal('cohort_outcomes', 'Fate of coins launched 24 to 48 hours ago', ratio(Number(cohort.graduated), Number(cohort.labeled)),
			{ metric: 'graduation_rate', rug_rate: ratio(Number(cohort.rugged), Number(cohort.labeled)),
				launched: Number(cohort.launched), labeled: Number(cohort.labeled), graduated: Number(cohort.graduated), rugged: Number(cohort.rugged) },
			{ source: 'pump_coin_intel + pump_coin_outcomes', cohort: 'first seen 24h to 48h ago' }, asOf),
		signal('smart_money_flow', 'Proven-wallet SOL into coins scored in window', sol(Number(smart.proven_buy)),
			{ unit: 'SOL', total_buy_sol: sol(Number(smart.total_buy)), proven_share: ratio(Number(smart.proven_buy), Number(smart.total_buy)),
				coins_with_smart_money: Number(smart.coins_with_smart), coins_scored: Number(smart.coins_scored) },
			{ source: 'coin_smart_money', ...win, ...freshness(smart.newest, asOfMs) }, asOf),
		signal('conviction_mix', 'Oracle conviction tiers for coins scored in window', tiers.map((t) => ({
			tier: t.tier, coins: Number(t.n), avg_score: round(num(t.avg_score), 1) })), {},
			{ source: 'oracle_conviction', ...win, ...freshness(tiers.reduce((m, t) => (!m || t.newest > m ? t.newest : m), null), asOfMs) }, asOf),
		signal('narrative_rotation', 'Launch share by category vs the previous window', cats.map((c) => ({
			category: c.category,
			share: ratio(Number(c.cur_n), curN),
			previous_share: ratio(Number(c.prev_n), prevN),
			share_change_pts: curN > 0 && prevN > 0 ? round((Number(c.cur_n) / curN - Number(c.prev_n) / prevN) * 100, 2) : null,
		})), {}, launchInputs, asOf),
	];
	return signals;
}

function moverRow(row, extra) {
	return { mint: row.mint, symbol: row.symbol || null, name: row.name || null, ...extra };
}

async function buildMovers(window, minutes, asOf) {
	const [inflow, smart, conviction, grads] = await Promise.all([
		inflowMovers(minutes),
		smartMoneyMovers(minutes),
		highConviction(minutes),
		recentGraduations(minutes),
	]);
	const win = { window, minutes };
	return {
		launch_inflow: {
			rule: 'Largest net SOL buy flow in each coin\'s first 90 seconds, launched in window',
			inputs: { source: 'pump_coin_intel', ...win, sample: inflow.length },
			as_of: asOf,
			items: inflow.map((r) => moverRow(r, {
				net_sol: sol(Number(r.buy_volume_lamports || 0) - Number(r.sell_volume_lamports || 0)),
				buy_sol: sol(r.buy_volume_lamports), sell_sol: sol(r.sell_volume_lamports),
				buys: r.buy_count, sells: r.sell_count, unique_buyers: r.unique_buyers,
				dev_sold: r.dev_sold, quality_score: r.quality_score, risk_flags: r.risk_flags || [],
				smart_money_count: r.smart_money_count, category: r.category, first_seen_at: iso(r.first_seen_at),
			})),
		},
		smart_money: {
			rule: 'Most SOL bought by wallets with a proven track record, coins scored in window',
			inputs: { source: 'coin_smart_money', ...win, sample: smart.length },
			as_of: asOf,
			items: smart.map((r) => moverRow(r, {
				proven_buy_sol: sol(r.proven_buy_lamports), total_buy_sol: sol(r.total_buy_lamports),
				smart_wallets: r.smart_wallet_count, smart_money_score: num(r.smart_money_score),
				graduated: r.graduated, category: r.category, scored_at: iso(r.scored_at),
			})),
		},
		high_conviction: {
			rule: 'Highest Oracle conviction score among coins scored in window',
			inputs: { source: 'oracle_conviction', ...win, sample: conviction.length },
			as_of: asOf,
			items: conviction.map((r) => moverRow(r, {
				score: r.score, tier: r.tier, rug_risk: r.rug_risk, upside: r.upside,
				smart_wallets: r.smart_wallet_count, category: r.category, scored_at: iso(r.scored_at),
			})),
		},
		graduations: {
			rule: 'Coins that graduated onto a DEX pool in window, strongest backing first',
			inputs: { source: 'pumpfun_graduations + pump_coin_intel', ...win, sample: grads.length },
			as_of: asOf,
			items: grads.map((r) => moverRow(r, {
				pool: r.pool, graduated_at: iso(r.seen_at), quality_score: r.quality_score,
				smart_money_count: r.smart_money_count, category: r.category,
			})),
		},
	};
}

/**
 * Coin-level anomalies inside the window. Pure over the candidate rows and the
 * window's percentile cut, exported for tests.
 */
export function coinAnomalies({ sample, cut, rows }, asOf, win) {
	const threshold = sample >= MIN_OUTLIER_SAMPLE && cut != null ? Math.max(cut, OUTLIER_FLOOR_SOL * LAMPORTS) : null;
	const out = [];
	for (const r of rows) {
		const base = { mint: r.mint, symbol: r.symbol || null, name: r.name || null, first_seen_at: iso(r.first_seen_at), as_of: asOf };
		if (threshold != null && Number(r.buy_volume_lamports || 0) >= threshold) {
			out.push({
				kind: r.dev_sold === true ? 'dev_dump_into_inflow' : 'volume_outlier',
				...base,
				buy_sol: sol(r.buy_volume_lamports),
				sell_sol: sol(r.sell_volume_lamports),
				unique_buyers: r.unique_buyers,
				risk_flags: r.risk_flags || [],
				inputs: {
					source: 'pump_coin_intel', ...win,
					rule: `first-90s buy volume at or above the window's p${OUTLIER_PCTL * 100} and at least ${OUTLIER_FLOOR_SOL} SOL`,
					threshold_sol: sol(threshold),
					coins_in_window: sample,
				},
			});
		}
		if (Number(r.smart_money_count) >= 3) {
			out.push({
				kind: 'smart_money_cluster',
				...base,
				smart_wallets: Number(r.smart_money_count),
				buy_sol: sol(r.buy_volume_lamports),
				inputs: { source: 'pump_coin_intel', ...win, rule: '3 or more proven wallets bought in the first 90 seconds' },
			});
		}
	}
	const rank = { dev_dump_into_inflow: 0, smart_money_cluster: 1, volume_outlier: 2 };
	return out.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.buy_sol ?? 0) - (a.buy_sol ?? 0)).slice(0, 25);
}

async function buildAnomalies(window, minutes, asOf) {
	const [buckets, gradBuckets, candidates] = await Promise.all([hourlyBuckets(), hourlyGraduations(), windowOutlierCandidates(minutes)]);
	const gradByHour = new Map(gradBuckets.map((g) => [new Date(g.hour).getTime(), Number(g.graduations)]));
	const merged = buckets.map((b) => ({
		hour: b.hour,
		launches: Number(b.launches),
		buy: Number(b.buy),
		sell: Number(b.sell),
		dev_sold: Number(b.dev_sold),
		graduations: gradByHour.get(new Date(b.hour).getTime()) || 0,
	}));
	const metrics = [
		{ id: 'launches_per_hour', label: 'Launches per hour', source: 'pump_coin_intel', value: (b) => b.launches },
		{ id: 'launch_buy_sol_per_hour', label: 'Launch buy volume per hour (SOL)', source: 'pump_coin_intel', value: (b) => b.buy / LAMPORTS },
		{ id: 'launch_buy_sell_ratio', label: 'Launch buy/sell ratio', source: 'pump_coin_intel', value: (b) => (b.sell > 0 ? b.buy / b.sell : NaN) },
		{ id: 'dev_dump_share', label: 'Dev-dump share of launches', source: 'pump_coin_intel', value: (b) => (b.launches > 0 ? b.dev_sold / b.launches : NaN) },
		{ id: 'graduations_per_hour', label: 'Graduations per hour', source: 'pumpfun_graduations', value: (b) => b.graduations },
	];
	return {
		ecosystem: hourlyAnomalies(merged, metrics, asOf),
		coins: coinAnomalies(candidates, asOf, { window, minutes }),
		inputs: { hours_compared: merged.length, coins_scanned: candidates.sample },
	};
}

/**
 * Ecosystem view for get_market_signals when no single mint is given.
 * `sections` narrows the work to what the caller needs.
 */
export async function getEcosystemSignals({ window = '1h', sections = ECOSYSTEM_SECTIONS } = {}) {
	const minutes = windowMinutes(window);
	const wanted = (Array.isArray(sections) && sections.length ? sections : ECOSYSTEM_SECTIONS).map(String);
	for (const s of wanted) {
		if (!ECOSYSTEM_SECTIONS.includes(s)) {
			throw new ToolInputError('bad_section', `sections must be drawn from ${ECOSYSTEM_SECTIONS.join(', ')}`, { section: s });
		}
	}
	const key = `tt:eco:v1:${window}:${[...wanted].sort().join(',')}`;
	return cacheWrap(key, 60, async () => {
		const asOfMs = Date.now();
		const asOf = new Date(asOfMs).toISOString();
		const [macro, movers, anomalies] = await Promise.all([
			wanted.includes('macro') ? buildMacro(window, minutes, asOf, asOfMs) : null,
			wanted.includes('movers') ? buildMovers(window, minutes, asOf) : null,
			wanted.includes('anomalies') ? buildAnomalies(window, minutes, asOf) : null,
		]);
		return {
			scope: 'ecosystem',
			chain: 'solana',
			network: 'mainnet',
			window,
			as_of: asOf,
			...(macro ? { macro } : {}),
			...(movers ? { movers } : {}),
			...(anomalies ? { anomalies } : {}),
		};
	});
}
