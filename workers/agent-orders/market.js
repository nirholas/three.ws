// agent-orders — live market signals for order evaluation.
//
// Every value here is REAL on-chain or derived-from-on-chain data: prices come
// from a live bonding-curve / AMM quote (launchpad coins) or a live aggregator
// reference quote (any other SPL token, mainnet), market cap from the curve's
// fixed supply or the mint's on-chain supply, smart-money
// from the reputation graph, dev-dump + graduation from the coin-intel table.
// Nothing is simulated. A source that can't be read returns null and the caller
// stays honest (it never fires an order on absent data).

import { getPumpTradeClient, getAmmPoolState } from '../../api/_lib/pump.js';
import { solUsdPrice } from '../../api/_lib/avatar-wallet.js';
import { getSmartMoneyForMint } from '../../api/_lib/smart-money.js';
import { sql } from '../../api/_lib/db.js';
import { jupiterQuote } from '../../api/_lib/token/jupiter.js';
import { PublicKey } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync, getMint,
	TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// pump.fun mints: fixed 1,000,000,000 supply, 6 decimals.
const TOTAL_SUPPLY_TOKENS = 1_000_000_000;
const TOKEN_DECIMALS = 6;
// A tiny reference buy → near-spot marginal price with negligible impact.
const REF_LAMPORTS = 1_000_000n; // 0.001 SOL
// The aggregator routes a slightly larger reference so a minimum-size route
// still exists on thin pairs; impact at 0.01 SOL is still negligible.
const AGG_REF_LAMPORTS = 10_000_000n; // 0.01 SOL
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const MINT_INFO_TTL_MS = 10 * 60_000;
const _mintInfo = new Map();

/**
 * Live price + market cap for any SPL mint, and the route that priced it.
 *
 * `route` narrows where to look: 'launchpad' prices off the bonding curve, then
 * the graduated AMM pool; 'aggregator' prices off a reference quote through the
 * aggregator (mainnet only); null tries the launchpad first and falls through
 * to the aggregator, which is how an order's route is first resolved. Returns
 * null when no venue prices the mint, so the caller treats it as "skip this
 * sweep", never as a price of 0.
 *
 * @returns {Promise<{ price_sol:number, mcap_sol:number, graduated:boolean, route:'launchpad'|'aggregator', source:'curve'|'amm'|'aggregator' } | null>}
 */
export async function quoteMarket({ network, mint, route = null }) {
	if (route !== 'aggregator') {
		const lp = await quoteMarketLaunchpad({ network, mint });
		if (lp) return { ...lp, route: 'launchpad' };
		if (route === 'launchpad') return null;
	}
	if (network !== 'mainnet') return null;
	return quoteMarketAggregator({ mint });
}

async function quoteMarketLaunchpad({ network, mint }) {
	let ctx;
	try { ctx = await getPumpTradeClient({ network }); } catch { return null; }
	const mintPk = new ctx.web3.PublicKey(mint);
	try {
		const q = await ctx.client.quoteForBuy({ mint: mintPk, quoteAmount: new ctx.BN(REF_LAMPORTS.toString()), slippagePct: 0 });
		const baseOut = Number(q.expectedBaseTokens.toString());
		if (!(baseOut > 0)) return null;
		const tokensOut = baseOut / 10 ** TOKEN_DECIMALS;
		const price_sol = (Number(REF_LAMPORTS) / 1e9) / tokensOut;
		return { price_sol, mcap_sol: price_sol * TOTAL_SUPPLY_TOKENS, graduated: false, source: 'curve' };
	} catch {
		// Graduated (CoinGraduated) or never on the curve: the canonical AMM pool
		// is the only other launchpad market, and it throws for a mint it lacks.
		return quoteMarketAmm({ network, mint });
	}
}

