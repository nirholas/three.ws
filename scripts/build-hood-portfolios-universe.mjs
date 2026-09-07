#!/usr/bin/env node
// Builds the asset universe for Robinhood Chain, from the chain itself.
//
//   node scripts/build-hood-portfolios-universe.mjs [--out data/hood-portfolios-universe.json] [--max-tokens 1200]
//
// Why this enumerator: chain 4663 is a launchpad chain. Walking every Uniswap
// v4 `Initialize` event from genesis was the first approach and it is the wrong
// one -- it finds 173,000+ distinct tokens before even reaching half the chain's
// history, almost all of them dead launches with no pool left, and the public
// RPC caps a single log query at 10,000 results anyway. An index of everything
// that ever existed is not a universe a portfolio can be built from.
//
// What matters is what is holdable NOW, so the enumeration is ranked rather
// than exhaustive: Blockscout's token index, paged in market-cap order, gives
// the tokens that actually carry value, and the 95-token Stock Token registry
// in data/robinhood-stock-tokens.json is unioned in so no tokenized equity is
// missed because it happens to rank low. DexScreener then supplies live price,
// liquidity and volume, and anything with no live pool is dropped.
//
// Blockscout sits behind Cloudflare and challenges datacenter IPs with an
// interstitial rather than a 4xx, so requests carry a browser User-Agent; a
// bare fetch here gets HTML back and looks like a parse bug.
//
// Market data (price, liquidity, 24h volume) is then filled in from
// DexScreener in batches of 30 addresses, and each token is classified into
// the three asset classes a Robinhood Portfolios manifest tags its constituents with.
//
// The output is committed so the API serves a stable universe without fanning
// out ~120 archival log queries per request; `npm run hood:universe`
// regenerates it.

import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

const RPC = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com';
const BROWSER_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Authoritative: these are the chain's USD stablecoins, identified by address.
const STABLECOINS = new Set([
	'0x5fc5360d0400a0fd4f2af552add042d716f1d168', // USDG
	'0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', // USDE
]);

// The liquidity above which a crypto token is treated as a major rather than
// long tail. Measured, not curated: a hand-maintained list of "blue chips"
// would be an opinion that rots, whereas depth is the property that actually
// decides whether a portfolio can rebalance into a position without moving it.
const MAJOR_LIQUIDITY_USD = 5_000_000;

const args = process.argv.slice(2);
function arg(name, fallback) {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
}
const OUT = path.resolve(arg('out', 'data/hood-portfolios-universe.json'));
const MAX_TOKENS = Number(arg('max-tokens', 1200));
const verbose = args.includes('--verbose');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params, {retries = 6} = {}) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetch(RPC, {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
				signal: AbortSignal.timeout(60_000),
			});
			const body = await res.json();
			if (body.error) throw new Error(body.error.message || 'rpc error');
			return body.result;
		} catch (err) {
			if (attempt === retries) throw err;
			// The public sequencer answers "Too Many Requests" rather than a 429
			// status, so back off on any failure rather than on a status check.
			await sleep(1000 * 2 ** attempt);
		}
	}
}

async function fetchJson(url, {retries = 3} = {}) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetch(url, {
				headers: {'user-agent': BROWSER_UA, accept: 'application/json'},
				signal: AbortSignal.timeout(30_000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await res.json();
		} catch (err) {
			if (attempt === retries) return null;
			await sleep(800 * 2 ** attempt);
		}
	}
	return null;
}

/**
 * Page Blockscout's ERC-20 index in market-cap order until `max` tokens are
 * collected or the pages run out.
 */
