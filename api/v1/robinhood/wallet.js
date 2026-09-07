// GET /api/v1/robinhood/wallet?address=0x… - the wallet side of the Hood Desk.
//
// Free, keyless, read-only: any address can be inspected, no signature and no
// session. One composed read returns the whole book for a Robinhood Chain
// (4663) wallet:
//
//   • native ETH balance            - chain RPC (eth_getBalance)
//   • ERC-20 positions, priced       - Blockscout balances joined to the
//     Chainlink NAV snapshot (Stock Tokens, uiMultiplier-correct per ERC-8056)
//     and to the deepest DexScreener pool (everything else)
//   • native balance history         - Blockscout coin-balance history. The
//     public sequencer RPC is not an archive node, so the indexer is the only
//     lane that can answer "what did this wallet hold an hour ago".
//   • activity tape + counterparties - Blockscout transactions folded together
//     with the token transfers they emitted
//
// Nothing here is estimated: a token the desk cannot price keeps a null value
// and is reported as unpriced rather than counted into the book at zero.

import { defineEndpoint } from '../../_lib/gateway.js';
import { error, rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import {
	publicClient,
	stockRegistry,
	chainlinkSnapshot,
	dexSnapshot,
	blockscoutStats,
	blockscoutAddressTokens,
	blockscoutCoinHistory,
	blockscoutCoinHistoryByDay,
	blockscoutAddressTxs,
	blockscoutAddressTokenTransfers,
	erc20Metadata,
	asOf,
} from '../../_lib/robinhood.js';
import {
	normalizeAddress,
	toUnits,
	balanceSeries,
	seriesChange,
	mergeActivity,
	mergeBalanceHistory,
	counterpartyFlow,
	rollupBook,
} from '../../_lib/robinhood-desk.js';

const CACHE_CONTROL = 'public, max-age=10, s-maxage=10, stale-while-revalidate=20';

export default defineEndpoint({
	name: 'v1.robinhood.wallet',
	method: 'GET',
	auth: 'public',
	handler: async ({ res, query, ip }) => {
		const rl = await limits.robinhoodRead(ip);
		if (!rl.success) return rateLimited(res, rl, 'Robinhood Chain data is capped at 60 requests/min per IP');

		const address = normalizeAddress(query.address);
		if (!address) {
			return error(
				res,
				400,
				'invalid_address',
				'pass ?address=0x… (a 20-byte Robinhood Chain address)',
			);
		}

		const [nativeWei, balances, coinHistory, dayHistory, txs, transfers, stats] = await Promise.all([
			publicClient(false).getBalance({ address }).then((v) => v.toString()).catch(() => null),
			blockscoutAddressTokens(address).catch(() => []),
			blockscoutCoinHistory(address).catch(() => []),
			blockscoutCoinHistoryByDay(address).catch(() => []),
			blockscoutAddressTxs(address).catch(() => []),
			blockscoutAddressTokenTransfers(address).catch(() => []),
			blockscoutStats().catch(() => null),
		]);

		const ethPriceUsd = stats && !stats.__error && stats.coin_price ? Number(stats.coin_price) : null;
		const held = balances
			.map((b) => ({
				address: normalizeAddress(b?.token?.address_hash || b?.token?.address),
				raw: b?.value ?? null,
				type: b?.token?.type || 'ERC-20',
				decimals: b?.token?.decimals != null ? Number(b.token.decimals) : null,
				symbol: b?.token?.symbol || null,
				name: b?.token?.name || null,
				icon: b?.token?.icon_url || null,
				holders: b?.token?.holders_count != null ? Number(b.token.holders_count) : null,
			}))
			.filter((t) => t.address && t.raw && t.type === 'ERC-20');

		// Unverified launchpad coins are indexed without decimals or a symbol.
		// Ask the contracts directly (one multicall) instead of guessing 18,
		// which would print a balance off by orders of magnitude.
		const unknown = held.filter((t) => t.decimals == null || !t.symbol).map((t) => t.address);
		const [meta, dex] = await Promise.all([
			erc20Metadata(unknown).catch(() => ({})),
			dexSnapshot(held.map((t) => t.address)).catch(() => ({})),
		]);
		const stockByAddress = new Map(
			stockRegistry().tokens.map((t) => [t.address.toLowerCase(), t]),
		);
		const nav = held.some((t) => stockByAddress.has(t.address))
			? await chainlinkSnapshot().catch(() => ({}))
			: {};

		const positions = held.map((t) => {
			const fallback = meta[t.address] || {};
			const decimals = t.decimals ?? fallback.decimals ?? null;
			const stock = stockByAddress.get(t.address) || null;
			const feed = stock ? nav[t.address] || null : null;
			const pair = dex[t.address] || null;

			// ERC-8056: a Stock Token's true position is raw × uiMultiplier / 1e18,
			// and its Chainlink NAV is already multiplier-adjusted, so the
			// multiplier is applied to the balance exactly once and never to the
			// price.
			const rawUnits = decimals != null ? toUnits(t.raw, decimals) : null;
			const multiplier = feed?.uiMultiplier ? Number(feed.uiMultiplier) / 1e18 : 1;
			const amount = rawUnits != null ? rawUnits * (stock ? multiplier : 1) : null;

			const navPriceUsd = feed?.priceUsd ?? null;
			const dexPriceUsd = pair?.priceUsd != null ? Number(pair.priceUsd) : null;
			const priceUsd = navPriceUsd ?? dexPriceUsd;
			return {
				address: t.address,
				symbol: t.symbol || fallback.symbol || pair?.baseToken?.symbol || null,
				name: t.name || fallback.name || pair?.baseToken?.name || null,
				icon: t.icon,
				decimals,
				rawBalance: String(t.raw),
				amount,
				kind: stock ? 'stock' : 'coin',
				priceUsd,
				priceSource: navPriceUsd != null ? 'chainlink-nav' : dexPriceUsd != null ? 'dex' : null,
				navPriceUsd,
				dexPriceUsd,
				change24hPct: pair?.priceChange?.h24 ?? null,
				liquidityUsd: pair?.liquidity?.usd ?? null,
				valueUsd: amount != null && priceUsd != null ? amount * priceUsd : null,
				pairUrl: pair?.url || null,
				holders: t.holders,
			};
		});

		const nativeEth = toUnits(nativeWei, 18);
		const book = rollupBook(
			nativeEth != null && ethPriceUsd != null ? nativeEth * ethPriceUsd : null,
			positions,
		);
		const intraday = balanceSeries(coinHistory, { ethPriceUsd });
		const daily = balanceSeries(dayHistory, { ethPriceUsd });
		const series = mergeBalanceHistory(daily, intraday);
		const activity = mergeActivity(txs, transfers, address, { limit: 40 });

		// A dusted wallet can hold hundreds of airdropped tokens (218 on one live
		// address during development, a 112KB response). The book totals count
		// every one of them; the returned ladder is capped at the deepest 100 by
		// value, and `positionsTruncated` says so rather than letting a client
		// believe it has the whole list.
		const POSITION_CAP = 100;
		const positionsOut = book.positions.slice(0, POSITION_CAP);

		res.setHeader('cache-control', CACHE_CONTROL);
		return {
			address,
			native: {
				symbol: 'ETH',
				balance: nativeEth,
				balanceWei: nativeWei,
				valueUsd: nativeEth != null && ethPriceUsd != null ? nativeEth * ethPriceUsd : null,
			},
			book: {
				valueUsd: book.bookValueUsd,
				nativeUsd: book.nativeUsd,
				tokensUsd: book.tokensUsd,
				nativeSharePct: book.nativeSharePct,
				positionCount: book.positionCount,
				pricedCount: book.pricedCount,
			},
			positions: positionsOut,
			positionsTruncated: book.positionCount > positionsOut.length,
			history: {
				series,
				intraday,
				daily,
				change: seriesChange(series),
				sessionChange: seriesChange(intraday),
				// The chain has no historical ETH price feed, so USD points on the
				// series are the native balance marked at one current price. Said
				// out loud here so the client can label the axis honestly.
				usdBasis: ethPriceUsd != null ? { ethPriceUsd, mode: 'current-price' } : null,
			},
			activity,
			counterparties: counterpartyFlow(activity),
			ethPriceUsd,
			source: 'chain rpc + blockscout + chainlink (on-chain) + dexscreener',
			asOf: asOf(),
		};
	},
});
