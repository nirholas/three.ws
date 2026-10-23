// Venue discovery, deployer reputation and the dev-sold read, against one REAL
// launch per venue captured from Robinhood Chain mainnet
// (tests/fixtures/venue-launches.json, scripts/capture-venue-fixtures.mjs).
// No mocks: each mint log, transaction and receipt Transfer log is on chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseMintLogs, launchFromMint, getMintLogs, launchesFromMints, TRANSFER_TOPIC } from '../src/mints.js';
import { venueForCall, listVenues, venueLabel } from '../src/venues.js';
import { devAllocation, devStatus, riskFlags, createReputation, FLAG_RULES } from '../src/reputation.js';
import { normalizeLaunch } from '../src/normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures/venue-launches.json'), 'utf8'));
const txOf = (c) => ({ ...c.tx, blockNumber: BigInt(c.tx.blockNumber) });

test('fixtures cover at least five distinct venues', () => {
	assert.ok(new Set(fx.launches.map((c) => c.venue)).size >= 5);
});

for (const c of fx.launches) {
	test(`${c.venue}: real mint log + tx resolve to this venue`, () => {
		const [mint] = parseMintLogs([c.mintLog]);
		assert.equal(mint.token.toLowerCase(), c.mintLog.address.toLowerCase());
		assert.equal(mint.transactionHash, c.tx.hash);
		const launch = launchFromMint(mint, txOf(c));
		assert.equal(launch.venue.id, c.venue);
		assert.equal(launch.launchpad, c.venue);
		assert.equal(launch.creator, c.tx.from);
		assert.equal(launch.venue.address, c.tx.to.toLowerCase());
	});

	test(`${c.venue}: normalizeLaunch carries venue, dev status and flags`, () => {
		const [mint] = parseMintLogs([c.mintLog]);
		const launch = launchFromMint(mint, txOf(c));
		const allocation = devAllocation(c.transferLogs, launch.token, launch.creator);
		const dev = devStatus(allocation, 0n);
		const out = normalizeLaunch({
			launch, venue: launch.venue, dev,
			deployer: { prior_launches: 0, prior_dev_exits: 0, inspected: 0, window_blocks: 1000 },
		});
		assert.equal(out.venue.id, c.venue);
		assert.equal(out.mint, c.mintLog.address);
		assert.equal(out.signature, c.tx.hash);
		assert.equal(out.dev_sold, allocation > 0n ? true : null);
		assert.deepEqual(out.flags, allocation > 0n ? ['dev_sold'] : []);
		assert.equal(out.deployer.address, c.tx.from);
	});
}

test('parseMintLogs drops ERC-721 mints (four topics, no data) and keeps the earliest mint per token', () => {
	const real = fx.launches[0].mintLog;
	const nft = { ...real, topics: [...real.topics, `0x${'0'.repeat(63)}1`], data: '0x' };
	const later = { ...real, blockNumber: `0x${(BigInt(real.blockNumber) + 5n).toString(16)}`, transactionHash: `0x${'ab'.repeat(32)}` };
	const mints = parseMintLogs([later, real, nft]);
	assert.equal(mints.length, 1);
	assert.equal(mints[0].transactionHash, real.transactionHash);
});

test('venueForCall: unknown contract is not a venue; known contract with a new selector still is', () => {
	const c = fx.launches[0];
	assert.equal(venueForCall('0x000000000000000000000000000000000000dead', c.tx.input), null);
	assert.equal(venueForCall(null, '0x12345678'), null);
	assert.equal(venueForCall(c.tx.to, '0xdeadbeef').id, c.venue);
});

test('venue catalog: ids are unique and every label resolves', () => {
	const venues = listVenues();
	assert.ok(venues.length >= 40);
	assert.equal(new Set(venues.map((v) => v.id)).size, venues.length);
	assert.ok(venues.every((v) => venueLabel(v).length > 0 && /^0x[0-9a-f]{40}$/.test(v.address)));
});

test('getMintLogs bisects a range that trips the RPC log cap instead of dropping it', async () => {
	const calls = [];
	const request = async ({ params: [f] }) => {
		const from = BigInt(f.fromBlock);
		const to = BigInt(f.toBlock);
		calls.push([from, to]);
		if (to - from + 1n > 1000n) throw new Error('query returned more than 10000 results');
		return [{ address: '0x1', blockNumber: f.fromBlock }];
	};
	const logs = await getMintLogs(request, 0n, 3999n, { chunk: 4000n });
	assert.equal(logs.length, 4);
	assert.ok(calls.every(([a, b]) => b - a + 1n <= 1000n || calls.length > 1));
});

