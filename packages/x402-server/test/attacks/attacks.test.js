import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttackCases, runAttacks, MAINNET_NETWORK_IDS } from '../../src/facilitator/attacks.js';
import { DEVNET, startFacilitator } from './helpers.js';

let node;
let cases;
before(async () => {
	node = await startFacilitator();
	cases = buildAttackCases({
		network: DEVNET,
		feePayer: node.sponsor.publicKey.toBase58(),
		payTo: node.payTo,
		mint: node.mint,
	});
});
after(() => node.close());

test('the suite carries at least 20 distinct attacks', () => {
	assert.ok(cases.length >= 20, `only ${cases.length} cases`);
	assert.equal(new Set(cases.map((c) => c.name)).size, cases.length);
});

test('every attack is refused with its specific reason, and none touches the RPC', async () => {
	const results = await runAttacks({ url: node.url, cases });
	const failures = results.filter((r) => !r.pass);
	assert.deepEqual(
		failures,
		[],
		`unrefused or wrongly refused:\n${failures.map((f) => `  ${f.name}: expected ${f.expect}, got ${f.got}`).join('\n')}`,
	);
});

test('the decision log records one refusal per attack with a machine-readable reason', () => {
	const summary = node.facilitator.decisionLog.summary();
	const refused = Object.values(summary.refusals).reduce((a, b) => a + b, 0);
	assert.equal(refused, cases.length);
	assert.equal(summary.settled, 0);
	assert.ok(summary.refusals.cu_price_too_high >= 1);
});

test('mainnet is on the refuse list', () => {
	assert.ok(MAINNET_NETWORK_IDS.some((id) => id.startsWith('solana:5eykt4')));
});
