// api/_lib/x402/pump-trending-score.js
//
// Pump.fun trending score feed — the data engine behind the `pump_trending`
// topic of POST /api/x402/crypto-intel.
//
// Produces a structured market signal from the live pump.fun trending board:
//   • Top N coins by market cap from the frontend-api-v3 board
//   • Per-coin buy/sell pressure from trades decoded from Solana (fetchPumpTrades)
//   • Whale buy detection (trades ≥ WHALE_SOL_THRESHOLD SOL)
//   • An aggregate bullish/bearish/neutral verdict with confidence score
//
// Pure scoring helpers (buildPumpTrendingSignal) take plain data so they are
// unit-testable without network. detectPumpTrending() wires them to live feeds.

import { fetchPumpTrades } from '../pump-feed-fetch.js';

const PUMP_FRONTEND_BASE =
	process.env.PUMP_FRONTEND_BASE || 'https://frontend-api-v3.pump.fun';

// Trades at or above this SOL amount count as "whale" activity.
export const WHALE_SOL_THRESHOLD =
	Number(process.env.PUMP_TRENDING_WHALE_SOL || 5);

// How many top-ranked coins to fetch.
export const CANDIDATES =
	Number(process.env.PUMP_TRENDING_CANDIDATES || 20);

// How many of those top coins to fetch trades for (trade fetch is slow/costly).
export const TRADE_COINS =
	Number(process.env.PUMP_TRENDING_TRADE_COINS || 5);

// Trades per coin fetched from swap-api.
export const TRADES_PER_COIN =
	Number(process.env.PUMP_TRENDING_TRADES_PER_COIN || 30);

// Concurrency limit for trade fetches (avoid hammering swap-api).
const TRADE_CONCURRENCY = Math.min(TRADE_COINS, 5);

// ── pure helpers ──────────────────────────────────────────────────────────────

function num(v) {
	const n = typeof v === 'string' ? parseFloat(v) : v;
	return Number.isFinite(n) ? n : null;
}

/**
 * Given arrays of raw trade objects (from swap-api v2) for multiple coins,
 * compute aggregate buy pressure and surface whale buys.
 *
 * @param {Array<{mint: string, trades: object[]}>} coinTrades
 * @returns {{ totalBuys, totalSells, totalVolumeSol, buyPressure, whaleBuys }}
 */
export function scorePressure(coinTrades) {
	let totalBuys = 0, totalSells = 0, totalVolumeSol = 0;
	const whaleBuys = [];

	for (const { mint, trades } of coinTrades) {
		for (const t of trades) {
			const isBuy = String(t.type ?? t.txType ?? '').toLowerCase() === 'buy';
			const sol = num(t.amountSol) ?? 0;
			if (isBuy) { totalBuys++; totalVolumeSol += sol; }
			else { totalSells++; }
			if (isBuy && sol >= WHALE_SOL_THRESHOLD) {
				whaleBuys.push({
					mint,
					sol_amount: Math.round(sol * 1000) / 1000,
					usd_amount: num(t.amountUsd),
					trader: t.userAddress ?? t.user ?? null,
				});
			}
		}
	}

	const totalTrades = totalBuys + totalSells;
	const buyPressure = totalTrades > 0 ? totalBuys / totalTrades : 0.5;
	return { totalBuys, totalSells, totalVolumeSol, buyPressure, whaleBuys };
}

/**
 * Build a crypto-intel-compatible signal object from scored pressure data.
 * Pure — no network calls, unit-testable.
 *
 * @param {object[]} coins  Normalized trending coin list (sorted by rank)
 * @param {object}   score  Output of scorePressure()
 * @returns {object}  Full crypto-intel response for topic=pump_trending
 */
