// Perps venue module: Hyperliquid perpetuals, read through the keyless public
// info API and traded through a per-agent API wallet.
//
// Hyperliquid is an EVM-style venue, not a Solana program, so it is the
// secondary leg beside the Solana venues (Phoenix, Jupiter). Collateral is USDC
// held in the owner's Hyperliquid account, which the owner funds on Hyperliquid
// itself; the platform never moves it. The agent trades with an API wallet: a
// separate key the owner approves on Hyperliquid, which can place and cancel
// orders but cannot withdraw. See ./hyperliquid-signing.js.
//
// Read paths (markets, books, funding, account) are keyless and live. The
// `buildOrderAction` and `buildCancelAction` builders return the exchange action
// the signing module signs; this module never holds a key.

import { hlInfo } from '../hyperliquid.js';
import { perpsError } from './errors.js';
import { num, round, memo, normalizeBook, estimateFill, projectPosition } from './venue-common.js';
import { formatPrice, formatSize } from './hyperliquid-signing.js';

export const id = 'hyperliquid';
export const label = 'Hyperliquid (API wallet)';
export const collateral = Object.freeze({ asset: 'USDC', decimals: 6 });
export const chain = 'hyperliquid';
export const execution = 'api_wallet';
export const capabilities = Object.freeze({
	order_types: Object.freeze(['market', 'limit']),
	conditional_orders: false,
	trader_account: false,
	deposit_withdraw: false,
	cancel: true,
	order_book: true,
});

const MARKETS_TTL_MS = 4_000;
const BASE_TAKER_FEE = 0.00045;
const BASE_MAKER_FEE = 0.00015;

/** Wrap an info read so a venue failure surfaces as a designed, retryable error. */
async function info(what, body) {
	try {
		return await hlInfo(body);
	} catch (err) {
		throw perpsError(
			502,
			'venue_unavailable',
			`Hyperliquid did not answer while trying to ${what}. Nothing was signed; retry in a moment.`,
			{ cause: String(err?.message || err).slice(0, 240) },
		);
	}
}

/** Accept "BTC", "btc", "BTC-PERP" and "BTC/USD" for the same market. */
export function normalizeSymbol(symbol) {
	return String(symbol || '')
		.trim()
		.replace(/[-/](PERP|USD|USDC)$/i, '');
}

/** Pure: the (meta, assetCtxs) pair into the interface's market rows. */
export function normalizeMarkets(payload) {
	const [meta, ctxs] = Array.isArray(payload) ? payload : [null, []];
	return (meta?.universe || [])
		.map((u, index) => {
			const ctx = ctxs[index] || {};
			const mark = num(ctx.markPx);
			const prev = num(ctx.prevDayPx);
			const oi = num(ctx.openInterest);
			const maxLev = num(u.maxLeverage) || 1;
			return {
				symbol: u.name,
				name: u.name,
				kind: 'crypto',
				status: u.isDelisted ? 'delisted' : 'active',
				mark_price: mark,
				index_price: num(ctx.oraclePx),
				change_24h_pct:
					mark != null && prev ? round(((mark - prev) / prev) * 100, 3) : null,
				funding_rate_hourly_pct:
					num(ctx.funding) != null ? round(num(ctx.funding) * 100, 8) : null,
				funding_rate_8h_pct:
					num(ctx.funding) != null ? round(num(ctx.funding) * 800, 8) : null,
				funding_apr_pct:
					num(ctx.funding) != null ? round(num(ctx.funding) * 24 * 365 * 100, 4) : null,
				open_interest: oi,
				open_interest_usd: oi != null && mark != null ? round(oi * mark, 2) : null,
				volume_24h_usd: num(ctx.dayNtlVlm),
				max_leverage: maxLev,
				initial_margin_rate: round(1 / maxLev, 8),
				maintenance_margin_rate: round(1 / (2 * maxLev), 8),
				taker_fee_rate: BASE_TAKER_FEE,
				maker_fee_rate: BASE_MAKER_FEE,
				min_size: 10 ** -(u.szDecimals ?? 0),
				size_decimals: u.szDecimals ?? 0,
				tick_size_usd: null,
				funding_interval_seconds: 3600,
				isolated_only: u.onlyIsolated === true,
				logo_url: null,
				asset_index: index,
			};
		})
		.filter((m) => m.mark_price != null);
}

