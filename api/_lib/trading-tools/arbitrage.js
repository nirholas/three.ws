// Cross-venue price comparison and two-leg arbitrage routes on Solana.
//
// Every venue is priced the same way: a Jupiter ExactIn quote restricted to
// that one venue (`dexes=<label>`) with direct routes only, so the number is
// what that venue's own pool pays for the size asked, fees and price impact
// included. The aggregate best route is quoted alongside as the baseline.
//
// arbitragePrices  buy and sell price for one pair on every venue that can
//                  fill it, plus the widest cross-venue spread.
// arbitrageQuote   the best two-leg route (buy on the cheapest venue, sell on
//                  the richest) with the expected profit after network fees.
//                  It never executes: each leg is handed back as the exact
//                  swap_quote arguments, so execution is two previewed,
//                  confirmed swap_execute calls. The legs are not atomic; the
//                  second one is re-priced when it is quoted, and the result
//                  says so.

import { jupiterQuote } from '../token/jupiter.js';
import { fetchCexTicker } from '../cex-public.js';
import { solPriceUsd } from '../sol-price.js';
import { cacheWrap } from '../cache.js';
import { ToolInputError, WSOL_MINT, USDC_MINT, resolveMint, tokenDecimals, tokenSearch } from './market.js';

/** The Solana venues priced individually, by the label Jupiter routes them under. */
export const ARB_VENUES = Object.freeze([
	{ id: 'orca-whirlpool', label: 'Whirlpool', name: 'Orca Whirlpools' },
	{ id: 'raydium-clmm', label: 'Raydium CLMM', name: 'Raydium CLMM' },
	{ id: 'raydium-amm', label: 'Raydium', name: 'Raydium AMM' },
	{ id: 'raydium-cpmm', label: 'Raydium CP', name: 'Raydium CPMM' },
	{ id: 'meteora-dlmm', label: 'Meteora DLMM', name: 'Meteora DLMM' },
	{ id: 'meteora-damm', label: 'Meteora DAMM v2', name: 'Meteora DAMM v2' },
	{ id: 'pump-amm', label: 'Pump.fun Amm', name: 'PumpSwap AMM' },
	{ id: 'pump-curve', label: 'Pump.fun', name: 'Pump.fun bonding curve' },
	{ id: 'solfi', label: 'SolFi V2', name: 'SolFi' },
	{ id: 'humidifi', label: 'HumidiFi', name: 'HumidiFi' },
]);
const AGGREGATE = { id: 'jupiter', label: null, name: 'Jupiter best route' };
const VENUE_BY_ID = new Map(ARB_VENUES.map((v) => [v.id, v]));

/** Venue id or Jupiter label -> venue, or null for the aggregate route. */
export function venueFor(idOrLabel) {
	if (idOrLabel == null || idOrLabel === '' || idOrLabel === 'jupiter') return null;
	const v = VENUE_BY_ID.get(idOrLabel) || ARB_VENUES.find((x) => x.label.toLowerCase() === String(idOrLabel).toLowerCase());
	if (!v) throw new ToolInputError('invalid_venue', `Unknown venue "${idOrLabel}". Use one of: jupiter, ${ARB_VENUES.map((x) => x.id).join(', ')}.`);
	return v;
}

// Two transactions, each a base fee plus a typical priority fee. Kept
// deliberately conservative so an "expected profit" is not an optimistic one.
const LEG_FEE_LAMPORTS = 5_000 + 100_000;
const QUOTE_CONCURRENCY = 4;
const SLIPPAGE_BPS = 50;

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return out;
}

/** One venue's ExactIn quote, or null when the venue cannot fill it. Cached briefly. */
async function venueQuote(venue, inputMint, outputMint, amount) {
	const key = `trading-tools:arbq:v1:${venue.id}:${inputMint}:${outputMint}:${amount}`;
	const q = await cacheWrap(key, 10, async () => {
		try {
			const r = await jupiterQuote({
				inputMint, outputMint, amount, slippageBps: SLIPPAGE_BPS,
				dexes: venue.label ? [venue.label] : null,
				onlyDirectRoutes: Boolean(venue.label),
			});
			return r?.outAmount ? { outAmount: String(r.outAmount), priceImpactPct: r.priceImpactPct, route: (r.routePlan || []).map((p) => p?.swapInfo?.label).filter(Boolean) } : { none: true };
		} catch (err) {
			// 400/404 are "this venue has no pool for the pair", an answer; the
			// rest are transport failures, reported per venue, never as a price.
			const s = Number(err?.status);
			return s === 400 || s === 404 ? { none: true } : { error: true };
		}
	}).catch(() => ({ error: true }));
	return q;
}