// Price off the live AMM pool reserves (post-graduation). price = quote/base,
// where quote is the EFFECTIVE reserve (vault balance + the pool's virtual quote
// reserves). Using the raw vault balance alone under-states both price and the
// mcap derived from it on launchpad coins.
async function quoteMarketAmm({ network, mint }) {
	try {
		const state = await getAmmPoolState({ network, mint });
		const base = Number(state.baseReserve.toString()) / 10 ** TOKEN_DECIMALS;
		const quote = Number(state.effectiveQuoteReserve.toString()) / 1e9;
		if (!(base > 0) || !(quote > 0)) return null;
		const price_sol = quote / base;
		return { price_sol, mcap_sol: price_sol * TOTAL_SUPPLY_TOKENS, graduated: true, source: 'amm' };
	} catch {
		return null;
	}
}

/** Decimals + whole-token supply for any SPL mint (Token or Token-2022), cached briefly. */
export async function readMintInfo({ network, mint }) {
	const key = `${network}:${mint}`;
	const hit = _mintInfo.get(key);
	if (hit && hit.expires > Date.now()) return hit.value;
	let ctx;
	try { ctx = await getPumpTradeClient({ network }); } catch { return null; }
	const conn = ctx.connection;
	const mintPk = new PublicKey(mint);
	let acc;
	try { acc = await conn.getAccountInfo(mintPk); } catch { return null; }
	if (!acc) return null;
	const programId = acc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
	let info;
	try { info = await getMint(conn, mintPk, 'confirmed', programId); } catch { return null; }
	const value = { decimals: info.decimals, supply: Number(info.supply) / 10 ** info.decimals };
	_mintInfo.set(key, { value, expires: Date.now() + MINT_INFO_TTL_MS });
	return value;
}

// Price off a live aggregator reference buy: SOL in over tokens out, scaled by
// the mint's own decimals. Market cap is that price times the on-chain supply,
// so it is the same figure a launchpad coin's mcap means (price x supply).
async function quoteMarketAggregator({ mint }) {
	const info = await readMintInfo({ network: 'mainnet', mint });
	if (!info) return null;
	let q;
	try {
		q = await jupiterQuote({ inputMint: WSOL_MINT, outputMint: mint, amount: AGG_REF_LAMPORTS.toString(), slippageBps: 100 });
	} catch {
		return null;
	}
	const out = Number(q?.outAmount || 0) / 10 ** info.decimals;
	if (!(out > 0)) return null;
	const price_sol = (Number(AGG_REF_LAMPORTS) / 1e9) / out;
	return { price_sol, mcap_sol: price_sol * info.supply, graduated: true, route: 'aggregator', source: 'aggregator' };
}

/**
 * Resolve where an order on `mint` fills. `venue` is what the owner asked for:
 * 'launchpad' (bonding curve, then the graduated AMM), 'aggregator' (best
 * route across every Solana venue, mainnet only), or 'auto' (the launchpad when
 * the mint trades there, otherwise the aggregator).
 *
 * @returns {Promise<{ route: 'launchpad'|'aggregator'|null, market: object|null, reason?: string }>}
 */
export async function resolveRoute({ network, mint, venue = 'auto' }) {
	if (venue === 'aggregator' && network !== 'mainnet') {
		return { route: null, market: null, reason: 'venue_mainnet_only' };
	}
	const want = venue === 'launchpad' || venue === 'aggregator' ? venue : null;
	const market = await quoteMarket({ network, mint, route: want });
	if (!market) return { route: null, market: null, reason: 'no_market' };
	return { route: market.route, market };
}

/**
 * Compute the live signal map an order's trigger needs. `need` is the set of
 * signal keys to resolve (price/mcap are always resolved since every price
 * trigger and most conditions use them). Each lookup degrades to null on failure.
 *
 * @param {object} o
 * @param {string} o.network
 * @param {string} o.mint
 * @param {string[]} [o.need]            extra signals (smart_money_score, dev_dump, …)
 * @param {number|null} [o.referencePrice]  baseline metric for price_change_pct
 * @param {string} [o.metric]            which metric price_change_pct is measured in
 * @param {string|null} [o.route]        'launchpad' | 'aggregator' | null (resolve)
 * @returns {Promise<{ market: object|null, signals: object }>}
 */