async function allMarkets() {
	return memo('hl:markets', MARKETS_TTL_MS, async () =>
		normalizeMarkets(await info('list markets', { type: 'metaAndAssetCtxs' })),
	);
}

export async function listMarkets({ kind = null } = {}) {
	if (kind && kind !== 'crypto') return [];
	const rows = (await allMarkets()).filter((m) => m.status === 'active');
	return rows
		.map(({ asset_index: _i, ...m }) => m)
		.sort((a, b) => (b.volume_24h_usd || 0) - (a.volume_24h_usd || 0));
}

async function marketRow(symbol) {
	const sym = normalizeSymbol(symbol).toLowerCase();
	const row = (await allMarkets()).find((m) => m.symbol.toLowerCase() === sym);
	if (!row)
		throw perpsError(
			404,
			'unknown_market',
			`No Hyperliquid perps market "${symbol}". Call perps_markets for the list.`,
			{ symbol },
		);
	return row;
}

export async function getMarket(symbol) {
	const { asset_index: _i, ...market } = await marketRow(symbol);
	return market;
}

/** Pure: Hyperliquid l2Book levels into the interface's book. */
export function normalizeL2(raw, depth = 20) {
	const [bids, asks] = raw?.levels || [[], []];
	const rows = (levels) => (levels || []).map((l) => [Number(l.px), Number(l.sz)]);
	return {
		...normalizeBook({ bids: rows(bids), asks: rows(asks), slot: raw?.time ?? null }, depth),
		synthetic: false,
	};
}

export async function getMarketData(symbol, { depth = 20, trades = 30, funding = 48 } = {}) {
	const market = await getMarket(symbol);
	const [book, fills, history] = await Promise.all([
		info('read the order book', { type: 'l2Book', coin: market.symbol }),
		trades > 0
			? info('read recent trades', { type: 'recentTrades', coin: market.symbol })
			: null,
		funding > 0
			? info('read funding history', {
					type: 'fundingHistory',
					coin: market.symbol,
					startTime: Date.now() - funding * 3_600_000,
				})
			: null,
	]);
	return {
		market,
		book: normalizeL2(book, depth),
		trades: (Array.isArray(fills) ? fills : []).slice(0, trades).map((t) => ({
			price: Number(t.px),
			size: Number(t.sz),
			side: t.side === 'B' ? 'buy' : 'sell',
			time: new Date(Number(t.time)).toISOString(),
			signature: t.hash && !/^0x0+$/.test(t.hash) ? t.hash : null,
		})),
		funding: (Array.isArray(history) ? history : [])
			.map((r) => ({
				time: new Date(Number(r.time)).toISOString(),
				rate_hourly_pct: round(Number(r.fundingRate) * 100, 8),
			}))
			.filter((r) => Number.isFinite(r.rate_hourly_pct)),
	};
}

// ── account ──────────────────────────────────────────────────────────────────