test('launchesFromMints fetches each transaction once and skips AMM pairs', async () => {
	const c = fx.launches[0];
	const [mint] = parseMintLogs([c.mintLog]);
	const second = { ...mint, token: '0x00000000000000000000000000000000000000aa' };
	let txReads = 0;
	const rpc = {
		getTransaction: async () => { txReads += 1; return txOf(c); },
		readContract: async ({ address }) => {
			if (address === second.token) return '0x0000000000000000000000000000000000000001';
			throw new Error('execution reverted');
		},
	};
	const out = await launchesFromMints(rpc, [mint, second]);
	assert.equal(txReads, 1);
	assert.deepEqual(out.map((l) => l.token), [mint.token]);
});

test('devAllocation sums only Transfer logs of this token into the creator', () => {
	const c = fx.launches.find((x) => devAllocation(x.transferLogs, x.mintLog.address, x.tx.from) > 0n) || fx.launches[0];
	const total = devAllocation(c.transferLogs, c.mintLog.address, c.tx.from);
	const expected = c.transferLogs
		.filter((l) => l.address.toLowerCase() === c.mintLog.address.toLowerCase() && l.topics.length === 3 && `0x${l.topics[2].slice(-40)}`.toLowerCase() === c.tx.from.toLowerCase())
		.reduce((s, l) => s + BigInt(l.data), 0n);
	assert.equal(total, expected);
	assert.equal(devAllocation(c.transferLogs, c.mintLog.address, '0x000000000000000000000000000000000000dEaD'), 0n);
	assert.ok(c.transferLogs.every((l) => l.topics[0] === TRANSFER_TOPIC));
});

test('devStatus: sold out, partial, held, no allocation, unreadable balance', () => {
	assert.deepEqual(devStatus(1000n, 0n), { dev_sold: true, dev_sold_pct: 100 });
	assert.deepEqual(devStatus(1000n, 250n), { dev_sold: false, dev_sold_pct: 75 });
	assert.deepEqual(devStatus(1000n, 1000n), { dev_sold: false, dev_sold_pct: 0 });
	assert.deepEqual(devStatus(1000n, 5000n), { dev_sold: false, dev_sold_pct: 0 });
	assert.deepEqual(devStatus(0n, 0n), { dev_sold: null, dev_sold_pct: null });
	assert.deepEqual(devStatus(1000n, null), { dev_sold: null, dev_sold_pct: null });
});

test('riskFlags applies the documented thresholds', () => {
	const clean = { dev_sold: false };
	assert.deepEqual(riskFlags(clean, { prior_launches: 0, prior_dev_exits: 0 }), []);
	assert.deepEqual(riskFlags({ dev_sold: true }, { prior_launches: 0, prior_dev_exits: 0 }), ['dev_sold']);
	assert.deepEqual(riskFlags(clean, { prior_launches: 1, prior_dev_exits: 1 }), ['prior_dev_exit']);
	assert.deepEqual(riskFlags(clean, { prior_launches: 2, prior_dev_exits: FLAG_RULES.serialExitCount }), ['serial_exit']);
	assert.deepEqual(riskFlags(clean, { prior_launches: FLAG_RULES.serialDeployerLaunches, prior_dev_exits: 0 }), ['serial_deployer']);
});

test('createReputation counts prior launches before the block and exits from balances', async () => {
	const creator = '0x00000000000000000000000000000000000000c1';
	const balances = { '0x01': 0n, '0x02': 400n };
	const rep = createReputation({
		multicall: async ({ contracts }) => contracts.map((c) => ({ status: 'success', result: balances[c.address] })),
	}, { windowBlocks: 5000 });
	rep.record({ creator, token: '0x01', blockNumber: 10n, allocation: 1000n });
	rep.record({ creator, token: '0x02', blockNumber: 20n, allocation: 1000n });
	rep.record({ creator, token: '0x02', blockNumber: 20n, allocation: 1000n });
	rep.record({ creator, token: '0x03', blockNumber: 99n, allocation: 1000n });
	assert.deepEqual(await rep.assess(creator, 50n), { prior_launches: 2, prior_dev_exits: 1, inspected: 2, window_blocks: 5000 });
	assert.deepEqual(await rep.assess('0x00000000000000000000000000000000000000c2', 50n), { prior_launches: 0, prior_dev_exits: 0, inspected: 0, window_blocks: 5000 });
});

test('getMintLogs waits out an RPC rate limit and retries the same range instead of aborting the scan', async () => {
	let hits = 0;
	const waits = [];
	const request = async ({ params: [f] }) => {
		hits += 1;
		if (hits <= 2) {
			const err = new Error('RPC Request failed.');
			err.cause = { code: 429, message: 'Rate Limit Hit, limit will reset in 60 seconds' };
			throw err;
		}
		return [{ address: '0x1', blockNumber: f.fromBlock }];
	};
	const logs = await getMintLogs(request, 0n, 99n, { sleep: async (ms) => { waits.push(ms); } });
	assert.equal(logs.length, 1);
	assert.deepEqual(waits, [60_000, 60_000]);
});

test('getMintLogs still throws a non-transient error on the first attempt', async () => {
	await assert.rejects(getMintLogs(async () => { throw new Error('invalid params shape'); }, 0n, 99n, { sleep: async () => {} }), /invalid params/);
});
