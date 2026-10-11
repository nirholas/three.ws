// The markets a paired coin can trade in, and the rules for picking them.
//
// The launchpad's quote registry decides WHICH assets a coin may pair against.
// This layer adds what the contract cannot know: what kind of asset each one is
// (tokenized stock, stablecoin, major, chain-native coin), its live USD price,
// and what a new pool in it opens at in dollars. Classification and prices come
// from the Robinhood Chain universe (data/hood-portfolios-universe.json, re-priced
// live), which also resolves ticker impersonation by contract address. Pairing is
// always by address; a symbol is only ever a lookup key into the registry.

import { formatUnits, parseUnits } from 'viem';
import { BPS, MAX_MARKETS, quoteRegistry } from './paired-launchpad.js';
import { liveUniverse } from './hood-portfolios.js';
import { dexPairsForToken } from './robinhood.js';

export const MARKET_CLASSES = ['rwa-equity', 'stablecoin', 'crypto-major', 'crypto-native'];

export const CLASS_LABELS = {
	'rwa-equity': 'Stock',
	stablecoin: 'Stablecoin',
	'crypto-major': 'Major',
	'crypto-native': 'Chain coin',
	unlisted: 'Unlisted',
};

export class PairedMarketError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.name = 'PairedMarketError';
		this.status = status;
	}
}

/**
 * Price and depth for an asset the universe could not see. Assets like USDG
 * and the chain's own coins mostly sit on the QUOTE side of their pools, which
 * a base-token lookup never sees, so the price is derived from the pool (base
 * USD price divided by base-per-quote) and the depth is the sum of every pool
 * it quotes. A classified stablecoin with no readable pool falls back to its
 * peg for price.
 */
export async function dexFallback(address, assetClass) {
	const want = String(address).toLowerCase();
	const pairs = await dexPairsForToken(want).catch(() => []);
	let priceUsd = null;
	let liquidityUsd = 0;
	for (const p of pairs) {
		const pairUsd = Number(p.priceUsd);
		const priceNative = Number(p.priceNative);
		const isBase = String(p.baseToken?.address).toLowerCase() === want;
		const isQuote = String(p.quoteToken?.address).toLowerCase() === want;
		if (!isBase && !isQuote) continue;
		liquidityUsd += Number(p.liquidity?.usd) || 0;
		if (priceUsd != null || !(pairUsd > 0)) continue;
		if (isBase) priceUsd = pairUsd;
		else if (priceNative > 0) priceUsd = pairUsd / priceNative;
	}
	if (priceUsd == null && assetClass === 'stablecoin') priceUsd = 1;
	return { priceUsd, liquidityUsd };
}

/**
 * Every registered quote with its class and live price. `openingValueUsd` is
 * the dollar market cap a coin opens at with 100% of its supply in this pool:
 * the virtual reserve, which is the curve's starting market cap in the quote.
 */
export async function pairedMarkets({ includeDisabled = false } = {}) {
	const [registry, universe] = await Promise.all([
		quoteRegistry(),
		liveUniverse().catch(() => ({ tokens: [] })),
	]);
	const byAddress = new Map(universe.tokens.map((t) => [t.address.toLowerCase(), t]));

	const rows = await Promise.all(registry.map(async (q) => {
		const u = byAddress.get(q.address.toLowerCase());
		const fallback = u?.priceUsd ? null : await dexFallback(q.address, u?.assetClass);
		const priceUsd = u?.priceUsd ?? fallback?.priceUsd ?? null;
		return {
			address: q.address,
			symbol: q.symbol,
			name: q.name,
			decimals: q.decimals,
			enabled: q.enabled,
			assetClass: u?.assetClass ?? 'unlisted',
			classLabel: CLASS_LABELS[u?.assetClass] ?? CLASS_LABELS.unlisted,
			// A registered quote the universe flags as a ticker squatter is still
			// shown (the chain lets coins pair with it), but never unmarked.
			canonical: u ? u.canonical : null,
			priceUsd,
			liquidityUsd: fallback ? fallback.liquidityUsd : (u?.liquidityUsd ?? null),
			change24hPct: u?.change24hPct ?? null,
			virtualQuote: q.virtualQuote,
			openingValueUsd: priceUsd != null ? Number(q.virtualQuote) * priceUsd : null,
		};
	}));

	const order = (r) => {
		const i = MARKET_CLASSES.indexOf(r.assetClass);
		return i === -1 ? MARKET_CLASSES.length : i;
	};
	return rows
		.filter((r) => includeDisabled || r.enabled)
		.sort((a, b) => order(a) - order(b) || (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0) || a.symbol.localeCompare(b.symbol));
}

