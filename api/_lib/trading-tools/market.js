// Market reads behind the trading tools: token search with a safety score,
// price, live signals, technical indicators and the token-filtered news feed.
//
// Everything here is read-only and public-data only. Each function composes
// libraries the platform's pages already use (the Jupiter token index, the
// market-data failover chain, the orders engine's signal map, the Oracle
// conviction store, the OHLCV ladder, the news aggregator), so a number a tool
// returns is the same number the matching page shows.
//
// Token names, symbols and descriptions come from the issuer and are untrusted
// data: they are returned as fields, never interpreted.

import { EMA, SMA, RSI, MACD, BollingerBands } from 'trading-signals';

import { jupiterTokenSearch } from '../token/jupiter.js';
import { searchPumpTokens } from '../pump-search.js';
import { composeTokenSecurity } from '../crypto-token-security.js';
import { fetchTokenMarketData } from '../market/token-market.js';
import { fetchTokenMarket, buildTokenSignal } from '../token-market.js';
import { topPoolForToken, fetchOhlcv } from '../market/ohlcv.js';
import { solPriceUsd, solChange24hPct } from '../sol-price.js';
import { getNews } from '../news.js';
import { cacheWrap } from '../cache.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** A boundary error the tool layer shows as-is. */
export class ToolInputError extends Error {
	constructor(code, message, detail = null) {
		super(message);
		this.code = code;
		this.detail = detail;
		this.isToolError = true;
	}
}

export function isMint(s) {
	return typeof s === 'string' && BASE58_RE.test(s.trim());
}

/** 'SOL' / 'USDC' shorthands and base58 mints; anything else is a search query. */
export function mintShorthand(s) {
	const v = String(s || '').trim();
	if (/^w?sol$/i.test(v)) return WSOL_MINT;
	if (/^usdc$/i.test(v)) return USDC_MINT;
	return isMint(v) ? v : null;
}

// ── safety score ─────────────────────────────────────────────────────────────

/**
 * The token-safety diligence rules (community-skills/skills/token-safety-check)
 * as a deterministic 0-100 score and a PASS / CAUTION / FAIL verdict.
 *
 *   FAIL     a live mint or freeze authority (a rug lever), or liquidity under
 *            $1k with holders concentrated above 80%.
 *   CAUTION  hard checks pass but liquidity is thin (< $10k), the top holders
 *            own more than half the supply, the pair is under a day old,
 *            metadata is mutable, or any input could not be read.
 *   PASS     every check ran and came back clean. It means "passes the on-chain
 *            checks", never "safe to buy".
 *
 * Every missing input is named in `unknown` instead of scored as a pass.
 *
 * @param {{
 *   mintAuthorityRevoked?: boolean|null, freezeAuthorityRevoked?: boolean|null,
 *   liquidityUsd?: number|null, ageMs?: number|null, topHoldersPct?: number|null,
 *   holderCount?: number|null, verified?: boolean|null, organicScore?: number|null,
 *   metadataMutable?: boolean|null, token2022?: boolean|null,
 * }} f
 */
