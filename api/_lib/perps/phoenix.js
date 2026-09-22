// Perps venue module: an on-chain central-limit-order-book perpetuals exchange on
// Solana, integrated through its maintained TypeScript SDK (@ellipsis-labs/rise).
//
// Why this venue (recorded 2026-09-22, see docs/perps.md "Venue selection"): a
// fully on-chain order book program with a maintained SDK published within the
// last 90 days, deep open interest on the SOL and BTC markets, and trader
// accounts any wallet can open through the public registration endpoint (no
// invite code). Every instruction built here was verified against mainnet with
// simulateTransaction before it shipped.
//
// This module implements the contract in ./index.js. It never signs: it reads
// venue state and returns web3.js instructions; service.js signs them with the
// agent's custodial wallet on the audited path.
//
// Margin model: every agent trades CROSS margin on trader subaccount 0. One
// collateral balance backs every position, the venue computes liquidation per
// position against the whole account, and the platform's risk guards bound the
// account's effective leverage (total notional over equity) rather than a
// per-order leverage knob the program does not have in cross mode.

import {
	createPhoenixClient,
	Side,
	OrderFlags,
	priceUsdToTicksWithMarketParams,
	ticksToUsdWithMarketParams,
	calculateLiquidationPriceUsd,
	PhoenixHttpError,
} from '@ellipsis-labs/rise';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { solanaRpcEndpoints, isEndpointCooling } from '../solana/connection.js';
import { perpsError } from './errors.js';

export const id = 'phoenix';
export const label = 'Solana on-chain order book';
export const collateral = Object.freeze({ asset: 'USDC', decimals: 6 });

const QUOTE_UNITS_PER_USD = 1_000_000;
const TRADER_PDA_INDEX = 0;
const CROSS_SUBACCOUNT = 0;
const MARKETS_TTL_MS = 60_000;
const STATS_TTL_MS = 4_000;
// Stop-loss triggers fire as immediate-or-cancel orders; this is how far past
// the trigger they may fill before the venue refuses the fill.
export const STOP_LOSS_SLIPPAGE_BPS = 300;

// ── client ───────────────────────────────────────────────────────────────────

let _client = null;
let _clientRpc = null;

/**
 * The SDK takes one RPC URL rather than our rotating Connection, so hand it the
 * first mainnet lane that is not cooling down, and rebuild the client when the
 * lane it holds starts cooling. Market data, order books and account views come
 * from the venue's HTTP API; RPC is only read for exchange metadata fallback.
 */
function client() {
	const lanes = solanaRpcEndpoints('mainnet');
	const rpcUrl = lanes.find((u) => !isEndpointCooling(u)) || lanes[0];
	if (!_client || _clientRpc !== rpcUrl) {
		_client?.dispose?.();
		_client = createPhoenixClient({ ws: false, rpcUrl, pdaCache: { maxEntries: 2048 } });
		_clientRpc = rpcUrl;
	}
	return _client;
}

// ── small helpers ────────────────────────────────────────────────────────────

const _memo = new Map();
async function memo(key, ttlMs, fn) {
	const hit = _memo.get(key);
	if (hit && (hit.promise || Date.now() - hit.at < ttlMs)) return hit.promise || hit.value;
	const promise = fn().then(
		(value) => {
			_memo.set(key, { at: Date.now(), value });
			return value;
		},
		(err) => {
			if (hit?.value !== undefined) _memo.set(key, hit);
			else _memo.delete(key);
			throw err;
		},
	);
	_memo.set(key, { ...(hit || {}), promise });
	return promise;
}

const num = (v) => {
	if (v == null || v === '') return null;
	const n = typeof v === 'object' && v !== null && 'ui' in v ? Number(v.ui) : Number(v);
	return Number.isFinite(n) ? n : null;
};

const round = (n, dp = 6) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);

/** Map a venue HTTP failure to a PerpsError: 4xx is a refusal, anything else is an outage. */
async function venueCall(what, fn) {
	try {
		return await fn();
	} catch (err) {
		if (err?.code && err?.status && err.name === 'PerpsError') throw err;
		const status = Number(err?.status);
		const venueMessage = (err?.body && typeof err.body === 'object' && err.body.error) || null;
		if (err instanceof PhoenixHttpError && status >= 400 && status < 500) {
			throw perpsError(422, 'venue_rejected', `The venue refused to ${what}: ${venueMessage || err.message}`, { venue_status: status });
		}
		throw perpsError(502, 'venue_unavailable', `The venue did not answer while trying to ${what}. Nothing was signed; retry in a moment.`, {
			cause: String(venueMessage || err?.message || err).slice(0, 240),
		});
	}
}

