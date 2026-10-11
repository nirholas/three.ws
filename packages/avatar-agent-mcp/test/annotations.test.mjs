// MCP ToolAnnotations invariants — this test pins the safety semantics of the
// whole tool surface. MCP clients use these hints to decide which calls need a
// human confirmation prompt, so an unannotated tool (or a mis-flagged
// execution tool) is a safety regression, not a style nit.
//
// Importing src/index.js is side-effect-free: the stdio transport only
// connects when the file is the process entry point, and buildServer()
// requires no env secrets.
//
// Run: node --test packages/avatar-agent-mcp/test/annotations.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

// The ONLY tools allowed to carry destructiveHint: true — they sign and
// broadcast irreversible Solana mainnet transactions. Adding an execution tool?
// Add it here deliberately, in the same commit.
const EXECUTION_TOOLS = new Set(['wallet_send', 'pump_buy', 'pump_launch', 'pump_collect_fees']);

// Read-only surface: inspect/derive/fetch, never mutate.
const READ_ONLY_TOOLS = new Set([
	'inspect_glb',
	'validate_glb',
	'optimize_glb',
	'thumbnail_glb',
	'viewer_url',
	'list_avatars',
	'list_animations',
	'render_avatar',
	'pump_snapshot',
	'wallet_balance',
	'ens_sns_resolve',
	// Previews and quotes sign nothing and move nothing: they are what a client
	// shows the user before the matching execution tool runs.
	'wallet_send_preview',
	'pump_buy_quote',
	'pump_launch_preview',
	'pump_collect_preview',
]);

// Deterministic reads — same inputs, same answer — may advertise idempotency.
const IDEMPOTENT_TOOLS = new Set([
	'inspect_glb',
	'validate_glb',
	'optimize_glb',
	'thumbnail_glb',
	'viewer_url',
	'list_avatars',
	'render_avatar',
]);

test('exactly 24 tools are registered', () => {
	assert.equal(TOOLS.length, 24);
	assert.equal(new Set(TOOLS.map((t) => t.name)).size, 24, 'tool names must be unique');
});

test('every tool has a human title and a complete annotations object', () => {
	for (const tool of TOOLS) {
		assert.equal(typeof tool.title, 'string', `${tool.name} is missing a title`);
		assert.ok(tool.title.length > 0, `${tool.name} has an empty title`);
		assert.ok(tool.annotations, `${tool.name} is missing MCP ToolAnnotations`);
		assert.equal(
			typeof tool.annotations.readOnlyHint,
			'boolean',
			`${tool.name} must set readOnlyHint explicitly`,
		);
		assert.equal(
			typeof tool.annotations.idempotentHint,
			'boolean',
			`${tool.name} must set idempotentHint explicitly`,
		);
		assert.equal(
			typeof tool.annotations.openWorldHint,
			'boolean',
			`${tool.name} must set openWorldHint explicitly`,
		);
	}
});

test('writes always set destructiveHint explicitly (spec default is TRUE when omitted)', () => {
	for (const tool of TOOLS) {
		if (tool.annotations.readOnlyHint === false) {
			assert.equal(
				typeof tool.annotations.destructiveHint,
				'boolean',
				`${tool.name} is a write — destructiveHint must be explicit, never defaulted`,
			);
		}
	}
});

test('the destructive set is EXACTLY the four on-chain execution tools', () => {
	const destructive = TOOLS.filter((t) => t.annotations.destructiveHint === true).map(
		(t) => t.name,
	);
	assert.deepEqual(new Set(destructive), EXECUTION_TOOLS);
});

test('read tools advertise readOnlyHint: true; writes do not', () => {
	for (const tool of TOOLS) {
		const expected = READ_ONLY_TOOLS.has(tool.name);
		assert.equal(
			tool.annotations.readOnlyHint,
			expected,
			`${tool.name} readOnlyHint should be ${expected}`,
		);
	}
});

test('idempotency is only claimed by deterministic reads', () => {
	for (const tool of TOOLS) {
		const expected = IDEMPOTENT_TOOLS.has(tool.name);
		assert.equal(
			tool.annotations.idempotentHint,
			expected,
			`${tool.name} idempotentHint should be ${expected}`,
		);
	}
});

test('wallet_create is the only closed-world tool (local keypair generation)', () => {
	for (const tool of TOOLS) {
		const expected = tool.name !== 'wallet_create';
		assert.equal(
			tool.annotations.openWorldHint,
			expected,
			`${tool.name} openWorldHint should be ${expected}`,
		);
	}
});

test('execution tools are never marked read-only or idempotent', () => {
	for (const name of EXECUTION_TOOLS) {
		const tool = TOOLS.find((t) => t.name === name);
		assert.ok(tool, `${name} must exist in the tool registry`);
		assert.equal(tool.annotations.readOnlyHint, false);
		assert.equal(tool.annotations.idempotentHint, false);
	}
});

test('buildServer registers every tool with its annotations, without env secrets', () => {
	const server = buildServer();
	// McpServer keeps its registry in _registeredTools (name → RegisteredTool).
	const registered = server._registeredTools;
	assert.ok(registered, 'McpServer should expose its tool registry');
	for (const tool of TOOLS) {
		const entry = registered[tool.name];
		assert.ok(entry, `${tool.name} not registered on the server`);
		assert.deepEqual(
			entry.annotations,
			tool.annotations,
			`${tool.name} annotations must survive registration`,
		);
	}
});
