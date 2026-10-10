// Tool-surface invariants for @three-ws/copy-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only connects
// when the file is the process entry point, and buildServer() reads no key (the
// THREE_WS_API_KEY is only touched at call time). These tests run offline — they
// never touch the network.
//
// Run: node --test packages/copy-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = [
	'list_subscriptions',
	'create_subscription',
	'update_subscription',
	'cancel_subscription',
	'get_executions',
	'record_execution',
	'get_earnings',
];

// The write tools — they change the copier's money-adjacent state.
const WRITE_NAMES = new Set([
	'create_subscription',
	'update_subscription',
	'cancel_subscription',
	'record_execution',
]);

test('exactly the expected tools are registered', () => {
	assert.equal(TOOLS.length, EXPECTED_NAMES.length);
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

test('read tools are read-only and non-idempotent; they set destructiveHint: false explicitly', () => {
	for (const tool of TOOLS) {
		if (WRITE_NAMES.has(tool.name)) continue;
		assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
		// Live copy state moves between calls — reads are never idempotent.
		assert.equal(tool.annotations.idempotentHint, false, `${tool.name} reads live data, not idempotent`);
		assert.equal(
			tool.annotations.destructiveHint,
			false,
			`${tool.name} is read-only, so destructiveHint must be an explicit false`,
		);
	}
});

test('write tools declare readOnlyHint:false', () => {
	for (const name of WRITE_NAMES) {
		const tool = TOOLS.find((t) => t.name === name);
		assert.ok(tool, `${name} should exist`);
		assert.equal(tool.annotations.readOnlyHint, false, `${name} mutates state — must set readOnlyHint:false`);
	}
});

test('only cancel_subscription is marked destructive', () => {
	for (const tool of TOOLS) {
		if (tool.name === 'cancel_subscription') {
			assert.equal(tool.annotations.destructiveHint, true, 'cancel_subscription must set destructiveHint:true');
		} else {
			assert.notEqual(tool.annotations.destructiveHint, true, `${tool.name} should not be destructive`);
		}
	}
});

test('idempotency hints match the API contract', () => {
	const hint = (name) => TOOLS.find((t) => t.name === name).annotations.idempotentHint;
	// Upsert + by-id config patch are idempotent; recording an action is a one-way transition.
	assert.equal(hint('create_subscription'), true, 'create_subscription upserts — idempotent');
	assert.equal(hint('update_subscription'), true, 'update_subscription patches — idempotent');
	assert.equal(hint('cancel_subscription'), true, 'cancel_subscription soft-stops — idempotent');
	assert.equal(hint('record_execution'), false, 'record_execution is a one-way pending→acted transition');
});

test('buildServer registers every tool with its annotations, without a signer or key', () => {
	const server = buildServer();
	const registered = server._registeredTools;
	assert.ok(registered, 'McpServer should expose its tool registry');
	for (const tool of TOOLS) {
		const entry = registered[tool.name];
		assert.ok(entry, `${tool.name} not registered on the server`);
		assert.deepEqual(entry.annotations, tool.annotations, `${tool.name} annotations must survive registration`);
	}
});