function isNotFound(err) {
	return err instanceof PhoenixHttpError && Number(err.status) === 404;
}

/** Convert an SDK (@solana/kit) instruction into a web3.js TransactionInstruction. */
export function toWeb3Instruction(ix) {
	// @solana/kit AccountRole: 0 READONLY, 1 WRITABLE, 2 READONLY_SIGNER, 3 WRITABLE_SIGNER.
	return new TransactionInstruction({
		programId: new PublicKey(ix.programAddress),
		keys: (ix.accounts || []).map((a) => ({
			pubkey: new PublicKey(a.address),
			isSigner: a.role >= 2,
			isWritable: a.role === 1 || a.role === 3,
		})),
		data: Buffer.from(ix.data || []),
	});
}

/** Convert the registration endpoint's JSON instruction shape into web3.js. */
function registerIxToWeb3(ix) {
	return new TransactionInstruction({
		programId: new PublicKey(ix.programId),
		keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
		data: Buffer.from(ix.data),
	});
}

// ── markets ──────────────────────────────────────────────────────────────────

/** Classify a market by what its contract references. */
export function marketKind(config) {
	const calendar = String(config?.metadata?.calendar?.id || '').toLowerCase();
	if (calendar.includes('equit')) return 'equity';
	if (config?.commodityMetadata?.isCommodity) return 'commodity';
	return 'crypto';
}

/** Market parameters the order math needs, read off one market config. */
export function marketParams(config) {
	const tiers = Array.isArray(config.leverageTiers) ? config.leverageTiers : [];
	const decimals = Number(config.baseLotsDecimals);
	return {
		symbol: config.symbol,
		tickSize: Number(config.tickSize),
		baseLotsDecimals: decimals,
		sizeStep: 10 ** -decimals,
		tickUsd: (Number(config.tickSize) * 10 ** decimals) / QUOTE_UNITS_PER_USD,
		takerFee: Number(config.takerFee),
		makerFee: Number(config.makerFee),
		maxLeverage: Number(tiers[0]?.maxLeverage) || 1,
		maintenanceBps: Number(config.riskFactors?.maintenanceBps) || 5000,
		status: config.marketStatus,
	};
}

/** Pure: one venue market config plus its latest stats row, as the interface's market shape. */
export function normalizeMarket(config, stats) {
	const p = marketParams(config);
	const mark = num(stats?.mark_price);
	const prev = num(stats?.prev_day_mark_price);
	const oi = num(stats?.open_interest);
	return {
		symbol: config.symbol,
		name: config.metadata?.name || config.symbol,
		kind: marketKind(config),
		status: config.marketStatus,
		mark_price: mark,
		index_price: num(stats?.oracle_price),
		change_24h_pct: mark != null && prev ? round(((mark - prev) / prev) * 100, 3) : null,
		funding_rate_hourly_pct: num(stats?.current_funding_rate),
		funding_rate_8h_pct: num(stats?.eight_hour_funding_rate),
		funding_apr_pct: num(stats?.annualized_funding_rate),
		open_interest: oi,
		open_interest_usd: oi != null && mark != null ? round(oi * mark, 2) : null,
		volume_24h_usd: num(stats?.day_volume_usd),
		max_leverage: p.maxLeverage,
		taker_fee_rate: p.takerFee,
		maker_fee_rate: p.makerFee,
		min_size: p.sizeStep,
		size_decimals: p.baseLotsDecimals,
		tick_size_usd: round(p.tickUsd, 10),
		funding_interval_seconds: Number(config.fundingIntervalSeconds) || 3600,
		isolated_only: config.isolatedOnly === true,
		logo_url: config.metadata?.logoUri || null,
	};
}

async function marketConfigs() {
	return memo('configs', MARKETS_TTL_MS, () => venueCall('list markets', () => client().api.markets().getMarkets()));
}

async function marketStats() {
	return memo('stats', STATS_TTL_MS, async () => {
		const res = await venueCall('read market stats', () => client().api.markets().getLatestMarketsStats());
		return new Map((res.markets || []).map((s) => [s.symbol, s]));
	});
}