async function enumerateRankedTokens(max) {
	const found = new Map();
	let params = '';
	for (let page = 0; page < 200 && found.size < max; page++) {
		const data = await fetchJson(`${BLOCKSCOUT}/api/v2/tokens?type=ERC-20${params}`);
		if (!data) break;
		const items = Array.isArray(data.items) ? data.items : [];
		if (!items.length) break;
		const sizeBefore = found.size;
		for (const it of items) {
			const addr = String(it.address_hash || it.address || '').toLowerCase();
			if (!/^0x[0-9a-f]{40}$/.test(addr) || found.has(addr)) continue;
			found.set(addr, {
				symbol: it.symbol || null,
				name: it.name || null,
				decimals: Number(it.decimals) || 18,
				holders: Number(it.holders_count ?? it.holders) || 0,
				marketCapUsd: it.circulating_market_cap ? Number(it.circulating_market_cap) : null,
			});
		}
		// Blockscout's cursor stops advancing once the index runs out of distinct
		// pages, and it keeps answering 200 with the same rows rather than ending
		// the listing. Without this the loop spins to its page cap re-reading the
		// same 800 tokens, which is what it did on the first full run.
		if (found.size === sizeBefore) {
			if (verbose) process.stderr.write('  cursor stopped advancing; ending pagination\n');
			break;
		}
		const next = data.next_page_params;
		if (!next) break;
		params = `&${new URLSearchParams(
			Object.fromEntries(Object.entries(next).filter(([, v]) => v !== null && v !== undefined)),
		).toString()}`;
		if (verbose) process.stderr.write(`  page ${page + 1}: ${found.size} tokens\n`);
		await sleep(160);
	}
	return found;
}

/**
 * Which of `addresses` are tokenized equities, asked of the chain itself.
 *
 * Every tokenized equity on Robinhood Chain is a beacon proxy onto one shared
 * implementation, and that implementation exposes `uiMultiplier()` (the
 * 1e18-scaled corporate-action multiplier) which nothing else on the chain
 * does. Verified 2026-09-07: GLD answers 1e18, CASHCAT reverts, USDG reverts.
 *
 * This replaces classifying by registry membership. The pinned registry in
 * data/robinhood-stock-tokens.json covers 95 tokens while the chain carries 254,
 * so registry membership silently filed real tokenized equities like GLD as
 * long-tail crypto. Asking the contract is both authoritative and complete.
 */
async function detectStockTokens(addresses) {
	const UI_MULTIPLIER = '0xa60bf13d'; // keccak256("uiMultiplier()")[0:4]
	const found = new Set();
	const CONCURRENCY = 16;
	for (let i = 0; i < addresses.length; i += CONCURRENCY) {
		const batch = addresses.slice(i, i + CONCURRENCY);
		const results = await Promise.all(
			batch.map(async (addr) => {
				try {
					const out = await rpc('eth_call', [{to: addr, data: UI_MULTIPLIER}, 'latest'], {retries: 2});
					// A non-equity either reverts (an error, already thrown) or returns
					// empty data; only a real 32-byte answer counts.
					return typeof out === 'string' && out.length === 66 ? addr : null;
				} catch {
					return null;
				}
			}),
		);
		for (const r of results) if (r) found.add(r);
		if (verbose) {
			process.stderr.write(`  equity probe ${Math.min(i + CONCURRENCY, addresses.length)}/${addresses.length}: ${found.size} found\n`);
		}
	}
	return found;
}

/**
 * Live market data for every address, one row per token.
 *
 * Uses DexScreener's `/tokens/v1/{chain}/{addresses}` endpoint rather than
 * `/latest/dex/tokens/`. The older one caps its RESPONSE at 30 pairs, not 30
 * tokens, so batching 30 addresses into it silently returns data for only the
 * first two or three -- NVDA alone has 30 pairs and crowds out everything else
 * in its batch. That failure is invisible: the missing tokens simply look like
 * they have no liquidity. `/tokens/v1/` returns exactly one best pair per token,
 * which is what a per-token snapshot actually needs.
 *
 * A chunk that fails after its retries is recorded rather than swallowed, so a
 * thin universe is reported as a fetch failure instead of being mistaken for a
 * chain with nothing on it.
 */
