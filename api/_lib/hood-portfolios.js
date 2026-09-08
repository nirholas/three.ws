// Robinhood Portfolios: the shared data layer behind /api/v1/hood-portfolios/*.
//
// Robinhood Portfolios turns a sentence into a portfolio: a person describes what they want
// exposure to, a screen ranks Robinhood Chain's whole token universe against
// it, and the result is a basket with target weights that a vault holds in kind
// and rebalances on a published schedule.
//
// This module owns the parts of that which are not the chain:
//
//   • the universe            = data/hood-portfolios-universe.json, refreshed by
//                               `npm run hood:universe`, re-priced live
//                               here from DexScreener + Chainlink on every read
//   • the screen              = a real LLM call through api/_lib/llm.js's
//                               free-first provider chain, constrained to the
//                               universe and validated against it afterwards
//   • the manifest            = canonical JSON + keccak256, so the document a
//                               user is shown hashes to the value that gets
//                               committed on-chain by PortfolioRegistry
//   • valuation               = NAV from live prices, refusing to answer rather
//                               than under-reporting when a leg is unpriceable
//
// Price history and backtesting live next door in hood-portfolios-history.js and
// hood-portfolios-backtest.js, because both are about time rather than about now.
//
// Nothing here invents a number. Where a price genuinely does not exist (a
// memecoin with no live pool, an equity feed that stopped updating when the US
// market closed) the field is null and the caller is told why, because the
// whole product depends on being able to tell the difference between "this is
// worth zero" and "nobody knows what this is worth right now".

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { keccak256, toHex } from 'viem';
import { cacheWrap } from './cache.js';
import { llmComplete } from './llm.js';
import {
	chainlinkSnapshot,
	dexSnapshot,
	publicClient,
	stockRegistry,
} from './robinhood.js';

export const CHAIN_ID = 4663;
export const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';

/** The three classes a manifest tags each constituent with. */
export const ASSET_CLASSES = ['rwa-equity', 'crypto-major', 'crypto-native', 'stablecoin'];

/** A constituent must have at least this much on-chain liquidity to be selectable. */
export const MIN_CONSTITUENT_LIQUIDITY_USD = 25_000;

/** Bounds on a generated basket. Wide enough to be useful, narrow enough to be a portfolio. */
export const MIN_CONSTITUENTS = 3;
export const MAX_CONSTITUENTS = 12;

/** No single constituent may exceed this share of a generated portfolio. */
export const MAX_WEIGHT_BPS = 3_500;

// ── The universe ────────────────────────────────────────────────────────────

let _universe = null;

/** The committed universe snapshot: every token that has ever had a v4 pool, plus every Stock Token. */
export function universeSnapshot() {
	if (_universe) return _universe;
	const file = path.join(process.cwd(), 'data', 'hood-portfolios-universe.json');
	_universe = JSON.parse(readFileSync(file, 'utf8'));
	return _universe;
}

/**
 * The universe re-priced from live sources.
 *
 * The committed snapshot fixes WHICH tokens exist (that needs ~120 archival log
 * queries and cannot be done per request); the prices, liquidity and volume on
 * top of it are read live so nothing a user sees is a stale number from
 * whenever the file was last built.
 */
