// The firehose orchestrator. Composes the hoodchain SDK watchers (Odyssey via
// RPC logs), a mint watcher that attributes every new token to the launch venue
// its transaction called (venues.js), a dynamic Uniswap v3 Swap watcher over
// the set of tracked pools (Odyssey pools post-graduation), and the Arbitrum
// sequencer feed used as a sub-second block-tip + gap watchdog.
// Everything is normalized to the pump-compatible shape and handed to onEvent.
//
// Divergence from the pump (PumpPortal) feed, by design:
//  • The sequencer feed carries every L2 tx ~100ms early but decoding trades
//    from its RLP payload is far less reliable than reading decoded event logs.
//    So we use RPC logs for the DECODED events and the feed only for liveness /
//    gap detection. Documented in the README.
//  • Solana `sol_amount` field name is reused for the native ETH magnitude.

import {
	watchLaunches, watchCurveTrades, watchGraduations, getRecentLaunches,
	odysseyTradedEvent, ODYSSEY_ADDRESSES,
} from 'hoodchain';
import { subscribeFeed } from 'hoodchain';
import { config, CHAIN_ID, redactRpcUrl } from './config.js';
import { getMintLogs, parseMintLogs, launchesFromMints } from './mints.js';
import { createReputation, devAllocation, devStatus, riskFlags, readBalances } from './reputation.js';
import { hood, resolveMeta, inspectPool, blockTimeMs } from './chain.js';
import { withRpcRetry, withRpcPatience } from './rpc.js';
import { ethPriceUsd } from './eth-price.js';
import {
	normalizeLaunch, normalizeCurveTrade, normalizeUniswapSwap, normalizeGraduation,
} from './normalize.js';

const uniswapSwapEvent = {
	type: 'event',
	name: 'Swap',
	inputs: [
		{ name: 'sender', type: 'address', indexed: true },
		{ name: 'recipient', type: 'address', indexed: true },
		{ name: 'amount0', type: 'int256', indexed: false },
		{ name: 'amount1', type: 'int256', indexed: false },
		{ name: 'sqrtPriceX96', type: 'uint160', indexed: false },
		{ name: 'liquidity', type: 'uint128', indexed: false },
		{ name: 'tick', type: 'int24', indexed: false },
	],
};

const ODYSSEY_FACTORIES = [
	ODYSSEY_ADDRESSES.bondingCurveFactory,
	ODYSSEY_ADDRESSES.reflectionFactory,
	ODYSSEY_ADDRESSES.instantFactory,
];

// Bounded-concurrency map — a backfill of hundreds of launches each needing a
// metadata multicall must not run one-at-a-time (minutes of dead sequential
// RPC latency) nor all-at-once (a request storm against a public RPC).
async function mapLimit(items, limit, fn) {
	let i = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (i < items.length) {
			const idx = i++;
			await fn(items[idx], idx);
		}
	});
	await Promise.all(workers);
}

/**
 * Start the firehose.
 * @param {(ev: { kind: 'launch'|'trade'|'graduation'|'status', data: object }) => void} onEvent
 * @returns {{ stop: () => void, health: () => object }}
 */