export async function getSignals({ network, mint, need = [], referencePrice = null, metric = 'mcap_usd', route = null }) {
	const market = await quoteMarket({ network, mint, route });
	const signals = {
		price_sol: market?.price_sol ?? null,
		mcap_sol: market?.mcap_sol ?? null,
		mcap_usd: null,
		graduated: market?.graduated ?? null,
		smart_money_score: null,
		dev_dump: null,
		price_change_pct: null,
	};

	const wants = new Set(need);
	// mcap_usd is needed whenever the metric is USD or a condition references it.
	if (market && (metric === 'mcap_usd' || wants.has('mcap_usd'))) {
		try { signals.mcap_usd = market.mcap_sol * (await solUsdPrice()); } catch { signals.mcap_usd = null; }
	}

	if (wants.has('smart_money_score')) {
		try {
			const sm = await getSmartMoneyForMint(mint, network);
			signals.smart_money_score = sm?.computed ? Number(sm.smart_money_score) : null;
		} catch { signals.smart_money_score = null; }
	}

	if (wants.has('dev_dump')) {
		try {
			const [row] = await sql`SELECT dev_sold, risk_flags FROM pump_coin_intel WHERE mint = ${mint}`;
			if (row) signals.dev_dump = row.dev_sold === true || (Array.isArray(row.risk_flags) && row.risk_flags.includes('dev_dumped'));
		} catch { signals.dev_dump = null; }
	}

	// price_change_pct vs the metric value captured when the order was created.
	// Always resolved when a baseline exists: the owner-facing order row shows it
	// whether or not a condition references the signal.
	if (referencePrice != null && market) {
		const cur = metricValue(market, signals, metric);
		if (cur != null && referencePrice > 0) signals.price_change_pct = ((cur - referencePrice) / referencePrice) * 100;
	}

	return { market, signals };
}

/** Pull the metric value (price_sol | mcap_sol | mcap_usd) out of a signal set. */
export function metricValue(market, signals, metric) {
	if (!market) return null;
	if (metric === 'price_sol') return market.price_sol;
	if (metric === 'mcap_sol') return market.mcap_sol;
	if (metric === 'mcap_usd') return signals.mcap_usd;
	return null;
}

/**
 * Live token holding for an owner. Sizes percentage sells (sell N% of the bag)
 * and supplies the mint decimals that convert a raw `size_tokens` order into the
 * whole-token amount the trade path expects. Returns whole-token + raw
 * base-unit balance + decimals, or null if the
 * owner holds none / the mint can't be read. Mirrors the resolveHolding logic the
 * trade endpoint uses so a percentage sell is priced against the same balance.
 */
export async function getHolding({ network, mint, owner }) {
	if (!owner) return null;
	let ctx;
	try { ctx = await getPumpTradeClient({ network }); } catch { return null; }
	const conn = ctx.connection;
	const mintPk = new PublicKey(mint);
	const ownerPk = new PublicKey(owner);
	let mintAcc;
	try { mintAcc = await conn.getAccountInfo(mintPk); } catch { return null; }
	if (!mintAcc) return null;
	const tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
	let decimals;
	try { decimals = (await getMint(conn, mintPk, 'confirmed', tokenProgramId)).decimals; } catch { return null; }
	const ata = getAssociatedTokenAddressSync(mintPk, ownerPk, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
	let raw = 0n;
	try { raw = BigInt((await conn.getTokenAccountBalance(ata)).value.amount); } catch { raw = 0n; }
	const whole = Number(raw) / 10 ** decimals;
	return { whole, raw, decimals };
}

export { TOTAL_SUPPLY_TOKENS, TOKEN_DECIMALS };
