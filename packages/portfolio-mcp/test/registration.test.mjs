// Tool-surface invariants for @three-ws/portfolio-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only connects
// when the file is the process entry point, and buildServer() needs no key,
// signer, or session. These tests run offline — they never touch the network or
// the chain.
//
// Run: node --test packages/portfolio-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = [
	'get_portfolio_summary',
	'get_portfolio_history',
	'get_portfolio_asset',
	'get_trades_feed',
	'get_wallet_balances',
	'preview_transfer',
	'send_transfer',
];

// The ONLY destructive tool: it signs and broadcasts an irreversible Solana
// mainnet transfer. Adding another? Add it here deliberately, same commit.
const DESTRUCTIVE_TOOLS = new Set(['send_transfer']);

// Every tool that writes anything. get_portfolio_summary persists a history
// point when called with snapshot:true, so it cannot claim read-only.
const WRITE_TOOLS = new Set(['send_transfer', 'get_portfolio_summary']);

test('exactly the expected tools are registered', () => {
	assert.equal(TOOLS.length, EXPECTED_NAMES.length);
	assert.deepEqual(new Set(TOOLS.map((t) => t.name)), new Set(EXPECTED_NAMES));
	assert.equal(new Set(TOOLS.map((t) => t.name)).size, EXPECTED_NAMES.length, 'tool names must be unique');
});

test('every tool has a title, description, input schema and complete annotations', () => {
	for (const tool of TOOLS) {
		assert.equal(typeof tool.title, 'string', `${tool.name} is missing a title`);
		assert.ok(tool.title.length > 0, `${tool.name} has an empty title`);
		assert.equal(typeof tool.description, 'string', `${tool.name} is missing a description`);
		assert.ok(tool.description.length > 0, `${tool.name} has an empty description`);
		assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `${tool.name} is missing inputSchema`);
		assert.equal(typeof tool.handler, 'function', `${tool.name} is missing a handler`);
		assert.ok(tool.annotations, `${tool.name} is missing MCP ToolAnnotations`);
		assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', `${tool.name} must set readOnlyHint`);
		assert.equal(typeof tool.annotations.idempotentHint, 'boolean', `${tool.name} must set idempotentHint`);
		assert.equal(typeof tool.annotations.openWorldHint, 'boolean', `${tool.name} must set openWorldHint`);
	}
});

test('reads are read-only live queries; writes are not', () => {
	for (const tool of TOOLS) {
		const isWrite = WRITE_TOOLS.has(tool.name);
		assert.equal(tool.annotations.readOnlyHint, !isWrite, `${tool.name} readOnlyHint should be ${!isWrite}`);
		// Everything talks to a live service (API or chain); nothing is idempotent —
		// balances, feeds, and broadcasts all move between calls.
		assert.equal(tool.annotations.openWorldHint, true, `${tool.name} talks to a live service`);
		assert.equal(tool.annotations.idempotentHint, false, `${tool.name} is never idempotent`);
		assert.equal(typeof tool.annotations.destructiveHint, 'boolean', `${tool.name} must set destructiveHint`);
	}
});

test('read-only tools set destructiveHint:false explicitly (the spec defaults an omitted one to true)', () => {
	for (const tool of TOOLS) {
		if (tool.annotations.readOnlyHint === true) {
			assert.equal(
				tool.annotations.destructiveHint,
				false,
				`${tool.name} is read-only, so destructiveHint must be an explicit false`,
			);
		}
	}
});

test('the transfer tool sets readOnlyHint:false and destructiveHint:true explicitly', () => {
	const destructive = TOOLS.filter((t) => t.annotations.destructiveHint === true).map((t) => t.name);
	assert.deepEqual(new Set(destructive), DESTRUCTIVE_TOOLS);
	for (const name of DESTRUCTIVE_TOOLS) {
		const tool = TOOLS.find((t) => t.name === name);
		assert.ok(tool, `${name} must exist in the tool registry`);
		assert.equal(tool.annotations.readOnlyHint, false, `${name} must not be read-only`);
		assert.equal(tool.annotations.destructiveHint, true, `${name} must be marked destructive`);
		assert.equal(tool.annotations.idempotentHint, false, `${name} must not be idempotent`);
	}
});

test('buildServer registers every tool with its annotations, without a signer or session', () => {
	const server = buildServer();
	const registered = server._registeredTools;
	assert.ok(registered, 'McpServer should expose its tool registry');
	for (const tool of TOOLS) {
		const entry = registered[tool.name];
		assert.ok(entry, `${tool.name} not registered on the server`);
		assert.deepEqual(entry.annotations, tool.annotations, `${tool.name} annotations must survive registration`);
	}
});