export function startFirehose(onEvent) {
	let active = true;
	const unwatchers = [];
	let feedSub = null;
	let swapUnwatch = null;

	// Cross-source dedupe: a launch/trade may surface from both backfill and the
	// live watcher. Key by tx + token + block + a discriminator.
	const seen = new Map(); // key → ts
	function once(key) {
		if (!key) return true;
		if (seen.has(key)) return false;
		seen.set(key, Date.now());
		if (seen.size > config.seenLimit) {
			const drop = Math.floor(config.seenLimit / 4);
			const it = seen.keys();
			for (let i = 0; i < drop; i++) seen.delete(it.next().value);
		}
		return true;
	}

	// Tracked Uniswap pools (insertion-ordered for LRU eviction).
	const pools = new Map(); // pool(lower) → token
	let resubTimer = null;
	let mintTimer = null;
	function trackPool(pool, token) {
		if (!pool) return;
		const key = pool.toLowerCase();
		if (pools.has(key)) return;
		pools.set(key, token);
		while (pools.size > config.maxTrackedPools) {
			pools.delete(pools.keys().next().value);
		}
		// Debounce re-subscription so a burst of launches re-watches once.
		clearTimeout(resubTimer);
		resubTimer = setTimeout(subscribeSwaps, 300);
	}

	function subscribeSwaps() {
		if (!active || pools.size === 0) return;
		try { swapUnwatch?.(); } catch { /* ignore */ }
		const addresses = [...pools.keys()];
		swapUnwatch = hood.public.watchContractEvent({
			address: addresses,
			abi: [uniswapSwapEvent],
			eventName: 'Swap',
			pollingInterval: config.pollingIntervalMs,
			onError: (err) => onEvent({ kind: 'status', data: { level: 'warn', src: 'swap-watch', message: err?.message } }),
			onLogs: (logs) => { for (const log of logs) handleSwap(log); },
		});
	}

	async function handleSwap(log) {
		const pool = log.address;
		const token = pools.get(pool.toLowerCase());
		if (!token) return;
		const key = `swap:${log.transactionHash}:${log.logIndex}`;
		if (!once(key)) return;
		const [poolInfo, meta, ethUsd, atMs] = await Promise.all([
			inspectPool(pool, token), resolveMeta(token), ethPriceUsd(), blockTimeMs(log.blockNumber),
		]);
		if (!poolInfo) return;
		const data = normalizeUniswapSwap({
			swap: {
				amount0: log.args.amount0, amount1: log.args.amount1,
				recipient: log.args.recipient, sender: log.args.sender,
				transactionHash: log.transactionHash, blockNumber: log.blockNumber,
			},
			token, pool,
			coinIsToken0: poolInfo.coinIsToken0,
			quoteSymbol: poolInfo.quoteSymbol,
			quoteDecimals: poolInfo.quoteDecimals,
			name: meta.name, symbol: meta.symbol, ethUsd, atMs,
		});
		bumpBlock(log.blockNumber);
		if (active) onEvent({ kind: 'trade', data });
	}

	// ── launch enrichment: dev allocation, dev-sold, deployer reputation ───────
	const reputation = createReputation(
		{ multicall: (a) => hood.public.multicall(a) },
		{ windowBlocks: Number(config.backfillBlocks) },
	);
	const allocations = new Map(); // token(lower) → bigint | null (null = receipt unreadable)
	const tracked = new Map(); // token(lower) → { data, allocation, creator } for the dev-sold sweep

	const odysseyVenue = { id: 'odyssey', label: 'The Odyssey', kind: 'bonding-curve', address: null };
	function withOdysseyVenue(l) { return l.venue ? l : { ...l, venue: odysseyVenue }; }

	async function allocationFor(launch) {
		const key = launch.token.toLowerCase();
		if (allocations.has(key)) return allocations.get(key);
		let alloc = null;
		try {
			const receipt = await withRpcRetry(() => hood.public.getTransactionReceipt({ hash: launch.transactionHash }));
			alloc = devAllocation(receipt.logs, launch.token, launch.creator);
		} catch { /* unreadable receipt leaves dev_sold null, never a guess */ }
		allocations.set(key, alloc);
		return alloc;
	}

	async function indexLaunch(launch) {
		const allocation = await allocationFor(launch);
		reputation.record({ creator: launch.creator, token: launch.token, blockNumber: launch.blockNumber, allocation: allocation ?? 0n });
		return allocation;
	}

	async function emitLaunch(launch, { indexed = false } = {}) {
		const key = `launch:${launch.transactionHash}:${launch.token.toLowerCase()}`;
		if (!once(key)) return;
		if (launch.pool) trackPool(launch.pool, launch.token);
		const allocation = indexed ? (allocations.get(launch.token.toLowerCase()) ?? null) : await indexLaunch(launch);
		const [meta, ethUsd, atMs, deployer, balance] = await Promise.all([
			resolveMeta(launch.token), ethPriceUsd(), blockTimeMs(launch.blockNumber),
			reputation.assess(launch.creator, launch.blockNumber).catch(() => null),
			allocation && allocation > 0n
				? readBalances({ multicall: (a) => hood.public.multicall(a) }, [{ token: launch.token, holder: launch.creator }]).then((r) => r[0]).catch(() => null)
				: Promise.resolve(null),
		]);
		const dev = devStatus(allocation ?? 0n, balance);
		bumpBlock(launch.blockNumber);
		if (!active) return;
		const data = normalizeLaunch({ launch, name: meta.name, symbol: meta.symbol, ethUsd, atMs, venue: launch.venue ?? null, dev, deployer });
		onEvent({ kind: 'launch', data });
		if (allocation && allocation > 0n) {
			tracked.set(launch.token.toLowerCase(), { data, allocation, creator: launch.creator });
			while (tracked.size > 300) tracked.delete(tracked.keys().next().value);
		}
	}

	/** Re-read creator balances for recent launches; re-emit any whose dev has since sold out. */
	async function sweepDevSold() {
		if (!active || tracked.size === 0) return;
		const cutoff = Math.floor(Date.now() / 1000) - 24 * 3600;
		const open = [...tracked.entries()].filter(([, t]) => t.data.dev_sold !== true && t.data.timestamp >= cutoff);
		if (!open.length) return;
		let balances;
		try {
			balances = await withRpcRetry(() => readBalances(
				{ multicall: (a) => hood.public.multicall(a) },
				open.map(([, t]) => ({ token: t.data.mint, holder: t.creator })),
			));
		} catch { return; }
		open.forEach(([key, t], i) => {
			const dev = devStatus(t.allocation, balances[i]);
			if (dev.dev_sold === null) return;
			const same = dev.dev_sold === t.data.dev_sold && dev.dev_sold_pct === t.data.dev_sold_pct;
			if (same) return;
			const data = { ...t.data, ...dev, flags: riskFlags(dev, t.data.deployer || { prior_launches: 0, prior_dev_exits: 0 }) };
			tracked.set(key, { ...t, data });
			onEvent({ kind: 'launch', data });
		});
	}

	// ── mint watcher: launches on every catalogued venue ───────────────────────
	const rpcView = {
		getTransaction: (hash) => withRpcPatience(() => hood.public.getTransaction({ hash })),
		readContract: (a) => withRpcPatience(() => hood.public.readContract(a)),
	};
	let mintCursor = 0n;
	let mintPolling = false;
	async function venueLaunchesBetween(from, to) {
		const logs = await getMintLogs((a) => withRpcRetry(() => hood.public.request(a)), from, to);
		return launchesFromMints(rpcView, parseMintLogs(logs));
	}
	async function pollMints() {
		if (!active || mintPolling) return;
		mintPolling = true;
		try {
			const head = await withRpcRetry(() => hood.public.getBlockNumber());
			if (mintCursor === 0n) { mintCursor = head; return; }
			if (head <= mintCursor) return;
			const launches = await venueLaunchesBetween(mintCursor + 1n, head);
			for (const l of launches) {
				if (!once(`token:${l.token.toLowerCase()}`)) continue;
				await emitLaunch(l).catch(() => {});
			}
			mintCursor = head;
		} catch (err) {
			onEvent({ kind: 'status', data: { level: 'warn', src: 'mint-watch', message: err?.message?.split('\n')[0] } });
		} finally {
			mintPolling = false;
		}
	}

	async function emitCurveTrade(trade) {
		const key = `trade:${trade.transactionHash}:${trade.token}:${trade.isBuy}:${trade.tokenAmount}`;
		if (!once(key)) return;
		const [meta, ethUsd, atMs] = await Promise.all([
			resolveMeta(trade.token), ethPriceUsd(), blockTimeMs(trade.blockNumber),
		]);
		bumpBlock(trade.blockNumber);
		if (active) onEvent({ kind: 'trade', data: normalizeCurveTrade({ trade, name: meta.name, symbol: meta.symbol, ethUsd, atMs }) });
	}

	async function emitGraduation(g) {
		const key = `grad:${g.transactionHash}:${g.token}`;
		if (!once(key)) return;
		trackPool(g.pool, g.token);
		const [meta, atMs] = await Promise.all([resolveMeta(g.token), blockTimeMs(g.blockNumber)]);
		bumpBlock(g.blockNumber);
		if (active) onEvent({ kind: 'graduation', data: normalizeGraduation({ grad: g, name: meta.name, symbol: meta.symbol, atMs }) });
	}

	// ── liveness + gap watchdog ────────────────────────────────────────────────
	let lastScannedBlock = 0n; // highest block we've processed events up to
	let feedSeq = 0;
	let feedTs = 0;
	let feedFramesAt = 0;
	function bumpBlock(bn) {
		const b = typeof bn === 'bigint' ? bn : BigInt(bn || 0);
		if (b > lastScannedBlock) lastScannedBlock = b;
	}

	// A bulk log read that survives the public RPC's transient -32602 shedding.
	const retryLogs = (fn, src) => withRpcRetry(fn, {
		onRetry: ({ attempt, delayMs, error }) => onEvent({
			kind: 'status',
			data: { level: 'info', src, message: `rpc retry ${attempt} in ${delayMs}ms: ${error?.message?.split('\n')[0] || 'transient'}` },
		}),
	});

	async function gapCheck() {
		if (!active) return;
		let head;
		try { head = await withRpcRetry(() => hood.public.getBlockNumber()); } catch { return; }
		if (lastScannedBlock === 0n) { lastScannedBlock = head; return; }
		if (head - lastScannedBlock <= BigInt(config.gapCatchupBlocks)) { lastScannedBlock = head; return; }
		// A gap opened (RPC watcher stalled). Backfill launches + curve trades.
		const from = lastScannedBlock + 1n;
		onEvent({ kind: 'status', data: { level: 'info', src: 'gap-fill', from: Number(from), to: Number(head) } });
		try {
			const launches = await retryLogs(
				() => getRecentLaunches(hood, { launchpad: 'odyssey', lookbackBlocks: head - from + 1n }), 'gap-fill',
			);
			await mapLimit(launches.filter((l) => l.blockNumber >= from), 8, (l) => emitLaunch(withOdysseyVenue(l)));
			const logs = await retryLogs(() => hood.public.getLogs({
				address: ODYSSEY_FACTORIES, event: odysseyTradedEvent, fromBlock: from, toBlock: head,
			}), 'gap-fill');
			await mapLimit(logs, 8, (log) => emitCurveTrade({
				launchpad: 'odyssey', token: log.args.token, trader: log.args.trader,
				isBuy: log.args.isBuy, tokenAmount: log.args.tokenAmount, quoteAmount: log.args.quoteAmount,
				fee: log.args.fee, blockNumber: log.blockNumber, transactionHash: log.transactionHash,
			}));
		} catch (err) {
			onEvent({ kind: 'status', data: { level: 'warn', src: 'gap-fill', message: err?.message } });
		}
		lastScannedBlock = head;
	}

	// ── cold-start backfill: register existing pools + seed the replay buffer ───
	//
	// getRecentLaunches over a wide window can return hundreds of launches; the
	// replay buffer only ever surfaces the newest `bufferLimit`, so fully
	// resolving metadata for the rest is wasted RPC work that would otherwise
	// serialize cold start for minutes. Every discovered pool is still tracked
	// (cheap, synchronous) so live Uniswap swaps on older coins are caught;
	// only the newest slice gets the full emit (metadata + ETH price + buffer).
	async function backfill() {
		try {
			const head = await retryLogs(() => hood.public.getBlockNumber(), 'backfill');
			const fromBlock = head > config.backfillBlocks ? head - config.backfillBlocks : 0n;
			if (mintCursor === 0n) mintCursor = head;
			const [odyssey, venueLaunches] = await Promise.all([
				retryLogs(() => getRecentLaunches(hood, { launchpad: 'odyssey', lookbackBlocks: config.backfillBlocks }), 'backfill'),
				venueLaunchesBetween(fromBlock, head),
			]);
			const launches = [...odyssey.map(withOdysseyVenue), ...venueLaunches]
				.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
			for (const l of launches) {
				once(`token:${l.token.toLowerCase()}`);
				if (l.pool) trackPool(l.pool, l.token);
			}
			// Index the whole window oldest-first so a deployer's earlier launches
			// are on record before their newer ones are graded against them.
			await mapLimit(launches, 8, (l) => indexLaunch(l));
			const toEmit = launches.slice(-config.bufferLimit); // oldest-first input → newest last
			await mapLimit(toEmit, 8, (l) => emitLaunch(l, { indexed: true }));
			onEvent({ kind: 'status', data: { level: 'info', src: 'backfill', launches: launches.length, emitted: toEmit.length, deployers: reputation.size() } });
		} catch (err) {
			onEvent({ kind: 'status', data: { level: 'warn', src: 'backfill', message: err?.message } });
		}
	}

	// ── wire everything up ─────────────────────────────────────────────────────
	unwatchers.push(watchLaunches(hood, (l) => { emitLaunch(withOdysseyVenue(l)).catch(() => {}); }, { launchpad: 'odyssey', pollingInterval: config.pollingIntervalMs, onError: (e) => onEvent({ kind: 'status', data: { level: 'warn', src: 'launch-watch', message: e?.message } }) }));
	unwatchers.push(watchCurveTrades(hood, (t) => { emitCurveTrade(t).catch(() => {}); }, { pollingInterval: config.pollingIntervalMs, onError: (e) => onEvent({ kind: 'status', data: { level: 'warn', src: 'trade-watch', message: e?.message } }) }));
	unwatchers.push(watchGraduations(hood, (g) => { emitGraduation(g).catch(() => {}); }, { pollingInterval: config.pollingIntervalMs, onError: (e) => onEvent({ kind: 'status', data: { level: 'warn', src: 'grad-watch', message: e?.message } }) }));

	if (config.useFeed) {
		subscribeFeed(
			(msg) => { feedSeq = msg.sequenceNumber; feedTs = msg.timestamp; feedFramesAt = Date.now(); },
			{ url: config.feedUrl, onError: (e) => onEvent({ kind: 'status', data: { level: 'warn', src: 'feed', message: e?.message } }), onConnect: () => onEvent({ kind: 'status', data: { level: 'info', src: 'feed', message: 'connected' } }) },
		).then((sub) => { feedSub = sub; }).catch(() => {});
	}

	backfill().finally(() => { if (active) mintTimer = setInterval(() => { pollMints(); }, config.pollingIntervalMs); });
	const sweepTimer = setInterval(() => { sweepDevSold().catch(() => {}); }, 60_000);
	const gapTimer = setInterval(() => { gapCheck().catch(() => {}); }, 15_000);

	return {
		stop() {
			active = false;
			clearTimeout(resubTimer);
			clearInterval(gapTimer);
			clearInterval(sweepTimer);
			clearInterval(mintTimer);
			for (const u of unwatchers) { try { u(); } catch { /* ignore */ } }
			try { swapUnwatch?.(); } catch { /* ignore */ }
			try { feedSub?.close(); } catch { /* ignore */ }
		},
		health() {
			return {
				network: config.network,
				chain_id: CHAIN_ID,
				rpc: config.rpcUrls.map(redactRpcUrl),
				last_scanned_block: Number(lastScannedBlock),
				tracked_pools: pools.size,
				feed: {
					enabled: config.useFeed,
					last_sequence: feedSeq,
					last_l2_timestamp: feedTs,
					seconds_since_frame: feedFramesAt ? Math.round((Date.now() - feedFramesAt) / 1000) : null,
				},
			};
		},
	};
}