/** Pure: clearinghouseState plus open orders into the interface's account shape. */
export function normalizeAccount(authority, state, openOrders = [], marks = new Map()) {
	const positions = (state?.assetPositions || [])
		.map(({ position: p }) => {
			const signed = num(p?.szi) || 0;
			if (signed === 0) return null;
			const size = Math.abs(signed);
			const mark =
				marks.get(p.coin) ?? (num(p.positionValue) ? num(p.positionValue) / size : null);
			const liq = num(p.liquidationPx);
			return {
				symbol: p.coin,
				side: signed > 0 ? 'long' : 'short',
				size,
				signed_size: signed,
				entry_price: num(p.entryPx),
				mark_price: mark,
				notional_usd: round(num(p.positionValue) ?? size * (mark || 0), 2),
				unrealized_pnl_usd: round(num(p.unrealizedPnl), 4),
				liquidation_price: liq && liq > 0 ? liq : null,
				liquidation_distance_pct:
					liq && liq > 0 && mark ? round((Math.abs(mark - liq) / mark) * 100, 2) : null,
				initial_margin_usd: round(num(p.marginUsed), 4),
				maintenance_margin_usd: null,
				funding_accrued_usd: round(-(num(p.cumFunding?.sinceOpen) || 0), 4),
				unsettled_funding_usd: 0,
				take_profit_price: null,
				stop_loss_price: null,
				leverage: num(p.leverage?.value),
				margin_mode: p.leverage?.type || null,
			};
		})
		.filter(Boolean)
		.sort((a, b) => b.notional_usd - a.notional_usd);

	const orders = [];
	const conditionals = [];
	for (const o of openOrders) {
		const side = o.side === 'B' ? 'buy' : 'sell';
		if (o.isTrigger) {
			const kind = /take profit/i.test(o.orderType || '') ? 'take_profit' : 'stop_loss';
			conditionals.push({
				id: String(o.oid),
				symbol: o.coin,
				kind,
				trigger_price: num(o.triggerPx),
				execution_price: num(o.limitPx),
				side,
				status: 'open',
				cancellable: true,
			});
		} else {
			orders.push({
				id: String(o.oid),
				symbol: o.coin,
				side,
				price: num(o.limitPx),
				price_ticks: null,
				size_remaining: num(o.sz),
				reduce_only: o.reduceOnly === true,
				type: 'limit',
				status: 'open',
			});
		}
	}
	const cross = state?.crossMarginSummary || state?.marginSummary || {};
	const equity = num(cross.accountValue) ?? 0;
	const notional = num(cross.totalNtlPos) ?? positions.reduce((s, p) => s + p.notional_usd, 0);
	const mm = num(state?.crossMaintenanceMarginUsed) ?? 0;
	const im = num(cross.totalMarginUsed) ?? 0;
	const nearest = positions.reduce(
		(m, p) =>
			p.liquidation_distance_pct != null ? Math.min(m, p.liquidation_distance_pct) : m,
		Infinity,
	);
	return {
		registered: true,
		authority,
		trader_account: authority,
		collateral_usd: round(num(cross.totalRawUsd) ?? equity, 6),
		equity_usd: round(equity, 6),
		withdrawable_usd: round(num(state?.withdrawable) ?? 0, 6),
		unrealized_pnl_usd: round(
			positions.reduce((s, p) => s + (p.unrealized_pnl_usd || 0), 0),
			6,
		),
		initial_margin_usd: round(im, 6),
		maintenance_margin_usd: round(mm, 6),
		funding_owed_usd: 0,
		notional_usd: round(notional, 2),
		account_leverage: equity > 0 ? round(notional / equity, 3) : 0,
		risk_state: nearest < 5 ? 'at_risk' : 'healthy',
		risk_tier: null,
		positions,
		orders,
		conditionals,
	};
}

export async function getAccount(address) {
	if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) {
		throw perpsError(
			400,
			'invalid_venue_account',
			'The Hyperliquid account must be a 0x address.',
		);
	}
	const [state, open, markets] = await Promise.all([
		info('read the account', { type: 'clearinghouseState', user: address }),
		info('read open orders', { type: 'frontendOpenOrders', user: address }),
		allMarkets(),
	]);
	return normalizeAccount(
		address,
		state,
		Array.isArray(open) ? open : [],
		new Map(markets.map((m) => [m.symbol, m.mark_price])),
	);
}