async function dexMarketData(addresses) {
	const out = new Map();
	const failed = [];
	for (let i = 0; i < addresses.length; i += 30) {
		const chunk = addresses.slice(i, i + 30);
		const data = await fetchJson(
			`https://api.dexscreener.com/tokens/v1/robinhood/${chunk.join(',')}`,
		);
		if (!Array.isArray(data)) {
			failed.push(...chunk);
		} else {
			for (const pair of data) {
				if (pair?.chainId !== 'robinhood') continue;
				const base = String(pair.baseToken?.address || '').toLowerCase();
				if (!chunk.includes(base)) continue;
				const liq = pair.liquidity?.usd || 0;
				const prev = out.get(base);
				if (!prev || liq > prev.liquidityUsd) {
					out.set(base, {
						symbol: pair.baseToken?.symbol || null,
						name: pair.baseToken?.name || null,
						priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
						liquidityUsd: liq,
						volume24hUsd: pair.volume?.h24 || 0,
						change24hPct: pair.priceChange?.h24 ?? null,
						txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
						dexId: pair.dexId || null,
						pairAddress: pair.pairAddress || null,
						pairCreatedAt: pair.pairCreatedAt || null,
					});
				}
			}
		}
		if (verbose) process.stderr.write(`  market data ${Math.min(i + 30, addresses.length)}/${addresses.length}\n`);
		await sleep(220); // DexScreener asks for <= 300 req/min
	}
	if (failed.length) {
		process.stderr.write(`  WARNING: market data failed for ${failed.length} addresses after retries\n`);
	}
	return out;
}

/**
 * Every branch is either authoritative or measured. Nothing here is a taste
 * judgement that would have to be maintained by hand as the chain changes.
 */
function classify(addr, isStockToken, liquidityUsd) {
	if (isStockToken.has(addr)) return 'rwa-equity'; // authoritative: the token answers uiMultiplier()
	if (STABLECOINS.has(addr)) return 'stablecoin'; // authoritative: known peg contracts
	if (liquidityUsd >= MAJOR_LIQUIDITY_USD) return 'crypto-major'; // measured: real depth
	return 'crypto-native'; // everything else: chain-native and long tail
}

