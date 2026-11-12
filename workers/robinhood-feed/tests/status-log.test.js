// The firehose reports backfill and watcher health as `status` events. Those
// used to reach SSE/WS subscribers only, so a backfill that died on a rate
// limit was indistinguishable from a quiet chain in the operator's log.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStatusLogger } from '../src/status-log.js';

function harness(start = 0) {
	const lines = [];
	let t = start;
	const log = createStatusLogger({ write: (level, line) => lines.push([level, line]), now: () => t, repeatMs: 60_000 });
	return { lines, log, advance: (ms) => { t += ms; } };
}

test('a backfill warning reaches the operator log with its source and message', () => {
	const { lines, log } = harness();
	log({ kind: 'status', data: { level: 'warn', src: 'backfill', message: 'Rate Limit Hit, limit will reset in 60 seconds' } });
	assert.deepEqual(lines, [['warn', '[robinhood-feed] warn · backfill · Rate Limit Hit, limit will reset in 60 seconds']]);
});

test('the backfill summary is logged so a cold start shows how much history it found', () => {
	const { lines, log } = harness();
	log({ kind: 'status', data: { level: 'info', src: 'backfill', launches: 42, emitted: 30, deployers: 17 } });
	assert.deepEqual(lines, [['info', '[robinhood-feed] backfill · launches=42 emitted=30 deployers=17']]);
});

test('a backfill info event that carries a message logs the message, not an empty line', () => {
	const { lines, log } = harness();
	log({ kind: 'status', data: { level: 'info', src: 'backfill', message: 'scanning 830000 blocks' } });
	assert.deepEqual(lines, [['info', '[robinhood-feed] backfill · scanning 830000 blocks']]);
});

test('routine info and non-status events stay out of the log', () => {
	const { lines, log } = harness();
	log({ kind: 'status', data: { level: 'info', src: 'sse', message: 'connected' } });
	log({ kind: 'trade', data: { tx: '0x1' } });
	log({ kind: 'launch', data: { mint: '0x2' } });
	assert.deepEqual(lines, []);
});

test('an identical warning repeating inside the window is logged once, then again after it', () => {
	const { lines, log, advance } = harness();
	const ev = { kind: 'status', data: { level: 'warn', src: 'mint-watch', message: 'HTTP request failed' } };
	log(ev);
	advance(10_000);
	log(ev);
	log({ kind: 'status', data: { level: 'warn', src: 'trade-watch', message: 'HTTP request failed' } });
	advance(60_000);
	log(ev);
	assert.deepEqual(lines.map(([, l]) => l), [
		'[robinhood-feed] warn · mint-watch · HTTP request failed',
		'[robinhood-feed] warn · trade-watch · HTTP request failed',
		'[robinhood-feed] warn · mint-watch · HTTP request failed (repeated 1x)',
	]);
});

test('a multi-line viem error is cut to its first line', () => {
	const { lines, log } = harness();
	log({ kind: 'status', data: { level: 'warn', src: 'launch-watch', message: 'HTTP request failed.\n\nURL: https://rpc\nRequest body: {...}' } });
	assert.equal(lines[0][1], '[robinhood-feed] warn · launch-watch · HTTP request failed.');
});
