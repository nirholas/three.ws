// Tool-surface invariants for @three-ws/signals-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only
// connects when the file is the process entry point, and buildServer() needs
// no key or signer. These tests run offline — they never touch the network.
//
// Run: node --test packages/signals-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = [
	'list_signal_feeds',
	'get_mirror_leaderboard',
	'get_subscriptions',
	'subscribe_signal',
	'set_subscription_status',
];

// The account-scoped write tools (account-keyed POSTs). Everything else is a
// public, read-only live query.
const WRITE_NAMES = new Set(['subscribe_signal', 'set_subscription_status']);

test('exactly the expected tools are registered', () => {
	assert.equal(TOOLS.length, 5);
	assert.deepEqual(new Set(TOOLS.map((t) => t.name)), new Set(EXPECTED_NAMES));
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
		// Every tool talks to the live three.ws API.
		assert.equal(tool.annotations.openWorldHint, true, `${tool.name} talks to a live service`);
	}
});

test('read-only tools are honest live queries; writes are flagged', () => {
	for (const tool of TOOLS) {
		if (WRITE_NAMES.has(tool.name)) {
			assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} is a write — readOnlyHint must be false`);
		} else {
			assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
			// Live market data is never idempotent — the feed/leaderboard moves between calls.
			assert.equal(tool.annotations.idempotentHint, false, `${tool.name} reads live data, not idempotent`);
		}
	}
});

test('the two account-scoped writes are present and marked', () => {
	const writes = TOOLS.filter((t) => t.annotations.readOnlyHint === false).map((t) => t.name);
	assert.deepEqual(new Set(writes), WRITE_NAMES);
});

test('read-only tools set destructiveHint:false explicitly (the spec defaults an omitted one to true)', () => {
	for (const tool of TOOLS) {
		if (WRITE_NAMES.has(tool.name)) continue;
		assert.equal(
			tool.annotations.destructiveHint,
			false,
			`${tool.name} is read-only, so destructiveHint must be an explicit false`,
		);
	}
});

test('buildServer registers every tool with its annotations, without a signer', () => {
	const server = buildServer();
	const registered = server._registeredTools;
	assert.ok(registered, 'McpServer should expose its tool registry');
	for (const tool of TOOLS) {
		const entry = registered[tool.name];
		assert.ok(entry, `${tool.name} not registered on the server`);
		assert.deepEqual(entry.annotations, tool.annotations, `${tool.name} annotations must survive registration`);
	}
});
