// Cross-venue price comparison and two-leg arbitrage routes on Solana.
//
// Venues are discovered at runtime, never hardcoded: the swap aggregator
// (api/_lib/token/jupiter.js) is asked for the best direct route for the pair,
// the venue that route used is recorded and then excluded, and the question is
// asked again, until no further venue can fill the pair or MAX_VENUES is
// reached. Each discovered venue is then priced on its own (`dexes=<label>`,
// direct routes only), so every number is what that venue's own pool pays for
// the size asked, fees and price impact included. Venue names are the labels
// the aggregator reports: runtime data, shown as fields, never interpreted.
//
// arbitragePrices  buy and sell price for one pair on every venue that can
//                  fill it, the aggregate best route as the baseline, and the
//                  widest cross-venue spread.
// arbitrageQuote   the best two-leg route (buy on the cheapest venue, sell on
//                  the richest) with the expected profit after network fees.
//                  It never executes: each leg is handed back as the exact
//                  swap_quote arguments, so execution is two previewed,
//                  confirmed swap_execute calls. The legs are not atomic, so
//                  the result carries the risk in numbers: a worst case built
//                  from real quotes (leg 1 at its slippage floor, leg 2 re-sold
//                  at its floor, and the spread closing to the weakest venue),
//                  and a size cap it refuses above unless the caller accepts
//                  the risk explicitly.

import { jupiterQuote, jupiterVenueLabels } from '../token/jupiter.js';
import { PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID } from '../solana/programs.js';
import { fetchCexTicker } from '../cex-public.js';
import { solPriceUsd } from '../sol-price.js';
import { cacheWrap } from '../cache.js';
import { ToolInputError, WSOL_MINT, USDC_MINT, resolveMint, tokenDecimals, tokenSearch, getPrice } from './market.js';

/** The most venues priced individually for one pair. */
export const MAX_VENUES = 8;
// Discovery rounds: one route can split across several venues, so a round can
// find more than one; the round cap bounds the sequential calls either way.
const MAX_DISCOVERY_ROUNDS = 8;
const QUOTE_CONCURRENCY = 4;
const SLIPPAGE_BPS = 50;
// Two transactions, each a base fee plus a typical priority fee. Kept
// deliberately conservative so an "expected profit" is not an optimistic one.
export const LEG_FEE_LAMPORTS = 5_000 + 100_000;

const AGGREGATE_ID = 'auto';

/**
 * Slippage each leg is priced and executed at: the same default swap_quote
 * uses, so the worst case below is the floor swap_execute would accept.
 */
export const ARB_LEG_SLIPPAGE_BPS = 100;
/** arbitrage_quote refuses a size above this (USD) unless accept_size_risk is true. */
export const ARB_SIZE_CAP_USD = 100;
/** The size no override lifts: two unhedged legs are not a place for size. */
export const ARB_HARD_CAP_USD = 1000;

/** The venue id for a router label, as api/_lib/trading-tools/venues.js addresses it. */
export function venueId(label) {
	return `dex:${label}`;
}

/**
 * The router's labels for the launchpad's bonding curve and its graduated AMM,
 * resolved from their program ids at runtime (cached for an hour). Empty when
 * the label index is unreachable, so callers fall back to the launchpad's own
 * quote path rather than guessing.
 * @returns {Promise<string[]>}
 */
export async function launchpadLabels() {
	const labels = await cacheWrap('trading-tools:venue-labels:v1', 3600, () => jupiterVenueLabels()).catch(() => ({}));
	return [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID].map((id) => labels?.[id]).filter(Boolean);
}

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

function routeLabels(q) {
	return [...new Set((q?.routePlan || []).map((p) => p?.swapInfo?.label).filter(Boolean))];
}

/**
 * One ExactIn quote, cached briefly. Returns { outAmount, priceImpactPct, labels }
 * for a fill, { none: true } when the venue set has no pool for the pair, and
 * { error: true } on a transport failure (reported per venue, never as a price).
 */