/** The Hyperliquid account this agent trades: the owner's address, stored on the agent. */
export function accountRef({ meta }) {
	const address = meta?.hyperliquid?.account;
	if (!address) {
		throw perpsError(
			409,
			'venue_account_missing',
			'This agent has no Hyperliquid account linked. Link the owner address and approve the agent API wallet first (docs/perps.md, Hyperliquid setup).',
			{ venue: id },
		);
	}
	return address;
}

const unsupported = (what) => () => {
	throw perpsError(
		400,
		'not_supported_on_venue',
		`Hyperliquid through three.ws does not support ${what}. ${what === 'a deposit or withdrawal' ? 'Fund and withdraw on Hyperliquid itself; the agent API wallet cannot move funds.' : 'Use a market or limit order.'}`,
		{ venue: id },
	);
};
export const prepareAccount = unsupported('a trader account step');
export const submitPrepare = unsupported('a trader account step');
export const buildDeposit = unsupported('a deposit or withdrawal');
export const buildWithdraw = unsupported('a deposit or withdrawal');
export const buildConditional = unsupported('take-profit or stop-loss orders');
export const buildCancelConditional = unsupported('take-profit or stop-loss orders');

// ── quote ────────────────────────────────────────────────────────────────────

/**
 * Pure: cross-margin liquidation price. Hyperliquid's documented formula:
 * liq = price - side * available / size / (1 - side * mmr), where `available` is
 * the account value left after the maintenance margin of every open position.
 */
export function liquidationPrice({ price, signedSize, equity, maintenanceTotal, mmr }) {
	if (!signedSize || !(price > 0)) return null;
	const side = signedSize > 0 ? 1 : -1;
	const available = equity - maintenanceTotal;
	const liq = price - (side * available) / Math.abs(signedSize) / (1 - side * mmr);
	return liq > 0 ? liq : null;
}

async function feeRates(address) {
	if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
		return { taker: BASE_TAKER_FEE, maker: BASE_MAKER_FEE };
	try {
		const fees = await hlInfo({ type: 'userFees', user: address });
		const taker = num(fees?.userCrossRate);
		const maker = num(fees?.userAddRate);
		if (taker != null && maker != null) return { taker, maker };
	} catch {
		// Fall back to the public base tier: a fee read never blocks a quote.
	}
	return { taker: BASE_TAKER_FEE, maker: BASE_MAKER_FEE };
}

