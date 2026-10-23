import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchFromFeedEvent } from '../../api/_lib/robinhood-feed.js';
import { normalizeLaunch } from '../../workers/robinhood-feed/src/normalize.js';
import { parseMintLogs, launchFromMint } from '../../workers/robinhood-feed/src/mints.js';

const fx = JSON.parse(readFileSync(new URL('../../workers/robinhood-feed/tests/fixtures/venue-launches.json', import.meta.url), 'utf8'));
const c = fx.launches[0];
const [mint] = parseMintLogs([c.mintLog]);
const launch = launchFromMint(mint, { ...c.tx, blockNumber: BigInt(c.tx.blockNumber) });
const data = normalizeLaunch({
	launch, venue: launch.venue, symbol: 'REAL',
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
