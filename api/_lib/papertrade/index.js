// Papertrade: read-only integration with the synthetic-perps exchange on
// HyperEVM (https://papertrade.xyz). Markets, protocol health, exact open
// quotes and any wallet's live positions, all from the real sources:
//
//   instruments, OI, caps   exchange API  GET /state/trading
//   protocol + payout queue exchange API  GET /query/protocol/*
//   wallet + positions      exchange API  GET /state/user/live (SSE, first frame)
//   win fee                 HyperEVM      winFeeRate() on the exchange contract
//   entry / mark price      Hyperliquid   l2Book BBO, the same mid the contract reads
//
// Nothing here signs, deposits or trades. Every money figure is computed by
// ./math.js at the contract's own fixed-point scales. Guide: docs/papertrade.md.

import { toFunctionSelector } from 'viem';
import { fetchUpstream, fetchUpstreamJson, lastGood } from '../upstream-fetch.js';
import {
	decodeInstrument, decodePosition, midRaw, bustPriceRaw, valuePosition, payoutPnlRaw, isBust, riskPercent,
	openCapacity, usdToRaw, rawToUsd, priceToRaw, rawToPrice, wadToNumber,
} from './math.js';

export const EXCHANGE_API = 'https://exchange.papertrade.xyz';
export const HYPER_EVM_RPC = 'https://rpc.hyperliquid.xyz/evm';
export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';
export const CHAIN_ID = 999;
export const CONTRACTS = Object.freeze({
	exchange: '0x6cd5661646289fb6e65ea5c032310fded797d0a2',
	collateral: '0x6b9e773128f453f5c2c60935ee2de2cbc5390a24',
});
export const APP_URL = 'https://exchange.papertrade.xyz';
export const DOCS_URL = 'https://docs.papertrade.xyz';

// Price moves in the position's favour that every quote is valued at, in percent.
export const SCENARIO_MOVES_PCT = Object.freeze([0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]);

const HEADERS = { accept: 'application/json', 'user-agent': 'three.ws/1.0 (+https://three.ws)' };
const WIN_FEE_SELECTOR = toFunctionSelector('winFeeRate()');

export class PapertradeError extends Error {
	constructor(status, code, message, detail = null) {
		super(message);
		this.name = 'PapertradeError';
		this.status = status;
		this.code = code;
		this.detail = detail;
	}
}

const fail = (status, code, message, detail = null) => new PapertradeError(status, code, message, detail);

const round = (n, dp = 6) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);

// ── short-lived read cache ───────────────────────────────────────────────────

const _memo = new Map();
function memo(key, ttlMs, load) {
	const hit = _memo.get(key);
	if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
	const promise = load();
	_memo.set(key, { at: Date.now(), promise });
	promise.catch(() => _memo.get(key)?.promise === promise && _memo.delete(key));
	return promise;
}

async function upstream(what, fn) {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof PapertradeError) throw err;
		throw fail(502, 'upstream_unavailable', `Papertrade data is unavailable right now (${what}). Retry in a moment.`, {
			cause: String(err?.message || err).slice(0, 200),
		});
	}
}

const exchangeGet = (path, name) =>
	fetchUpstreamJson(`${EXCHANGE_API}${path}`, { headers: HEADERS }, { name: `papertrade:${name}`, timeoutMs: 8000, attempts: 2 });

// ── raw reads ────────────────────────────────────────────────────────────────

/**
 * Instruments and global trading parameters. Instrument parameters change only
 * by owner action, so a last good copy (flagged stale) may stand in for one
 * failed read; open interest in a stale copy is reported as such.
 */
export function tradingState() {
	return memo('trading', 5_000, async () => {
		const { value, stale, ageMs } = await upstream('trading state', () =>
			lastGood('papertrade:trading', () => exchangeGet('/state/trading', 'trading'), { maxAgeMs: 10 * 60_000 }));
		if (value?.schemaVersion !== 1 || !Array.isArray(value.instruments)) {
			throw fail(502, 'upstream_schema_changed', 'Papertrade changed its trading-state format; quotes are paused until the integration is updated.', {
				schema_version: value?.schemaVersion ?? null,
			});
		}
		const intake = Array.isArray(value.intake) ? value.intake : null;
		return {
			tradingPaused: value.tradingPaused === true,
			indexedThroughBlock: Number(value.indexedThroughBlock) || null,
			minimumMarginRaw: BigInt(value.minimumTradeSizeRaw),
			minimumOpenNotionalRaw: BigInt(value.minimumOpenNotionalRaw),
			maximumNetOpenInterestRaw: intake && intake[2] != null ? BigInt(intake[2]) : 0n,
			instruments: value.instruments.map(decodeInstrument),
			stale,
			ageMs,
		};
	});
}