export function scoreTokenSafety(f) {
	let score = 100;
	const fails = [];
	const cautions = [];
	const passes = [];
	const unknown = [];

	const authority = (value, label, lever) => {
		if (value === false) {
			score -= 45;
			fails.push(`${label} authority is live: ${lever}`);
		} else if (value === true) passes.push(`${label} authority revoked`);
		else {
			score -= 12;
			unknown.push(`${label} authority`);
		}
	};
	authority(f.mintAuthorityRevoked, 'Mint', 'the issuer can print unlimited supply');
	authority(f.freezeAuthorityRevoked, 'Freeze', 'the issuer can freeze holder accounts so they cannot sell');

	const liq = f.liquidityUsd;
	if (liq == null) {
		score -= 15;
		unknown.push('liquidity');
	} else if (liq < 10_000) {
		score -= 25;
		cautions.push(`liquidity is only $${Math.round(liq).toLocaleString('en-US')}: a modest sell moves the price hard`);
	} else if (liq < 100_000) {
		score -= 8;
		passes.push(`liquidity $${Math.round(liq).toLocaleString('en-US')}`);
	} else passes.push(`liquidity $${Math.round(liq).toLocaleString('en-US')}`);

	const top = f.topHoldersPct;
	if (top == null) {
		score -= 10;
		unknown.push('holder concentration');
	} else if (top > 80) {
		score -= 30;
		cautions.push(`top holders own ${top.toFixed(1)}% of supply`);
	} else if (top > 50) {
		score -= 18;
		cautions.push(`top holders own ${top.toFixed(1)}% of supply`);
	} else passes.push(`top holders own ${top.toFixed(1)}% of supply`);

	if (liq != null && liq < 1_000 && top != null && top > 80) {
		fails.push('near-zero liquidity on concentrated supply: trivially dumpable');
	}

	if (f.ageMs == null) unknown.push('pair age');
	else if (f.ageMs < 86_400_000) {
		score -= 12;
		cautions.push('the pair is under a day old');
	} else if (f.ageMs < 7 * 86_400_000) score -= 4;

	if (f.metadataMutable === true) {
		score -= 8;
		cautions.push('metadata is mutable: name, symbol and image can still be rewritten');
	}
	if (f.token2022 === true) {
		score -= 5;
		cautions.push('Token-2022 mint: check its extensions (transfer hook, permanent delegate, transfer fee)');
	}
	if (f.verified === true) passes.push('verified in the Jupiter token index');
	if (f.organicScore != null && f.organicScore < 20) {
		score -= 5;
		cautions.push(`organic trading score is low (${Math.round(f.organicScore)}/100)`);
	}

	score = Math.max(0, Math.min(100, Math.round(score)));
	const verdict = fails.length ? 'FAIL' : cautions.length || unknown.length ? 'CAUTION' : 'PASS';
	return { score, verdict, fails, cautions, passes, unknown };
}

// ── token search ─────────────────────────────────────────────────────────────

function ageFrom(iso) {
	const t = Date.parse(iso || '');
	return Number.isFinite(t) ? Math.max(0, Date.now() - t) : null;
}

function shapeJupiterToken(t) {
	const created = t.firstPool?.createdAt || t.createdAt || null;
	const ageMs = ageFrom(created);
	const audit = t.audit || {};
	const safety = scoreTokenSafety({
		mintAuthorityRevoked: typeof audit.mintAuthorityDisabled === 'boolean' ? audit.mintAuthorityDisabled : null,
		freezeAuthorityRevoked: typeof audit.freezeAuthorityDisabled === 'boolean' ? audit.freezeAuthorityDisabled : null,
		liquidityUsd: Number.isFinite(t.liquidity) ? t.liquidity : null,
		ageMs,
		topHoldersPct: Number.isFinite(audit.topHoldersPercentage) ? audit.topHoldersPercentage : null,
		holderCount: Number.isFinite(t.holderCount) ? t.holderCount : null,
		verified: t.isVerified === true,
		organicScore: Number.isFinite(t.organicScore) ? t.organicScore : null,
		token2022: t.tokenProgram === TOKEN_2022,
	});
	return {
		mint: t.id,
		symbol: t.symbol || null,
		name: t.name || null,
		decimals: Number.isInteger(t.decimals) ? t.decimals : null,
		icon: t.icon || null,
		price_usd: Number.isFinite(t.usdPrice) ? t.usdPrice : null,
		market_cap_usd: Number.isFinite(t.mcap) ? t.mcap : null,
		liquidity_usd: Number.isFinite(t.liquidity) ? t.liquidity : null,
		volume_24h_usd: t.stats24h ? (t.stats24h.buyVolume || 0) + (t.stats24h.sellVolume || 0) : null,
		price_change_24h_pct: Number.isFinite(t.stats24h?.priceChange) ? t.stats24h.priceChange : null,
		holder_count: Number.isFinite(t.holderCount) ? t.holderCount : null,
		top_holders_pct: Number.isFinite(audit.topHoldersPercentage) ? audit.topHoldersPercentage : null,
		pair_created_at: created,
		age_hours: ageMs != null ? Math.round(ageMs / 36e5) : null,
		mint_authority_revoked: typeof audit.mintAuthorityDisabled === 'boolean' ? audit.mintAuthorityDisabled : null,
		freeze_authority_revoked: typeof audit.freezeAuthorityDisabled === 'boolean' ? audit.freezeAuthorityDisabled : null,
		token_program: t.tokenProgram === TOKEN_2022 ? 'token-2022' : 'spl-token',
		verified: t.isVerified === true,
		organic_score: Number.isFinite(t.organicScore) ? Math.round(t.organicScore) : null,
		safety,
		source: 'jupiter',
	};
}

