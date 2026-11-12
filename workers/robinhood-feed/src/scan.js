// Chunked eth_getLogs scans that survive the public Robinhood Chain RPC.
//
// rpc.mainnet.chain.robinhood.com throttles eth_getLogs with a bare HTTP 429
// "Too Many Requests" (no reset hint) on roughly every other call during a
// burst, recovering within a second. A wide backfill is hundreds of calls, so
// throttling is the normal case, not the exception. Two rules follow:
//  - Retry the throttled CHUNK, never the whole scan, so progress is kept.
//  - Budget waits per range (consecutive failures on that range), not per
//    scan: a scan-wide cap is spent long before a long backfill finishes.
// A range over the RPC's matched-log cap is split in half rather than skipped,
// because dropping it would under-count exactly the busiest stretches.

import { rateLimitWaitMs } from './rpc.js';

const defaultSleep = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });
const isTooManyLogs = (err) => /exceeds? limit|too many results|response size|query returned more/i.test(String(err?.details || err?.message || err));

/**
 * Every log `fetchRange` returns over [from, to], fetched in chunks of at most `chunk` blocks.
 *
 * @template L
 * @param {(start: bigint, end: bigint) => Promise<L[]>} fetchRange
 * @param {bigint|number} from
 * @param {bigint|number} to
 * @param {{ chunk?: bigint, maxRateLimitWaits?: number, baseWaitMs?: number, maxWaitMs?: number, sleep?: (ms: number) => Promise<void> }} [opts]
 *   `maxRateLimitWaits` caps consecutive waits on ONE range; unhinted 429s back
 *   off from `baseWaitMs` doubling to `maxWaitMs`, a provider reset hint is used as given.
 * @returns {Promise<L[]>}
 */
export async function scanLogRanges(fetchRange, from, to, {
	chunk = 4_000n, maxRateLimitWaits = 30, baseWaitMs = 500, maxWaitMs = 10_000, sleep = defaultSleep,
} = {}) {
	const out = [];
	const queue = [[BigInt(from), BigInt(to)]];
	let waits = 0; // consecutive waits on the range at the head of the queue
	while (queue.length) {
		const [start, end] = queue.shift();
		const span = end - start + 1n;
		if (span <= 0n) continue;
		if (span > chunk) {
			const mid = start + span / 2n;
			queue.unshift([start, mid - 1n], [mid, end]);
			continue;
		}
		let logs;
		try {
			logs = await fetchRange(start, end);
		} catch (err) {
			const waitMs = rateLimitWaitMs(err, { fallbackMs: Math.min(baseWaitMs * 2 ** waits, maxWaitMs) });
			if (waitMs !== null && waits < maxRateLimitWaits) {
				waits += 1;
				await sleep(waitMs);
				queue.unshift([start, end]);
				continue;
			}
			if (isTooManyLogs(err) && span > 1n) {
				waits = 0;
				const mid = start + span / 2n;
				queue.unshift([start, mid - 1n], [mid, end]);
				continue;
			}
			throw err;
		}
		waits = 0;
		out.push(...logs);
	}
	return out;
}

/**
 * Odyssey launches (factory `TokenCreated`) in [from, to], scanned chunk by chunk.
 *
 * @param {(range: { fromBlock: bigint, toBlock: bigint }) => Promise<Array<{ args: { token: string, creator: string }, blockNumber: bigint, transactionHash: string }>>} getLogs
 *   viem getLogs already bound to the Odyssey factories and the TokenCreated event
 */
export async function odysseyLaunchesBetween(getLogs, from, to, { chunk = 10_000n, ...opts } = {}) {
	const logs = await scanLogRanges((fromBlock, toBlock) => getLogs({ fromBlock, toBlock }), from, to, { chunk, ...opts });
	return logs.map((log) => ({
		launchpad: 'odyssey',
		token: log.args.token,
		creator: log.args.creator,
		pool: null,
		blockNumber: log.blockNumber,
		transactionHash: log.transactionHash,
	}));
}
