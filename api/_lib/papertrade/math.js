// Papertrade position math: pure, BigInt, at the contract's own scales.
//
// Papertrade (HyperEVM, chain 999) is not an order book. Every position is a
// synthetic swap against one LP, entered and exited at Hyperliquid's BBO mid,
// with isolated margin fixed at open. Its economics differ from a normal perp
// in three ways, and getting them wrong misprices every quote:
//
//   1. A 0.2 bps jitter deadband: a win is measured as if the exit were
//      entry/50000 less favourable, so a move inside that pays nothing.
//   2. An asymmetric impact haircut on the gain only. The kept share is
//        (1 - baseRate) / (1 + 1/(move*rateMultiplier)
//                            + referenceNotional/(1e6*move*positionMultiplier))
//      so small moves keep little and large moves approach (1 - baseRate).
//   3. A win fee (read live from the contract's winFeeRate()) on what remains.
//      Losses pay nothing on top of the loss, and a loss is floored at the
//      full isolated margin.
//
// Liquidation is a hard bust: the trigger sits a fixed buffer (instrument
// bustBufferRaw, about 5 bps) closer to entry than the zero-equity price, and
// crossing it forfeits the whole margin.
//
// Scales: collateral and every fraction are 1e18 fixed point; prices are
// integers in the instrument's price scale (BTC 10, ETH 100), the same raw
// units Hyperliquid's BBO precompile reports. Integer division here rounds the
// same way the contract does, which is why this file never touches floats
// until the final USD conversion. Behaviour documented at
// https://docs.papertrade.xyz and verified against live positions (see
// tests/papertrade-math.test.js).

export const WAD = 10n ** 18n;
const U64_MAX = (1n << 64n) - 1n;
// A side cap at or above this is the contract's "no cap" sentinel.
const UNCAPPED = 1n << 127n;

const big = (v) => (v == null ? null : BigInt(v));

/** USD number -> 1e18 collateral raw (cent-and-below precision kept to 1e-6). */
export function usdToRaw(usd) {
	return BigInt(Math.round(Number(usd) * 1e6)) * 10n ** 12n;
}

/** 1e18 collateral raw -> USD number, rounded to 1e-6. */
export function rawToUsd(raw) {
	if (raw == null) return null;
	const r = BigInt(raw);
	const neg = r < 0n;
	const micros = (neg ? -r : r) / 10n ** 12n;
	return (neg ? -1 : 1) * (Number(micros) / 1e6);
}

/** Price number -> raw integer at the instrument's price scale. */
export function priceToRaw(price, scaleRaw) {
	return BigInt(Math.round(Number(price) * Number(scaleRaw)));
}

/** Raw price -> number. */
export function rawToPrice(raw, scaleRaw) {
	return raw == null ? null : Number(raw) / Number(scaleRaw);
}

/** 1e18 fraction -> plain number. */
export function wadToNumber(raw) {
	return raw == null ? null : Number(BigInt(raw) * 1_000_000n / WAD) / 1e6;
}

/**
 * Decode one `/state/trading` instrument tuple. Field order is the exchange's
 * wire schema (schemaVersion 1).
 */