async function configFor(symbol) {
	const sym = normalizeSymbol(symbol);
	const config = (await marketConfigs()).find((m) => m.symbol === sym);
	if (!config) {
		throw perpsError(404, 'unknown_market', `No perps market "${symbol}". Call perps_markets for the list.`, { symbol });
	}
	return config;
}

/** Accept "SOL", "sol", "SOL-PERP" and "SOL/USD" for the same market. */
export function normalizeSymbol(symbol) {
	return String(symbol || '')
		.trim()
		.toUpperCase()
		.replace(/[-/](PERP|USD|USDC)$/, '');
}

export async function listMarkets({ kind = null } = {}) {
	const [configs, stats] = await Promise.all([marketConfigs(), marketStats()]);
	return configs
		.filter((c) => c.marketStatus !== 'closed')
		.map((c) => normalizeMarket(c, stats.get(c.symbol)))
		.filter((m) => !kind || m.kind === kind)
		.sort((a, b) => (b.volume_24h_usd || 0) - (a.volume_24h_usd || 0));
}

export async function getMarket(symbol) {
	const config = await configFor(symbol);
	const stats = await marketStats();
	return { ...normalizeMarket(config, stats.get(config.symbol)), params: marketParams(config) };
}

// ── market data ──────────────────────────────────────────────────────────────

/** Pure: venue book levels ([price, size][]) into the interface's book shape. */
export function normalizeBook(raw, depth = 20) {
	const toLevels = (rows) =>
		(Array.isArray(rows) ? rows : [])
			.slice(0, depth)
			.map(([price, size]) => ({ price: Number(price), size: Number(size) }))
			.filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0);
	const bids = toLevels(raw?.bids);
	const asks = toLevels(raw?.asks);
	const bestBid = bids[0]?.price ?? null;
	const bestAsk = asks[0]?.price ?? null;
	const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
	return {
		slot: raw?.slot ?? null,
		bids,
		asks,
		best_bid: bestBid,
		best_ask: bestAsk,
		mid,
		spread_bps: bestBid != null && bestAsk != null && mid ? round(((bestAsk - bestBid) / mid) * 10_000, 2) : null,
	};
}

/**
 * Pure: walk one side of a book to fill `size` base units.
 * @param {{price:number,size:number}[]} levels best price first
 */
export function estimateFill(levels, size) {
	let remaining = size;
	let notional = 0;
	let worst = null;
	for (const l of levels) {
		if (remaining <= 0) break;
		const take = Math.min(remaining, l.size);
		notional += take * l.price;
		remaining -= take;
		worst = l.price;
	}
	const filled = size - Math.max(0, remaining);
	return {
		filled: round(filled, 10),
		complete: remaining <= 1e-12,
		avg_price: filled > 0 ? notional / filled : null,
		worst_price: worst,
		notional_usd: notional,
	};
}

async function orderbook(symbol, depth = 50) {
	const config = await configFor(symbol);
	const raw = await venueCall('read the order book', () => client().api.orderbook().getOrderbook(config.symbol));
	return normalizeBook(raw, depth);
}

/** Pure: venue fill rows into trades. A positive base quantity is a taker buy. */
export function normalizeTrades(rows) {
	return (Array.isArray(rows) ? rows : []).map((f) => {
		const base = Number(f.baseQty);
		return {
			price: Number(f.price),
			size: Math.abs(base),
			side: base >= 0 ? 'buy' : 'sell',
			time: new Date(Number(f.timestamp)).toISOString(),
			signature: f.transactionSignature || null,
		};
	});
}

/** Pure: venue funding history rows (seconds + percent strings) into funding points. */
export function normalizeFunding(rows) {
	return (Array.isArray(rows) ? rows : [])
		.map((r) => ({ time: new Date(Number(r.timestamp) * 1000).toISOString(), rate_hourly_pct: Number(r.fundingRatePercentage) }))
		.filter((r) => Number.isFinite(r.rate_hourly_pct));
}

export async function getMarketData(symbol, { depth = 20, trades = 30, funding = 48 } = {}) {
	const market = await getMarket(symbol);
	const [book, fills, fundingHistory] = await Promise.all([
		orderbook(market.symbol, depth),
		venueCall('read recent trades', () => client().api.trades().getMarketFills(market.symbol, { limit: trades })),
		venueCall('read funding history', () => client().api.funding().getFundingRateHistory(market.symbol, { limit: funding })),
	]);
	const { params, ...pub } = market;
	return {
		market: pub,
		book,
		trades: normalizeTrades(fills?.data),
		funding: normalizeFunding(fundingHistory?.rates),
	};
}