/** The win fee, read from the exchange contract (1e18 fraction). */
export function winFeeRate() {
	return memo('winfee', 60_000, () =>
		upstream('win fee', async () => {
			const { value } = await lastGood('papertrade:winfee', async () => {
				const out = await fetchUpstreamJson(HYPER_EVM_RPC, {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: CONTRACTS.exchange, data: WIN_FEE_SELECTOR }, 'latest'] }),
				}, { name: 'papertrade:hyperevm', timeoutMs: 8000, attempts: 2 });
				if (out?.error || typeof out?.result !== 'string' || !/^0x[0-9a-f]+$/i.test(out.result)) {
					throw new Error(`winFeeRate() eth_call failed: ${out?.error?.message || 'no result'}`);
				}
				return BigInt(out.result);
			}, { maxAgeMs: 60 * 60_000 });
			return value;
		}));
}

/**
 * Hyperliquid best bid and ask for one coin, in the instrument's raw price
 * scale. Never served stale: an entry price must be the price now.
 */
export function bbo(instrument) {
	return memo(`bbo:${instrument.symbol}`, 1_500, () =>
		upstream(`${instrument.symbol} price`, async () => {
			const book = await fetchUpstreamJson(HL_INFO_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ type: 'l2Book', coin: instrument.symbol }),
			}, { name: 'hyperliquid:l2book', timeoutMs: 6000, attempts: 2 });
			const bid = book?.levels?.[0]?.[0]?.px;
			const ask = book?.levels?.[1]?.[0]?.px;
			if (bid == null || ask == null) throw new Error(`no ${instrument.symbol} BBO`);
			const bidRaw = priceToRaw(bid, instrument.priceScaleRaw);
			const askRaw = priceToRaw(ask, instrument.priceScaleRaw);
			return { bidRaw, askRaw, midRaw: midRaw(bidRaw, askRaw), at: Number(book.time) || Date.now() };
		}));
}

/** The price a position marks at: the frozen mid for a terminal market, else the live BBO mid. */
async function markFor(instrument) {
	if (instrument.terminal && instrument.frozenBidRaw != null && instrument.frozenAskRaw != null) {
		return { midRaw: midRaw(instrument.frozenBidRaw, instrument.frozenAskRaw), bidRaw: instrument.frozenBidRaw, askRaw: instrument.frozenAskRaw, at: instrument.pausedAtMs, frozen: true };
	}
	return { ...(await bbo(instrument)), frozen: false };
}

function findInstrument(state, symbol) {
	const want = String(symbol || '').trim().toUpperCase().replace(/[-/]?(USD|USDC|PERP)$/, '');
	const inst = state.instruments.find((i) => i.symbol.toUpperCase() === want);
	if (!inst) {
		throw fail(404, 'unknown_market', `Papertrade has no ${want || 'such'} market. Listed: ${state.instruments.map((i) => i.symbol).join(', ')}.`, {
			available: state.instruments.map((i) => i.symbol),
		});
	}
	return inst;
}

function marketStatus(inst, paused) {
	if (inst.retired) return 'retired';
	if (inst.terminal) return 'terminal';
	if (paused || inst.paused) return 'paused';
	if (inst.closeOnly) return 'close_only';
	return inst.active ? 'active' : 'inactive';
}

// ── public service ───────────────────────────────────────────────────────────