async function resolvePair({ token, quote }) {
	const base = await resolveMint(token);
	const q = quote ? await resolveMint(quote) : WSOL_MINT;
	if (base === q) throw new ToolInputError('invalid_pair', 'token and quote must differ.');
	const [bd, qd] = await Promise.all([tokenDecimals(base), tokenDecimals(q)]);
	return { base, quoteMint: q, baseDecimals: bd, quoteDecimals: qd };
}

function toAtomic(amount, decimals) {
	const n = Number(amount);
	if (!Number.isFinite(n) || n <= 0) throw new ToolInputError('invalid_amount', 'amount must be a positive number of the quote token.');
	const [w, f = ''] = String(amount).split('.');
	return (BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

const human = (atomic, decimals) => Number(BigInt(atomic)) / 10 ** decimals;

/**
 * Price one pair on every venue: what `amount` of the quote token buys there,
 * and what those tokens sell back for.
 * @param {{ token: string, quote?: string, amount?: number|string, venues?: string[] }} args
 */
export async function arbitragePrices({ token, quote = 'SOL', amount = 1, venues = null }) {
	const pair = await resolvePair({ token, quote });
	const amountIn = toAtomic(amount, pair.quoteDecimals);
	const pool = venues?.length ? venues.map((v) => venueFor(v)).filter(Boolean) : ARB_VENUES;
	const all = [AGGREGATE, ...pool];

	const buys = await mapLimit(all, QUOTE_CONCURRENCY, (v) => venueQuote(v, pair.quoteMint, pair.base, amountIn));
	const aggBuy = buys[0];
	// Sell side is priced for the token amount the aggregate buy returns, so
	// every venue is compared on the same size.
	const sellSize = aggBuy?.outAmount || buys.find((b) => b?.outAmount)?.outAmount || null;
	const sells = sellSize
		? await mapLimit(all, QUOTE_CONCURRENCY, (v) => venueQuote(v, pair.base, pair.quoteMint, sellSize))
		: all.map(() => null);

	const rows = all.map((v, i) => {
		const b = buys[i];
		const s = sells[i];
		const tokensOut = b?.outAmount ? human(b.outAmount, pair.baseDecimals) : null;
		const quoteBack = s?.outAmount ? human(s.outAmount, pair.quoteDecimals) : null;
		const sellTokens = sellSize ? human(sellSize, pair.baseDecimals) : null;
		return {
			venue: v.id,
			name: v.name,
			status: b?.outAmount || s?.outAmount ? 'ok' : b?.error || s?.error ? 'error' : 'no_pool',
			buy: tokensOut ? { tokens_out: tokensOut, price: Number(amount) / tokensOut, price_impact_pct: b.priceImpactPct != null ? Number(b.priceImpactPct) * 100 : null } : null,
			sell: quoteBack && sellTokens ? { tokens_in: sellTokens, quote_out: quoteBack, price: quoteBack / sellTokens, price_impact_pct: s.priceImpactPct != null ? Number(s.priceImpactPct) * 100 : null } : null,
			executable: true,
		};
	});

	const venuesOk = rows.filter((r) => r.venue !== 'jupiter' && (r.buy || r.sell));
	const bestBuy = venuesOk.filter((r) => r.buy).sort((a, b) => a.buy.price - b.buy.price)[0] || null;
	const bestSell = venuesOk.filter((r) => r.sell).sort((a, b) => b.sell.price - a.sell.price)[0] || null;
	const spreadPct = bestBuy && bestSell && bestBuy.venue !== bestSell.venue
		? ((bestSell.sell.price - bestBuy.buy.price) / bestBuy.buy.price) * 100
		: null;

	// Off-chain reference: the first healthy centralized venue's ticker, when
	// the token is listed there. Shown for context, never routable.
	let reference = null;
	const sym = await tokenSearch({ query: pair.base, limit: 1, deep: false }).then((r) => r.best?.symbol).catch(() => null);
	if (sym) {
		const t = await fetchCexTicker(sym).catch(() => null);
		if (t?.price) reference = { symbol: sym, price_usd: t.price, source: t.source, executable: false };
	}

	return {
		token: pair.base,
		quote: pair.quoteMint,
		amount_in: Number(amount),
		venues_quoted: rows.filter((r) => r.status === 'ok').length,
		venues: rows,
		best_buy: bestBuy ? { venue: bestBuy.venue, price: bestBuy.buy.price } : null,
		best_sell: bestSell ? { venue: bestSell.venue, price: bestSell.sell.price } : null,
		gross_spread_pct: spreadPct,
		reference,
		quoted_at: new Date().toISOString(),
	};
}

/**
 * The best two-leg route for a pair: buy on one venue, sell on another, with
 * the expected profit after both legs' network fees.
 * @param {{ token: string, quote?: string, amount?: number|string }} args
 */
export async function arbitrageQuote({ token, quote = 'SOL', amount = 1 }) {
	const pair = await resolvePair({ token, quote });
	const amountIn = toAtomic(amount, pair.quoteDecimals);

	const buys = await mapLimit(ARB_VENUES, QUOTE_CONCURRENCY, (v) => venueQuote(v, pair.quoteMint, pair.base, amountIn));
	const buyable = ARB_VENUES.map((v, i) => ({ v, q: buys[i] })).filter((x) => x.q?.outAmount);
	if (buyable.length < 2) {
		throw new ToolInputError('insufficient_venues', `Only ${buyable.length} venue(s) can fill this pair at this size, so there is no cross-venue route.`, {
			venues_quoted: buyable.map((x) => x.v.id),
		});
	}
	buyable.sort((a, b) => (BigInt(b.q.outAmount) > BigInt(a.q.outAmount) ? 1 : -1));

	// Try the two cheapest buy venues against every other venue's sell.
	const candidates = [];
	for (const buy of buyable.slice(0, 2)) {
		const others = ARB_VENUES.filter((v) => v.id !== buy.v.id);
		const sells = await mapLimit(others, QUOTE_CONCURRENCY, (v) => venueQuote(v, pair.base, pair.quoteMint, buy.q.outAmount));
		others.forEach((v, i) => {
			if (sells[i]?.outAmount) candidates.push({ buy, sell: { v, q: sells[i] } });
		});
	}
	if (!candidates.length) throw new ToolInputError('no_route', 'No second venue can buy back what the first leg returns.');

	const solUsd = await solPriceUsd().catch(() => null);
	const feeLamports = 2 * LEG_FEE_LAMPORTS;
	let feeInQuote;
	if (pair.quoteMint === WSOL_MINT) feeInQuote = feeLamports / 1e9;
	else if (pair.quoteMint === USDC_MINT && solUsd) feeInQuote = (feeLamports / 1e9) * solUsd;
	else feeInQuote = null;

	const scored = candidates.map((c) => {
		const out = human(c.sell.q.outAmount, pair.quoteDecimals);
		const gross = out - Number(amount);
		const net = feeInQuote != null ? gross - feeInQuote : null;
		return { ...c, out, gross, net };
	}).sort((a, b) => (b.net ?? b.gross) - (a.net ?? a.gross));
	const best = scored[0];
	const tokens = human(best.buy.q.outAmount, pair.baseDecimals);

	return {
		token: pair.base,
		quote: pair.quoteMint,
		amount_in: Number(amount),
		profitable: best.net != null ? best.net > 0 : best.gross > 0,
		expected: {
			quote_out: best.out,
			gross_profit: best.gross,
			network_fees: feeInQuote,
			net_profit: best.net,
			net_profit_pct: best.net != null ? (best.net / Number(amount)) * 100 : null,
			net_profit_usd: best.net != null && pair.quoteMint === WSOL_MINT && solUsd ? best.net * solUsd : pair.quoteMint === USDC_MINT ? best.net : null,
		},
		legs: [
			{
				step: 1, action: 'buy', venue: best.buy.v.id, venue_name: best.buy.v.name,
				pays: Number(amount), receives_tokens: tokens,
				swap_quote: { input_mint: pair.quoteMint, output_mint: pair.base, amount: Number(amount), venue: best.buy.v.id },
			},
			{
				step: 2, action: 'sell', venue: best.sell.v.id, venue_name: best.sell.v.name,
				sells_tokens: tokens, receives: best.out,
				swap_quote: { input_mint: pair.base, output_mint: pair.quoteMint, amount: tokens, venue: best.sell.v.id },
			},
		],
		alternatives: scored.slice(1, 4).map((c) => ({ buy_venue: c.buy.v.id, sell_venue: c.sell.v.id, gross_profit: c.gross, net_profit: c.net })),
		execution:
			'Not atomic. Execute leg 1 with swap_quote then swap_execute, then quote leg 2 fresh (the price will have moved) and execute it only if it still clears the fees. Each leg is a separate confirmed swap.',
		quoted_at: new Date().toISOString(),
	};
}
