// Tool-surface invariants for @three-ws/tutor-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only
// connects when the file is the process entry point, and buildServer() needs
// no key or signer. These tests run offline — they never touch the network.
//
// Run: node --test packages/tutor-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = [
	'load_session',
	'close_session',
];

// The single write tool — closing a session finalizes its ledger.
const WRITE_TOOLS = new Set(['close_session']);

test('exactly the expected tools are registered', () => {
	assert.equal(TOOLS.length, 2);
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

test('read tools are read-only and set destructiveHint:false explicitly (the spec defaults an omitted one to true)', () => {
	for (const tool of TOOLS) {
		if (WRITE_TOOLS.has(tool.name)) continue;
		assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
		// Live ledger data moves between calls (the tab grows as questions are billed).
		assert.equal(tool.annotations.idempotentHint, false, `${tool.name} reads live data, not idempotent`);
		assert.equal(
			tool.annotations.destructiveHint,
			false,
			`${tool.name} is read-only, so destructiveHint must be an explicit false`,
		);
	}
});

test('write tools declare readOnlyHint:false and an honest destructiveHint', () => {
	for (const tool of TOOLS) {
		if (!WRITE_TOOLS.has(tool.name)) continue;
		assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} mutates state — readOnlyHint must be false`);
		// Closing is a non-funds-moving, idempotent seal, so it is explicitly non-destructive.
		assert.equal(typeof tool.annotations.destructiveHint, 'boolean', `${tool.name} must declare destructiveHint`);
		assert.equal(tool.annotations.destructiveHint, false, `${tool.name} closes (seals) a session — not destructive`);
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