export async function liveUniverse({ minLiquidityUsd = 0, classes = null, limit = 0 } = {}) {
	return cacheWrap(`hp:universe:${minLiquidityUsd}:${classes?.join(',') || 'all'}:${limit}`, 30, async () => {
		const snap = universeSnapshot();
		const addresses = snap.tokens.map((t) => t.address);
		const [dex, nav] = await Promise.all([dexSnapshot(addresses), chainlinkSnapshot().catch(() => ({}))]);

		// `chainlinkSnapshot()` keys by lower-case token address and returns
		// { symbol, priceUsd, updatedAt, uiMultiplier, totalSupply }. Its answers are
		// ALREADY multiplier-adjusted, so `uiMultiplier` must never be applied on top
		// of `priceUsd`; it is returned only for raw-balance arithmetic.
		const navByAddress = {};
		for (const [addr, row] of Object.entries(nav || {})) navByAddress[addr.toLowerCase()] = row;

		let rows = snap.tokens.map((t) => {
			const pair = dex[t.address] || null;
			const feed = navByAddress[t.address] || null;
			const dexUsd = pair?.priceUsd ? Number(pair.priceUsd) : null;
			const navUsd = feed?.priceUsd != null ? Number(feed.priceUsd) : null;
			return {
				address: t.address,
				symbol: t.symbol,
				name: t.name,
				decimals: t.decimals,
				assetClass: t.assetClass,
				feed: t.feed,
				// Ticker squatting is rife on this chain (12 contracts call
				// themselves USDG). `canonical` is resolved once at build time by
				// contract address, never by symbol, and only canonical tokens are
				// ever offered to the screen.
				canonical: t.canonical !== false,
				symbolPeers: t.symbolPeers ?? 0,
				// The DEX mid is the price a portfolio can actually transact at on this
				// chain, so it leads. The equity feed is the reference it is compared to.
				priceUsd: dexUsd ?? navUsd,
				dexPriceUsd: dexUsd,
				navPriceUsd: navUsd,
				navUpdatedAt: feed?.updatedAt != null ? Number(feed.updatedAt) : null,
				premiumPct: dexUsd != null && navUsd ? ((dexUsd - navUsd) / navUsd) * 100 : null,
				liquidityUsd: pair?.liquidity?.usd ?? 0,
				volume24hUsd: pair?.volume?.h24 ?? 0,
				change24hPct: pair?.priceChange?.h24 ?? null,
				dexId: pair?.dexId ?? null,
				pairAddress: pair?.pairAddress ?? null,
			};
		});

		if (classes?.length) rows = rows.filter((r) => classes.includes(r.assetClass));
		if (minLiquidityUsd > 0) rows = rows.filter((r) => r.liquidityUsd >= minLiquidityUsd);
		rows.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
		if (limit > 0) rows = rows.slice(0, limit);

		return {
			chainId: CHAIN_ID,
			generatedAtBlock: snap.generatedAtBlock,
			universeBuiltAt: snap.generatedAt,
			pricedAt: new Date().toISOString(),
			count: rows.length,
			tokens: rows,
		};
	});
}

/**
 * Everything a portfolio is allowed to hold.
 *
 * Three conditions, and the third is the one that is easy to forget: real
 * liquidity, a price we can actually read, and a symbol that belongs to this
 * contract rather than one it is impersonating. Without the last, a screen shown
 * only symbols and liquidity would pick the deepest "USDG" on the chain, which
 * is not the real one.
 */
export async function selectableUniverse() {
	const u = await liveUniverse({ minLiquidityUsd: MIN_CONSTITUENT_LIQUIDITY_USD });
	const tokens = u.tokens.filter((t) => t.canonical && t.priceUsd != null && t.priceUsd > 0);
	return { ...u, count: tokens.length, tokens };
}

// ── The manifest ────────────────────────────────────────────────────────────

/**
 * Canonical JSON: object keys sorted at every depth, no insignificant whitespace.
 *
 * The manifest's hash is committed on-chain, so two parties who serialise the
 * same document must produce the same bytes. JSON.stringify's key order follows
 * insertion order, which differs between the generator and a client that
 * round-tripped the document, so ordering is imposed rather than assumed.
 */
export function canonicalise(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalise(value[k])}`).join(',')}}`;
}

/** keccak256 of the canonical serialisation: the exact value `PortfolioRegistry.publish` commits. */
export function manifestHash(manifest) {
	return keccak256(toHex(canonicalise(manifest)));
}

/** The schema version every manifest this build produces declares. */
export const MANIFEST_VERSION = '1.0.0';

/**
 * Assemble the manifest document from a screen result.
 *
 * Everything needed to re-run the screen and check it goes in: the prompt, the
 * universe snapshot it ran against, the filters, and every constituent's price
 * and liquidity at selection time. That is what makes the screen auditable
 * without anybody having to be trusted. The claim "this basket follows from
 * this prompt" is not enforceable on-chain, but "this basket follows from this
 * recorded input" is checkable by anyone who re-runs it.
 */
