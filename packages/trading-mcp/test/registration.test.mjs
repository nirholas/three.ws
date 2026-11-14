// Tool-surface and refusal invariants for @three-ws/trading-mcp. Offline: no
// network, no credential. Importing src/index.js never grabs the transport.
//
// Run: node --test packages/trading-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';
import { THREE_MINT } from '../src/config.js';
import { tradeBody } from '../src/lib/args.js';
import { summarizePositions } from '../src/tools/list-positions.js';
import { z } from 'zod';

const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const AGENT = '845e4464-1d17-4cac-8990-be3f72bbc38d';
const MINT = 'THREEsynthetic11111111111111111111111111111';

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

test('"three" and "$THREE" name the promoted coin: a buy resolves to the mint, a sell is refused', () => {
	for (const mint of ['three', '$THREE', ' Three ']) {
		assert.equal(tradeBody({ side: 'buy', mint, amountSol: 0.1 }, { preview: true }).mint, THREE_MINT, mint);
		assert.throws(() => tradeBody({ side: 'sell', mint, amountTokens: 'all' }, { preview: true }), (e) => e.code === 'three_sell_forbidden', mint);
	}
});

test('a sell can be sized in tokens: "all" or an amount, resolved server-side against the live balance', () => {
	assert.equal(tradeBody({ side: 'sell', mint: MINT, amountTokens: 'all' }, { preview: true }).token_amount, 'all');
	const some = tradeBody({ side: 'sell', mint: MINT, amountTokens: 12.5 }, { preview: false });
	assert.equal(some.token_amount, '12.5');
	assert.equal(some.token_amount_raw, undefined);
	assert.equal(tradeBody({ side: 'sell', mint: MINT, tokenAmountRaw: '5000' }, { preview: true }).token_amount_raw, '5000');
	assert.throws(() => tradeBody({ side: 'sell', mint: MINT, amountTokens: 'most' }, { preview: true }), /amountTokens/);
	assert.throws(() => tradeBody({ side: 'sell', mint: MINT, amountTokens: 0 }, { preview: true }), /amountTokens/);
	assert.throws(() => tradeBody({ side: 'sell', mint: MINT, amountTokens: 'all', tokenAmountRaw: '5' }, { preview: true }), /not both/);
	assert.throws(() => tradeBody({ side: 'sell', mint: MINT }, { preview: true }), /amountTokens/);
});

test('the quote schema accepts the "three" alias and a token-sized sell', () => {
	const schema = z.object(byName.quote_trade.inputSchema);
	assert.ok(schema.safeParse({ agentId: AGENT, side: 'buy', mint: 'three', amountSol: 0.1 }).success);
	assert.ok(schema.safeParse({ agentId: AGENT, side: 'sell', mint: MINT, amountTokens: 'all' }).success);
	assert.ok(schema.safeParse({ agentId: AGENT, side: 'sell', mint: MINT, amountTokens: 2.5 }).success);
	assert.equal(schema.safeParse({ agentId: AGENT, side: 'sell', mint: MINT, amountTokens: 'half' }).success, false);
});

test('list_positions summarizes the portfolio into SOL, positions with P&L, and net worth', () => {
	const out = summarizePositions({
		agent: { id: AGENT, wallet: 'WALLET' }, network: 'mainnet', sol_usd: 150, t: 1,
		net_worth: { sol: 3.2, usd: 480, realized_pnl_sol: 0.1, realized_pnl_usd: 15, unrealized_pnl_sol: 0.4 },
		holdings: [
			{ mint: null, isNative: true, symbol: 'SOL', amount: 2, decimals: 9, usd_value: 300, priceable: true },
			{ mint: THREE_MINT, symbol: 'THREE', name: 'three.ws', amount: 1000, decimals: 6, price: 0.1, usd_value: 100, priceable: true, is_three: true, cost_basis_sol: 0.5, unrealized_sol: 0.17, unrealized_pct: 34 },
			{ mint: MINT, symbol: 'SYN', name: 'Synthetic', amount: 42.5, decimals: 6, price: null, usd_value: null, priceable: false, is_three: false, cost_basis_sol: 0.2, unrealized_sol: null, unrealized_pct: null, liquidity_warning: 'unpriceable' },
		],
		attribution: [{ big: true }], metrics: { big: true }, risk: { big: true },
		risk_flags: [{ level: 'warn', text: 'Concentrated.' }],
	});
	assert.deepEqual(out.sol, { amount: 2, usd_value: 300 });
	assert.equal(out.wallet, 'WALLET');
	assert.equal(out.positions.length, 2);
	assert.deepEqual(out.positions[0], {
		mint: THREE_MINT, symbol: 'THREE', name: 'three.ws', amount: 1000, decimals: 6, price_usd: 0.1, usd_value: 100,
		cost_basis_sol: 0.5, unrealized_sol: 0.17, unrealized_pct: 34, priceable: true, sellable: false,
	});
	assert.equal(out.positions[1].sellable, true);
	assert.equal(out.positions[1].priceable, false);
	assert.deepEqual(out.net_worth, { sol: 3.2, usd: 480, realized_pnl_sol: 0.1, unrealized_pnl_sol: 0.4 });
	assert.deepEqual(out.risk_flags, ['warn: Concentrated.']);
	assert.equal(out.attribution, undefined);
	assert.equal(out.metrics, undefined);
});
