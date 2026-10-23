/**
 * /api/pump/token-stats: the neutral, trader-terminal fact sheet behind the
 * "Token stats" panel on /launches/<mint>.
 *
 *   GET /api/pump/token-stats?mint=<mint>
 *
 * Facts only, never a verdict. Every field is a number or a state read straight
 * from a public source, so the page can show what GMGN-style terminals show
 * without scoring, ranking, or labeling anyone's coin:
 *
 *   · windows     5m / 1h / 6h / 24h volume, buys, sells, buy and sell volume,
 *                 net buy, unique traders, price change (pump.fun swap API
 *                 trades, paged back up to 24h)
 *   · holders     holder count, top-10 share, top holder, dev share, bonding
 *                 curve share, early-buyer share, top-10 list (Helius DAS, or
 *                 the 20 largest accounts over plain RPC when Helius is down)
 *   · signals     Gini of the top-50 holders, share of the first buyers seeded by
 *                 one funder, and whether the creation transaction was v1
 *                 (api/_lib/coin/holder-signals.js)
 *   · authorities mint and freeze authority as read off the mint account
 *   · curve       bonding curve progress, curve reserves, graduation state
 *   · market      liquidity and DEX Screener paid-profile state
 *
 * A field that could not be read is null, never 0, so the client renders "-"
 * instead of a made-up figure. mainnet only: pump.fun has no devnet market.
 */

import { PublicKey } from '@solana/web3.js';
import { unpackMint } from '@solana/spl-token';
import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { cacheWrapLastGood } from '../_lib/cache.js';
import { pumpFetchJson, PUMP_FRONTEND_BASE, PUMP_SWAP_BASE } from '../_lib/pump-feed-fetch.js';
import { liveHolderSet } from '../_lib/coin/cohorts-live.js';
import { getConnection } from '../_lib/pump.js';
import { solPriceUsd } from '../_lib/sol-price.js';
import { holderGini, readSeeding, readLaunchVersion, persistOracleSignals } from '../_lib/coin/holder-signals.js';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DEXSCREENER = 'https://api.dexscreener.com';

const TRADE_PAGE = 100;
const TRADE_MAX_PAGES = 15; // 1,500 trades: a full day for all but the busiest coins
const DAY_SEC = 86_400;
// pump.fun bonding curves start with 793.1M tokens available to buy; progress is
// the share of that pool already bought out.
const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;
// A buy landing within this many seconds of creation counts as an early buy.
const EARLY_BUY_SEC = 5;
const CACHE_TTL_S = 20;

export const WINDOWS = [
	{ key: '5m', sec: 300 },
	{ key: '1h', sec: 3600 },
	{ key: '6h', sec: 21_600 },
	{ key: '24h', sec: DAY_SEC },
];

const num = (v) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/** Normalize one swap-API trade row. Rows without a timestamp or side are dropped. */
export function normalizeTrade(t) {
	const ts = Date.parse(t?.timestamp);
	const side = String(t?.type || '').toLowerCase();
	if (!Number.isFinite(ts) || (side !== 'buy' && side !== 'sell')) return null;
	return {
		t: Math.floor(ts / 1000),
		buy: side === 'buy',
		user: t.userAddress || t.user || null,
		usd: num(t.amountUsd) ?? 0,
		sol: num(t.amountSol) ?? 0,
		price: num(t.priceUsd),
	};
}

/**
 * Roll normalized trades (any order) into per-window stats. `coveredFrom` is the
 * oldest timestamp the fetched history reaches, or null when the history is the
 * coin's complete trade list; a window reaching past it is flagged partial.
 */