/** Every listed market with its live price, limits and open interest. */
export async function markets() {
	const [state, fee, stats] = await Promise.all([
		tradingState(),
		winFeeRate(),
		exchangeGet('/query/protocol/market-stats', 'market-stats').catch(() => null),
	]);
	const rows = await Promise.all(state.instruments.filter((i) => !i.retired).map(async (inst) => {
		const px = await markFor(inst).catch(() => null);
		const mid = px ? rawToPrice(px.midRaw, inst.priceScaleRaw) : null;
		const oiUsd = (raw) => (mid == null ? null : round((Number(raw / 10n ** 12n) / 1e6) * mid, 2));
		const vol = stats?.markets?.[String(inst.id)]?.volume_24h;
		return {
			symbol: inst.symbol,
			instrument_id: inst.id,
			status: marketStatus(inst, state.tradingPaused),
			openable: inst.openable && !state.tradingPaused,
			mid_price: mid,
			bid: px ? rawToPrice(px.bidRaw, inst.priceScaleRaw) : null,
			ask: px ? rawToPrice(px.askRaw, inst.priceScaleRaw) : null,
			price_at: px?.at ?? null,
			price_source: px?.frozen ? 'frozen_at_pause' : px ? 'hyperliquid_bbo_mid' : null,
			max_leverage: inst.maxLeverage,
			max_position_notional_usd: rawToUsd(inst.maxPositionNotionalRaw),
			bust_buffer_bps: round(wadToNumber(inst.bustBufferRaw) * 10_000, 3),
			open_interest_long_usd: oiUsd(inst.longOiRaw),
			open_interest_short_usd: oiUsd(inst.shortOiRaw),
			volume_24h_usd: vol != null ? rawToUsd(BigInt(vol)) : null,
		};
	}));
	return {
		venue: 'papertrade',
		chain_id: CHAIN_ID,
		collateral: 'USDC',
		trading_paused: state.tradingPaused,
		min_margin_usd: rawToUsd(state.minimumMarginRaw),
		min_notional_usd: rawToUsd(state.minimumOpenNotionalRaw),
		win_fee_pct: round(wadToNumber(fee) * 100, 4),
		funding: 'none',
		stale: state.stale,
		markets: rows,
		links: { app: APP_URL, docs: DOCS_URL },
	};
}

/** Protocol health: TVL, LP, payout queue, fees, relayer readiness. */
export async function protocol() {
	const [summary, queue, relayer, fee] = await Promise.all([
		upstream('protocol summary', () => exchangeGet('/query/protocol/summary', 'summary')),
		exchangeGet('/query/protocol/queue-summary', 'queue').catch(() => null),
		exchangeGet('/relayer/health', 'relayer').catch(() => null),
		winFeeRate(),
	]);
	const b = summary?.balances || {};
	const usd = (v) => (v == null ? null : rawToUsd(BigInt(v)));
	const queueTotal = queue?.total != null ? usd(queue.total) : null;
	return {
		venue: 'papertrade',
		as_of: summary?.source?.at ?? null,
		block: summary?.source?.block ?? null,
		live_since: summary?.source?.genesis ?? null,
		tvl_usd: usd(b.tvl),
		margin_locked_usd: usd(b.margin),
		lp_usd: usd(b.lp),
		reserve_usd: usd(b.reserve),
		open_positions: summary?.activity?.open ?? null,
		lifetime_volume_usd: usd(summary?.activity?.volume),
		lifetime_fees_usd: usd(summary?.fees?.lifetime),
		win_fee_pct: round(wadToNumber(fee) * 100, 4),
		payout_queue: queue
			? { total_usd: queueTotal, entries: queue.count ?? 0, active: (queue.count ?? 0) > 0 }
			: null,
		relayer_ready: relayer ? relayer.ok === true && relayer.ready === true : null,
		risk_notes: [
			'Winning closes are paid from one LP; when it is short, the unpaid profit waits in a first-in, first-out payout queue.',
			'The contracts are upgradeable by the protocol owner through a timelock.',
		],
	};
}

function validateOpen({ symbol, side, marginUsd, leverage }) {
	if (side !== 'long' && side !== 'short') throw fail(400, 'invalid_side', 'side must be "long" or "short".');
	const margin = Number(marginUsd);
	if (!Number.isFinite(margin) || margin <= 0 || margin > 10_000_000) throw fail(400, 'invalid_margin', 'margin_usd must be a positive number of USDC, at most 10,000,000.');
	const lev = Number(leverage);
	if (!Number.isInteger(lev) || lev < 1) throw fail(400, 'invalid_leverage', 'leverage must be a whole number of at least 1.');
	if (!symbol) throw fail(400, 'symbol_required', 'symbol is required, e.g. BTC or ETH.');
	return { margin, lev };
}

