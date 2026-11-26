// Recent pump.fun trades for one mint, read straight from Solana.
//
// pump.fun's HTTP trade feeds are gone: swap-api /v2/coins/<mint>/trades
// answers 410 "deprecated" and frontend-api /trades/all/<mint> rejects every
// request (including a valid CAIP-2 chainId) since 2026-11-25. The chain is
// the authoritative record anyway, so this reads it over the platform's own
// RPC failover chain with no third-party unlock.
//
// One reader serves the pump-fun MCP tool (get_token_trades), the shared feed
// layer (pump-feed-fetch.js fetchPumpTrades, behind /api/crypto/trending,
// /api/crypto/whales and the x402 pump signals), pump alerts and token stats.

import { getConnection, solanaPubkey, getAmmPoolState, getPumpSdkV2 } from './pump.js';
import { cacheGet, cacheSet } from './cache.js';
import { eventField } from './pump-onchain-trades.js';
import { pumpTradesFromEvents } from '../../src/pump/trade-events.js';
import { getSolPriceUsd } from '../../src/shared/usd-price.js';

// Recent trade history for a mint, read directly from chain so it works without
// the optional pump.fun indexer. Pre-graduation tokens trade against the pump
// bonding-curve program (`TradeEvent`); graduated tokens trade on the pump AMM
// pool (`BuyEvent`/`SellEvent`). We pull recent signatures for whichever account
// is live, fetch those transactions, and decode the on-chain events.
// What one confirmed transaction says about one coin: a trade, or not a trade
// (null). Same reasoning as the claim verdicts above: confirmed history never
// changes, and repeat polls of one coin were re-reading it at 12,600
// getTransaction calls an hour on 2026-11-06. usdValue is left out because it
// follows the current SOL price. A transaction the RPC has not returned yet, or
// logs the parser rejected, is never remembered.
const TRADE_VERDICT_TTL_S = 24 * 60 * 60;
const tradeVerdictKey = (network, venue, mint, signature) => `pumptrade:v1:${network}:${venue}:${mint}:${signature}`;

/**
 * Decode up to `limit` (max 50) trades for a mint from its curve or pool
 * signatures, newest first. `before` continues from a previous page's
 * `cursor`; `hasMore` is false once the account's signature history ends.
 *
 * @param {{ mint: string, limit?: number, network?: string, before?: string|null }} args
 */
export async function readPumpTradesFromChain({ mint, limit, network = 'mainnet', before = null }) {
	const pk = solanaPubkey(mint);
	if (!pk) throw new TypeError('invalid mint');
	const want = Math.min(50, Math.max(1, Number(limit) || 20));
	// Fetch a few extra signatures since some touching the account aren't trades
	// (fee claims, migrations) and get filtered out during decode.
	const sigLimit = Math.min(60, want * 2);
	const connection = getConnection({ network });

	// Resolve whether the token has graduated to the AMM. A live pool means we
	// read AMM Buy/Sell events; otherwise we read bonding-curve TradeEvents.
	let pool = null;
	try {
		const ammState = await getAmmPoolState({ network, mint });
		pool = ammState?.poolKey ?? null;
	} catch (e) {
		// No pool yet (pool_not_found) or a transient AMM read failure: fall
		// through to the bonding-curve path rather than failing the request.
		void e;
	}

	const [anchor, pumpSdk, ammSdk, solPrice] = await Promise.all([
		import('@coral-xyz/anchor'),
		import('@pump-fun/pump-sdk'),
		import('@pump-fun/pump-swap-sdk'),
		getSolPriceUsd().catch(() => null),
	]);
	const { BorshCoder, EventParser } = anchor;

	const isAmm = !!pool;
	let address;
	let parser;
	if (isAmm) {
		address = pool;
		const coder = new BorshCoder(ammSdk.pumpAmmJson);
		parser = new EventParser(ammSdk.PUMP_AMM_PROGRAM_ID, coder);
	} else {
		const v2 = await getPumpSdkV2({ network });
		address = v2.bondingCurvePda(pk);
		const coder = new BorshCoder(pumpSdk.pumpIdl);
		parser = new EventParser(pumpSdk.PUMP_PROGRAM_ID, coder);
	}

	const sigInfos = await connection.getSignaturesForAddress(address, before ? { limit: sigLimit, before } : { limit: sigLimit });
	if (!sigInfos.length) return { mint, network, graduated: isAmm, count: 0, trades: [], cursor: null, hasMore: false };

	const signatures = sigInfos.map((s) => s.signature);
	const mintStr = pk.toString();
	const poolStr = pool?.toString();
	const trades = [];

	function decodeTx(tx, signature) {
		const logs = tx?.meta?.logMessages;
		if (!logs || tx.meta.err) return null;
		const blockTime = tx.blockTime ? tx.blockTime * 1000 : Date.now();
		let parsed;
		try {
			parsed = [...parser.parseLogs(logs)];
		} catch {
			return undefined;
		}
		for (const event of parsed) {
			if (isAmm && (event.name === 'BuyEvent' || event.name === 'SellEvent')) {
				const d = event.data;
				if (poolStr && d.pool?.toString() !== poolStr) continue;
				const isBuy = event.name === 'BuyEvent';
				const lamports = isBuy
					? eventField(d, 'quoteAmountIn')
					: eventField(d, 'quoteAmountOut');
				const tokens = isBuy
					? eventField(d, 'baseAmountOut')
					: eventField(d, 'baseAmountIn');
				const sol = Number(lamports?.toString() ?? '0') / 1e9;
				const ts = eventField(d, 'timestamp');
				return {
					signature,
					isBuy,
					solAmount: sol,
					tokenAmount: tokens?.toString() ?? '0',
					wallet: d.user?.toString() ?? null,
					timestamp: ts ? Number(ts.toString()) : Math.floor(blockTime / 1000),
				};
			}
		}
		if (isAmm) return null;
		// A buy that completed the curve also carries its synthetic-migration pool
		// part; pumpTradesFromEvents folds it in.
		const trade = pumpTradesFromEvents(parsed).find((t) => t.mint === mintStr);
		if (!trade) return null;
		const sol = Number(trade.solAmount) / 1e9;
		const ts = eventField(trade.data, 'timestamp');
		return {
			signature,
			isBuy: trade.isBuy,
			solAmount: sol,
			tokenAmount: trade.tokenAmount.toString(),
			wallet: trade.user || null,
			timestamp: ts ? Number(ts.toString()) : Math.floor(blockTime / 1000),
		};
	}

	// Fetch in small chunks and stop as soon as we have enough trades. Most
	// signatures touching the curve/pool account ARE trades, so we rarely need
	// the full window. Chunking also keeps batch sizes friendly to public RPCs.
	const CHUNK = 8;
	const venue = isAmm ? 'amm' : 'curve';
	let lastExamined = null;
	for (let off = 0; off < signatures.length && trades.length < want; off += CHUNK) {
		const slice = signatures.slice(off, off + CHUNK);
		const verdicts = new Map();
		await Promise.all(slice.map(async (signature) => {
			const hit = await cacheGet(tradeVerdictKey(network, venue, mintStr, signature)).catch(() => null);
			if (hit && typeof hit === 'object' && 'trade' in hit) verdicts.set(signature, hit);
		}));
		const unread = slice.filter((signature) => !verdicts.has(signature));
		const txs = unread.length
			? await connection.getTransactions(unread, {
					maxSupportedTransactionVersion: 1,
					commitment: 'confirmed',
				})
			: [];
		unread.forEach((signature, i) => {
			if (!txs[i]) return;
			const trade = decodeTx(txs[i], signature);
			if (trade === undefined) return;
			const verdict = { trade };
			verdicts.set(signature, verdict);
			cacheSet(tradeVerdictKey(network, venue, mintStr, signature), verdict, TRADE_VERDICT_TTL_S).catch(() => {});
		});
		for (const signature of slice) {
			if (trades.length >= want) break;
			lastExamined = signature;
			const trade = verdicts.get(signature)?.trade;
			if (trade) trades.push({ ...trade, usdValue: solPrice > 0 ? trade.solAmount * solPrice : null });
		}
	}

	// Older history remains when this page stopped before its last signature or
	// the RPC filled the whole signature window.
	const hasMore = lastExamined !== signatures[signatures.length - 1] || sigInfos.length === sigLimit;
	return { mint, network, graduated: isAmm, count: trades.length, trades, cursor: lastExamined, hasMore };
}

