// Trade history for paired coins, read from the launchpad's own events.
//
// Every buy and sell emits `Swap(token, quoteToken, trader, isBuy, quoteAmount,
// tokenAmount, feeAmount)`, which is everything a trade feed and a candle need.
// The chain is the log: there is no ingestion pipeline to fall behind.
//
// Robinhood Chain's RPC caps one eth_getLogs at 10,000,000 blocks (~11 days at
// ~100ms blocks), so history is read in fixed 10M-block chunks counted from the
// launchpad's first block. A chunk that ends well below the head can never
// change, so it is cached for a day; only the newest chunk is re-read, briefly
// cached. A coin's scan starts at the block it launched in, so a young coin
// costs one call however long the launchpad has existed.

import { createPublicClient, fallback, formatUnits, http } from 'viem';
import { cacheWrap } from './cache.js';
import { HOOD_MAINNET, publicClient, rpcUrls } from './robinhood.js';
import { LAUNCHPAD_START_BLOCK, TOKEN_DECIMALS, launchedEvent, launchpadAddress, quoteIndex, swapEvent } from './paired-launchpad.js';

export const LOG_CHUNK = 10_000_000n;
// A chunk this far below the head is final for caching purposes.
const FINALITY_BLOCKS = 2_000n;

function chunkBounds(from, head) {
	const chunks = [];
	const first = (from - LAUNCHPAD_START_BLOCK) / LOG_CHUNK;
	for (let i = first; LAUNCHPAD_START_BLOCK + i * LOG_CHUNK <= head; i++) {
		const start = LAUNCHPAD_START_BLOCK + i * LOG_CHUNK;
		const end = start + LOG_CHUNK - 1n;
		chunks.push({ i, start: start < from ? from : start, end: end > head ? head : end, final: end + FINALITY_BLOCKS < head });
	}
	return chunks;
}

// Log scans get their own client with JSON-RPC batching off. The shared
// client batches every concurrent call into one request, and this RPC drops
// calls out of a large batch, which surfaces as a response with no entry for
// the getLogs at all.
let logClient = null;
function logsClient() {
	if (!logClient) {
		const transports = rpcUrls(false).map((u) => http(u, { timeout: 15_000, retryCount: 2 }));
		logClient = createPublicClient({
			chain: HOOD_MAINNET,
			transport: transports.length === 1 ? transports[0] : fallback(transports, { rank: false }),
		});
	}
	return logClient;
}

const plain = (log) => ({
	block: log.blockNumber.toString(),
	txHash: log.transactionHash,
	logIndex: log.logIndex,
	args: Object.fromEntries(
		Object.entries(log.args).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map((x) => ({ ...x })) : v]),
	),
});

/** Every log of one launchpad event matching `args`, oldest first. */
async function scanLaunchpad(event, eventName, args, from = LAUNCHPAD_START_BLOCK) {
	const client = logsClient();
	const head = await client.getBlockNumber();
	const argKey = Object.entries(args).map(([k, v]) => `${k}=${String(v).toLowerCase()}`).join('&') || 'all';
	const chunks = chunkBounds(from, head);
	const batches = await Promise.all(
		chunks.map(({ i, start, end, final }) =>
			cacheWrap(`paired:logs:${launchpadAddress()}:${eventName}:${argKey}:${i}:${final ? 'f' : start}`, final ? 86_400 : 10, async () =>
				(await client.getLogs({ address: launchpadAddress(), event, args, fromBlock: start, toBlock: end })).map(plain),
			),
		),
	);
	return batches.flat();
}

/** The block a coin launched in, from its own Launched event. Immutable, so cached long. */
export async function launchBlockOf(token) {
	return cacheWrap(`paired:launch-block:${String(token).toLowerCase()}`, 86_400, async () => {
		const [log] = await scanLaunchpad(launchedEvent, 'Launched', { token });
		return log ? { block: log.block, txHash: log.txHash } : null;
	});
}

const blockTimes = new Map();

async function timestampOf(block) {
	if (blockTimes.has(block)) return blockTimes.get(block);
	const b = await publicClient(false).getBlock({ blockNumber: BigInt(block) });
	const seconds = Number(b.timestamp);
	blockTimes.set(block, seconds);
	return seconds;
}

/**
 * Every swap of one coin, oldest first, with amounts in each pool's own
 * decimals. `price` is quote units per whole coin for that fill.
 */
export async function coinTrades(token) {
	const launch = await launchBlockOf(token);
	if (!launch) return [];
	const [logs, quotes] = await Promise.all([scanLaunchpad(swapEvent, 'Swap', { token }, BigInt(launch.block)), quoteIndex()]);
	await Promise.all([...new Set(logs.map((l) => l.block))].map(timestampOf));
	return logs
		.map((l) => {
			const q = quotes.get(String(l.args.quoteToken).toLowerCase()) || { symbol: '?', decimals: 18 };
			const quoteAmount = Number(formatUnits(BigInt(l.args.quoteAmount), q.decimals));
			const tokenAmount = Number(formatUnits(BigInt(l.args.tokenAmount), TOKEN_DECIMALS));
			return {
				txHash: l.txHash,
				block: Number(l.block),
				time: blockTimes.get(l.block) ?? 0,
				trader: l.args.trader,
				isBuy: l.args.isBuy,
				quoteToken: l.args.quoteToken,
				quoteSymbol: q.symbol,
				quoteAmount,
				tokenAmount,
				fee: Number(formatUnits(BigInt(l.args.feeAmount), q.decimals)),
				// A fill that rounds to zero tokens would poison every candle it
				// touches with Infinity, so it carries no price.
				price: tokenAmount > 0 ? quoteAmount / tokenAmount : null,
			};
		})
		.sort((a, b) => a.block - b.block || a.time - b.time);
}

export const coinTradesCached = (token) => cacheWrap(`paired:trades:${String(token).toLowerCase()}`, 15, () => coinTrades(token));

export const INTERVALS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 };

/**
 * OHLCV candles for one pool. Quiet intervals are filled forward with flat
 * candles: a chart that skips the hours nobody traded compresses time and makes
 * a quiet coin look busy.
 */
export function toCandles(trades, intervalSeconds) {
	const buckets = new Map();
	for (const t of trades) {
		if (t.price == null) continue;
		const time = Math.floor(t.time / intervalSeconds) * intervalSeconds;
		const c = buckets.get(time);
		if (!c) buckets.set(time, { time, open: t.price, high: t.price, low: t.price, close: t.price, volume: t.quoteAmount, trades: 1 });
		else {
			c.high = Math.max(c.high, t.price);
			c.low = Math.min(c.low, t.price);
			c.close = t.price;
			c.volume += t.quoteAmount;
			c.trades += 1;
		}
	}
	const ordered = [...buckets.values()].sort((a, b) => a.time - b.time);
	const filled = [];
	for (const candle of ordered) {
		const prev = filled[filled.length - 1];
		if (prev) {
			for (let t = prev.time + intervalSeconds; t < candle.time; t += intervalSeconds) {
				filled.push({ time: t, open: prev.close, high: prev.close, low: prev.close, close: prev.close, volume: 0, trades: 0 });
			}
		}
		filled.push(candle);
	}
	return filled;
}