/** Deepen the first result with the on-chain security read (metadata mutability, LP facts). */
async function deepenSafety(row) {
	const sec = await composeTokenSecurity({ address: row.mint }).catch(() => null);
	if (sec?.status !== 'ok') return { ...row, security: null };
	const c = sec.checks;
	const merged = scoreTokenSafety({
		mintAuthorityRevoked: c.mintAuthorityRevoked ?? row.mint_authority_revoked,
		freezeAuthorityRevoked: c.freezeAuthorityRevoked ?? row.freeze_authority_revoked,
		liquidityUsd: row.liquidity_usd ?? c.liquidityUsd,
		ageMs: row.age_hours != null ? row.age_hours * 36e5 : null,
		topHoldersPct: row.top_holders_pct,
		verified: row.verified,
		organicScore: row.organic_score,
		metadataMutable: c.metadataMutable,
		token2022: row.token_program === 'token-2022',
	});
	return {
		...row,
		safety: merged,
		security: { risk_level: sec.riskLevel, reasons: sec.reasons, checks: c, sources: sec.sources },
	};
}

/**
 * Resolve a symbol, name or mint to candidate mints, each with liquidity, age,
 * holder concentration, authority status and a safety score. Ranked by
 * liquidity, because copycat tokens reuse popular names on purpose and the
 * deepest market is almost always the real one; the result still lists every
 * candidate so the caller can confirm by mint.
 *
 * @param {{ query: string, limit?: number, deep?: boolean }} args
 */
export async function tokenSearch({ query, limit = 5, deep = true }) {
	const q = String(query || '').trim();
	if (!q) throw new ToolInputError('invalid_query', 'query must be a token symbol, name or mint address.');
	const lim = Math.max(1, Math.min(20, Number(limit) || 5));

	let rows = null;
	let source = 'jupiter';
	try {
		const raw = await cacheWrap(`trading-tools:search:v1:${q.toLowerCase()}`, 60, () => jupiterTokenSearch(q, { limit: 40 }));
		rows = raw.filter((t) => t && isMint(t.id)).map(shapeJupiterToken);
	} catch {
		rows = null;
	}

	if (!rows) {
		// Jupiter's index is down: fall back to the launchpad search, then read
		// authorities and concentration straight from chain for the top hits.
		source = 'pump-search';
		const hits = (await searchPumpTokens(q, lim)) || [];
		rows = await Promise.all(
			hits.slice(0, Math.min(lim, 3)).map(async (h) => {
				const sec = await composeTokenSecurity({ address: h.mint }).catch(() => null);
				const c = sec?.status === 'ok' ? sec.checks : {};
				return {
					mint: h.mint,
					symbol: h.symbol || null,
					name: h.name || null,
					decimals: null,
					icon: h.logo || null,
					price_usd: h.price_usd ?? null,
					market_cap_usd: h.usd_market_cap ?? null,
					liquidity_usd: c.liquidityUsd ?? null,
					holder_count: null,
					top_holders_pct: null,
					mint_authority_revoked: c.mintAuthorityRevoked ?? null,
					freeze_authority_revoked: c.freezeAuthorityRevoked ?? null,
					safety: scoreTokenSafety({
						mintAuthorityRevoked: c.mintAuthorityRevoked ?? null,
						freezeAuthorityRevoked: c.freezeAuthorityRevoked ?? null,
						liquidityUsd: c.liquidityUsd ?? null,
						metadataMutable: c.metadataMutable ?? null,
						topHoldersPct: c.topHolderPctFlag === true ? 81 : null,
					}),
					security: sec?.status === 'ok' ? { risk_level: sec.riskLevel, reasons: sec.reasons, checks: c, sources: sec.sources } : null,
					source: 'pump-search',
				};
			}),
		);
	}

	const exact = mintShorthand(q);
	rows.sort((a, b) => {
		if (exact) return (b.mint === exact) - (a.mint === exact);
		const sym = q.replace(/^\$/, '').toLowerCase();
		const ea = (a.symbol || '').toLowerCase() === sym;
		const eb = (b.symbol || '').toLowerCase() === sym;
		if (ea !== eb) return eb - ea;
		return (b.liquidity_usd || 0) - (a.liquidity_usd || 0);
	});
	rows = rows.slice(0, lim);
	if (deep && rows[0] && rows[0].source === 'jupiter') rows[0] = await deepenSafety(rows[0]);

	return {
		query: q,
		source,
		count: rows.length,
		best: rows[0] || null,
		results: rows,
		note: rows.length > 1
			? 'Several tokens share names. Ranked by exact symbol match, then liquidity. Confirm the mint before trading.'
			: null,
	};
}