/**
 * One chain trade in the row shape the pump.fun swap-api used to serve, which
 * every feed consumer reads: type/amountSol/amountUsd/userAddress/timestamp
 * (unix seconds). amountUsd is null when no SOL price was available.
 *
 * @param {{ signature: string, isBuy: boolean, solAmount: number, tokenAmount: string, wallet: string|null, timestamp: number, usdValue: number|null }} t
 */
export function chainTradeRow(t) {
	const side = t.isBuy ? 'buy' : 'sell';
	const usd = Number.isFinite(t.usdValue) && t.usdValue > 0 ? t.usdValue : null;
	const tokens = Number(t.tokenAmount);
	return {
		signature: t.signature,
		tx: t.signature,
		type: side,
		txType: side,
		is_buy: t.isBuy,
		amountSol: t.solAmount,
		amountUsd: usd,
		// pump.fun coins all carry 6 decimals.
		priceUsd: usd != null && tokens > 0 ? usd / (tokens / 1e6) : null,
		tokenAmount: t.tokenAmount,
		userAddress: t.wallet,
		user: t.wallet,
		timestamp: t.timestamp,
	};
}

/**
 * Recent trades for a mint as swap-api-shaped rows, newest first. Never
 * throws: an invalid mint or an RPC failure is null, so callers can tell an
 * outage from a coin with no trades ([]).
 *
 * @param {string} mint
 * @param {{ limit?: number, network?: string }} [opts]
 * @returns {Promise<Array<object>|null>}
 */
export async function fetchChainTradeRows(mint, { limit = 50, network = 'mainnet' } = {}) {
	const page = await fetchChainTradePage(mint, { limit, network });
	return page ? page.rows : null;
}

/**
 * One page of trade rows, for callers that walk history back (token-stats
 * pages a day). Pass the previous page's `cursor` as `before`. Never throws:
 * a failed read is null, so a page error is never mistaken for the end of the
 * coin's history.
 *
 * @param {string} mint
 * @param {{ limit?: number, before?: string|null, network?: string }} [opts]
 * @returns {Promise<{ rows: Array<object>, cursor: string|null, hasMore: boolean }|null>}
 */
export async function fetchChainTradePage(mint, { limit = 50, before = null, network = 'mainnet' } = {}) {
	try {
		const r = await readPumpTradesFromChain({ mint, limit, network, before });
		return { rows: r.trades.map(chainTradeRow), cursor: r.cursor, hasMore: r.hasMore };
	} catch {
		return null;
	}
}