async function main() {
	const repoRoot = process.cwd();
	const registry = JSON.parse(
		readFileSync(path.join(repoRoot, 'data', 'robinhood-stock-tokens.json'), 'utf8'),
	);
	const stocksByAddress = new Map(registry.tokens.map((t) => [t.address.toLowerCase(), t]));

	const latest = Number(await rpc('eth_blockNumber', []));
	process.stderr.write(`Robinhood Chain head: ${latest}\n`);
	process.stderr.write(`Enumerating up to ${MAX_TOKENS} tokens from the Blockscout index...\n`);
	const ranked = await enumerateRankedTokens(MAX_TOKENS);

	// Union in every Stock Token, so no tokenized equity is missed for ranking low.
	for (const [addr, t] of stocksByAddress) {
		if (!ranked.has(addr)) {
			ranked.set(addr, {symbol: t.symbol, name: t.name, decimals: t.decimals, holders: 0, marketCapUsd: null});
		}
	}

	const addresses = [...ranked.keys()];
	process.stderr.write(`${addresses.length} candidate tokens. Asking the chain which are tokenized equities...\n`);
	const isStockToken = await detectStockTokens(addresses);
	process.stderr.write(`${isStockToken.size} tokenized equities. Fetching live market data...\n`);
	const market = await dexMarketData(addresses);

	const rows = addresses
		.map((addr) => {
			const stock = stocksByAddress.get(addr);
			const meta = ranked.get(addr) || {};
			const m = market.get(addr) || {};
			const liquidityUsd = m.liquidityUsd ?? 0;
			return {
				address: addr,
				symbol: stock?.symbol || meta.symbol || m.symbol || null,
				name: stock?.name || meta.name || m.name || null,
				decimals: stock?.decimals ?? meta.decimals ?? 18,
				assetClass: classify(addr, isStockToken, liquidityUsd),
				feed: stock?.feed || null,
				feedDecimals: stock?.feedDecimals ?? null,
				holders: meta.holders ?? 0,
				marketCapUsd: meta.marketCapUsd ?? null,
				priceUsd: m.priceUsd ?? null,
				liquidityUsd,
				volume24hUsd: m.volume24hUsd ?? 0,
				change24hPct: m.change24hPct ?? null,
				txns24h: m.txns24h ?? 0,
				dexId: m.dexId ?? null,
				pairAddress: m.pairAddress ?? null,
				pairCreatedAt: m.pairCreatedAt ?? null,
			};
		})
		// A token with no live pool cannot be issued into a portfolio or rebalanced
		// out of one, so it is not part of the universe however large its market cap.
		.filter((r) => r.liquidityUsd > 0)
		.sort((a, b) => b.liquidityUsd - a.liquidityUsd);

	// ── Symbol impersonation ────────────────────────────────────────────────
	//
	// This chain is a launchpad chain, and ticker squatting on it is not
	// hypothetical: 12 separate contracts are called "Global Dollar" with the
	// symbol USDG, and several of them carry deeper liquidity than the real one
	// (0x5fc5360d..., $1.25M) -- the deepest impostor holds $3.0M. A screen that
	// sees only a symbol, a class and a liquidity number would pick the impostor
	// every time, and it would look like the correct answer.
	//
	// So the symbol is resolved to a contract here, once, rather than trusted:
	//   - a token whose symbol nothing else uses is canonical;
	//   - where an AUTHORITATIVE token holds the symbol (a tokenized equity that
	//     answers uiMultiplier(), or a known peg contract), it is canonical and
	//     every other claimant is not;
	//   - where no claimant is authoritative, the deepest is canonical and the
	//     rest are flagged, because a contested ticker with nothing to arbitrate
	//     it is exactly what an impersonator relies on.
	//
	// Non-canonical tokens stay in the universe and stay visible on the board,
	// clearly marked. They are simply never offered to the screen.
	const AUTHORITATIVE = new Set(['rwa-equity', 'stablecoin']);
	const bySymbol = new Map();
	for (const r of rows) {
		const key = (r.symbol || '').trim().toUpperCase();
		if (!key) continue;
		if (!bySymbol.has(key)) bySymbol.set(key, []);
		bySymbol.get(key).push(r);
	}
	for (const [, peers] of bySymbol) {
		const authoritative = peers.filter((r) => AUTHORITATIVE.has(r.assetClass));
		// `rows` is already sorted by liquidity, so the first peer is the deepest.
		const winner = authoritative[0] || peers[0];
		for (const r of peers) {
			r.symbolPeers = peers.length - 1;
			r.canonical = r === winner;
		}
	}
	for (const r of rows) {
		if (r.canonical === undefined) {
			r.symbolPeers = 0;
			r.canonical = true; // no symbol at all: nothing to impersonate
		}
	}

	const counts = rows.reduce((acc, r) => {
		acc[r.assetClass] = (acc[r.assetClass] || 0) + 1;
		return acc;
	}, {});

	const doc = {
		chainId: 4663,
		generatedAt: new Date().toISOString(),
		generatedAtBlock: latest,
		candidatesConsidered: addresses.length,
		tokenCount: rows.length,
		tradableCount: rows.length,
		canonicalCount: rows.filter((r) => r.canonical).length,
		impersonatedSymbols: [...bySymbol.entries()]
			.filter(([, peers]) => peers.length > 1)
			.map(([symbol, peers]) => ({symbol, claimants: peers.length}))
			.sort((a, b) => b.claimants - a.claimants),
		classCounts: counts,
		classification: {
			'rwa-equity': 'the contract answers uiMultiplier(), which only Robinhood tokenized equities do (authoritative, on-chain)',
			stablecoin: 'a known USD peg contract on this chain (authoritative)',
			'crypto-major': `on-chain liquidity of at least $${MAJOR_LIQUIDITY_USD.toLocaleString('en-US')} (measured)`,
			'crypto-native': 'everything else: chain-native tokens and the long tail (measured)',
		},
		sources: {
			enumeration: `${BLOCKSCOUT}/api/v2/tokens, paged in market-cap order`,
			equities: 'on-chain uiMultiplier() probe, plus data/robinhood-stock-tokens.json for Chainlink feed addresses',
			market: 'https://api.dexscreener.com (chainId robinhood)',
		},
		tokens: rows,
	};

	mkdirSync(path.dirname(OUT), {recursive: true});
	writeFileSync(OUT, `${JSON.stringify(doc, null, '\t')}\n`);
	process.stderr.write(`\nWrote ${OUT}\n`);
	process.stderr.write(`  ${rows.length} tokens with live liquidity, from ${addresses.length} candidates\n`);
	process.stderr.write(`  ${doc.canonicalCount} canonical, ${rows.length - doc.canonicalCount} flagged as ticker impersonation\n`);
	for (const [k, v] of Object.entries(counts)) process.stderr.write(`  ${k}: ${v}\n`);
}

main().catch((err) => {
	process.stderr.write(`${err.stack || err}\n`);
	process.exit(1);
});