export function windowStats(trades, { now, coveredFrom = null }) {
	const sorted = [...trades].sort((a, b) => a.t - b.t);
	const last = sorted.length ? sorted[sorted.length - 1] : null;
	return Object.fromEntries(
		WINDOWS.map((w) => {
			const start = now - w.sec;
			const inWin = sorted.filter((x) => x.t >= start);
			const makers = new Set();
			let buys = 0;
			let sells = 0;
			let buyUsd = 0;
			let sellUsd = 0;
			for (const x of inWin) {
				if (x.user) makers.add(x.user);
				if (x.buy) {
					buys++;
					buyUsd += x.usd;
				} else {
					sells++;
					sellUsd += x.usd;
				}
			}
			// Price change: last trade price against the last trade before the window
			// opened (the price the window started at). No prior trade means the coin
			// did not exist yet, so the first trade inside the window is the base.
			let change = null;
			if (last?.price) {
				const before = sorted.filter((x) => x.t < start && x.price);
				const base = before.length ? before[before.length - 1] : inWin.find((x) => x.price);
				if (base?.price && base !== last) change = ((last.price - base.price) / base.price) * 100;
				else if (base === last) change = 0;
			}
			return [
				w.key,
				{
					volume_usd: buyUsd + sellUsd,
					buys,
					sells,
					buy_usd: buyUsd,
					sell_usd: sellUsd,
					net_buy_usd: buyUsd - sellUsd,
					traders: makers.size,
					price_change_pct: change,
					partial: coveredFrom != null && coveredFrom > start,
				},
			];
		}),
	);
}

/** Page the swap API back until a day of history, the coin's first trade, or the page cap. */
async function fetchDayOfTrades(mint, now) {
	const out = [];
	let cursor = null;
	let complete = false;
	for (let page = 0; page < TRADE_MAX_PAGES; page++) {
		const qs = new URLSearchParams({ limit: String(TRADE_PAGE) });
		if (cursor) qs.set('cursor', cursor);
		const { ok, body } = await pumpFetchJson(
			`${PUMP_SWAP_BASE}/v2/coins/${encodeURIComponent(mint)}/trades?${qs}`,
			{ timeoutMs: 6000 },
		);
		if (!ok) {
			if (page === 0) return null;
			break;
		}
		const rows = (Array.isArray(body?.trades) ? body.trades : []).map(normalizeTrade).filter(Boolean);
		out.push(...rows);
		cursor = body?.pagination?.nextCursor || null;
		if (!body?.pagination?.hasMore || !cursor) {
			complete = true;
			break;
		}
		const oldest = rows.length ? Math.min(...rows.map((r) => r.t)) : now;
		if (oldest < now - DAY_SEC) break;
	}
	const oldest = out.length ? Math.min(...out.map((r) => r.t)) : null;
	return { trades: out, complete, oldest };
}

function shareOfSupply(units, supply) {
	if (supply <= 0n) return null;
	return Number((units * 1_000_000_000n) / supply) / 1_000_000_000;
}

/**
 * Holder facts over the live holder set. The bonding curve and AMM pool are
 * program-owned liquidity, not holders, so they are reported separately and
 * excluded from the top-holder ranking the way trading terminals do.
 */
export function holderStats(holders, { supply, creator, curve, pool, earlyBuyers, complete = true }) {
	const program = new Set([curve, pool].filter(Boolean));
	const people = holders.filter((h) => !program.has(h.wallet));
	const byWallet = new Map(holders.map((h) => [h.wallet, h.units]));
	const sum = (list) => list.reduce((acc, h) => acc + h.units, 0n);
	const top10 = people.slice(0, 10);
	// A largest-accounts-only set knows the top of the book but not the tail, so
	// the full count and the early-buyer sum are unknowable from it.
	const early = earlyBuyers && complete
		? sum(people.filter((h) => earlyBuyers.has(h.wallet) && h.wallet !== creator))
		: null;
	return {
		count: complete ? people.length : null,
		top10_pct: shareOfSupply(sum(top10), supply),
		top1_pct: people[0] ? shareOfSupply(people[0].units, supply) : null,
		// Outside the largest accounts the dev's balance is unknown, not zero.
		dev_pct: creator && (complete || byWallet.has(creator)) ? shareOfSupply(byWallet.get(creator) || 0n, supply) : null,
		curve_pct: curve ? shareOfSupply(byWallet.get(curve) || 0n, supply) : null,
		pool_pct: pool ? shareOfSupply(byWallet.get(pool) || 0n, supply) : null,
		early_buyers: earlyBuyers && complete ? earlyBuyers.size : null,
		early_buyers_pct: early == null ? null : shareOfSupply(early, supply),
		...holderGini(holders, { curve, pool }),
		top: top10.map((h) => ({
			wallet: h.wallet,
			pct: shareOfSupply(h.units, supply),
			is_dev: h.wallet === creator,
		})),
	};
}