async function quoteOnce({ inputMint, outputMint, amount, dexes = null, excludeDexes = null, direct = Boolean(dexes || excludeDexes) }) {
	const key = `trading-tools:arbq:v2:${inputMint}:${outputMint}:${amount}:${direct ? 'd' : 'a'}:${(dexes || []).join('|')}:${(excludeDexes || []).join('|')}`;
	return cacheWrap(key, 10, async () => {
		try {
			const r = await jupiterQuote({
				inputMint, outputMint, amount, slippageBps: SLIPPAGE_BPS,
				dexes, excludeDexes, onlyDirectRoutes: direct,
			});
			return r?.outAmount
				? { outAmount: String(r.outAmount), priceImpactPct: r.priceImpactPct, labels: routeLabels(r) }
				: { none: true };
		} catch (err) {
			const s = Number(err?.status);
			return s === 400 || s === 404 ? { none: true } : { error: true };
		}
	}).catch(() => ({ error: true }));
}

/**
 * Discover every venue that can fill `inputMint -> outputMint` directly at this
 * size, by asking for the best direct route and excluding what it used.
 * @returns {Promise<string[]>} venue labels, in discovery order
 */
export async function discoverVenues({ inputMint, outputMint, amount, max = MAX_VENUES }) {
	const found = [];
	for (let round = 0; round < MAX_DISCOVERY_ROUNDS && found.length < max; round++) {
		// Direct routes only, so every label names a pool of this exact pair.
		const q = await quoteOnce({ inputMint, outputMint, amount, excludeDexes: found.length ? found : null, direct: true });
		if (!q?.outAmount) break;
		const fresh = q.labels.filter((l) => !found.includes(l));
		if (!fresh.length) break;
		found.push(...fresh);
	}
	return found.slice(0, max);
}

/**
 * When discovery found no venue, tell an outage apart from a pair nothing can
 * fill: an empty venue list during a router outage is not a market reading.
 */
async function assertRouterReachable({ inputMint, outputMint, amount }) {
	const probe = await quoteOnce({ inputMint, outputMint, amount });
	if (probe?.error) {
		const e = new ToolInputError('router_unavailable', 'The venue router could not be reached, so no venue could be priced. This is an outage, not a market reading; try again in a minute.');
		e.status = 503;
		throw e;
	}
}

async function resolvePair({ token, quote }) {
	const base = await resolveMint(token);
	const q = quote ? await resolveMint(quote) : WSOL_MINT;
	if (base === q) throw new ToolInputError('invalid_pair', 'token and quote must differ.');
	const [bd, qd] = await Promise.all([tokenDecimals(base), tokenDecimals(q)]);
	return { base, quoteMint: q, baseDecimals: bd, quoteDecimals: qd };
}