export function buildPumpTrendingSignal(coins, score) {
	const { totalBuys, totalSells, buyPressure, totalVolumeSol, whaleBuys } = score;
	const topSymbol = coins[0]?.symbol || 'PUMP';
	const topMcap = coins[0]?.market_cap_usd;
	const topMcapStr = topMcap != null
		? topMcap >= 1_000_000 ? `$${(topMcap / 1_000_000).toFixed(2)}M`
			: `$${(topMcap / 1000).toFixed(0)}k`
		: 'N/A';

	let signal, headline, rationale;

	if (buyPressure >= 0.65) {
		signal = 'bullish';
		headline = `Pump.fun trending: ${topSymbol} leads at ${topMcapStr} mcap — ${Math.round(buyPressure * 100)}% buy pressure`;
		rationale = `${totalBuys} buys vs ${totalSells} sells across the top ${TRADE_COINS} trending tokens. ` +
			`${whaleBuys.length} whale buy${whaleBuys.length !== 1 ? 's' : ''} detected (≥${WHALE_SOL_THRESHOLD} SOL each). ` +
			`Strong demand signals near-term momentum.`;
	} else if (buyPressure <= 0.40) {
		signal = 'bearish';
		headline = `Pump.fun trending: ${topSymbol} tops chart at ${topMcapStr} — sellers outweigh buyers`;
		rationale = `${totalSells} sells vs ${totalBuys} buys across the top ${TRADE_COINS} trending tokens. ` +
			`Sell pressure is elevated; watch for further retracement before positioning.`;
	} else {
		signal = 'neutral';
		headline = `Pump.fun trending: ${topSymbol} at ${topMcapStr} mcap — balanced flow (${Math.round(buyPressure * 100)}% buys)`;
		rationale = `Trade flow is mixed across the top ${TRADE_COINS} trending tokens (${totalBuys} buys, ${totalSells} sells). ` +
			`No clear directional conviction; await a decisive move before acting.`;
	}

	// Confidence scales with distance from 50/50 — a strongly skewed order book
	// is more informative than a balanced one.
	const confidence = Math.round(
		Math.min(0.92, 0.55 + Math.abs(buyPressure - 0.5) * 0.8) * 100,
	) / 100;

	return {
		topic: 'pump_trending',
		headline,
		signal,
		price_usd: null,
		change_24h: null,
		rationale,
		confidence,
		buy_pressure: Math.round(buyPressure * 1000) / 1000,
		total_volume_sol: Math.round(totalVolumeSol * 1000) / 1000,
		whale_buys: whaleBuys.slice(0, 10),
		whale_buy_count: whaleBuys.length,
		trending_mints: coins.slice(0, 10).map((c) => ({
			mint: c.mint,
			symbol: c.symbol,
			name: c.name,
			market_cap_usd: c.market_cap_usd,
			rank: c.rank,
		})),
		top_mint: coins[0]?.mint ?? null,
		ts: new Date().toISOString(),
	};
}

// ── live feed fetchers ────────────────────────────────────────────────────────

async function fetchTrendingCoins(limit) {
	const url = new URL('/coins', PUMP_FRONTEND_BASE);
	url.searchParams.set('offset', '0');
	url.searchParams.set('limit', String(limit));
	url.searchParams.set('sort', 'market_cap');
	url.searchParams.set('order', 'DESC');
	url.searchParams.set('includeNsfw', 'false');
	const r = await fetch(url, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(7000),
	});
	if (!r.ok) return null;
	const body = await r.json().catch(() => null);
	const coins = Array.isArray(body) ? body : Array.isArray(body?.coins) ? body.coins : null;
	if (!Array.isArray(coins)) return null;
	return coins
		.filter((c) => c && typeof c.mint === 'string' && c.mint.length >= 32)
		.map((c, i) => ({
			mint: c.mint,
			symbol: c.symbol || '?',
			name: c.name || c.symbol || '',
			market_cap_usd: num(c.usd_market_cap),
			market_cap_sol: num(c.market_cap),
			rank: i + 1,
			complete: !!c.complete,
		}));
}

// pump.fun retired its HTTP trade feeds on 2026-11-25; fetchPumpTrades decodes
// the coin's trades from Solana and shares them across callers for a few seconds.
async function fetchCoinTrades(mint, limit) {
	const feed = await fetchPumpTrades(mint, { limit });
	return feed?.rows || [];
}

/**
 * Main entry point: fetch live pump.fun data and return a crypto-intel signal.
 * Throws a 503-tagged error when the upstream board is unavailable (so the
 * paidEndpoint wrapper withholds settlement — the caller is never charged for
 * an empty verdict).
 */
export async function detectPumpTrending() {
	const coins = await fetchTrendingCoins(CANDIDATES).catch(() => null);
	if (!coins || coins.length === 0) {
		throw Object.assign(
			new Error('pump.fun trending board is temporarily unavailable'),
			{ status: 503, code: 'data_unavailable' },
		);
	}

	// Fetch trades for the top TRADE_COINS in capped concurrency.
	const topCoins = coins.slice(0, TRADE_COINS);
	const coinTrades = [];

	// Simple concurrency pool — chunk into batches of TRADE_CONCURRENCY.
	for (let i = 0; i < topCoins.length; i += TRADE_CONCURRENCY) {
		const batch = topCoins.slice(i, i + TRADE_CONCURRENCY);
		const results = await Promise.allSettled(
			batch.map((c) => fetchCoinTrades(c.mint, TRADES_PER_COIN)),
		);
		results.forEach((res, j) => {
			coinTrades.push({
				mint: batch[j].mint,
				trades: res.status === 'fulfilled' ? res.value : [],
			});
		});
	}

	const score = scorePressure(coinTrades);
	return buildPumpTrendingSignal(coins, score);
}