function scenario(position, inst, fee, movePct, direction) {
	const entry = position.entryPriceRaw;
	const delta = (entry * BigInt(Math.round(movePct * 10_000))) / 1_000_000n;
	const up = direction === 'favour' ? position.isLong : !position.isLong;
	const exit = up ? entry + delta : entry - delta;
	const v = valuePosition(position, exit, inst);
	const payout = payoutPnlRaw(v.adjustedPnlRaw, fee);
	const raw = rawToUsd(v.rawPnlRaw);
	const paid = rawToUsd(payout);
	return {
		move_pct: direction === 'favour' ? movePct : -movePct,
		exit_price: rawToPrice(exit, inst.priceScaleRaw),
		raw_pnl_usd: raw,
		payout_pnl_usd: paid,
		kept_pct: v.rawPnlRaw > 0n ? round((paid / raw) * 100, 2) : null,
		busted: isBust(position, exit),
	};
}

/**
 * Price an open exactly as the exchange would fill it right now: entry at the
 * BBO mid, the hard-bust trigger, the capacity limits, and what the position
 * would actually pay out across a ladder of favourable moves.
 */
export async function quote({ symbol, side, marginUsd, leverage }) {
	const { margin, lev } = validateOpen({ symbol, side, marginUsd, leverage });
	const [state, fee] = await Promise.all([tradingState(), winFeeRate()]);
	const inst = findInstrument(state, symbol);
	const px = await markFor(inst);
	const isLong = side === 'long';
	const marginRaw = usdToRaw(margin);
	const notionalRaw = marginRaw * BigInt(lev);
	const entryRaw = px.midRaw;
	const position = { isLong, entryPriceRaw: entryRaw, marginRaw, leverage: lev, bustPriceRaw: bustPriceRaw(entryRaw, lev, isLong, inst.bustBufferRaw) };
	const cap = openCapacity({ instrument: inst, isLong, leverage: lev, markRaw: entryRaw, maximumNetOpenInterestRaw: state.maximumNetOpenInterestRaw });

	const checks = [
		{ id: 'market_open', ok: inst.openable && !state.tradingPaused, label: `${inst.symbol} is ${marketStatus(inst, state.tradingPaused)}` },
		{ id: 'leverage', ok: lev <= inst.maxLeverage, label: `Leverage ${lev}x within the ${inst.maxLeverage}x market maximum` },
		{ id: 'min_margin', ok: marginRaw >= state.minimumMarginRaw, label: `Margin at least $${rawToUsd(state.minimumMarginRaw)}` },
		{ id: 'min_notional', ok: notionalRaw >= state.minimumOpenNotionalRaw, label: `Notional at least $${rawToUsd(state.minimumOpenNotionalRaw).toLocaleString('en-US')}` },
		{ id: 'capacity', ok: cap.maxMarginRaw == null || marginRaw <= cap.maxMarginRaw, label: cap.maxMarginRaw == null ? 'No capacity limit applies' : `Margin within the $${rawToUsd(cap.maxMarginRaw).toLocaleString('en-US')} the market can take at ${lev}x (${cap.limitedBy})` },
	];

	const bust = rawToPrice(position.bustPriceRaw, inst.priceScaleRaw);
	const entry = rawToPrice(entryRaw, inst.priceScaleRaw);
	return {
		venue: 'papertrade',
		symbol: inst.symbol,
		side,
		margin_usd: rawToUsd(marginRaw),
		leverage: lev,
		notional_usd: rawToUsd(notionalRaw),
		entry_price: entry,
		price_source: px.frozen ? 'frozen_at_pause' : 'hyperliquid_bbo_mid',
		price_at: px.at,
		bust_price: bust,
		bust_distance_pct: round((Math.abs(entry - bust) / entry) * 100, 4),
		loss_at_bust_usd: -rawToUsd(marginRaw),
		max_margin_usd: cap.maxMarginRaw == null ? null : rawToUsd(cap.maxMarginRaw),
		win_fee_pct: round(wadToNumber(fee) * 100, 4),
		fees_at_open_usd: 0,
		funding: 'none',
		scenarios: SCENARIO_MOVES_PCT.map((m) => scenario(position, inst, fee, m, 'favour')),
		checks,
		openable: checks.every((c) => c.ok),
		blocked_by: checks.filter((c) => !c.ok).map((c) => c.id),
		stale_market_params: state.stale,
		notes: [
			'Entry is the Hyperliquid best-bid/ask mid at the moment the relayer lands the intent, so a live fill can differ from this quote by however far the mid moves in between.',
			'Crossing the bust price forfeits the full margin, even when a voluntary close just before would have returned some of it.',
			'Profit on a winning close passes a 0.2 bps deadband, the impact haircut and the win fee; scenarios show what is actually paid.',
		],
		trade_url: APP_URL,
	};
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Read the first `wallet` frame of the exchange's live wallet stream. */
async function walletFrame(address) {
	const res = await fetchUpstream(`${EXCHANGE_API}/state/user/live?wallet=${address}`, {
		headers: { ...HEADERS, accept: 'text/event-stream' },
	}, { name: 'papertrade:wallet', timeoutMs: 8000, attempts: 1 });
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	try {
		while (buf.length < 4_000_000) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let cut;
			while ((cut = buf.indexOf('\n\n')) !== -1) {
				const block = buf.slice(0, cut);
				buf = buf.slice(cut + 2);
				const event = /^event: (.+)$/m.exec(block)?.[1]?.trim();
				if (event !== 'wallet') continue;
				const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
				return JSON.parse(data);
			}
		}
	} finally {
		reader.cancel().catch(() => {});
	}
	throw new Error('wallet stream closed before its first wallet frame');
}

