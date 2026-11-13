// The fixture capture script (scripts/capture-venue-fixtures.mjs) replayed over
// the REAL launches it captured earlier (tests/fixtures/venue-launches.json).
// Each RPC answer below is a captured on-chain record, served back in the raw
// JSON-RPC shape the public Robinhood Chain RPC returns.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { captureVenueLaunches } from '../scripts/capture-venue-fixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures/venue-launches.json'), 'utf8'));
const hex = (n) => `0x${BigInt(n).toString(16)}`;

function replayRpc(launches) {
	const byHash = new Map(launches.map((c) => [c.tx.hash, c]));
	return {
		request: async ({ method, params }) => {
			if (method === 'eth_getLogs') {
				const from = BigInt(params[0].fromBlock);
				const to = BigInt(params[0].toBlock);
				return launches.map((c) => c.mintLog).filter((l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to);
			}
			if (method === 'eth_getTransactionReceipt') {
				const c = byHash.get(params[0]);
				return {
					transactionHash: c.tx.hash,
					logs: c.transferLogs.map((l) => ({
						...l,
						logIndex: hex(l.logIndex),
						blockNumber: c.mintLog.blockNumber,
						transactionHash: c.tx.hash,
					})),
				};
			}
			throw new Error(`unexpected method ${method}`);
		},
		getTransaction: async ({ hash }) => {
			const c = byHash.get(hash);
			return { ...c.tx, blockNumber: BigInt(c.tx.blockNumber) };
		},
		readContract: async () => { throw new Error('execution reverted'); },
	};
}

test('captureVenueLaunches rebuilds one fixture per venue from mint logs, transactions and receipts', async () => {
	const blocks = fx.launches.map((c) => BigInt(c.mintLog.blockNumber));
	const from = blocks.reduce((a, b) => (b < a ? b : a));
	const to = blocks.reduce((a, b) => (b > a ? b : a));
	const captured = await captureVenueLaunches(replayRpc(fx.launches), from, to, { sleep: async () => {} });

	assert.deepEqual(captured.map((c) => c.venue).sort(), fx.launches.map((c) => c.venue).sort());
	for (const c of captured) {
		const want = fx.launches.find((x) => x.venue === c.venue);
		assert.equal(c.tx.hash, want.tx.hash);
		assert.equal(c.tx.from, want.tx.from);
		assert.equal(c.tx.blockNumber, want.tx.blockNumber);
		assert.equal(c.mintLog.address.toLowerCase(), want.mintLog.address.toLowerCase());
		assert.deepEqual(c.mintLog.topics, want.mintLog.topics);
		assert.equal(c.mintLog.data, want.mintLog.data);
		assert.equal(c.mintLog.transactionHash, want.tx.hash);
		assert.deepEqual(c.transferLogs, want.transferLogs);
	}
});

test('captureVenueLaunches skips venues already captured, so a refresh only adds new ones', async () => {
	const [first, ...rest] = fx.launches;
	const blocks = fx.launches.map((c) => BigInt(c.mintLog.blockNumber));
	const captured = await captureVenueLaunches(replayRpc(fx.launches), blocks.reduce((a, b) => (b < a ? b : a)), blocks.reduce((a, b) => (b > a ? b : a)), {
		sleep: async () => {},
		skipVenues: new Set(rest.map((c) => c.venue)),
	});
	assert.deepEqual(captured.map((c) => c.venue), [first.venue]);
});
