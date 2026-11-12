// Chunked log scans against the public Robinhood Chain RPC.
//
// Measured live (2026-11-12): rpc.mainnet.chain.robinhood.com throttles
// eth_getLogs with a bare HTTP 429 "Too Many Requests" (no reset hint) on
// roughly every other call, recovering within a second. Two failures followed:
//  - The Odyssey backfill retried the whole 83-chunk getRecentLaunches scan
//    with a ~2s backoff, so one 429 anywhere restarted or aborted all of it.
//  - getMintLogs spent a 20-wait budget for the WHOLE scan at 10s per
//    unhinted 429, so a ~200-chunk backfill ran out and threw.
// Both left the replay buffer empty with nothing in the log.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanLogRanges, odysseyLaunchesBetween } from '../src/scan.js';
import { rateLimitWaitMs } from '../src/rpc.js';

const throttled = () => Object.assign(new Error('HTTP request failed.'), { cause: { code: 429, message: 'Too Many Requests' } });

test('a long scan on a throttled RPC completes: 429s cost a short wait each, not a scan-wide budget', async () => {
	const fetched = [];
	let calls = 0;
	const waits = [];
	// 60 chunks, every other call throttled: 60 waits, three times the old scan-wide cap.
	const logs = await scanLogRanges(async (start, end) => {
		calls += 1;
		if (calls % 2 === 1) throw throttled();
		fetched.push([start, end]);
		return [{ blockNumber: start }];
	}, 0n, 59_999n, { chunk: 1_000n, sleep: async (ms) => { waits.push(ms); } });

	assert.equal(logs.length, 60);
	assert.equal(fetched.length, 60, 'each range is fetched successfully exactly once');
	assert.deepEqual(fetched[0], [0n, 999n]);
	assert.deepEqual(fetched.at(-1), [59_000n, 59_999n]);
	assert.equal(waits.length, 60);
	assert.ok(waits.every((ms) => ms <= 1_000), `unhinted 429 waits stay short, got max ${Math.max(...waits)}ms`);
});

test('consecutive throttling on one range backs off exponentially up to the cap', async () => {
	let calls = 0;
	const waits = [];
	await scanLogRanges(async () => {
		calls += 1;
		if (calls <= 7) throw throttled();
		return [];
	}, 0n, 9n, { sleep: async (ms) => { waits.push(ms); } });
	assert.deepEqual(waits, [500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
});

test('a provider reset hint is honoured as given', async () => {
	let calls = 0;
	const waits = [];
	await scanLogRanges(async () => {
		calls += 1;
		if (calls === 1) throw Object.assign(new Error('RPC Request failed.'), { cause: { code: 429, message: 'Rate Limit Hit, limit will reset in 60 seconds' } });
		return [];
	}, 0n, 9n, { sleep: async (ms) => { waits.push(ms); } });
	assert.deepEqual(waits, [60_000]);
});

test('a range that never gets through gives up after the per-range cap instead of hanging forever', async () => {
	let calls = 0;
	await assert.rejects(
		scanLogRanges(async () => { calls += 1; throw throttled(); }, 0n, 9n, { maxRateLimitWaits: 5, sleep: async () => {} }),
		/HTTP request failed/,
	);
	assert.equal(calls, 6);
});

test('a range over the matched-log cap is split, a non-transient error throws at once', async () => {
	const seen = [];
	const logs = await scanLogRanges(async (start, end) => {
		seen.push([start, end]);
		if (end - start > 4n) throw new Error('query returned more than 10000 results');
		return [{ start }];
	}, 0n, 9n, { sleep: async () => {} });
	assert.equal(logs.length, 2);
	assert.deepEqual(seen, [[0n, 9n], [0n, 4n], [5n, 9n]]);

	await assert.rejects(scanLogRanges(async () => { throw new Error('invalid params shape'); }, 0n, 9n, { sleep: async () => {} }), /invalid params/);
});

test('the Odyssey backfill resumes at the throttled chunk and maps TokenCreated logs to launches', async () => {
	const calls = [];
	let n = 0;
	const getLogs = async ({ fromBlock, toBlock }) => {
		n += 1;
		calls.push(fromBlock);
		if (n === 3) throw throttled(); // third chunk throttled mid-scan
		if (fromBlock !== 20_000n) return [];
		return [{
			args: { token: '0x00000000000000000000000000000000000000a1', creator: '0x00000000000000000000000000000000000000c1' },
			blockNumber: 20_500n,
			transactionHash: '0xabc',
		}];
	};
	const launches = await odysseyLaunchesBetween(getLogs, 0n, 49_999n, { chunk: 10_000n, sleep: async () => {} });
	assert.deepEqual(calls, [0n, 10_000n, 20_000n, 20_000n, 30_000n, 40_000n], 'no restart from block 0');
	assert.deepEqual(launches, [{
		launchpad: 'odyssey',
		token: '0x00000000000000000000000000000000000000a1',
		creator: '0x00000000000000000000000000000000000000c1',
		pool: null,
		blockNumber: 20_500n,
		transactionHash: '0xabc',
	}]);
});

test('rateLimitWaitMs takes a caller fallback for an unhinted 429', () => {
	assert.equal(rateLimitWaitMs(throttled(), { fallbackMs: 500 }), 500);
	assert.equal(rateLimitWaitMs(throttled()), 10_000);
});
