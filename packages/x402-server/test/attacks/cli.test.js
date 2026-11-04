import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFacilitator } from './helpers.js';

const BIN = fileURLToPath(new URL('../../bin/x402-server.js', import.meta.url));
let node;
before(async () => {
	node = await startFacilitator();
});
after(() => node.close());

// spawnSync would block the in-process facilitator, so run the CLI async.
import { spawn } from 'node:child_process';
const run = (args) =>
	new Promise((resolve) => {
		const c = spawn('node', [BIN, ...args]);
		let out = '';
		c.stdout.on('data', (d) => (out += d));
		c.stderr.on('data', (d) => (out += d));
		c.on('close', (code) => resolve({ code, out }));
	});

test('attack CLI exits 0 and reports every case refused against a local facilitator', async () => {
	const r = await run(['attack', '--facilitator', node.url, '--pay-to', node.payTo, '--mint', node.mint]);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /\d+\/\d+ attacks refused/);
	assert.doesNotMatch(r.out, /FAIL/);
});

test('attack CLI reads pay-to and mint from the facilitator index when not passed', async () => {
	const r = await run(['attack', '--facilitator', node.url]);
	assert.equal(r.code, 0, r.out);
});

test('attack CLI without --facilitator prints usage and exits 2', () => {
	const r = spawnSync('node', [BIN, 'attack']);
	assert.equal(r.status, 2);
});
