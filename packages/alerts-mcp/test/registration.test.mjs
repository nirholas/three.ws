// Tool-surface invariants for @three-ws/alerts-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only connects
// when the file is the process entry point, and buildServer() needs no session
// token. These tests run offline — they never touch the network.
//
// Run: node --test packages/alerts-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = [
	'list_alert_rules',
	'create_alert_rule',
	'update_alert_rule',
	'delete_alert_rule',
	'get_alert_history',
];

// The read-only query tools vs. the account-mutating write tools.
const READ_TOOLS = new Set(['list_alert_rules', 'get_alert_history']);
const WRITE_TOOLS = new Set(['create_alert_rule', 'update_alert_rule', 'delete_alert_rule']);

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
		assert.equal(tool.annotations.openWorldHint, true, `${tool.name} talks to a live service`);
	}
});

test('read tools are read-only, live-data queries', () => {
	for (const tool of TOOLS.filter((t) => READ_TOOLS.has(t.name))) {
		assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
		// Live data moves between calls — never idempotent, never destructive.
		assert.equal(tool.annotations.idempotentHint, false, `${tool.name} reads live data, not idempotent`);
		assert.equal(tool.annotations.destructiveHint, false, `${tool.name} is read-only, so destructiveHint must be an explicit false`);
	}
});

test('write tools declare readOnlyHint:false and honest idempotency', () => {
	for (const tool of TOOLS.filter((t) => WRITE_TOOLS.has(t.name))) {
		assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} mutates account state — readOnlyHint must be false`);
	}
	const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
	// create appends a new rule — calling twice creates two, so NOT idempotent.
	assert.equal(byName.create_alert_rule.annotations.idempotentHint, false);
	// update sets fields to given values — re-applying is a no-op, so idempotent.
	assert.equal(byName.update_alert_rule.annotations.idempotentHint, true);
	// delete is irreversible and a second delete 404s — destructive, not idempotent.
	assert.equal(byName.delete_alert_rule.annotations.destructiveHint, true);
	assert.equal(byName.delete_alert_rule.annotations.idempotentHint, false);
});

test('buildServer registers every tool with its annotations, without a session', () => {
	const server = buildServer();
	const registered = server._registeredTools;
	assert.ok(registered, 'McpServer should expose its tool registry');
	for (const tool of TOOLS) {
		const entry = registered[tool.name];
		assert.ok(entry, `${tool.name} not registered on the server`);
		assert.deepEqual(entry.annotations, tool.annotations, `${tool.name} annotations must survive registration`);
	}
});
