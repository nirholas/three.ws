// Tool-surface invariants for @three-ws/provenance-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only connects
// when the file is the process entry point, and buildServer() needs no token or
// signer. These tests run offline — they never touch the network.
//
// Run: node --test packages/provenance-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = [
	'list_agent_actions',
	'query_action',
	'append_agent_action',
];

const READ_TOOLS = new Set(['list_agent_actions', 'query_action']);
const WRITE_TOOLS = new Set(['append_agent_action']);

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

test('read tools are read-only, live, non-idempotent, and set destructiveHint:false explicitly', () => {
	for (const tool of TOOLS.filter((t) => READ_TOOLS.has(t.name))) {
		assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
		assert.equal(tool.annotations.openWorldHint, true, `${tool.name} talks to a live service`);
		// Live ledger data is never idempotent — newer actions appear between calls.
		assert.equal(tool.annotations.idempotentHint, false, `${tool.name} reads live data, not idempotent`);
		assert.equal(
			tool.annotations.destructiveHint,
			false,
			`${tool.name} is read-only, so destructiveHint must be an explicit false`,
		);
	}
});

test('the append tool is a non-idempotent, non-destructive write', () => {
	for (const tool of TOOLS.filter((t) => WRITE_TOOLS.has(t.name))) {
		assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} writes — readOnlyHint must be false`);
		// Append-only ledger: each call records a new row, none are ever removed.
		assert.equal(tool.annotations.idempotentHint, false, `${tool.name} appends a new record every call`);
		assert.equal(tool.annotations.destructiveHint, false, `${tool.name} never overwrites or deletes`);
		assert.equal(tool.annotations.openWorldHint, true, `${tool.name} talks to a live service`);
	}
});

test('buildServer registers every tool with its annotations, without a token or signer', () => {
	const server = buildServer();
	const registered = server._registeredTools;
	assert.ok(registered, 'McpServer should expose its tool registry');
	for (const tool of TOOLS) {
		const entry = registered[tool.name];
		assert.ok(entry, `${tool.name} not registered on the server`);
		assert.deepEqual(entry.annotations, tool.annotations, `${tool.name} annotations must survive registration`);
	}
});