/**
 * Holder set from standard RPC when Helius DAS is unavailable (quota, outage):
 * the 20 largest token accounts, resolved to their owner wallets. Any provider
 * on the failover chain serves getTokenLargestAccounts, so the top of the book
 * survives a Helius outage; the full holder count does not.
 */
async function largestHolderSet(mint) {
	const conn = getConnection({ network: 'mainnet' });
	const mintPk = new PublicKey(mint);
	const largest = await conn.getTokenLargestAccounts(mintPk, 'confirmed');
	const accounts = (largest?.value || []).filter((a) => a.amount && a.amount !== '0');
	if (!accounts.length) return null;
	const parsed = await conn.getMultipleParsedAccounts(accounts.map((a) => a.address), { commitment: 'confirmed' });
	const byOwner = new Map();
	accounts.forEach((a, i) => {
		const owner = parsed?.value?.[i]?.data?.parsed?.info?.owner;
		if (!owner) return;
		byOwner.set(owner, (byOwner.get(owner) || 0n) + BigInt(a.amount));
	});
	const holders = [...byOwner.entries()]
		.map(([wallet, units]) => ({ wallet, units }))
		.sort((a, b) => (b.units > a.units ? 1 : b.units < a.units ? -1 : 0));
	return holders.length ? { holders, complete: false } : null;
}

async function readHolderSet(mint) {
	try {
		const live = await liveHolderSet({ mint, network: 'mainnet' });
		if (live?.holders?.length) return { holders: live.holders, complete: true };
	} catch {
		/* Helius DAS unavailable with no cached copy: fall through to plain RPC */
	}
	try {
		return await largestHolderSet(mint);
	} catch {
		return null;
	}
}

async function readAuthorities(mint) {
	try {
		const mintPk = new PublicKey(mint);
		const info = await getConnection({ network: 'mainnet' }).getAccountInfo(mintPk, 'confirmed');
		if (!info) return null;
		const m = unpackMint(mintPk, info, info.owner);
		return {
			mint_authority: m.mintAuthority ? m.mintAuthority.toBase58() : null,
			freeze_authority: m.freezeAuthority ? m.freezeAuthority.toBase58() : null,
			decimals: m.decimals,
			supply: m.supply.toString(),
		};
	} catch {
		return null;
	}
}

async function readDexScreener(mint) {
	const [pairsRes, ordersRes] = await Promise.all([
		pumpFetchJson(`${DEXSCREENER}/tokens/v1/solana/${mint}`, { timeoutMs: 5000, retries: 0 }),
		pumpFetchJson(`${DEXSCREENER}/orders/v1/solana/${mint}`, { timeoutMs: 5000, retries: 0 }),
	]);
	const pairs = pairsRes.ok && Array.isArray(pairsRes.body) ? pairsRes.body : [];
	const liquidity = pairs.reduce((acc, p) => acc + (num(p?.liquidity?.usd) || 0), 0);
	const orders = ordersRes.ok && Array.isArray(ordersRes.body?.orders) ? ordersRes.body.orders : null;
	return {
		liquidity_usd: liquidity > 0 ? liquidity : null,
		dex_paid: orders == null ? null : orders.some((o) => o?.type === 'tokenProfile' && o?.status === 'approved'),
		pair_url: pairs[0]?.url || null,
	};
}