/** Resolve a symbol/name/mint to one mint (the best search hit). */
export async function resolveMint(input) {
	const direct = mintShorthand(input);
	if (direct) return direct;
	const found = await tokenSearch({ query: input, limit: 1, deep: false });
	if (!found.best) throw new ToolInputError('token_not_found', `No Solana token matches "${String(input).slice(0, 40)}".`);
	return found.best.mint;
}

/** Decimals for a mint: SOL and USDC are known, anything else comes from the token index. */
export async function tokenDecimals(mint) {
	if (mint === WSOL_MINT) return 9;
	if (mint === USDC_MINT) return 6;
	const rows = await cacheWrap(`trading-tools:decimals:v1:${mint}`, 3600, async () => {
		const hits = await jupiterTokenSearch(mint, { limit: 1 });
		const d = hits.find((h) => h.id === mint)?.decimals;
		return Number.isInteger(d) ? { d } : null;
	}).catch(() => null);
	if (rows?.d != null) return rows.d;
	throw new ToolInputError('unknown_decimals', `Could not read the decimals of ${mint}. Pass the amount in base units instead.`);
}

// ── price ────────────────────────────────────────────────────────────────────

/** Live USD and SOL price for a mint, from the platform's market-data failover chain. */
export async function getPrice({ mint }) {
	const m = await resolveMint(mint);
	const solUsd = await solPriceUsd().catch(() => null);
	if (m === WSOL_MINT) {
		const change = await solChange24hPct().catch(() => null);
		return { mint: m, symbol: 'SOL', price_usd: solUsd, price_sol: 1, price_change_24h_pct: change, sol_usd: solUsd, source: 'sol-price' };
	}
	const md = await fetchTokenMarketData(m);
	if (!md || !(md.price_usd > 0)) {
		throw new ToolInputError('price_unavailable', `No market prices ${m} right now. It may have no liquidity yet.`, { mint: m });
	}
	return {
		mint: m,
		price_usd: md.price_usd,
		price_sol: solUsd ? md.price_usd / solUsd : null,
		price_change_24h_pct: md.price_change_24h ?? null,
		market_cap_usd: md.market_cap ?? null,
		liquidity_usd: md.liquidity ?? null,
		volume_24h_usd: md.volume_24h ?? null,
		holders: md.holders ?? null,
		sol_usd: solUsd,
		source: md.source,
	};
}

// ── signals ──────────────────────────────────────────────────────────────────

/**
 * The live signal read for one token: bonding-curve or AMM price, smart-money
 * score, dev-dump flag and graduation from the orders engine; the momentum read
 * from the market-data layer; and the Oracle conviction score when the engine
 * has scored the coin.
 */
export async function getMarketSignals({ mint, network = 'mainnet' }) {
	const m = await resolveMint(mint);
	const [{ getSignals }, { readCoin }] = await Promise.all([
		import('../../../workers/agent-orders/market.js'),
		import('../oracle/store.js'),
	]);
	const [sig, market, oracle] = await Promise.all([
		getSignals({ network, mint: m, need: ['smart_money_score', 'dev_dump', 'mcap_usd'] }).catch(() => null),
		fetchTokenMarket(m).catch(() => null),
		network === 'mainnet' ? readCoin(m, network).catch(() => null) : null,
	]);
	const momentum = market && market.price_usd != null ? buildTokenSignal(market) : null;
	const conviction = oracle?.conviction || null;
	return {
		mint: m,
		network,
		launchpad: sig?.signals
			? {
				price_sol: sig.signals.price_sol,
				mcap_sol: sig.signals.mcap_sol,
				mcap_usd: sig.signals.mcap_usd,
				graduated: sig.signals.graduated,
				smart_money_score: sig.signals.smart_money_score,
				dev_dumped: sig.signals.dev_dump,
			}
			: null,
		market: market
			? {
				price_usd: market.price_usd,
				change_24h_pct: market.change_24h,
				liquidity_usd: market.liquidity_usd,
				volume_24h_usd: market.volume_24h_usd,
				market_cap_usd: market.market_cap_usd,
				txns_24h: market.txns_24h || null,
			}
			: null,
		momentum,
		oracle: conviction ? { conviction, reasons: oracle.reasons || [], predicts: oracle.predicts || null } : null,
		sources: [sig?.market ? 'launchpad' : null, market ? 'market' : null, conviction ? 'oracle' : null].filter(Boolean),
	};
}