export function buildManifest({ prompt, screen, universe, createdAt = new Date().toISOString() }) {
	return {
		version: MANIFEST_VERSION,
		chainId: CHAIN_ID,
		createdAt,
		prompt,
		name: screen.name,
		symbol: screen.symbol,
		thesis: screen.thesis,
		rebalance: {
			intervalDays: screen.rebalanceDays,
			// The vault's own timelock and auction window, restated here so the manifest
			// fully describes the product a holder is buying.
			proposalDelayHours: 24,
			auctionHours: 6,
		},
		eligibility: {
			minLiquidityUsd: MIN_CONSTITUENT_LIQUIDITY_USD,
			maxWeightBps: MAX_WEIGHT_BPS,
			minConstituents: MIN_CONSTITUENTS,
			maxConstituents: MAX_CONSTITUENTS,
		},
		universe: {
			builtAt: universe.universeBuiltAt,
			atBlock: universe.generatedAtBlock,
			consideredCount: universe.count,
			source: 'Uniswap v4 Initialize events on chain 4663, unioned with the Stock Token registry',
		},
		constituents: screen.constituents.map((c) => ({
			address: c.address,
			symbol: c.symbol,
			assetClass: c.assetClass,
			weightBps: c.weightBps,
			rationale: c.rationale,
			priceUsdAtSelection: c.priceUsd,
			liquidityUsdAtSelection: c.liquidityUsd,
			oracle: c.feed ? { kind: 'chainlink', feed: c.feed } : { kind: 'dex-mid', pair: c.pairAddress },
		})),
	};
}

// ── The screen ──────────────────────────────────────────────────────────────

const SCREEN_SYSTEM = `You build investment portfolios from a token universe on Robinhood Chain (chain 4663).

The universe spans three asset classes and you may mix them freely in one portfolio:
  rwa-equity     tokenized equities and ETFs (NVDA, SPY, AAPL, GLD...). These track real
                 companies and only trade against a real-world price when US markets are open.
  crypto-major   large liquid crypto (WETH).
  crypto-native  tokens native to this chain, including memecoins. High risk, high variance.
  stablecoin     USD stablecoins. Use only as ballast, never as the thesis.

Rules you must follow exactly:
  - Choose ONLY tokens from the supplied universe. Never invent an address or a symbol.
  - Choose between 3 and 12 constituents.
  - weightBps are integers that sum to EXACTLY 10000.
  - No single constituent may exceed 3500 bps.
  - Prefer deeper liquidity when two candidates serve the thesis equally well.
  - rebalanceDays is one of 7, 14, 30, 90.
  - Every constituent needs a one-sentence rationale tying it to the user's prompt specifically.
    Never write filler like "provides diversification" or "strong fundamentals".
  - thesis is two sentences: what this portfolio is a bet on, and what would make it wrong.
  - name is a short human title. symbol is 3-6 uppercase letters, no spaces.

Reply with ONE JSON object and nothing else:
{"name":"...","symbol":"...","thesis":"...","rebalanceDays":30,
 "constituents":[{"address":"0x...","weightBps":2500,"rationale":"..."}]}`;

function universeDigest(tokens, cap = 120) {
	return tokens
		.slice(0, cap)
		.map(
			(t) =>
				`${t.address} ${t.symbol || '?'} class=${t.assetClass} price=${
					t.priceUsd != null ? `$${Number(t.priceUsd).toPrecision(6)}` : 'n/a'
				} liq=$${Math.round(t.liquidityUsd).toLocaleString('en-US')} vol24=$${Math.round(
					t.volume24hUsd,
				).toLocaleString('en-US')} chg24=${t.change24hPct != null ? `${t.change24hPct}%` : 'n/a'}`,
		)
		.join('\n');
}

function extractJson(text) {
	const trimmed = String(text || '').trim();
	// Models wrap JSON in prose or fences often enough that finding the object is
	// part of parsing it, not a workaround.
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced ? fenced[1] : trimmed;
	const start = candidate.indexOf('{');
	const end = candidate.lastIndexOf('}');
	if (start === -1 || end <= start) throw new Error('the screen did not return a JSON object');
	return JSON.parse(candidate.slice(start, end + 1));
}

export class ScreenError extends Error {
	constructor(message, detail) {
		super(message);
		this.name = 'ScreenError';
		this.detail = detail;
	}
}

/**
 * Scale arbitrary positive weights onto integers that sum to exactly `total`,
 * with no entry above `max` or below 1.
 *
 * Two passes, because doing it in one is where this went wrong the first time.
 *
 * The **water-filling** pass handles the cap. Naively scaling and then clamping
 * loses whatever the clamp removed, so a set like 9999/1/1 collapses to
 * 3500/1/1 and sums to 3502 rather than 10000. Instead, any entry that would
 * exceed `max` is pinned there and its excess is redistributed proportionally
 * across the entries that are still under the cap, repeating until nothing new
 * pins. That converges because each round pins at least one more entry.
 *
 * The **largest-remainder** pass handles the rounding. Rounding each share
 * independently leaves a remainder of up to n-1 basis points, so the entries are
 * floored and the leftover is handed out one at a time, largest fractional part
 * first, skipping anything already at the cap. The result sums to `total`
 * exactly, which is what `feeSplit`-style arithmetic downstream depends on.
 *
 * Feasibility is the caller's: `total` must be reachable, i.e. entries.length *
 * max >= total. With at least 3 constituents and a 3500bps cap, 10500 >= 10000.
 */