/**
 * Any wallet's Papertrade account, read from public chain-indexed state:
 * balances, lifetime totals, and every open position valued at the live mid
 * (raw PnL, what a close would pay, bust distance).
 */
export async function account(address) {
	if (!ADDRESS_RE.test(String(address || ''))) throw fail(400, 'invalid_address', 'address must be a 0x-prefixed 40-hex-character EVM wallet address.');
	const wallet = String(address).toLowerCase();
	const [state, fee, frame] = await Promise.all([tradingState(), winFeeRate(), upstream('wallet state', () => walletFrame(wallet))]);
	const byId = new Map(state.instruments.map((i) => [i.id, i]));
	const marks = new Map();
	const positions = [];
	for (const tuple of frame.openPositions || []) {
		const p = decodePosition(tuple);
		const inst = byId.get(p.instrumentId);
		if (!inst) continue;
		if (!marks.has(inst.id)) marks.set(inst.id, await markFor(inst).catch(() => null));
		const px = marks.get(inst.id);
		const valued = px ? valuePosition(p, px.midRaw, inst) : null;
		positions.push({
			id: p.id,
			symbol: inst.symbol,
			side: p.isLong ? 'long' : 'short',
			margin_usd: rawToUsd(p.marginRaw),
			leverage: p.leverage,
			notional_usd: rawToUsd(p.marginRaw * BigInt(p.leverage)),
			entry_price: rawToPrice(p.entryPriceRaw, inst.priceScaleRaw),
			bust_price: rawToPrice(p.bustPriceRaw, inst.priceScaleRaw),
			mark_price: px ? rawToPrice(px.midRaw, inst.priceScaleRaw) : null,
			raw_pnl_usd: valued ? rawToUsd(valued.rawPnlRaw) : null,
			close_payout_pnl_usd: valued ? rawToUsd(payoutPnlRaw(valued.adjustedPnlRaw, fee)) : null,
			risk_pct: px ? riskPercent(p, px.midRaw) : null,
			bust_crossed: px ? isBust(p, px.midRaw) : null,
			margin_from_queue: p.useDebt,
			opened_at: new Date(p.openedAtMs).toISOString(),
		});
	}
	positions.sort((a, b) => b.notional_usd - a.notional_usd);
	const funds = frame.funds || {};
	const life = frame.lifetime || {};
	const usd = (v) => (v == null ? null : rawToUsd(BigInt(v)));
	const unrealized = positions.reduce((s, p) => (p.close_payout_pnl_usd == null ? s : s + p.close_payout_pnl_usd), 0);
	return {
		venue: 'papertrade',
		address: wallet,
		indexed_through_block: frame.indexedThroughBlock ?? null,
		balance_usd: usd(frame.balance),
		available_usd: usd(funds.availableBalance),
		locked_margin_usd: usd(frame.locked),
		queued_payout_usd: usd(frame.queued),
		session_key_active: Array.isArray(frame.sessionKeys) && frame.sessionKeys.some(([, exp]) => Number(exp) * 1000 > Date.now()),
		open_positions: positions.length,
		close_all_payout_pnl_usd: round(unrealized, 6),
		lifetime: {
			deposited_usd: usd(life.depositedRaw),
			withdrawn_usd: usd(life.withdrawnRaw),
			realized_pnl_usd: usd(life.realizedPnlRaw),
			fees_paid_usd: usd(life.feesPaidRaw),
			traded_notional_usd: usd(life.tradedNotionalRaw),
		},
		positions,
	};
}
