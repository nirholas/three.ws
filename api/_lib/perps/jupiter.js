// Perps venue module: Jupiter Perpetuals on Solana, through Jupiter's public
// perps API (https://perps-api.jup.ag/v1, documented at /v1/docs).
//
// Measured against the live API on 2026-10-23, where it differs from the
// published OpenAPI document (the live validator wins):
//   - POST /positions/increase takes marketMint, collateralMint, inputMint,
//     collateralTokenDelta (token base units) and leverage, not the symbol-based
//     body the document shows. It answers with the quote and an unsigned
//     transaction in one call, and there is no separate /quote route.
//   - A long must post the market token as collateral; a short posts USDC.
//   - Three markets exist: SOL, ETH and BTC (the mints below).
//
// Pricing model: Jupiter perps fill at the oracle price plus a price-impact fee
// against the JLP pool, so there is no order book. The interface's `book` is one
// synthetic level per side at the mark, sized by the pool's available liquidity,
// and is marked `synthetic: true`. Funding is a borrow rate paid to the pool, so
// `funding_rate_hourly_pct` is null and the borrow rates ride along as
// `borrow_rate_long_hourly_pct` / `borrow_rate_short_hourly_pct`.
//
// This module never signs. `buildOrderTransaction` returns the venue's unsigned
// transaction; service.js simulates it, signs it with the agent's custodial
// wallet and hands the signed bytes back to `submitSigned`, which lands it
// through the venue's keeper endpoint.

import { perpsError } from './errors.js';
import { num, round, memo, projectPosition } from './venue-common.js';

export const id = 'jupiter';
export const label = 'Jupiter Perpetuals (Solana)';
export const collateral = Object.freeze({ asset: 'USDC', decimals: 6 });
export const chain = 'solana';
export const execution = 'transaction';
export const capabilities = Object.freeze({
	order_types: Object.freeze(['market']),
	conditional_orders: false,
	trader_account: false,
	deposit_withdraw: false,
	cancel: false,
	order_book: false,
});

const BASE = process.env.JUPITER_PERPS_API_URL || 'https://perps-api.jup.ag/v1';
const TIMEOUT_MS = 8_000;
const MARKETS_TTL_MS = 4_000;
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** The system program address: a valid pubkey that owns no positions, used to price an order before a wallet is known. */
const QUOTE_ONLY_WALLET = '11111111111111111111111111111111';

export const MARKETS = Object.freeze({
	SOL: {
		name: 'Solana',
		mint: 'So11111111111111111111111111111111111111112',
		decimals: 9,
		sizeStep: 0.0001,
		sizeDecimals: 4,
		tick: 0.01,
	},
	ETH: {
		name: 'Ether',
		mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
		decimals: 8,
		sizeStep: 0.0001,
		sizeDecimals: 4,
		tick: 0.01,
	},
	BTC: {
		name: 'Bitcoin',
		mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
		decimals: 8,
		sizeStep: 0.00001,
		sizeDecimals: 5,
		tick: 0.01,
	},
});
const MAX_LEVERAGE = 250;

// ── http ─────────────────────────────────────────────────────────────────────