// ── indicators ───────────────────────────────────────────────────────────────

export const INDICATORS = Object.freeze(['rsi', 'ema', 'sma', 'macd', 'bbands']);

const INTERVALS = Object.freeze({
	'1m': { timeframe: 'minute', aggregate: 1 },
	'5m': { timeframe: 'minute', aggregate: 5 },
	'15m': { timeframe: 'minute', aggregate: 15 },
	'1h': { timeframe: 'hour', aggregate: 1 },
	'4h': { timeframe: 'hour', aggregate: 4 },
	'1d': { timeframe: 'day', aggregate: 1 },
});
export const INDICATOR_INTERVALS = Object.freeze(Object.keys(INTERVALS));

const r6 = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Number(Number(n).toPrecision(8)));

// Moving averages report a value from the first input; only a stable value (a
// full window of data) is a real reading, so everything before it is null.
function stableAdd(ind, value) {
	const out = ind.add(value);
	return ind.isStable ? out : null;
}

/**
 * Compute the requested indicators over a chronological close series. Pure, so
 * it is tested against reference values. Each indicator returns its latest
 * value and the trailing series (aligned to the last `tail` candles).
 *
 * @param {number[]} closes oldest -> newest
 * @param {{ indicators?: string[], period?: number, tail?: number }} [opts]
 */
export function computeIndicators(closes, { indicators = INDICATORS, period = 14, tail = 30 } = {}) {
	const want = new Set(indicators);
	const out = {};
	const keep = (arr) => arr.slice(-tail);

	if (want.has('rsi')) {
		const rsi = new RSI(period);
		const series = closes.map((c) => r6(stableAdd(rsi, c)));
		const last = series.at(-1);
		out.rsi = {
			period,
			value: last,
			state: last == null ? 'insufficient_data' : last >= 70 ? 'overbought' : last <= 30 ? 'oversold' : 'neutral',
			series: keep(series),
		};
	}
	for (const [key, Cls] of [['ema', EMA], ['sma', SMA]]) {
		if (!want.has(key)) continue;
		const fast = new Cls(Math.max(2, Math.round(period * 9 / 14)));
		const slow = new Cls(Math.max(3, Math.round(period * 21 / 14)));
		const fastSeries = closes.map((c) => r6(stableAdd(fast, c)));
		const slowSeries = closes.map((c) => r6(stableAdd(slow, c)));
		const f = fastSeries.at(-1);
		const s = slowSeries.at(-1);
		out[key] = {
			fast_period: fast.interval,
			slow_period: slow.interval,
			fast: f,
			slow: s,
			trend: f == null || s == null ? 'insufficient_data' : f > s ? 'up' : f < s ? 'down' : 'flat',
			fast_series: keep(fastSeries),
			slow_series: keep(slowSeries),
		};
	}
	if (want.has('macd')) {
		const macd = new MACD(new EMA(12), new EMA(26), new EMA(9));
		const series = closes.map((c) => {
			const v = stableAdd(macd, c);
			return v ? { macd: r6(v.macd), signal: r6(v.signal), histogram: r6(v.histogram) } : null;
		});
		const last = series.at(-1);
		out.macd = {
			fast: 12, slow: 26, signal_period: 9,
			...(last || { macd: null, signal: null, histogram: null }),
			bias: !last ? 'insufficient_data' : last.histogram > 0 ? 'bullish' : last.histogram < 0 ? 'bearish' : 'flat',
			series: keep(series),
		};
	}
	if (want.has('bbands')) {
		const bb = new BollingerBands(20, 2);
		const series = closes.map((c) => {
			const v = stableAdd(bb, c);
			return v ? { upper: r6(v.upper), middle: r6(v.middle), lower: r6(v.lower) } : null;
		});
		const last = series.at(-1);
		const close = closes.at(-1);
		out.bbands = {
			period: 20, stddev: 2,
			...(last || { upper: null, middle: null, lower: null }),
			position: !last ? 'insufficient_data' : close > last.upper ? 'above_upper' : close < last.lower ? 'below_lower' : 'inside',
			series: keep(series),
		};
	}
	return out;
}