/** Split 100% evenly in basis points, handing the remainder to the first markets. */
export function evenWeights(count) {
	const base = Math.floor(BPS / count);
	const weights = Array.from({ length: count }, () => base);
	let remainder = BPS - base * count;
	for (let i = 0; remainder > 0; i = (i + 1) % count, remainder--) weights[i] += 1;
	return weights;
}

/** Accepts `NVDA`, `$nvda`, the tokenized `NVDAx`, or a 0x address. */
function matchMarket(markets, raw) {
	const text = String(raw ?? '').trim();
	if (/^0x[0-9a-fA-F]{40}$/.test(text)) {
		return markets.find((m) => m.address.toLowerCase() === text.toLowerCase()) ?? null;
	}
	const key = text.replace(/^\$/, '').toUpperCase();
	if (!key) return null;
	const exact = markets.filter((m) => m.symbol.toUpperCase() === key);
	const found = exact.length ? exact : key.endsWith('X') ? markets.filter((m) => m.symbol.toUpperCase() === key.slice(0, -1)) : [];
	if (found.length > 1) {
		throw new PairedMarketError(`More than one market is called ${key}. Pass its contract address instead: ${found.map((m) => m.address).join(', ')}.`);
	}
	return found[0] ?? null;
}

/**
 * Resolve what a caller asked to pair with into allocations the contract will
 * accept: one to five distinct enabled quotes whose weights total exactly 100%.
 * `weights` are percentages (e.g. [50, 30, 20]); omitted means an even split.
 */
export async function resolveAllocations(requested, weights) {
	const list = Array.isArray(requested) ? requested : String(requested ?? '').split(',');
	const wanted = list.map((s) => String(s).trim()).filter(Boolean);
	if (!wanted.length) throw new PairedMarketError('Pick at least one market to pair against.');
	if (wanted.length > MAX_MARKETS) throw new PairedMarketError(`A coin can pair with at most ${MAX_MARKETS} markets.`);

	const markets = await pairedMarkets();
	const picked = wanted.map((w) => {
		const m = matchMarket(markets, w);
		if (!m) throw new PairedMarketError(`${w} is not a market on the paired launchpad. List the markets to see what a coin can pair against.`);
		return m;
	});
	if (new Set(picked.map((m) => m.address.toLowerCase())).size !== picked.length) {
		throw new PairedMarketError('Each market can appear only once.');
	}

	let bps;
	if (weights == null || (Array.isArray(weights) && weights.length === 0)) {
		bps = evenWeights(picked.length);
	} else {
		if (!Array.isArray(weights) || weights.length !== picked.length) {
			throw new PairedMarketError('Give one weight per market, as percentages that add up to 100.');
		}
		bps = weights.map((w) => Math.round(Number(w) * 100));
		if (bps.some((w) => !Number.isFinite(w) || w <= 0)) throw new PairedMarketError('Every market weight must be above 0%.');
		if (bps.reduce((a, b) => a + b, 0) !== BPS) throw new PairedMarketError('Market weights must add up to exactly 100%.');
	}

	return picked.map((m, i) => ({
		quoteToken: m.address,
		symbol: m.symbol,
		decimals: m.decimals,
		assetClass: m.assetClass,
		canonical: m.canonical,
		weightBps: bps[i],
		priceUsd: m.priceUsd,
		// What this pool opens at in dollars: its share of the full-weight reserve.
		openingValueUsd: m.openingValueUsd != null ? (m.openingValueUsd * bps[i]) / BPS : null,
	}));
}

/** Human amount in a quote's own decimals → base units, rejecting more precision than the asset has. */
export function parseQuoteAmount(amount, decimals) {
	const text = String(amount ?? '').trim();
	const re = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
	if (!re.test(text)) throw new PairedMarketError(`Amounts in this asset take at most ${decimals} decimal places, like "0.5".`);
	const raw = parseUnits(text, decimals);
	if (raw === 0n) throw new PairedMarketError('The amount must be above zero.');
	return raw;
}

export const formatQuote = (raw, decimals) => formatUnits(BigInt(raw), decimals);

/**
 * A coin with every pool priced in dollars from its quote asset's live USD
 * price. The coin's own dollar market cap is the supply-weighted average of its
 * pools: each pool prices the whole supply, and a pool holding more of it says
 * more about what the coin trades at.
 */
export function withUsd(coin, priceByQuote) {
	const pairs = coin.pairs.map((p) => {
		const q = priceByQuote.get(p.quoteToken.toLowerCase());
		return { ...p, priceUsd: q != null ? p.price * q : null, marketCapUsd: q != null ? p.marketCap * q : null };
	});
	const priced = pairs.filter((p) => p.marketCapUsd != null);
	const weight = priced.reduce((s, p) => s + p.weightBps, 0);
	const marketCapUsd = weight ? priced.reduce((s, p) => s + p.marketCapUsd * p.weightBps, 0) / weight : null;
	return { ...coin, pairs, marketCapUsd };
}