/** A UI amount to base units in string space (no float multiply). */
export function toAtomic(amount, decimals) {
	const n = Number(amount);
	if (!Number.isFinite(n) || n <= 0) throw new ToolInputError('invalid_amount', 'amount must be a positive number of the quote token.');
	const [w, f = ''] = Number(amount).toFixed(decimals).split('.');
	return (BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

const human = (atomic, decimals) => Number(BigInt(atomic)) / 10 ** decimals;

/**
 * Price the discovered venues on both sides of a pair: what `amountIn` of the
 * quote token buys on each, and what the aggregate-sized token amount sells
 * back for on each.
 */
async function priceVenues(pair, amountIn, labels) {
	const buys = await mapLimit(labels, QUOTE_CONCURRENCY, (l) => quoteOnce({ inputMint: pair.quoteMint, outputMint: pair.base, amount: amountIn, dexes: [l] }));
	const aggBuy = await quoteOnce({ inputMint: pair.quoteMint, outputMint: pair.base, amount: amountIn });
	const sellSize = aggBuy?.outAmount || buys.find((b) => b?.outAmount)?.outAmount || null;
	const sells = sellSize
		? await mapLimit(labels, QUOTE_CONCURRENCY, (l) => quoteOnce({ inputMint: pair.base, outputMint: pair.quoteMint, amount: sellSize, dexes: [l] }))
		: labels.map(() => null);
	const aggSell = sellSize ? await quoteOnce({ inputMint: pair.base, outputMint: pair.quoteMint, amount: sellSize }) : null;
	return { buys, sells, aggBuy, aggSell, sellSize };
}

function venueRow({ id, name, buy, sell, sellSize, amount, pair }) {
	const tokensOut = buy?.outAmount ? human(buy.outAmount, pair.baseDecimals) : null;
	const quoteBack = sell?.outAmount ? human(sell.outAmount, pair.quoteDecimals) : null;
	const sellTokens = sellSize ? human(sellSize, pair.baseDecimals) : null;
	return {
		venue: id,
		name,
		status: buy?.outAmount || sell?.outAmount ? 'ok' : buy?.error || sell?.error ? 'error' : 'no_pool',
		buy: tokensOut
			? { tokens_out: tokensOut, price: Number(amount) / tokensOut, price_impact_pct: buy.priceImpactPct != null ? Number(buy.priceImpactPct) * 100 : null }
			: null,
		sell: quoteBack && sellTokens
			? { tokens_in: sellTokens, quote_out: quoteBack, price: quoteBack / sellTokens, price_impact_pct: sell.priceImpactPct != null ? Number(sell.priceImpactPct) * 100 : null }
			: null,
	};
}

/**
 * Price one pair on every venue that can fill it: what `amount` of the quote
 * token buys there, and what those tokens sell back for.
 * @param {{ token: string, quote?: string, amount?: number|string }} args
 */
export async function arbitragePrices({ token, quote = 'SOL', amount = 1 }) {
	const pair = await resolvePair({ token, quote });
	const amountIn = toAtomic(amount, pair.quoteDecimals);
	const labels = await discoverVenues({ inputMint: pair.quoteMint, outputMint: pair.base, amount: amountIn });
	if (!labels.length) await assertRouterReachable({ inputMint: pair.quoteMint, outputMint: pair.base, amount: amountIn });
	const priced = await priceVenues(pair, amountIn, labels);

	const venueRows = labels.map((label, i) => venueRow({
		id: venueId(label), name: label, buy: priced.buys[i], sell: priced.sells[i], sellSize: priced.sellSize, amount, pair,
	}));
	const aggregate = venueRow({ id: AGGREGATE_ID, name: 'Best route (aggregated)', buy: priced.aggBuy, sell: priced.aggSell, sellSize: priced.sellSize, amount, pair });

	const venuesOk = venueRows.filter((r) => r.buy || r.sell);
	const bestBuy = venuesOk.filter((r) => r.buy).sort((a, b) => a.buy.price - b.buy.price)[0] || null;
	const bestSell = venuesOk.filter((r) => r.sell).sort((a, b) => b.sell.price - a.sell.price)[0] || null;
	const spreadPct = bestBuy && bestSell && bestBuy.venue !== bestSell.venue
		? ((bestSell.sell.price - bestBuy.buy.price) / bestBuy.buy.price) * 100
		: null;

	// Off-chain reference: the first healthy centralized ticker for the symbol,
	// when one lists it. Shown for context, never routable.
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
		venues_quoted: venuesOk.length,
		venues: venueRows,
		aggregate,
		best_buy: bestBuy ? { venue: bestBuy.venue, name: bestBuy.name, price: bestBuy.buy.price } : null,
		best_sell: bestSell ? { venue: bestSell.venue, name: bestSell.name, price: bestSell.sell.price } : null,
		gross_spread_pct: spreadPct,
		reference,
		quoted_at: new Date().toISOString(),
	};
}

/** Network fees for two legs, expressed in the quote token, or null when unpriceable. */
export function twoLegFeeInQuote(quoteMint, solUsd) {
	const feeSol = (2 * LEG_FEE_LAMPORTS) / 1e9;
	if (quoteMint === WSOL_MINT) return feeSol;
	if (quoteMint === USDC_MINT && solUsd) return feeSol * solUsd;
	return null;
}

/**
 * Rank buy-venue x sell-venue candidates by net profit. Pure.
 * @param {{ buy: { venue: string, tokens_atomic: string }, sell: { venue: string, out: number } }[]} candidates
 */
export function rankRoutes(candidates, amount, feeInQuote) {
	return candidates
		.map((c) => {
			const gross = c.sell.out - Number(amount);
			const net = feeInQuote != null ? gross - feeInQuote : null;
			return { ...c, gross, net };
		})
		.sort((a, b) => (b.net ?? b.gross) - (a.net ?? a.gross));
}

/** Apply a slippage floor in base units: what a leg is allowed to return at worst. */
export function slippageFloor(atomic, bps) {
	return (BigInt(atomic) * BigInt(10_000 - bps)) / 10_000n;
}

/**
 * The size gate. Pure: the caller prices the size, this decides.
 * @returns {{ ok: true, size_usd: number|null, cap_usd: number, hard_cap_usd: number, above_default_cap: boolean } | { ok: false, code: string, message: string }}
 */
export function checkArbSize({ sizeUsd, accept = false, cap = ARB_SIZE_CAP_USD, hardCap = ARB_HARD_CAP_USD }) {
	const base = { cap_usd: cap, hard_cap_usd: hardCap };
	if (sizeUsd == null || !Number.isFinite(sizeUsd)) {
		return { ok: false, code: 'size_unpriced', message: 'Could not price this size in USD, so it cannot be checked against the size cap. Quote against SOL or USDC instead.', ...base };
	}
	if (sizeUsd > hardCap) {
		return { ok: false, code: 'size_above_hard_cap', message: `$${sizeUsd.toFixed(2)} is above the $${hardCap} ceiling for an unhedged two-leg route. Split it or size down.`, ...base };
	}
	if (sizeUsd > cap && !accept) {
		return {
			ok: false,
			code: 'size_above_cap',
			message: `$${sizeUsd.toFixed(2)} is above the $${cap} default cap for a non-atomic route. Leg 2 can fail or reprice after leg 1 fills, leaving you holding the token. Pass accept_size_risk: true to quote up to $${hardCap}.`,
			...base,
		};
	}
	return { ok: true, size_usd: sizeUsd, above_default_cap: sizeUsd > cap, ...base };
}

/**
 * The simulated worst case of a two-leg route, from real quotes. Pure.
 *
 * @param {object} o
 * @param {number} o.amount            quote-token amount leg 1 pays
 * @param {number|null} o.feeInQuote   both legs' network fees in the quote token
 * @param {number} o.expectedOut       leg 2's expected proceeds at the quoted size
 * @param {number} o.slippedOut        leg 2's quoted proceeds for leg 1's slippage-floor tokens on the sell venue
 * @param {number|null} o.closedOut    the same tokens sold on the weakest venue that quoted (the spread closed)
 * @param {number} o.slippageBps       the per-leg slippage floor
 */
export function worstCase({ amount, feeInQuote, expectedOut, slippedOut, closedOut, slippageBps }) {
	const floor = (x) => (x == null ? null : x * (1 - slippageBps / 10_000));
	const fees = feeInQuote ?? 0;
	const slipped = floor(slippedOut);
	const closed = floor(closedOut);
	const worstOut = closed != null ? Math.min(slipped, closed) : slipped;
	const net = (out) => (out == null ? null : out - Number(amount) - fees);
	const worstNet = net(worstOut);
	return {
		scenarios: [
			{ id: 'expected', description: 'Both legs fill at the quoted prices.', quote_out: expectedOut, net_profit: net(expectedOut) },
			{
				id: 'both_legs_slip',
				description: `Leg 1 returns its ${slippageBps / 100}% slippage floor of tokens and leg 2 sells them at its own floor on the same venue.`,
				quote_out: slipped,
				net_profit: net(slipped),
			},
			closed != null
				? {
					id: 'spread_closes',
					description: 'By the time leg 2 is quoted the spread has closed: the tokens sell at the weakest venue that quoted, at its slippage floor. This is also what you hold if leg 2 fails and you unwind later.',
					quote_out: closed,
					net_profit: net(closed),
				}
				: null,
		].filter(Boolean),
		worst_quote_out: worstOut,
		worst_net_profit: worstNet,
		max_loss: worstNet != null && worstNet < 0 ? -worstNet : 0,
		max_loss_pct: worstNet != null && worstNet < 0 ? (-worstNet / Number(amount)) * 100 : 0,
		fees_counted: feeInQuote != null,
	};
}

/**
 * The verdict an agent should act on. Pure. 'viable' only when the expected
 * edge is positive AND the worst case loses less than the edge earns.
 */
export function arbVerdict({ expectedNet, worst }) {
	if (expectedNet == null || expectedNet <= 0) return { verdict: 'unprofitable', reason: 'The expected profit does not clear both legs and their network fees.' };
	if (worst.max_loss >= expectedNet) {
		return { verdict: 'risk_exceeds_edge', reason: `The worst case loses ${worst.max_loss.toPrecision(4)}, at least as much as the expected edge of ${expectedNet.toPrecision(4)}. Skip it or size down.` };
	}
	return { verdict: 'viable', reason: 'The expected edge is positive and larger than the simulated worst-case loss. The legs are still separate transactions.' };
}

async function sizeInUsd(pair, amount) {
	if (pair.quoteMint === USDC_MINT) return Number(amount);
	if (pair.quoteMint === WSOL_MINT) {
		const solUsd = await solPriceUsd().catch(() => null);
		return solUsd ? Number(amount) * solUsd : null;
	}
	const p = await getPrice({ mint: pair.quoteMint }).catch(() => null);
	return p?.price_usd ? Number(amount) * p.price_usd : null;
}

/**
 * The best two-leg route for a pair: buy on one venue, sell on another, with
 * the expected profit after both legs' network fees, the non-atomic risk and a
 * simulated worst case. Refuses above ARB_SIZE_CAP_USD unless accept_size_risk.
 * @param {{ token: string, quote?: string, amount?: number|string, accept_size_risk?: boolean }} args
 */
export async function arbitrageQuote({ token, quote = 'SOL', amount = 1, accept_size_risk: acceptSizeRisk = false }) {
	const pair = await resolvePair({ token, quote });
	const amountIn = toAtomic(amount, pair.quoteDecimals);
	const size = checkArbSize({ sizeUsd: await sizeInUsd(pair, amount), accept: acceptSizeRisk === true });
	if (!size.ok) {
		throw new ToolInputError(size.code, size.message, { cap_usd: size.cap_usd, hard_cap_usd: size.hard_cap_usd, parameter: 'amount' });
	}
	const labels = await discoverVenues({ inputMint: pair.quoteMint, outputMint: pair.base, amount: amountIn });
	if (!labels.length) await assertRouterReachable({ inputMint: pair.quoteMint, outputMint: pair.base, amount: amountIn });

	const buys = await mapLimit(labels, QUOTE_CONCURRENCY, (l) => quoteOnce({ inputMint: pair.quoteMint, outputMint: pair.base, amount: amountIn, dexes: [l] }));
	const buyable = labels.map((label, i) => ({ label, q: buys[i] })).filter((x) => x.q?.outAmount);
	if (buyable.length < 2) {
		throw new ToolInputError('insufficient_venues', `Only ${buyable.length} venue(s) can fill this pair at this size, so there is no cross-venue route.`, {
			venues_quoted: buyable.map((x) => venueId(x.label)),
		});
	}
	buyable.sort((a, b) => (BigInt(b.q.outAmount) > BigInt(a.q.outAmount) ? 1 : -1));

	// The two richest buy venues against every other venue's sell.
	const candidates = [];
	for (const buy of buyable.slice(0, 2)) {
		const others = labels.filter((l) => l !== buy.label);
		const sells = await mapLimit(others, QUOTE_CONCURRENCY, (l) => quoteOnce({ inputMint: pair.base, outputMint: pair.quoteMint, amount: buy.q.outAmount, dexes: [l] }));
		others.forEach((label, i) => {
			if (sells[i]?.outAmount) {
				candidates.push({
					buy: { venue: buy.label, tokens_atomic: buy.q.outAmount },
					sell: { venue: label, out: human(sells[i].outAmount, pair.quoteDecimals) },
				});
			}
		});
	}
	if (!candidates.length) throw new ToolInputError('no_route', 'No second venue can buy back what the first leg returns.');

	const solUsd = await solPriceUsd().catch(() => null);
	const feeInQuote = twoLegFeeInQuote(pair.quoteMint, solUsd);
	const scored = rankRoutes(candidates, amount, feeInQuote);
	const best = scored[0];
	const tokens = human(best.buy.tokens_atomic, pair.baseDecimals);

	// Worst case, from fresh quotes at the slippage-floor token count: the same
	// sell venue, and the weakest venue that quoted this buy's tokens.
	const floorTokens = slippageFloor(best.buy.tokens_atomic, ARB_LEG_SLIPPAGE_BPS).toString();
	const weakest = scored.filter((c) => c.buy.venue === best.buy.venue).sort((a, b) => a.sell.out - b.sell.out)[0];
	const [slippedQ, closedQ] = await Promise.all([
		quoteOnce({ inputMint: pair.base, outputMint: pair.quoteMint, amount: floorTokens, dexes: [best.sell.venue] }),
		weakest && weakest.sell.venue !== best.sell.venue
			? quoteOnce({ inputMint: pair.base, outputMint: pair.quoteMint, amount: floorTokens, dexes: [weakest.sell.venue] })
			: null,
	]);
	if (!slippedQ?.outAmount) {
		throw new ToolInputError('worst_case_unavailable', 'Could not re-quote leg 2 at its slippage floor, so the worst case cannot be shown. Nothing is quoted without it; try again in a moment.');
	}
	const worst = worstCase({
		amount,
		feeInQuote,
		expectedOut: best.sell.out,
		slippedOut: human(slippedQ.outAmount, pair.quoteDecimals),
		closedOut: closedQ?.outAmount ? human(closedQ.outAmount, pair.quoteDecimals) : null,
		slippageBps: ARB_LEG_SLIPPAGE_BPS,
	});
	const verdict = arbVerdict({ expectedNet: best.net ?? best.gross, worst });
	const toUsd = (v) => (v == null ? null : pair.quoteMint === USDC_MINT ? v : pair.quoteMint === WSOL_MINT && solUsd ? v * solUsd : null);

	return {
		token: pair.base,
		quote: pair.quoteMint,
		amount_in: Number(amount),
		size,
		venues_quoted: labels.length,
		profitable: best.net != null ? best.net > 0 : best.gross > 0,
		...verdict,
		expected: {
			quote_out: best.sell.out,
			gross_profit: best.gross,
			network_fees: feeInQuote,
			net_profit: best.net,
			net_profit_pct: best.net != null ? (best.net / Number(amount)) * 100 : null,
			net_profit_usd: toUsd(best.net),
		},
		worst_case: {
			...worst,
			max_loss_usd: toUsd(worst.max_loss),
			inputs: {
				slippage_bps_per_leg: ARB_LEG_SLIPPAGE_BPS,
				leg1_tokens_expected: tokens,
				leg1_tokens_at_floor: human(floorTokens, pair.baseDecimals),
				sell_venue: venueId(best.sell.venue),
				weakest_venue: weakest && closedQ?.outAmount ? venueId(weakest.sell.venue) : null,
				network_fee_lamports_per_leg: LEG_FEE_LAMPORTS,
			},
		},
		risk: {
			atomic: false,
			summary: 'The two legs are separate transactions. Leg 1 can fill and leg 2 can then fail, reprice or be front-run, leaving you holding the token. Nothing here protects against that except sizing.',
			factors: [
				{ id: 'leg_gap', detail: 'Leg 2 is quoted and signed after leg 1 confirms; any price move in between is yours.' },
				{ id: 'slippage', detail: `Each leg accepts up to ${ARB_LEG_SLIPPAGE_BPS / 100}% slippage; the worst case above prices both at that floor.` },
				{ id: 'stranded_inventory', detail: 'If leg 2 fails you hold the leg 1 tokens; the spread_closes scenario is what they fetch at the weakest venue.' },
				{ id: 'guards', detail: 'Each leg runs the full trade guard chain on its own (spend caps, price-impact breaker, rug firewall), so leg 2 can be refused after leg 1 filled.' },
			],
		},
		legs: [
			{
				step: 1, action: 'buy', venue: venueId(best.buy.venue), venue_name: best.buy.venue,
				pays: Number(amount), receives_tokens: tokens,
				swap_quote: { input_mint: pair.quoteMint, output_mint: pair.base, amount: Number(amount), dex: venueId(best.buy.venue), slippage_bps: ARB_LEG_SLIPPAGE_BPS },
			},
			{
				step: 2, action: 'sell', venue: venueId(best.sell.venue), venue_name: best.sell.venue,
				sells_tokens: tokens, receives: best.sell.out,
				swap_quote: { input_mint: pair.base, output_mint: pair.quoteMint, amount: tokens, dex: venueId(best.sell.venue), slippage_bps: ARB_LEG_SLIPPAGE_BPS },
			},
		],
		alternatives: scored.slice(1, 4).map((c) => ({ buy_venue: venueId(c.buy.venue), sell_venue: venueId(c.sell.venue), gross_profit: c.gross, net_profit: c.net })),
		execution:
			'Not atomic. Execute leg 1 with swap_quote then swap_execute, then quote leg 2 fresh with the tokens leg 1 actually returned (the price will have moved) and execute it only if it still clears the fees. Each leg is a separate confirmed swap.',
		quoted_at: new Date().toISOString(),
	};
}