/** Exported so other composed read surfaces (the launch receipt) can reuse the same fact sheet without an internal HTTP round trip. */
export async function buildStats(mint) {
	const now = Math.floor(Date.now() / 1000);
	const metaRes = await pumpFetchJson(`${PUMP_FRONTEND_BASE}/coins-v2/${mint}`, { timeoutMs: 5000 });
	const coin = metaRes.ok ? metaRes.body : null;

	const supply = coin?.total_supply != null ? BigInt(Math.round(Number(coin.total_supply))) : 1_000_000_000_000_000n;
	const creator = coin?.creator || null;
	const curve = coin?.bonding_curve || null;
	const pool = coin?.pool_address || null;
	const createdSec = num(coin?.created_timestamp) != null ? Math.floor(coin.created_timestamp / 1000) : null;

	const [tradeHist, holderSet, authorities, dex, solUsd, launchVersion] = await Promise.all([
		fetchDayOfTrades(mint, now),
		readHolderSet(mint),
		readAuthorities(mint),
		readDexScreener(mint),
		solPriceUsd().catch(() => null),
		readLaunchVersion(mint).catch(() => null),
	]);

	// The first buyers are only nameable from a complete trade history.
	const seeding = await readSeeding(mint, tradeHist?.complete ? tradeHist.trades : null, { creator }).catch(() => null);

	// Early buyers are only knowable when the fetched history reaches the coin's
	// first trade; otherwise the field stays null rather than undercounting.
	let earlyBuyers = null;
	if (tradeHist?.complete && createdSec != null) {
		earlyBuyers = new Set(
			tradeHist.trades
				.filter((x) => x.buy && x.user && x.user !== creator && x.t - createdSec <= EARLY_BUY_SEC)
				.map((x) => x.user),
		);
	}

	const devTrades = tradeHist && creator ? tradeHist.trades.filter((x) => x.user === creator) : [];

	const realTokens = coin?.real_token_reserves != null ? BigInt(Math.round(Number(coin.real_token_reserves))) : null;
	const graduated = coin?.complete === true;
	const curveProgress = graduated
		? 100
		: realTokens != null
			? Math.max(0, Math.min(100, Number(((INITIAL_REAL_TOKEN_RESERVES - realTokens) * 1_000_000n) / INITIAL_REAL_TOKEN_RESERVES) / 10_000))
			: null;
	const curveSol = !graduated && coin?.real_sol_reserves != null ? Number(coin.real_sol_reserves) / 1e9 : null;
	// Curve liquidity the way trading terminals quote it: both sides of the
	// virtual reserves valued in USD (SOL side doubled, since the token side is
	// priced against it). A graduated coin reads its AMM liquidity from DEX Screener.
	const virtualSol = coin?.virtual_sol_reserves != null ? Number(coin.virtual_sol_reserves) / 1e9 : null;
	const curveLiquidityUsd = !graduated && virtualSol != null && solUsd ? virtualSol * 2 * solUsd : null;

	const holders = holderSet
		? { ...holderStats(holderSet.holders, { supply, creator, curve, pool, earlyBuyers, complete: holderSet.complete }), complete: holderSet.complete }
		: null;
	persistOracleSignals(mint, { gini: holders?.gini ?? null, seededShare: seeding?.seeded_share ?? null });

	return {
		mint,
		as_of: new Date(now * 1000).toISOString(),
		windows: tradeHist
			? windowStats(tradeHist.trades, { now, coveredFrom: tradeHist.complete ? null : tradeHist.oldest })
			: null,
		trades_sampled: tradeHist?.trades.length ?? null,
		holders,
		authorities,
		seeding,
		launch_version: launchVersion,
		dev: creator
			? {
					wallet: creator,
					bought: devTrades.filter((x) => x.buy).length,
					sold: devTrades.filter((x) => !x.buy).length,
				}
			: null,
		curve: coin
			? {
					graduated,
					progress_pct: curveProgress,
					real_sol: curveSol,
					real_sol_usd: curveSol != null && solUsd ? curveSol * solUsd : null,
				}
			: null,
		market: {
			market_cap_usd: num(coin?.usd_market_cap ?? coin?.market_cap_usd),
			ath_market_cap_usd: num(coin?.ath_market_cap),
			liquidity_usd: dex.liquidity_usd ?? curveLiquidityUsd,
			dex_paid: dex.dex_paid,
			dexscreener_url: dex.pair_url,
		},
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
	const mint = (url.searchParams.get('mint') || '').trim();
	if (!MINT_RE.test(mint)) return error(res, 400, 'invalid_mint', 'mint must be a base58 address');

	const body = await cacheWrapLastGood(`pump:token-stats:${mint}`, CACHE_TTL_S, () => buildStats(mint));
	res.setHeader('cache-control', 'public, max-age=15, s-maxage=20');
	return json(res, 200, body);
});
