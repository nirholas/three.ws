// Tool-surface invariants for @three-ws/clash-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only
// connects when the file is the process entry point, and buildServer() needs
// no key or signer. These tests run offline — they never touch the network.
//
// Run: node --test packages/clash-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = ['get_clash_state', 'get_clash_leaderboard', 'enlist_faction', 'rally_faction'];

// The two write tools and their honest annotations.
const WRITE_TOOLS = new Set(['enlist_faction', 'rally_faction']);

test('exactly the expected tools are registered', () => {
	assert.equal(TOOLS.length, 4);
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

test('read tools are read-only, live, non-idempotent and explicitly non-destructive', () => {
	for (const tool of TOOLS) {
		if (WRITE_TOOLS.has(tool.name)) continue;
		assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
		// Live board/leaderboard data is never idempotent — power moves between calls.
		assert.equal(tool.annotations.idempotentHint, false, `${tool.name} reads live data, not idempotent`);
		assert.equal(
			tool.annotations.destructiveHint,
			false,
			`${tool.name} is read-only, so destructiveHint must be an explicit false`,
		);
	}
});

test('write tools set readOnlyHint:false and are not destructive (no funds move)', () => {
	for (const name of WRITE_TOOLS) {
		const tool = TOOLS.find((t) => t.name === name);
		assert.ok(tool, `${name} should exist`);
		assert.equal(tool.annotations.readOnlyHint, false, `${name} mutates game state — readOnlyHint must be false`);
		assert.notEqual(tool.annotations.destructiveHint, true, `${name} moves no funds — must not be destructive`);
	}
});

test('enlist is idempotent (re-mints an equivalent pass); rally is not (appends power)', () => {
	const enlist = TOOLS.find((t) => t.name === 'enlist_faction');
	const rally = TOOLS.find((t) => t.name === 'rally_faction');
	assert.equal(enlist.annotations.idempotentHint, true, 'enlist_faction should be idempotent');
	assert.equal(rally.annotations.idempotentHint, false, 'rally_faction appends power — not idempotent');
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