/**
 * Technical indicators for a token, computed server-side from the OHLCV the
 * charts already pull (GeckoTerminal, Birdeye, CEX rungs) on its deepest pool.
 * @param {{ mint: string, indicators?: string[], interval?: string, period?: number }} args
 */
export async function getIndicators({ mint, indicators = INDICATORS, interval = '1h', period = 14 }) {
	const m = await resolveMint(mint);
	const iv = INTERVALS[interval];
	if (!iv) throw new ToolInputError('invalid_interval', `interval must be one of ${INDICATOR_INTERVALS.join(', ')}.`);
	const list = (Array.isArray(indicators) ? indicators : String(indicators).split(','))
		.map((s) => String(s).trim().toLowerCase())
		.filter(Boolean);
	const bad = list.filter((i) => !INDICATORS.includes(i));
	if (bad.length) throw new ToolInputError('invalid_indicator', `Unknown indicator(s): ${bad.join(', ')}. Use ${INDICATORS.join(', ')}.`);
	const p = Math.max(2, Math.min(100, Math.round(Number(period) || 14)));

	let pool;
	try {
		pool = await topPoolForToken(m);
	} catch {
		throw new ToolInputError('no_market', `No trading pool was found for ${m}, so there are no candles to compute from.`, { mint: m });
	}
	const data = await fetchOhlcv({ pool, timeframe: iv.timeframe, aggregate: iv.aggregate, limit: 300, baseSymbol: m === WSOL_MINT ? 'SOL' : null });
	const candles = data.candles || [];
	if (candles.length < 2) throw new ToolInputError('no_candles', `Not enough price history for ${m} on the ${interval} interval.`, { mint: m });
	const closes = candles.map((c) => c.c);
	const last = candles.at(-1);
	return {
		mint: m,
		pool,
		interval,
		candles: candles.length,
		source: data.source,
		last_close_usd: last.c,
		last_candle_at: new Date(last.t * (last.t < 1e12 ? 1000 : 1)).toISOString(),
		indicators: computeIndicators(closes, { indicators: list.length ? list : INDICATORS, period: p }),
	};
}

// ── news ─────────────────────────────────────────────────────────────────────

/**
 * The aggregated crypto news feed the intelligence surfaces read, optionally
 * filtered to one token. A mint is resolved to its symbol first, since
 * headlines name tickers, not addresses.
 * @param {{ token?: string|null, category?: string|null, limit?: number }} args
 */
export async function getNewsFeed({ token = null, category = null, limit = 15 }) {
	const lim = Math.max(1, Math.min(50, Number(limit) || 15));
	let q = null;
	let resolved = null;
	if (token) {
		const t = String(token).trim().replace(/^\$/, '');
		if (isMint(t)) {
			const hit = await tokenSearch({ query: t, limit: 1, deep: false }).catch(() => null);
			if (!hit?.best?.symbol) throw new ToolInputError('token_not_found', `Could not resolve ${t} to a symbol to search the news for.`);
			resolved = { mint: t, symbol: hit.best.symbol };
			q = hit.best.symbol;
		} else {
			q = t;
		}
	}
	const feed = await getNews({ category: category || undefined, q: q || undefined, limit: lim, curated: true });
	return {
		token: resolved || (q ? { symbol: q } : null),
		total: feed.total,
		sources_ok: feed.sources_ok,
		sources_total: feed.sources_total,
		articles: feed.articles.map((a) => ({
			id: a.id || null,
			title: a.title,
			link: a.link,
			source: a.source || null,
			published_at: a.pub_date || null,
			tickers: a.tickers || [],
			sentiment: a.sentiment ?? null,
			summary: a.description || null,
		})),
	};
}
