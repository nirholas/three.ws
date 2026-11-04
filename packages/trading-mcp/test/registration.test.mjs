// Tool-surface and refusal invariants for @three-ws/trading-mcp. Offline: no
// network, no credential. Importing src/index.js never grabs the transport.
//
// Run: node --test packages/trading-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';
import { THREE_MINT } from '../src/config.js';
import { tradeBody } from '../src/lib/args.js';

const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const AGENT = '845e4464-1d17-4cac-8990-be3f72bbc38d';
const MINT = 'Gif5sJNdu1S9ZhnY9Nz8Ma1JqURnXsiYsN2KjUAx7PLY';

test('exactly the expected tools are registered', () => {
	assert.deepEqual(TOOLS.map((t) => t.name).sort(), ['execute_trade', 'list_positions', 'quote_trade']);
});

test('only execute_trade is a destructive write; the others are read-only', () => {
	assert.equal(byName.execute_trade.annotations.destructiveHint, true);
	assert.equal(byName.execute_trade.annotations.readOnlyHint, false);
	for (const n of ['quote_trade', 'list_positions']) {
		assert.equal(byName[n].annotations.readOnlyHint, true, n);
		assert.equal(byName[n].annotations.destructiveHint, false, n);
	}
});

test('buildServer registers without a credential', () => {
	assert.ok(buildServer());
});

test('execute_trade refuses without confirm:true before any request', async () => {
	await assert.rejects(
		() => byName.execute_trade.handler({ agentId: AGENT, side: 'buy', mint: MINT, amountSol: 0.1 }),
		(e) => e.code === 'confirmation_required',
	);
});

test('a $THREE sell is refused locally by both quote_trade and execute_trade', async () => {
	const args = { agentId: AGENT, side: 'sell', mint: THREE_MINT, tokenAmountRaw: '1000000' };
	await assert.rejects(() => byName.quote_trade.handler(args), (e) => e.code === 'three_sell_forbidden');
	await assert.rejects(() => byName.execute_trade.handler({ ...args, confirm: true }), (e) => e.code === 'three_sell_forbidden');
});

test('a $THREE buy is allowed through the body builder', () => {
	const b = tradeBody({ side: 'buy', mint: THREE_MINT, amountSol: 0.25 }, { preview: true });
	assert.equal(b.sol_amount, 0.25);
	assert.equal(b.preview, true);
	assert.equal(b.slippage_bps, 100);
});

test('the body builder rejects bad sizes and slippage', () => {
	assert.throws(() => tradeBody({ side: 'buy', mint: MINT, amountSol: 0 }, { preview: true }), /amountSol/);
	assert.throws(() => tradeBody({ side: 'sell', mint: MINT, tokenAmountRaw: '-1' }, { preview: false }), /tokenAmountRaw/);
	assert.throws(() => tradeBody({ side: 'buy', mint: MINT, amountSol: 1, slippageBps: 900 }, { preview: true }), /slippageBps/);
});

test('with no THREE_WS_API_KEY every tool refuses locally with missing_credential', async () => {
	if (process.env.THREE_WS_API_KEY) return;
	const calls = {
		quote_trade: { agentId: AGENT, side: 'buy', mint: MINT, amountSol: 0.1 },
		list_positions: { agentId: AGENT },
		execute_trade: { agentId: AGENT, side: 'buy', mint: MINT, amountSol: 0.1, confirm: true },
	};
	for (const [name, args] of Object.entries(calls)) {
		await assert.rejects(() => byName[name].handler(args), (e) => e.code === 'missing_credential', name);
	}
});