// ── account ──────────────────────────────────────────────────────────────────

const sideOf = (v) => {
	const s = String(v).toLowerCase();
	return s === '0' || s.includes('bid') || s.includes('buy') ? 'buy' : 'sell';
};

/**
 * Pure: the venue's trader view (computed margin, PnL, liquidation per position)
 * plus the raw state snapshot (orders with exact ticks, conditional triggers),
 * as the interface's account shape.
 */
export function normalizeAccount({ authority, traderAccount, view, snapshot, marks = new Map(), configs = [] }) {
	const bySymbol = new Map(configs.map((c) => [c.symbol, c]));
	const sub = snapshot?.snapshot?.subaccounts?.find((s) => s.subaccountIndex === CROSS_SUBACCOUNT) || null;

	const positions = (view?.positions || [])
		.map((p) => {
			const signed = num(p.positionSize) || 0;
			if (signed === 0) return null;
			const mark = marks.get(p.symbol) ?? null;
			const size = Math.abs(signed);
			const liq = num(p.liquidationPrice);
			return {
				symbol: p.symbol,
				side: signed > 0 ? 'long' : 'short',
				size,
				signed_size: signed,
				entry_price: num(p.entryPrice),
				mark_price: mark,
				notional_usd: round(size * (mark ?? num(p.entryPrice) ?? 0), 2),
				unrealized_pnl_usd: round(num(p.unrealizedPnl), 4),
				liquidation_price: liq && liq > 0 ? liq : null,
				liquidation_distance_pct: liq && liq > 0 && mark ? round((Math.abs(mark - liq) / mark) * 100, 2) : null,
				initial_margin_usd: round(num(p.initialMargin), 4),
				maintenance_margin_usd: round(num(p.maintenanceMargin), 4),
				funding_accrued_usd: round(num(p.accumulatedFunding), 4),
				unsettled_funding_usd: round(num(p.unsettledFunding), 4),
				take_profit_price: num(p.takeProfitPrice) || null,
				stop_loss_price: num(p.stopLossPrice) || null,
			};
		})
		.filter(Boolean)
		.sort((a, b) => b.notional_usd - a.notional_usd);

	const orders = [];
	for (const group of sub?.orders || []) {
		for (const o of group.orders || []) {
			orders.push({
				id: String(o.orderSequenceNumber),
				symbol: group.symbol,
				side: sideOf(o.side),
				price: num(o.priceUsd),
				price_ticks: String(o.priceTicks),
				size_remaining: num(o.sizeRemainingUnits),
				reduce_only: o.reduceOnly === true,
				type: o.isConditionalOrder ? 'conditional' : o.isStopLoss ? 'stop' : 'limit',
				status: o.status || 'open',
			});
		}
	}

	const conditionals = [];
	const pushTriggers = (symbol, row) => {
		const config = bySymbol.get(symbol);
		const params = config ? marketParams(config) : null;
		const usd = (ticks) => (params && ticks != null ? ticksToUsdWithMarketParams(ticks, params) : null);
		for (const t of row.conditionalTakeProfitTriggers || []) {
			conditionals.push({ id: String(t.conditionalTakeProfitId), symbol, kind: 'take_profit', trigger_price: usd(t.trigger?.triggerPriceTicks), execution_price: usd(t.trigger?.executionPriceTicks), side: sideOf(t.trigger?.side), status: t.status, cancellable: true });
		}
		for (const t of row.conditionalStopLossTriggers || []) {
			conditionals.push({ id: String(t.conditionalStopLossId), symbol, kind: 'stop_loss', trigger_price: usd(t.trigger?.triggerPriceTicks), execution_price: usd(t.trigger?.executionPriceTicks), side: sideOf(t.trigger?.side), status: t.status, cancellable: true });
		}
		for (const t of row.takeProfitTriggers || []) {
			conditionals.push({ id: String(t.takeProfitId), symbol, kind: 'take_profit', trigger_price: usd(t.trigger?.triggerPriceTicks), execution_price: usd(t.trigger?.executionPriceTicks), side: sideOf(t.trigger?.side), status: t.status, cancellable: false });
		}
		for (const t of row.stopLossTriggers || []) {
			conditionals.push({ id: String(t.stopLossId), symbol, kind: 'stop_loss', trigger_price: usd(t.trigger?.triggerPriceTicks), execution_price: usd(t.trigger?.executionPriceTicks), side: sideOf(t.trigger?.side), status: t.status, cancellable: false });
		}
	};
	for (const p of sub?.positions || []) pushTriggers(p.symbol, p);
	for (const t of sub?.triggers || []) pushTriggers(t.symbol, t);
	const seen = new Set();
	const uniqueConditionals = conditionals.filter((c) => {
		const key = `${c.symbol}:${c.kind}:${c.id}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	const equity = num(view?.portfolioValue) ?? 0;
	const notional = positions.reduce((s, p) => s + p.notional_usd, 0);
	return {
		registered: Boolean(view),
		authority,
		trader_account: traderAccount,
		collateral_usd: round(num(view?.collateralBalance) ?? 0, 6),
		equity_usd: round(equity, 6),
		withdrawable_usd: round(num(view?.withdrawableQuoteCollateral) ?? 0, 6),
		unrealized_pnl_usd: round(num(view?.unrealizedPnl) ?? 0, 6),
		initial_margin_usd: round(num(view?.initialMargin) ?? 0, 6),
		maintenance_margin_usd: round(num(view?.maintenanceMargin) ?? 0, 6),
		funding_owed_usd: round(num(view?.unsettledFundingOwed) ?? 0, 6),
		notional_usd: round(notional, 2),
		account_leverage: equity > 0 ? round(notional / equity, 3) : 0,
		risk_state: view?.riskState || (view ? 'healthy' : 'unregistered'),
		risk_tier: view?.riskTier || null,
		positions,
		orders,
		conditionals: uniqueConditionals,
	};
}

async function traderAddress(authority) {
	return client().pda.getTraderAddress({ authority, traderPdaIndex: TRADER_PDA_INDEX, subaccountIndex: CROSS_SUBACCOUNT });
}

export async function getAccount(authority) {
	const traderAccount = await traderAddress(authority);
	const [view, snapshot, stats, configs] = await Promise.all([
		client()
			.api.traders()
			.getTrader(traderAccount)
			.catch((e) => {
				if (isNotFound(e)) return null;
				throw e;
			}),
		client()
			.api.traders()
			.getTraderStateSnapshot(authority)
			.catch((e) => {
				if (isNotFound(e)) return null;
				throw e;
			}),
		marketStats(),
		marketConfigs(),
	]).catch(async (e) => {
		if (e?.name === 'PerpsError') throw e;
		return venueCall('read the trader account', () => Promise.reject(e));
	});
	const marks = new Map([...stats].map(([sym, s]) => [sym, num(s.mark_price)]));
	return normalizeAccount({ authority, traderAccount, view, snapshot, marks, configs });
}

// ── account preparation (trader registration) ────────────────────────────────

/**
 * Build the registration instructions for `authority`, which also pays the
 * rent. The venue's onboarder co-signs server-side in submitPrepare, which is
 * why the returned transaction must go back through the venue rather than
 * straight to RPC.
 */
export async function prepareAccount(authority) {
	const traderAccount = await traderAddress(authority);
	const res = await venueCall('build the account registration', () =>
		client().api.exchange().buildRegisterIxs({ traderAuthority: authority, txFeePayer: authority }),
	);
	return {
		trader_account: res.traderPda || traderAccount,
		onboarder: res.traderOnboarder,
		needs_register: res.includeRegisterTrader !== false,
		instructions: res.instructions.map(registerIxToWeb3),
		cosigned_by_venue: true,
	};
}

/** Send a registration transaction the agent has signed; the venue co-signs and submits it. */
export async function submitPrepare({ authority, transactionBase64 }) {
	const res = await venueCall('submit the account registration', () =>
		client().api.exchange().sendRegisterIxs({ transaction: transactionBase64, traderAuthority: authority, txFeePayer: authority }),
	);
	return { signature: res.signature, trader_account: res.traderPda };
}

// ── collateral ───────────────────────────────────────────────────────────────

const toQuoteUnits = (usd) => BigInt(Math.floor(Number(usd) * QUOTE_UNITS_PER_USD));

/** USDC from the agent wallet into trader collateral (one transaction, venue-converted). */
export async function buildDeposit(authority, amountUsd) {
	const res = await venueCall('build the collateral deposit', () =>
		client().ixs.buildDepositIxs({ authority, amount: toQuoteUnits(amountUsd), traderPdaIndex: TRADER_PDA_INDEX, traderSubaccountIndex: CROSS_SUBACCOUNT }),
	);
	return res.instructions.map(toWeb3Instruction);
}

/** Trader collateral back to USDC in the agent wallet. */
export async function buildWithdraw(authority, amountUsd) {
	const res = await venueCall('build the collateral withdrawal', () =>
		client().ixs.buildWithdrawIxs({ authority, amount: toQuoteUnits(amountUsd), traderPdaIndex: TRADER_PDA_INDEX, traderSubaccountIndex: CROSS_SUBACCOUNT }),
	);
	return res.instructions.map(toWeb3Instruction);
}

// ── order math (pure) ────────────────────────────────────────────────────────

/** Round a size DOWN to the market's lot step and return it as the exact decimal string the SDK wants. */
export function sizeToLots(size, params) {
	const dec = params.baseLotsDecimals;
	const factor = 10 ** dec;
	const lots = Math.floor(Number(size) * factor + 1e-9);
	return { lots, size: lots / factor, text: (lots / factor).toFixed(dec) };
}

/** Round a price to the market's tick; `mode` picks the direction that protects the trader. */
export function priceToTick(price, params, mode = 'nearest') {
	const tick = params.tickUsd;
	const steps = Number(price) / tick;
	const n = mode === 'up' ? Math.ceil(steps - 1e-9) : mode === 'down' ? Math.floor(steps + 1e-9) : Math.round(steps);
	const dp = Math.max(0, Math.ceil(-Math.log10(tick)));
	return Number((n * tick).toFixed(dp));
}

/**
 * Pure: apply a fill of `delta` base units (signed) at `price` to a position of
 * `size` (signed) held at `entry`. Handles adding, reducing, closing and flipping.
 */
export function projectPosition({ size = 0, entry = 0, delta, price }) {
	const next = size + delta;
	if (size === 0 || Math.sign(size) === Math.sign(delta)) {
		const total = Math.abs(size) + Math.abs(delta);
		return { size: next, entry: total ? (Math.abs(size) * entry + Math.abs(delta) * price) / total : 0, realized_pnl: 0 };
	}
	const closing = Math.min(Math.abs(size), Math.abs(delta));
	const realized = closing * (price - entry) * Math.sign(size);
	if (Math.abs(delta) <= Math.abs(size) + 1e-12) {
		return { size: Math.abs(next) < 1e-12 ? 0 : next, entry: Math.abs(next) < 1e-12 ? 0 : entry, realized_pnl: realized };
	}
	return { size: next, entry: price, realized_pnl: realized };
}

/**
 * Quote an order against the live book and the agent's live account. Returns
 * every number the guards and the confirmation screen need.
 *
 * @param {object} o
 * @param {string} o.symbol
 * @param {'long'|'short'} o.side
 * @param {number} o.size               base units
 * @param {'market'|'limit'} o.type
 * @param {number} [o.price]            limit price
 * @param {boolean} [o.reduceOnly]
 * @param {number} [o.slippageBps]      market orders: worst acceptable price past the book walk
 * @param {object} o.account            the output of getAccount
 */
export async function quoteOrder({ symbol, side, size, type, price = null, reduceOnly = false, slippageBps = 100, account }) {
	const market = await getMarket(symbol);
	const { params } = market;
	if (market.status !== 'active') {
		throw perpsError(409, 'market_inactive', `${market.symbol} is ${market.status} on the venue right now, so it cannot take orders.`, { status: market.status });
	}
	const lot = sizeToLots(size, params);
	if (lot.lots < 1) {
		throw perpsError(400, 'size_too_small', `The smallest ${market.symbol} order is ${params.sizeStep} ${market.symbol}.`, { min_size: params.sizeStep });
	}
	const book = await orderbook(market.symbol, 100);
	const isLong = side === 'long';
	const mark = market.mark_price ?? book.mid;

	let entry;
	let feeRate;
	let limitPrice;
	let fill = null;
	if (type === 'market') {
		fill = estimateFill(isLong ? book.asks : book.bids, lot.size);
		if (!fill.complete) {
			throw perpsError(422, 'insufficient_liquidity', `The visible ${market.symbol} book cannot fill ${lot.size} right now (only ${fill.filled}). Use a smaller size or a limit order.`, { fillable: fill.filled });
		}
		entry = fill.avg_price;
		feeRate = params.takerFee;
		const slip = Math.max(0, Number(slippageBps) || 0) / 10_000;
		limitPrice = priceToTick(isLong ? fill.worst_price * (1 + slip) : fill.worst_price * (1 - slip), params, isLong ? 'up' : 'down');
	} else {
		if (!(Number(price) > 0)) throw perpsError(400, 'price_required', 'A limit order needs a positive price.');
		limitPrice = priceToTick(price, params, 'nearest');
		entry = limitPrice;
		const crosses = isLong ? book.best_ask != null && limitPrice >= book.best_ask : book.best_bid != null && limitPrice <= book.best_bid;
		feeRate = crosses ? params.takerFee : params.makerFee;
	}

	const notional = lot.size * entry;
	const fee = notional * feeRate;
	const existing = account.positions.find((p) => p.symbol === market.symbol) || null;
	const delta = isLong ? lot.size : -lot.size;
	if (reduceOnly) {
		if (!existing || Math.sign(existing.signed_size) === Math.sign(delta)) {
			throw perpsError(409, 'nothing_to_reduce', `A reduce-only ${side} needs an open ${isLong ? 'short' : 'long'} ${market.symbol} position to reduce.`);
		}
		if (lot.size > existing.size + 1e-12) {
			throw perpsError(409, 'reduce_exceeds_position', `Reduce-only size ${lot.size} is larger than the open position (${existing.size}).`, { position_size: existing.size });
		}
	}
	const projected = projectPosition({ size: existing?.signed_size || 0, entry: existing?.entry_price || 0, delta, price: entry });

	const markRef = mark || entry;
	const imBefore = existing ? Math.abs(existing.signed_size) * markRef / params.maxLeverage : 0;
	const imAfter = (Math.abs(projected.size) * markRef) / params.maxLeverage;
	const accountNotionalAfter = account.notional_usd - (existing ? existing.notional_usd : 0) + Math.abs(projected.size) * markRef;
	const collateralAfter = account.collateral_usd - fee + projected.realized_pnl;
	const equityAfter = account.equity_usd - fee;
	const initialMarginAfter = account.initial_margin_usd - imBefore + imAfter;

	let liquidation = null;
	if (projected.size !== 0) {
		liquidation = calculateLiquidationPriceUsd({
			positionSize: projected.size,
			entryPriceUsd: projected.entry,
			leverage: params.maxLeverage,
			maintenanceMarginBps: params.maintenanceBps,
			collateralUsd: collateralAfter,
			otherAssetUnrealizedPnlUsd: account.unrealized_pnl_usd - (existing?.unrealized_pnl_usd || 0),
			otherAssetMaintenanceMarginUsd: Math.max(0, account.maintenance_margin_usd - (existing?.maintenance_margin_usd || 0)),
		});
	}

	return {
		symbol: market.symbol,
		side,
		type,
		reduce_only: reduceOnly === true,
		size: lot.size,
		size_text: lot.text,
		mark_price: mark,
		index_price: market.index_price,
		entry_price: round(entry, 8),
		limit_price: limitPrice,
		worst_book_price: fill?.worst_price ?? null,
		slippage_bps: type === 'market' ? Number(slippageBps) : null,
		notional_usd: round(notional, 4),
		fee_rate: feeRate,
		fee_usd: round(fee, 6),
		market_max_leverage: params.maxLeverage,
		position_after: {
			side: projected.size > 0 ? 'long' : projected.size < 0 ? 'short' : 'flat',
			size: round(Math.abs(projected.size), 10),
			entry_price: projected.size ? round(projected.entry, 8) : null,
			notional_usd: round(Math.abs(projected.size) * markRef, 4),
			realized_pnl_usd: round(projected.realized_pnl, 6),
		},
		liquidation_price: liquidation && liquidation > 0 ? round(liquidation, 6) : null,
		liquidation_distance_pct: liquidation && liquidation > 0 && markRef ? round((Math.abs(markRef - liquidation) / markRef) * 100, 3) : null,
		margin_impact_usd: round(imAfter - imBefore, 6),
		initial_margin_after_usd: round(initialMarginAfter, 6),
		collateral_after_usd: round(collateralAfter, 6),
		equity_after_usd: round(equityAfter, 6),
		free_collateral_after_usd: round(equityAfter - initialMarginAfter, 6),
		account_notional_after_usd: round(accountNotionalAfter, 4),
		account_leverage_after: equityAfter > 0 ? round(accountNotionalAfter / equityAfter, 4) : null,
		risk_increasing: Math.abs(projected.size) > Math.abs(existing?.signed_size || 0) + 1e-12 || (existing && Math.sign(projected.size) !== Math.sign(existing.signed_size) && projected.size !== 0),
	};
}

// ── order instructions ───────────────────────────────────────────────────────

/** Build a market or limit order from a quote (the preview's exact size and limit price). */
export async function buildOrder(authority, quote) {
	const c = client();
	const side = quote.side === 'long' ? Side.Bid : Side.Ask;
	const orderFlags = quote.reduce_only ? OrderFlags.ReduceOnly : OrderFlags.None;
	const base = { authority, symbol: quote.symbol, traderPdaIndex: TRADER_PDA_INDEX, traderSubaccountIndex: CROSS_SUBACCOUNT };
	const ix = await venueCall(`build the ${quote.type} order`, async () => {
		if (quote.type === 'market') {
			const orderPacket = await c.orderPackets.buildMarketOrderPacket({
				symbol: quote.symbol,
				side,
				baseUnits: quote.size_text,
				priceLimitUsd: String(quote.limit_price),
				orderFlags,
			});
			return c.ixs.buildPlaceMarketOrder({ ...base, orderPacket });
		}
		const orderPacket = await c.orderPackets.buildLimitOrderPacket({
			symbol: quote.symbol,
			side,
			baseUnits: quote.size_text,
			priceUsd: String(quote.limit_price),
			orderFlags,
		});
		return c.ixs.buildPlaceLimitOrder({ ...base, orderPacket });
	});
	return [toWeb3Instruction(ix)];
}

/**
 * Build a take-profit or stop-loss on an existing position. Direction and the
 * closing side always come from the live position, never from the caller: a
 * trigger on the wrong side of a position is rejected by the program.
 */
export async function buildConditional(authority, { symbol, kind, triggerPrice, position, sizePercent = 100, slippageBps = STOP_LOSS_SLIPPAGE_BPS }) {
	const market = await getMarket(symbol);
	const { params } = market;
	const isLong = position.side === 'long';
	const closingSide = isLong ? 'sell' : 'buy';
	const trigger = priceToTick(triggerPrice, params, 'nearest');
	const greater = (kind === 'take_profit') === isLong;
	let execution;
	if (kind === 'take_profit') {
		execution = trigger;
	} else {
		const slip = slippageBps / 10_000;
		execution = priceToTick(isLong ? trigger * (1 - slip) : trigger * (1 + slip), params, isLong ? 'down' : 'up');
	}
	const leg = { side: closingSide, orderKind: kind === 'take_profit' ? 'limit' : 'ioc', triggerPrice: trigger, executionPrice: execution };
	const ixs = await venueCall(`build the ${kind.replace('_', '-')} trigger`, () =>
		client()
			.api.orders()
			.placePositionConditionalOrder({
				authority,
				traderPdaIndex: TRADER_PDA_INDEX,
				traderSubaccountIndex: CROSS_SUBACCOUNT,
				symbol: market.symbol,
				sizePercent: Math.max(1, Math.min(100, Math.round(sizePercent))),
				...(greater ? { greaterTrigger: leg } : { lessTrigger: leg }),
			}),
	);
	return { instructions: ixs.map(toWeb3Instruction), trigger_price: trigger, execution_price: execution, direction: greater ? 'greater_than' : 'less_than' };
}

/** Cancel one resting limit order by its sequence number and exact tick price. */
export async function buildCancel(authority, { symbol, orderId, priceTicks }) {
	const market = await getMarket(symbol);
	const ix = await venueCall('build the order cancel', () =>
		client().ixs.buildCancelOrdersById({
			authority,
			symbol: market.symbol,
			traderPdaIndex: TRADER_PDA_INDEX,
			traderSubaccountIndex: CROSS_SUBACCOUNT,
			orders: [{ orderSequenceNumber: String(orderId), priceInTicks: String(priceTicks) }],
		}),
	);
	return [toWeb3Instruction(ix)];
}

/** Cancel one take-profit / stop-loss trigger. */
export async function buildCancelConditional(authority, { symbol, conditionalId, direction }) {
	const market = await getMarket(symbol);
	const ixs = await venueCall('build the trigger cancel', () =>
		client()
			.api.orders()
			.cancelConditionalOrder({
				authority,
				traderPdaIndex: TRADER_PDA_INDEX,
				traderSubaccountIndex: CROSS_SUBACCOUNT,
				symbol: market.symbol,
				conditionalOrderIndex: Number(conditionalId),
				executionDirection: direction,
			}),
	);
	return ixs.map(toWeb3Instruction);
}