export function normaliseWeights(raw, max, total = 10_000) {
	const n = raw.length;
	if (n === 0) return [];
	if (n * max < total) {
		throw new ScreenError('the weight cap cannot be satisfied by this many constituents', {
			constituents: n,
			maxWeightBps: max,
			total,
		});
	}

	let values = raw.map((w) => (Number.isFinite(w) && w > 0 ? Number(w) : 1));
	const pinned = new Array(n).fill(false);

	for (;;) {
		const pinnedTotal = pinned.reduce((s, p, i) => (p ? s + values[i] : s), 0);
		const budget = total - pinnedTotal;
		const freeSum = values.reduce((s, v, i) => (pinned[i] ? s : s + v), 0);
		// Every free entry being zero can only happen if the caller passed no
		// usable weights at all; spread the budget evenly rather than dividing by 0.
		const scale = freeSum > 0 ? budget / freeSum : 0;

		let newlyPinned = false;
		for (let i = 0; i < n; ++i) {
			if (pinned[i]) continue;
			const scaled = freeSum > 0 ? values[i] * scale : budget / values.filter((_, j) => !pinned[j]).length;
			if (scaled > max) {
				values[i] = max;
				pinned[i] = true;
				newlyPinned = true;
			}
		}
		if (newlyPinned) continue;

		for (let i = 0; i < n; ++i) {
			if (!pinned[i]) values[i] = freeSum > 0 ? values[i] * scale : budget / n;
		}
		break;
	}

	const floors = values.map((v) => Math.max(1, Math.min(max, Math.floor(v))));
	let remainder = total - floors.reduce((a, b) => a + b, 0);

	if (remainder > 0) {
		const order = values
			.map((v, i) => ({ i, frac: v - Math.floor(v) }))
			.sort((a, b) => b.frac - a.frac);
		for (let pass = 0; remainder > 0 && pass < n + 2; ++pass) {
			for (const { i } of order) {
				if (remainder === 0) break;
				if (floors[i] < max) {
					floors[i] += 1;
					remainder -= 1;
				}
			}
		}
	} else if (remainder < 0) {
		// Only reachable when flooring to a minimum of 1 pushed the total above
		// `total`, which needs a very large n; take back from the largest first.
		const order = floors.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
		for (let pass = 0; remainder < 0 && pass < n + 2; ++pass) {
			for (const { i } of order) {
				if (remainder === 0) break;
				if (floors[i] > 1) {
					floors[i] -= 1;
					remainder += 1;
				}
			}
		}
	}

	return floors;
}

/**
 * Normalise and validate a raw screen result against the universe.
 *
 * A language model is a ranking engine here, never an authority: everything it
 * returns is checked against the universe it was given, and anything it made up
 * is dropped rather than repaired into something plausible. Weights are the one
 * thing that IS repaired, because "sum to exactly 10000" is an arithmetic
 * property of a set the model chose correctly, not a judgement call.
 */
export function validateScreen(raw, tokens) {
	const byAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));
	const seen = new Set();
	const picked = [];

	for (const c of Array.isArray(raw?.constituents) ? raw.constituents : []) {
		const addr = String(c?.address || '').toLowerCase();
		const token = byAddress.get(addr);
		if (!token || seen.has(addr)) continue;
		const weight = Number(c?.weightBps);
		if (!Number.isFinite(weight) || weight <= 0) continue;
		seen.add(addr);
		picked.push({
			...token,
			weightBps: Math.round(weight),
			rationale: String(c?.rationale || '').trim() || `Selected for ${String(raw?.name || 'the thesis')}.`,
		});
		if (picked.length >= MAX_CONSTITUENTS) break;
	}

	if (picked.length < MIN_CONSTITUENTS) {
		throw new ScreenError('the screen did not return enough usable constituents', {
			returned: raw?.constituents?.length ?? 0,
			usable: picked.length,
			minimum: MIN_CONSTITUENTS,
		});
	}

	const weights = normaliseWeights(picked.map((c) => c.weightBps), MAX_WEIGHT_BPS);
	for (let i = 0; i < picked.length; ++i) picked[i].weightBps = weights[i];

	picked.sort((a, b) => b.weightBps - a.weightBps);

	const allowedIntervals = [7, 14, 30, 90];
	const days = Number(raw?.rebalanceDays);
	const symbol = String(raw?.symbol || '')
		.toUpperCase()
		.replace(/[^A-Z]/g, '')
		.slice(0, 6);

	return {
		name: String(raw?.name || '').trim().slice(0, 64) || 'Generated Portfolio',
		symbol: symbol.length >= 3 ? symbol : 'FLTCHR',
		thesis: String(raw?.thesis || '').trim().slice(0, 600),
		rebalanceDays: allowedIntervals.includes(days) ? days : 30,
		constituents: picked,
	};
}

