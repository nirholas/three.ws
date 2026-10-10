// Tool-surface invariants for @three-ws/naming-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only
// connects when the file is the process entry point, and buildServer() needs
// no key or signer. These tests run offline — they never touch the network.
//
// Run: node --test packages/naming-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = ['sns_resolve', 'sns_reverse', 'threews_availability'];

test('exactly the expected tools are registered', () => {
	assert.equal(TOOLS.length, 3);
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
	}
});

test('sns_resolve takes a required .sol name and is read-only', () => {
	const tool = TOOLS.find((t) => t.name === 'sns_resolve');
	assert.ok(tool, 'sns_resolve must exist');
	assert.equal(tool.annotations.readOnlyHint, true);
	assert.equal(tool.annotations.idempotentHint, false);
	assert.equal(tool.annotations.openWorldHint, true);
	assert.ok(tool.inputSchema.name, 'sns_resolve must accept a name parameter');
	assert.match(tool.description, /\.sol/);
});

test('sns_reverse takes a required base58 address and is read-only', () => {
	const tool = TOOLS.find((t) => t.name === 'sns_reverse');
	assert.ok(tool, 'sns_reverse must exist');
	assert.equal(tool.annotations.readOnlyHint, true);
	assert.equal(tool.annotations.idempotentHint, false);
	assert.equal(tool.annotations.openWorldHint, true);
	assert.ok(tool.inputSchema.address, 'sns_reverse must accept an address parameter');
	assert.match(tool.description, /wallet/i);
});

test('threews_availability takes a required label and is read-only', () => {
	const tool = TOOLS.find((t) => t.name === 'threews_availability');
	assert.ok(tool, 'threews_availability must exist');
	assert.equal(tool.annotations.readOnlyHint, true);
	assert.equal(tool.annotations.idempotentHint, false);
	assert.equal(tool.annotations.openWorldHint, true);
	assert.ok(tool.inputSchema.label, 'threews_availability must accept a label parameter');
	assert.match(tool.description, /threews\.sol/);
});

test('every tool advertises readOnlyHint and openWorldHint (all are live public reads)', () => {
	for (const tool of TOOLS) {
		assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
		assert.equal(tool.annotations.openWorldHint, true, `${tool.name} talks to a live service`);
	}
});

test('every read-only tool sets destructiveHint:false explicitly (the spec defaults an omitted one to true)', () => {
	for (const tool of TOOLS) {
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