async function call(what, path, { method = 'GET', query = null, body = null } = {}) {
	const url = new URL(BASE + path);
	for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
	let res;
	try {
		res = await fetch(url, {
			method,
			headers: {
				accept: 'application/json',
				...(body ? { 'content-type': 'application/json' } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (err) {
		throw perpsError(
			502,
			'venue_unavailable',
			`Jupiter perps did not answer while trying to ${what}. Nothing was signed; retry in a moment.`,
			{ cause: String(err?.message || err).slice(0, 240) },
		);
	}
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (res.ok) return json;
	const message = json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
	if (res.status >= 400 && res.status < 500) {
		throw perpsError(422, 'venue_rejected', `Jupiter perps refused to ${what}: ${message}`, {
			venue_status: res.status,
			venue_code: json?.code || null,
		});
	}
	throw perpsError(
		502,
		'venue_unavailable',
		`Jupiter perps failed while trying to ${what} (${res.status}). Nothing was signed; retry in a moment.`,
		{ venue_status: res.status },
	);
}

// ── markets ──────────────────────────────────────────────────────────────────

/** Accept "SOL", "sol", "SOL-PERP" and "SOL/USD" for the same market. */
export function normalizeSymbol(symbol) {
	return String(symbol || '')
		.trim()
		.toUpperCase()
		.replace(/[-/](PERP|USD|USDC)$/, '');
}

/** Pure: market-stats plus pool-info rows into the interface's market shape. */
export function normalizeMarket(symbol, stats, pool) {
	const m = MARKETS[symbol];
	const mark = num(stats?.price);
	const feeRate = num(pool?.openFeePercent) != null ? num(pool.openFeePercent) / 100 : null;
	return {
		symbol,
		name: m.name,
		kind: 'crypto',
		status: 'active',
		mark_price: mark,
		index_price: mark,
		change_24h_pct: num(stats?.priceChange24H),
		funding_rate_hourly_pct: null,
		funding_rate_8h_pct: null,
		funding_apr_pct: null,
		borrow_rate_long_hourly_pct: num(pool?.longBorrowRatePercent),
		borrow_rate_short_hourly_pct: num(pool?.shortBorrowRatePercent),
		open_interest: null,
		open_interest_usd: null,
		available_liquidity_long_usd: num(pool?.longAvailableLiquidity),
		available_liquidity_short_usd: num(pool?.shortAvailableLiquidity),
		volume_24h_usd: num(stats?.volume),
		max_leverage: MAX_LEVERAGE,
		initial_margin_rate: round(1 / MAX_LEVERAGE, 8),
		maintenance_margin_rate: round(1 / MAX_LEVERAGE / 2, 8),
		taker_fee_rate: feeRate,
		maker_fee_rate: feeRate,
		min_size: m.sizeStep,
		size_decimals: m.sizeDecimals,
		tick_size_usd: m.tick,
		funding_interval_seconds: 3600,
		isolated_only: true,
		logo_url: null,
	};
}

async function snapshot(symbol) {
	const m = MARKETS[symbol];
	return memo(`jup:${symbol}`, MARKETS_TTL_MS, async () => {
		const [stats, pool] = await Promise.all([
			call('read market stats', '/market-stats', { query: { mint: m.mint } }),
			call('read pool info', '/pool-info', { query: { mint: m.mint } }),
		]);
		return { stats, pool };
	});
}

function requireSymbol(symbol) {
	const sym = normalizeSymbol(symbol);
	if (!MARKETS[sym]) {
		throw perpsError(
			404,
			'unknown_market',
			`No Jupiter perps market "${symbol}". Markets: ${Object.keys(MARKETS).join(', ')}.`,
			{ symbol },
		);
	}
	return sym;
}

export async function listMarkets({ kind = null } = {}) {
	if (kind && kind !== 'crypto') return [];
	const rows = await Promise.all(
		Object.keys(MARKETS).map(async (s) => {
			const { stats, pool } = await snapshot(s);
			return normalizeMarket(s, stats, pool);
		}),
	);
	return rows.sort((a, b) => (b.volume_24h_usd || 0) - (a.volume_24h_usd || 0));
}

export async function getMarket(symbol) {
	const sym = requireSymbol(symbol);
	const { stats, pool } = await snapshot(sym);
	return normalizeMarket(sym, stats, pool);
}

/** Pure: a one-level-per-side book at the oracle mark, sized by the pool's available liquidity. */
export function syntheticBook(market) {
	const mark = market.mark_price;
	const side = (usd) => (mark > 0 && usd > 0 ? [[mark, usd / mark]] : []);
	return {
		...normalizeBookRows({
			bids: side(market.available_liquidity_short_usd),
			asks: side(market.available_liquidity_long_usd),
		}),
		synthetic: true,
		source: 'oracle_price_with_impact_fee',
	};
}

function normalizeBookRows(raw) {
	const lv = (rows) => rows.map(([price, size]) => ({ price, size }));
	const bids = lv(raw.bids);
	const asks = lv(raw.asks);
	const bestBid = bids[0]?.price ?? null;
	const bestAsk = asks[0]?.price ?? null;
	const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
	return {
		slot: null,
		bids,
		asks,
		best_bid: bestBid,
		best_ask: bestAsk,
		mid,
		spread_bps: bestBid != null && bestAsk != null ? 0 : null,
	};
}

export async function getMarketData(symbol) {
	const market = await getMarket(symbol);
	return { market, book: syntheticBook(market), trades: [], funding: [] };
}

// ── account ──────────────────────────────────────────────────────────────────

const usdRaw = (v) => (num(v) == null ? null : num(v) / 1e6);

/** Pure: the venue's /positions rows into the interface's account shape. */
export function normalizeAccount(authority, rows) {
	const positions = (Array.isArray(rows) ? rows : [])
		.map((p) => {
			const sym =
				Object.keys(MARKETS).find((s) => MARKETS[s].mint === p.assetMint) || p.asset;
			const m = MARKETS[sym];
			if (!m) return null;
			const notional = usdRaw(p.sizeUsd) ?? 0;
			const entry = num(p.entryPriceUsd);
			const mark = num(p.markPriceUsd);
			const liq = num(p.liquidationPriceUsd);
			const size = (num(p.sizeTokenAmount) ?? 0) / 10 ** m.decimals;
			const isLong = p.side === 'long';
			return {
				symbol: sym,
				side: isLong ? 'long' : 'short',
				size: round(size, 10),
				signed_size: isLong ? size : -size,
				entry_price: entry,
				mark_price: mark,
				notional_usd: round(notional, 2),
				unrealized_pnl_usd: usdRaw(p.pnlAfterFeesUsd) ?? usdRaw(p.pnlBeforeFeesUsd),
				liquidation_price: liq && liq > 0 ? liq : null,
				liquidation_distance_pct:
					liq && liq > 0 && mark ? round((Math.abs(mark - liq) / mark) * 100, 2) : null,
				initial_margin_usd: usdRaw(p.collateralUsd),
				maintenance_margin_usd: 0,
				funding_accrued_usd:
					usdRaw(p.borrowFeesUsd) == null ? null : -usdRaw(p.borrowFeesUsd),
				unsettled_funding_usd: 0,
				take_profit_price: null,
				stop_loss_price: null,
				position_pubkey: p.positionPubkey,
				collateral_token: p.collateralToken,
				leverage: num(p.leverage),
			};
		})
		.filter(Boolean)
		.sort((a, b) => b.notional_usd - a.notional_usd);
	const collateralUsd = positions.reduce((s, p) => s + (p.initial_margin_usd || 0), 0);
	const upnl = positions.reduce((s, p) => s + (p.unrealized_pnl_usd || 0), 0);
	const notional = positions.reduce((s, p) => s + p.notional_usd, 0);
	const equity = collateralUsd + upnl;
	const nearest = positions.reduce(
		(m, p) =>
			p.liquidation_distance_pct != null ? Math.min(m, p.liquidation_distance_pct) : m,
		Infinity,
	);
	return {
		registered: true,
		authority,
		trader_account: null,
		collateral_usd: round(collateralUsd, 6),
		equity_usd: round(equity, 6),
		withdrawable_usd: 0,
		unrealized_pnl_usd: round(upnl, 6),
		initial_margin_usd: round(collateralUsd, 6),
		maintenance_margin_usd: 0,
		funding_owed_usd: 0,
		notional_usd: round(notional, 2),
		account_leverage: equity > 0 ? round(notional / equity, 3) : 0,
		risk_state: nearest < 5 ? 'at_risk' : 'healthy',
		risk_tier: null,
		positions,
		orders: [],
		conditionals: [],
	};
}

export async function getAccount(authority) {
	const res = await call('read positions', '/positions', { query: { walletAddress: authority } });
	return normalizeAccount(authority, res?.dataList);
}

/** The wallet that owns this venue's positions: the agent's Solana wallet. */
export function accountRef({ wallet }) {
	if (!wallet)
		throw perpsError(
			409,
			'wallet_unsignable',
			'This agent has no Solana wallet, so it has no Jupiter perps positions to read.',
		);
	return wallet;
}

const unsupported = (what) => () => {
	throw perpsError(
		400,
		'not_supported_on_venue',
		`Jupiter perps does not support ${what}. ${what === 'a deposit or withdrawal' ? 'Collateral is posted and returned with each order.' : 'Use a market order.'}`,
		{ venue: id },
	);
};
export const prepareAccount = unsupported('a trader account step');
export const submitPrepare = unsupported('a trader account step');
export const buildDeposit = unsupported('a deposit or withdrawal');
export const buildWithdraw = unsupported('a deposit or withdrawal');
export const buildConditional = unsupported('take-profit or stop-loss orders');
export const buildCancel = unsupported('resting orders');
export const buildCancelConditional = unsupported('take-profit or stop-loss orders');

// ── quote ────────────────────────────────────────────────────────────────────

const clampLeverage = (v, max) => Math.min(max, Math.max(1.1, Number(v) || 2));
const floorTo = (n, dp) => Math.floor(n * 10 ** dp) / 10 ** dp;

/** Pure: the increase request body for a sized order at a leverage. */
export function increaseBody({
	wallet,
	symbol,
	side,
	notionalUsd,
	leverage,
	markPrice,
	slippageBps,
}) {
	const m = MARKETS[symbol];
	const collateralUsd = notionalUsd / leverage;
	const isLong = side === 'long';
	const collateralMint = isLong ? m.mint : USDC_MINT;
	const collateralDecimals = isLong ? m.decimals : 6;
	const collateralTokens = isLong ? collateralUsd / markPrice : collateralUsd;
	return {
		walletAddress: wallet,
		marketMint: m.mint,
		collateralMint,
		inputMint: collateralMint,
		collateralTokenDelta: String(Math.ceil(collateralTokens * 10 ** collateralDecimals)),
		leverage: String(leverage.toFixed(1)),
		maxSlippageBps: String(Math.round(slippageBps)),
		side,
	};
}

export async function quoteOrder({
	symbol,
	side,
	size,
	type,
	reduceOnly = false,
	slippageBps = 100,
	leverage = 2,
	account,
}) {
	const market = await getMarket(symbol);
	if (type !== 'market') {
		throw perpsError(
			400,
			'order_type_unsupported',
			'Jupiter perps takes market orders only. Resting limit orders, take-profit and stop-loss are not available on this venue.',
			{ venue: id, supported: capabilities.order_types },
		);
	}
	const sizeStep = market.min_size;
	const sized = floorTo(Number(size), market.size_decimals);
	if (!(sized >= sizeStep)) {
		throw perpsError(
			400,
			'size_too_small',
			`The smallest ${market.symbol} order is ${sizeStep} ${market.symbol}.`,
			{ min_size: sizeStep },
		);
	}
	const mark = market.mark_price;
	if (!(mark > 0))
		throw perpsError(409, 'no_price', `${market.symbol} has no mark price right now.`);
	const isLong = side === 'long';
	const liquidityUsd = isLong
		? market.available_liquidity_long_usd
		: market.available_liquidity_short_usd;
	const notional = sized * mark;
	if (liquidityUsd != null && notional > liquidityUsd) {
		throw perpsError(
			422,
			'insufficient_liquidity',
			`The Jupiter ${side} pool has $${liquidityUsd.toFixed(0)} of ${market.symbol} liquidity available, less than this $${notional.toFixed(0)} order.`,
			{ fillable_usd: liquidityUsd },
		);
	}
	const existing = account.positions.find((p) => p.symbol === market.symbol) || null;
	const delta = isLong ? sized : -sized;
	const reduces = existing && Math.sign(existing.signed_size) !== Math.sign(delta);
	if (reduceOnly) {
		if (!reduces)
			throw perpsError(
				409,
				'nothing_to_reduce',
				`A reduce-only ${side} needs an open ${isLong ? 'short' : 'long'} ${market.symbol} position to reduce.`,
			);
		if (sized > existing.size + 1e-12)
			throw perpsError(
				409,
				'reduce_exceeds_position',
				`Reduce-only size ${sized} is larger than the open position (${existing.size}).`,
				{ position_size: existing.size },
			);
	}

	const lev = clampLeverage(leverage, market.max_leverage);
	let entry = mark;
	let feeUsd = notional * (market.taker_fee_rate || 0);
	let apiLiq = null;
	let venueParams = null;
	if (!reduces) {
		const body = increaseBody({
			wallet: account.authority || QUOTE_ONLY_WALLET,
			symbol: market.symbol,
			side,
			notionalUsd: notional,
			leverage: lev,
			markPrice: mark,
			slippageBps,
		});
		const res = await call(`quote a ${side} ${market.symbol} order`, '/positions/increase', {
			method: 'POST',
			body,
		});
		const q = res?.quote || {};
		entry = num(q.entryPriceUsd) ?? mark;
		feeUsd = num(q.openFeeUsd) ?? feeUsd;
		apiLiq = num(q.liquidationPriceUsd);
		venueParams = {
			...body,
			walletAddress: undefined,
			quote_leverage: num(q.leverage),
			position_size_usd: num(q.positionSizeUsd),
		};
		if (q.collateralLessThanFees === true) {
			throw perpsError(
				422,
				'collateral_less_than_fees',
				'At this leverage the collateral would not cover the opening fees. Use a larger size.',
				{ fee_usd: feeUsd },
			);
		}
	} else {
		venueParams = {
			position_pubkey: existing.position_pubkey || null,
			close_all: sized >= existing.size - 1e-12,
		};
	}

	const projected = projectPosition({
		size: existing?.signed_size || 0,
		entry: existing?.entry_price || 0,
		delta,
		price: entry,
	});
	const markRef = mark;
	const imBefore = existing
		? (existing.initial_margin_usd ?? (Math.abs(existing.signed_size) * markRef) / lev)
		: 0;
	const marginNew = reduces ? 0 : notional / lev;
	const imAfter = reduces
		? Math.max(
				0,
				imBefore *
					(Math.abs(projected.size) / Math.max(Math.abs(existing.signed_size), 1e-12)),
			)
		: imBefore + marginNew;
	const accountNotionalAfter =
		account.notional_usd -
		(existing ? existing.notional_usd : 0) +
		Math.abs(projected.size) * markRef;
	const equityAfter =
		account.equity_usd +
		(reduces ? 0 : marginNew) -
		feeUsd +
		(reduces ? projected.realized_pnl : 0);
	const fundsUsd = account.funding_available_usd;
	const freeAfter = fundsUsd != null ? fundsUsd - marginNew - feeUsd : equityAfter - imAfter;
	let liquidation = apiLiq;
	if (existing && !reduces && existing.liquidation_price) {
		liquidation =
			apiLiq == null
				? existing.liquidation_price
				: isLong
					? Math.max(apiLiq, existing.liquidation_price)
					: Math.min(apiLiq, existing.liquidation_price);
	} else if (reduces && projected.size !== 0) {
		liquidation = existing.liquidation_price;
	}
	return {
		symbol: market.symbol,
		side,
		type,
		reduce_only: reduceOnly === true,
		size: sized,
		size_text: sized.toFixed(market.size_decimals),
		mark_price: mark,
		index_price: market.index_price,
		entry_price: round(entry, 8),
		limit_price: null,
		crosses_book: true,
		worst_book_price: null,
		slippage_bps: Number(slippageBps),
		notional_usd: round(notional, 4),
		fee_rate: notional > 0 ? round(feeUsd / notional, 8) : market.taker_fee_rate,
		fee_usd: round(feeUsd, 6),
		market_max_leverage: market.max_leverage,
		quote_leverage: lev,
		venue_params: venueParams,
		position_after: {
			side: projected.size > 0 ? 'long' : projected.size < 0 ? 'short' : 'flat',
			size: round(Math.abs(projected.size), 10),
			entry_price: projected.size ? round(projected.entry, 8) : null,
			notional_usd: round(Math.abs(projected.size) * markRef, 4),
			realized_pnl_usd: round(projected.realized_pnl, 6),
		},
		liquidation_price: liquidation && liquidation > 0 ? round(liquidation, 6) : null,
		liquidation_distance_pct:
			liquidation && liquidation > 0
				? round((Math.abs(markRef - liquidation) / markRef) * 100, 3)
				: null,
		margin_impact_usd: round(imAfter - imBefore, 6),
		initial_margin_after_usd: round(imAfter, 6),
		collateral_after_usd: round(account.collateral_usd + marginNew - feeUsd, 6),
		equity_after_usd: round(equityAfter, 6),
		free_collateral_after_usd: round(freeAfter, 6),
		account_notional_after_usd: round(accountNotionalAfter, 4),
		account_leverage_after:
			equityAfter > 0 ? round(accountNotionalAfter / equityAfter, 4) : null,
		risk_increasing: !reduces,
	};
}

// ── execution ────────────────────────────────────────────────────────────────

/**
 * Build the venue's unsigned transaction for a quoted order. An increase posts
 * collateral with the order; a reduction decreases the position and returns the
 * proceeds in USDC.
 * @returns {{ action: string, serializedTxBase64: string, blockhash: string|null, lastValidBlockHeight: number|null }}
 */
export async function buildOrderTransaction(authority, quote) {
	const p = quote.venue_params || {};
	let res;
	let action;
	if (quote.risk_increasing) {
		res = await call(`build the ${quote.side} order`, '/positions/increase', {
			method: 'POST',
			body: {
				...p,
				walletAddress: authority,
				quote_leverage: undefined,
				position_size_usd: undefined,
			},
		});
		action = 'increase-position';
	} else {
		if (!p.position_pubkey)
			throw perpsError(
				409,
				'no_position',
				`There is no open ${quote.symbol} position on Jupiter to reduce.`,
			);
		const sizeUsd = Math.round(quote.notional_usd * 1e6);
		res = await call(`build the ${quote.symbol} reduction`, '/positions/decrease', {
			method: 'POST',
			body: {
				positionPubkey: p.position_pubkey,
				sizeUsdDelta: String(sizeUsd),
				collateralUsdDelta: '0',
				desiredMint: USDC_MINT,
				entirePosition: p.close_all === true,
				maxSlippageBps: String(Math.round(quote.slippage_bps ?? 100)),
			},
		});
		action = 'decrease-position';
	}
	if (!res?.serializedTxBase64)
		throw perpsError(
			502,
			'venue_unavailable',
			'Jupiter perps returned no transaction to sign. Nothing was sent; retry in a moment.',
		);
	return {
		action,
		serializedTxBase64: res.serializedTxBase64,
		blockhash: res.txMetadata?.blockhash ?? null,
		lastValidBlockHeight: res.txMetadata?.lastValidBlockHeight
			? Number(res.txMetadata.lastValidBlockHeight)
			: null,
	};
}

export const buildOrder = buildOrderTransaction;

/** Land a signed transaction through the venue's execute endpoint. */
export async function submitSigned({ action, serializedTxBase64 }) {
	const res = await call('submit the signed transaction', '/transaction/execute', {
		method: 'POST',
		body: { action, serializedTxBase64 },
	});
	if (!res?.txid)
		throw perpsError(
			502,
			'venue_unavailable',
			'Jupiter perps accepted the transaction but returned no signature. Check the wallet before retrying.',
		);
	return { signature: res.txid };
}

/** The orders-engine style health probe: one cheap read that proves the API answers. */
export async function ping() {
	const t0 = Date.now();
	await call('check health', '/jlp-info');
	return { latency_ms: Date.now() - t0 };
}