export function decodeInstrument(t) {
	if (!Array.isArray(t) || t.length < 23) throw new TypeError('papertrade: malformed instrument tuple');
	const [id, symbol, assetIndex, priceScale, active, paused, terminal, retired, closeOnly, frozenBid, frozenAsk, pausedAt,
		rateMultiplier, positionMultiplier, maxLeverage, maxPositionNotional, bustBuffer, baseRate, referenceNotional,
		longOi, shortOi, longCap, shortCap] = t;
	return {
		id: Number(id),
		symbol: String(symbol),
		assetIndex: Number(assetIndex),
		priceScaleRaw: big(priceScale),
		active: active === true,
		paused: paused === true,
		terminal: terminal === true,
		retired: retired === true,
		closeOnly: closeOnly === true,
		openable: active === true && paused !== true && closeOnly !== true && retired !== true,
		frozenBidRaw: big(frozenBid),
		frozenAskRaw: big(frozenAsk),
		pausedAtMs: pausedAt == null ? null : Number(pausedAt),
		rateMultiplierRaw: big(rateMultiplier),
		positionMultiplierRaw: big(positionMultiplier),
		maxLeverage: Number(maxLeverage),
		maxPositionNotionalRaw: big(maxPositionNotional),
		bustBufferRaw: big(bustBuffer),
		baseRateRaw: big(baseRate),
		referenceNotionalRaw: big(referenceNotional),
		longOiRaw: big(longOi),
		shortOiRaw: big(shortOi),
		longCapRaw: big(longCap),
		shortCapRaw: big(shortCap),
	};
}

/** Decode one open-position tuple from the wallet stream. */
export function decodePosition(t) {
	if (!Array.isArray(t) || t.length < 9) throw new TypeError('papertrade: malformed position tuple');
	const [id, instrumentId, isLong, useDebt, entry, margin, leverage, bust, openedAt, intentId] = t;
	return {
		id: String(id),
		instrumentId: Number(instrumentId),
		isLong: isLong === true,
		useDebt: useDebt === true,
		entryPriceRaw: BigInt(entry),
		marginRaw: BigInt(margin),
		leverage: Number(leverage),
		bustPriceRaw: BigInt(bust),
		openedAtMs: Number(openedAt),
		intentId: intentId == null ? null : String(intentId),
	};
}

/** Mid of a BBO at raw scale, truncated the way the contract truncates. */
export function midRaw(bidRaw, askRaw) {
	return (BigInt(bidRaw) + BigInt(askRaw)) / 2n;
}

/**
 * The hard-bust trigger for a new position: the zero-equity price (entry moved
 * by entry/leverage against the position), pulled `bustBufferRaw` closer to
 * entry.
 */
export function bustPriceRaw(entryRaw, leverage, isLong, bustBufferRaw) {
	const entry = BigInt(entryRaw);
	const step = entry / BigInt(leverage);
	const zero = isLong ? entry - step : entry + step;
	const buffer = BigInt(bustBufferRaw);
	return isLong ? zero + (zero * buffer) / WAD : zero - (zero * buffer) / WAD;
}

/**
 * Value a position at an exit price. Returns the raw PnL (move times notional)
 * and the adjusted PnL the contract credits: deadband and impact haircut on a
 * gain, the loss floored at the margin otherwise. Both 1e18 collateral raw.
 */
export function valuePosition(position, exitRaw, instrument) {
	const entry = BigInt(position.entryPriceRaw);
	const exit = BigInt(exitRaw);
	const margin = BigInt(position.marginRaw);
	const lev = position.leverage;
	if (entry <= 0n || exit < 0n || margin < 0n || !Number.isSafeInteger(lev) || lev < 1) {
		throw new RangeError('papertrade: invalid position valuation inputs');
	}
	const deadband = entry / 50_000n;
	if (entry > U64_MAX || exit > U64_MAX || (position.isLong ? entry + deadband : exit + deadband) > U64_MAX) {
		throw new RangeError('papertrade: price outside the contract range');
	}
	let effective = exit;
	if (position.isLong) {
		if (exit > entry + deadband) effective = exit - deadband;
		else if (exit > entry) effective = entry;
	} else if (exit + deadband < entry) effective = exit + deadband;
	else if (exit < entry) effective = entry;

	const move = position.isLong ? effective - entry : entry - effective;
	const rawPnlRaw = (margin * BigInt(lev) * move) / entry;
	if (rawPnlRaw <= 0n) return { rawPnlRaw, adjustedPnlRaw: rawPnlRaw < -margin ? -margin : rawPnlRaw };

	const moveWad = ((move < 0n ? -move : move) * WAD) / entry;
	const rateTerm = (moveWad * instrument.rateMultiplierRaw) / WAD;
	const positionTerm = (1_000_000n * moveWad * instrument.positionMultiplierRaw) / WAD;
	if (rateTerm === 0n || positionTerm === 0n) return { rawPnlRaw, adjustedPnlRaw: 0n };
	const m = (WAD * WAD) / rateTerm;
	const h = (instrument.referenceNotionalRaw * WAD) / positionTerm;
	if (m > WAD * WAD || h > WAD * WAD) return { rawPnlRaw, adjustedPnlRaw: 0n };
	const keep = ((WAD - instrument.baseRateRaw) * WAD) / (WAD + m + h);
	return { rawPnlRaw, adjustedPnlRaw: (rawPnlRaw * keep) / WAD };
}