export async function quoteOrder({
	symbol,
	side,
	size,
	type,
	price = null,
	reduceOnly = false,
	slippageBps = 100,
	account,
}) {
	const row = await marketRow(symbol);
	if (row.status !== 'active')
		throw perpsError(
			409,
			'market_inactive',
			`${row.symbol} is ${row.status} on Hyperliquid right now.`,
			{ status: row.status },
		);
	if (!capabilities.order_types.includes(type)) {
		throw perpsError(
			400,
			'order_type_unsupported',
			`Hyperliquid takes ${capabilities.order_types.join(' and ')} orders here, not ${type}.`,
			{ venue: id },
		);
	}
	const sizeText = formatSize(size, row.size_decimals);
	const sized = Number(sizeText);
	if (!(sized > 0))
		throw perpsError(
			400,
			'size_too_small',
			`The smallest ${row.symbol} order is ${row.min_size} ${row.symbol}.`,
			{ min_size: row.min_size },
		);
	const book = normalizeL2(
		await info('read the order book', { type: 'l2Book', coin: row.symbol }),
		100,
	);
	const isLong = side === 'long';
	const mark = row.mark_price ?? book.mid;
	const fees = await feeRates(account.authority);

	let entry;
	let feeRate;
	let limitPrice;
	let crossesBook = true;
	let fill = null;
	if (type === 'market') {
		fill = estimateFill(isLong ? book.asks : book.bids, sized);
		if (!fill.complete)
			throw perpsError(
				422,
				'insufficient_liquidity',
				`The visible ${row.symbol} book cannot fill ${sized} right now (only ${fill.filled}). Use a smaller size or a limit order.`,
				{ fillable: fill.filled },
			);
		entry = fill.avg_price;
		feeRate = fees.taker;
		const slip = Math.max(0, Number(slippageBps) || 0) / 10_000;
		limitPrice = Number(
			formatPrice(
				isLong ? fill.worst_price * (1 + slip) : fill.worst_price * (1 - slip),
				row.size_decimals,
			),
		);
	} else {
		if (!(Number(price) > 0))
			throw perpsError(400, 'price_required', 'A limit order needs a positive price.');
		limitPrice = Number(formatPrice(price, row.size_decimals));
		entry = limitPrice;
		crossesBook = isLong
			? book.best_ask != null && limitPrice >= book.best_ask
			: book.best_bid != null && limitPrice <= book.best_bid;
		feeRate = crossesBook ? fees.taker : fees.maker;
	}

	const notional = sized * entry;
	const fee = notional * feeRate;
	const existing = account.positions.find((p) => p.symbol === row.symbol) || null;
	const delta = isLong ? sized : -sized;
	if (reduceOnly) {
		if (!existing || Math.sign(existing.signed_size) === Math.sign(delta)) {
			throw perpsError(
				409,
				'nothing_to_reduce',
				`A reduce-only ${side} needs an open ${isLong ? 'short' : 'long'} ${row.symbol} position to reduce.`,
			);
		}
		if (sized > existing.size + 1e-12)
			throw perpsError(
				409,
				'reduce_exceeds_position',
				`Reduce-only size ${sized} is larger than the open position (${existing.size}).`,
				{ position_size: existing.size },
			);
	}
	const projected = projectPosition({
		size: existing?.signed_size || 0,
		entry: existing?.entry_price || 0,
		delta,
		price: entry,
	});
	const markRef = mark || entry;
	const imBefore = existing ? (Math.abs(existing.signed_size) * markRef) / row.max_leverage : 0;
	const imAfter = (Math.abs(projected.size) * markRef) / row.max_leverage;
	const accountNotionalAfter =
		account.notional_usd -
		(existing ? existing.notional_usd : 0) +
		Math.abs(projected.size) * markRef;
	const equityAfter = account.equity_usd - fee + projected.realized_pnl;
	const initialMarginAfter = account.initial_margin_usd - imBefore + imAfter;
	const mmr = row.maintenance_margin_rate;
	const otherMm = Math.max(
		0,
		account.maintenance_margin_usd -
			(existing ? Math.abs(existing.signed_size) * markRef * mmr : 0),
	);
	const liq =
		projected.size !== 0
			? liquidationPrice({
					price: markRef,
					signedSize: projected.size,
					equity: equityAfter,
					maintenanceTotal: otherMm + Math.abs(projected.size) * markRef * mmr,
					mmr,
				})
			: null;
	return {
		symbol: row.symbol,
		side,
		type,
		reduce_only: reduceOnly === true,
		size: sized,
		size_text: sizeText,
		mark_price: mark,
		index_price: row.index_price,
		entry_price: round(entry, 8),
		limit_price: limitPrice,
		crosses_book: crossesBook,
		worst_book_price: fill?.worst_price ?? null,
		slippage_bps: type === 'market' ? Number(slippageBps) : null,
		notional_usd: round(notional, 4),
		fee_rate: feeRate,
		fee_usd: round(fee, 6),
		market_max_leverage: row.max_leverage,
		venue_params: { asset_index: row.asset_index, sz_decimals: row.size_decimals },
		position_after: {
			side: projected.size > 0 ? 'long' : projected.size < 0 ? 'short' : 'flat',
			size: round(Math.abs(projected.size), 10),
			entry_price: projected.size ? round(projected.entry, 8) : null,
			notional_usd: round(Math.abs(projected.size) * markRef, 4),
			realized_pnl_usd: round(projected.realized_pnl, 6),
		},
		liquidation_price: liq ? round(liq, 6) : null,
		liquidation_distance_pct:
			liq && markRef ? round((Math.abs(markRef - liq) / markRef) * 100, 3) : null,
		margin_impact_usd: round(imAfter - imBefore, 6),
		initial_margin_after_usd: round(initialMarginAfter, 6),
		collateral_after_usd: round(account.collateral_usd - fee + projected.realized_pnl, 6),
		equity_after_usd: round(equityAfter, 6),
		free_collateral_after_usd: round(equityAfter - initialMarginAfter, 6),
		account_notional_after_usd: round(accountNotionalAfter, 4),
		account_leverage_after:
			equityAfter > 0 ? round(accountNotionalAfter / equityAfter, 4) : null,
		risk_increasing:
			Math.abs(projected.size) > Math.abs(existing?.signed_size || 0) + 1e-12 ||
			(existing &&
				Math.sign(projected.size) !== Math.sign(existing.signed_size) &&
				projected.size !== 0),
	};
}

