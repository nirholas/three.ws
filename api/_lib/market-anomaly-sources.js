// Real series for the market anomaly engine (api/_lib/market-anomaly.js).
// Every loader returns ascending { t, v } points built from the same upstreams
// the /markets pages and paid market-data endpoints run on: no sample data.
//
//   price              CoinGecko 7d hourly sparkline via fetchMarketsTable
//   tvl                DeFiLlama historicalChainTvl/Solana (daily)
//   stablecoin supply  DeFiLlama stablecoincharts/Solana (daily circulating USD)
//   stablecoin peg     DeFiLlama stablecoins board via buildStablecoins
//   funding            Hyperliquid fundingHistory per perp (hourly)
//   open interest      Hyperliquid metaAndAssetCtxs snapshots, persisted by the
//                      cron in market_anomaly_samples (no public history exists)

import { fetchMarketsTable } from './market-fallbacks.js';
import { fetchUpstreamJson } from './upstream-fetch.js';
import { hlInfo, fetchHyperliquidPerps } from './hyperliquid.js';
import { buildStablecoins } from '../defi/stablecoins.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UA = { headers: { accept: 'application/json', 'user-agent': 'three.ws/1.0' } };

export const SOLANA_CHAIN = 'Solana';
/** Coins scored by the price processor (top by market cap). */
export const PRICE_COINS = 100;
/** Perps scored by the funding and open interest processors (top by volume). */
export const PERP_COUNT = 20;
const FUNDING_WINDOW_MS = 7 * DAY;

/** @returns {Promise<{ subject: string, points: { t: number, v: number }[] }[]>} */
export async function loadPriceSeries() {
	const { rows } = await fetchMarketsTable({ page: 1, perPage: PRICE_COINS, category: '' });
	const now = Date.now();
	const out = [];
	for (const r of rows) {
		const spark = Array.isArray(r.sparkline) ? r.sparkline.filter((n) => Number.isFinite(n)) : [];
		if (!r.id || spark.length < 2) continue;
		// The sparkline is evenly spaced hourly samples ending now.
		const points = spark.map((v, i) => ({ t: now - (spark.length - 1 - i) * HOUR, v }));
		out.push({ subject: r.symbol ? String(r.symbol).toUpperCase() : r.id, points });
	}
	return out;
}

/** Daily Solana DeFi TVL. Drops the in-progress final day only if it is partial. */
export async function loadSolanaTvlSeries() {
	const raw = await fetchUpstreamJson(
		`https://api.llama.fi/v2/historicalChainTvl/${SOLANA_CHAIN}`,
		UA,
		{ name: 'defillama:chain-tvl', timeoutMs: 15_000, attempts: 2 },
	);
	if (!Array.isArray(raw)) throw new Error('unexpected chain TVL shape');
	const points = raw
		.map((p) => ({ t: Number(p.date) * 1000, v: Number(p.tvl) }))
		.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0);
	return [{ subject: SOLANA_CHAIN, points: points.slice(-120) }];
}

/** Daily Solana stablecoin circulating supply, in USD. */
export async function loadSolanaStablecoinSupplySeries() {
	const raw = await fetchUpstreamJson(
		`https://stablecoins.llama.fi/stablecoincharts/${SOLANA_CHAIN}`,
		UA,
		{ name: 'defillama:stablecoin-chart', timeoutMs: 15_000, attempts: 2 },
	);
	if (!Array.isArray(raw)) throw new Error('unexpected stablecoin chart shape');
	const points = raw
		.map((p) => ({ t: Number(p.date) * 1000, v: Number(p.totalCirculatingUSD?.peggedUSD) }))
		.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0);
	return [{ subject: SOLANA_CHAIN, points: points.slice(-120) }];
}

/** Current stablecoin board (price, peg type, circulating USD) for the peg check. */
export async function loadStablecoinBoard() {
	const board = await buildStablecoins();
	return board.stablecoins;
}

/** Top perps by 24h volume with their current mark price and USD open interest. */
export async function loadPerpSnapshot() {
	const rows = await fetchHyperliquidPerps();
	return rows.slice(0, PERP_COUNT).map((r) => ({
		coin: r.index_id,
		symbol: r.symbol,
		funding_rate_8h_pct: r.funding_rate,
		open_interest_usd: r.open_interest,
	}));
}

/** Hourly funding history (8h-equivalent percent) for one perp over the last 7 days. */
export async function loadFundingSeries(coin) {
	const rows = await hlInfo({ type: 'fundingHistory', coin, startTime: Date.now() - FUNDING_WINDOW_MS });
	if (!Array.isArray(rows)) throw new Error('unexpected fundingHistory shape');
	const points = rows
		.map((r) => ({ t: Number(r.time), v: Number(r.fundingRate) * 8 * 100 }))
		.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
	return { subject: `${coin}-USD`, points };
}
