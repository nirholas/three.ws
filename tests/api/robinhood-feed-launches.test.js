import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchFromFeedEvent, mergeFeedLaunches } from '../../api/_lib/robinhood-feed.js';
import { normalizeLaunch } from '../../workers/robinhood-feed/src/normalize.js';
import { parseMintLogs, launchFromMint } from '../../workers/robinhood-feed/src/mints.js';

const fx = JSON.parse(readFileSync(new URL('../../workers/robinhood-feed/tests/fixtures/venue-launches.json', import.meta.url), 'utf8'));
const c = fx.launches[0];
const [mint] = parseMintLogs([c.mintLog]);
const launch = launchFromMint(mint, { ...c.tx, blockNumber: BigInt(c.tx.blockNumber) });
const data = normalizeLaunch({
	launch, venue: launch.venue, symbol: 'REAL', name: 'Real Coin', atMs: 1_794_589_201_000,
	dev: { dev_sold: true, dev_sold_pct: 100 },
	deployer: { prior_launches: 6, prior_dev_exits: 2, inspected: 2, window_blocks: 830000 },
});

test('a real worker launch event maps to the API row with venue, record and flags', () => {
	const row = launchFromFeedEvent({ kind: 'launch', data });
	assert.equal(row.token, c.mintLog.address);
	assert.equal(row.venue.id, c.venue);
	assert.equal(row.deployer, c.tx.from);
	assert.deepEqual(row.deployerRecord, { priorLaunches: 6, priorDevExits: 2, inspected: 2, windowBlocks: 830000 });
	assert.equal(row.devSold, true);
	assert.equal(row.devSoldPct, 100);
	assert.deepEqual(row.flags, ['dev_sold', 'serial_exit', 'serial_deployer']);
	assert.equal(row.txHash, c.tx.hash);
});

test('malformed worker payloads are dropped, unknown flags are filtered', () => {
	assert.equal(launchFromFeedEvent(null), null);
	assert.equal(launchFromFeedEvent({ kind: 'trade', data }), null);
	assert.equal(launchFromFeedEvent({ kind: 'launch', data: { ...data, mint: 'nope' } }), null);
	const row = launchFromFeedEvent({ kind: 'launch', data: { ...data, flags: ['dev_sold', '<script>'] } });
	assert.deepEqual(row.flags, ['dev_sold']);
});

// A market-lane row for the same token (the bonding-curve lane's row shape)
// whose metadata multicall and block read failed under public-RPC throttling.
const marketRow = (over = {}) => ({
	launchpad: 'Market lane', type: 'bonding-curve', token: c.mintLog.address, deployer: c.tx.from,
	block: Number(c.tx.blockNumber), txHash: c.tx.hash, timestamp: null, symbol: null, name: null,
	priceEth: 1e-9, progressPct: 4.2, totalSupply: 1e9, ...over,
});

test('merge keeps the market row and lays the worker grading over it', () => {
	const feedRow = launchFromFeedEvent({ kind: 'launch', data });
	const [row] = mergeFeedLaunches([marketRow({ timestamp: '2026-11-13T17:00:00.000Z', symbol: 'MKT', name: 'Market Name' })], [feedRow]);
	assert.equal(row.launchpad, 'Market lane');
	assert.equal(row.progressPct, 4.2);
	assert.equal(row.venue.id, c.venue);
	assert.deepEqual(row.flags, feedRow.flags);
	// the market lane's own reads win when they succeeded
	assert.equal(row.symbol, 'MKT');
	assert.equal(row.name, 'Market Name');
	assert.equal(row.timestamp, '2026-11-13T17:00:00.000Z');
});

test('merge fills the name, symbol and time a throttled market lane could not read from the worker row', () => {
	const feedRow = launchFromFeedEvent({ kind: 'launch', data });
	const [row] = mergeFeedLaunches([marketRow()], [feedRow]);
	assert.equal(row.symbol, 'REAL');
	assert.equal(row.name, 'Real Coin');
	assert.equal(row.timestamp, feedRow.timestamp);
	assert.ok(row.timestamp);
	assert.equal(row.progressPct, 4.2);
});

test('a token only the worker saw is passed through as the worker row', () => {
	const feedRow = launchFromFeedEvent({ kind: 'launch', data });
	const other = marketRow({ token: '0x000000000000000000000000000000000000beef' });
	const rows = mergeFeedLaunches([other], [feedRow]);
	assert.equal(rows.length, 2);
	assert.equal(rows.find((r) => r.token === c.mintLog.address), feedRow);
});