// ── actions ──────────────────────────────────────────────────────────────────

/** Pure: the exchange action for a quoted order. Key order is part of the signed bytes. */
export function buildOrderAction(quote) {
	const { asset_index: assetIndex, sz_decimals: szDecimals } = quote.venue_params || {};
	if (!Number.isInteger(assetIndex))
		throw perpsError(
			500,
			'quote_incomplete',
			'The quote carries no Hyperliquid asset index. Preview the order again.',
		);
	return {
		type: 'order',
		orders: [
			{
				a: assetIndex,
				b: quote.side === 'long',
				p: formatPrice(quote.limit_price, szDecimals),
				s: quote.size_text,
				r: quote.reduce_only === true,
				t: { limit: { tif: quote.type === 'market' ? 'Ioc' : 'Gtc' } },
			},
		],
		grouping: 'na',
	};
}

export const buildOrder = async (_ref, quote) => buildOrderAction(quote);

/** Pure: the exchange action that cancels one resting order. */
export function buildCancelAction({ assetIndex, orderId }) {
	return { type: 'cancel', cancels: [{ a: assetIndex, o: Number(orderId) }] };
}

export async function buildCancel(_ref, { symbol, orderId }) {
	const row = await marketRow(symbol);
	return buildCancelAction({ assetIndex: row.asset_index, orderId });
}

/**
 * Pure: read Hyperliquid's answer to an order. Returns the fill or resting
 * state, or throws the venue's own refusal reason.
 */
export function parseOrderResponse(res) {
	if (res?.status !== 'ok') {
		throw perpsError(
			422,
			'venue_rejected',
			`Hyperliquid refused the request: ${typeof res?.response === 'string' ? res.response : JSON.stringify(res?.response ?? res).slice(0, 240)}`,
			{ venue: id },
		);
	}
	const status = res.response?.data?.statuses?.[0];
	if (status?.error)
		throw perpsError(422, 'venue_rejected', `Hyperliquid refused the order: ${status.error}`, {
			venue: id,
		});
	if (status?.filled)
		return {
			state: 'filled',
			order_id: String(status.filled.oid),
			filled_size: Number(status.filled.totalSz),
			avg_price: Number(status.filled.avgPx),
		};
	if (status?.resting) return { state: 'resting', order_id: String(status.resting.oid) };
	return { state: 'accepted', order_id: null };
}

export async function ping() {
	const t0 = Date.now();
	await hlInfo({ type: 'meta' });
	return { latency_ms: Date.now() - t0 };
}

/** API wallets the owner has approved on this account (address + name + expiry). */
export async function listApprovedApiWallets(account) {
	const rows = await info('read approved API wallets', { type: 'extraAgents', user: account });
	return (Array.isArray(rows) ? rows : []).map((r) => ({
		address: String(r.address || '').toLowerCase(),
		name: r.name ?? null,
		valid_until: r.validUntil ?? null,
	}));
}