/** What a close at `exitRaw` pays: adjusted PnL less the win fee on a gain. */
export function payoutPnlRaw(adjustedPnlRaw, winFeeRateRaw) {
	const adj = BigInt(adjustedPnlRaw);
	if (adj <= 0n) return adj;
	return adj - (adj * BigInt(winFeeRateRaw)) / WAD;
}

/** Has the mark crossed the bust trigger? */
export function isBust(position, markRaw) {
	return position.isLong ? BigInt(markRaw) <= position.bustPriceRaw : BigInt(markRaw) >= position.bustPriceRaw;
}

/** How far toward bust a position has moved, 0 to 100. */
export function riskPercent(position, markRaw) {
	const mark = BigInt(markRaw);
	const span = position.isLong ? position.entryPriceRaw - position.bustPriceRaw : position.bustPriceRaw - position.entryPriceRaw;
	const against = position.isLong ? position.entryPriceRaw - mark : mark - position.entryPriceRaw;
	if (span <= 0n) return isBust(position, mark) ? 100 : 0;
	if (against <= 0n) return 0;
	if (against >= span) return 100;
	return Number((against * 10_000n) / span) / 100;
}

/**
 * The largest margin an open of this side and leverage can take right now:
 * the per-position notional cap and the side's open-interest headroom, both
 * divided by leverage. Mirrors the exchange's own pre-trade sizing.
 *
 * @returns {{ maxMarginRaw: bigint|null, limitedBy: string|null, headroomRaw: bigint|null }}
 */
export function openCapacity({ instrument, isLong, leverage, markRaw, maximumNetOpenInterestRaw = 0n }) {
	let maxMarginRaw = null;
	let limitedBy = null;
	const take = (value, reason) => {
		if (maxMarginRaw === null || value < maxMarginRaw) {
			maxMarginRaw = value;
			limitedBy = reason;
		}
	};
	if (leverage > instrument.maxLeverage) take(0n, 'leverage_above_market_max');
	if (instrument.maxPositionNotionalRaw > 0n) take(instrument.maxPositionNotionalRaw / BigInt(leverage), 'max_position_notional');
	let headroomRaw = null;
	const mark = markRaw == null ? null : BigInt(markRaw);
	if (mark !== null && mark > 0n) {
		const same = isLong ? instrument.longOiRaw : instrument.shortOiRaw;
		const other = isLong ? instrument.shortOiRaw : instrument.longOiRaw;
		const sideCap = isLong ? instrument.longCapRaw : instrument.shortCapRaw;
		const netCap = maximumNetOpenInterestRaw > 0n ? other + (maximumNetOpenInterestRaw * instrument.priceScaleRaw) / mark : null;
		const cap = sideCap > 0n && sideCap < UNCAPPED && (netCap === null || sideCap < netCap) ? sideCap : netCap;
		if (cap !== null) {
			headroomRaw = ((cap > same ? cap - same : 0n) * mark) / instrument.priceScaleRaw;
			take(headroomRaw / BigInt(leverage), isLong ? 'long_open_interest_cap' : 'short_open_interest_cap');
		}
	}
	return { maxMarginRaw, limitedBy, headroomRaw };
}