/**
 * Run the screen: a prompt in, a validated basket out.
 *
 * The model never sees the whole universe. It sees the tokens that are actually
 * holdable (real liquidity, a readable price) ordered by depth, which is both
 * what fits in a prompt and what a portfolio could survive rebalancing into.
 */
export async function generatePortfolio({ prompt, universe = null, track = null }) {
	const u = universe || (await selectableUniverse());
	if (!u.tokens.length) {
		throw new ScreenError('no token in the universe currently has enough liquidity to be held', {
			minLiquidityUsd: MIN_CONSTITUENT_LIQUIDITY_USD,
		});
	}

	const user = `User's prompt: ${prompt}

Universe (${Math.min(u.tokens.length, 120)} most liquid of ${u.tokens.length} holdable tokens on Robinhood Chain):
${universeDigest(u.tokens)}`;

	const completion = await llmComplete({
		system: SCREEN_SYSTEM,
		user,
		maxTokens: 1800,
		timeoutMs: 45_000,
		track,
	});

	let raw;
	try {
		raw = extractJson(completion.text);
	} catch (err) {
		throw new ScreenError('the screen returned a response that was not valid JSON', {
			provider: completion.provider,
			model: completion.model,
			reason: String(err.message || err),
		});
	}

	const screen = validateScreen(raw, u.tokens);
	const manifest = buildManifest({ prompt, screen, universe: u });

	return {
		screen,
		manifest,
		manifestHash: manifestHash(manifest),
		provider: completion.provider,
		model: completion.model,
		universeConsidered: u.tokens.length,
	};
}

// ── Valuation ───────────────────────────────────────────────────────────────

/**
 * Value a basket at current prices.
 *
 * `unpriceable` is the field that matters. A portfolio whose equity leg's feed
 * went stale over a weekend, or whose memecoin leg lost its only pool, has a
 * NAV that is not merely uncertain but unknowable, and saying so is the whole
 * difference between an index product and a number generator.
 */
export function valueBasket(constituents, priceByAddress) {
	let total = 0;
	const legs = [];
	const unpriceable = [];

	for (const c of constituents) {
		const price = priceByAddress.get(String(c.address).toLowerCase());
		const weight = c.weightBps / 10_000;
		if (price == null || !(price > 0)) {
			unpriceable.push({ address: c.address, symbol: c.symbol, reason: 'no live price on this chain' });
			legs.push({ ...c, priceUsd: null, valueUsd: null });
			continue;
		}
		const valueUsd = weight * price;
		total += valueUsd;
		legs.push({ ...c, priceUsd: price, valueUsd });
	}

	return {
		legs,
		unpriceable,
		// A NAV computed while a leg is unpriceable would be a smaller number
		// presented as a complete one, so it is withheld rather than approximated.
		navUsdPerUnit: unpriceable.length === 0 ? total : null,
		pricedLegs: legs.length - unpriceable.length,
		totalLegs: legs.length,
	};
}

/** Cheap health line for the status surfaces: is the chain answering, and how fresh is the universe. */
export async function portfoliosHealth() {
	return cacheWrap('hp:health', 20, async () => {
		const snap = universeSnapshot();
		let head = null;
		let chainOk = false;
		try {
			head = Number(await publicClient(false).getBlockNumber());
			chainOk = true;
		} catch {
			chainOk = false;
		}
		const stocks = stockRegistry();
		return {
			chainId: CHAIN_ID,
			chainOk,
			head,
			universeBuiltAt: snap.generatedAt,
			universeAtBlock: snap.generatedAtBlock,
			universeTokens: snap.tokenCount,
			equityRegistrySize: stocks.tokenCount,
			equitiesWithFeeds: stocks.feedCount,
		};
	});
}
