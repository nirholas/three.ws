// Tool-surface invariants for @three-ws/autopilot-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only connects
// when the file is the process entry point, and buildServer() needs no key. These
// tests run offline — they never touch the network and need no credential.
//
// Run: node --test packages/autopilot-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const EXPECTED_NAMES = [
	'get_autopilot_config',
	'set_autopilot_config',
	'generate_proposals',
	'list_proposals',
	'dryrun_proposal',
	'adjust_proposal',
	'execute_proposal',
	'dismiss_proposal',
	'undo_action',
	'list_autopilot_activity',
	'compute_trust',
];

// The tools that perform a real write (mutate config / queue / take action).
const WRITE_NAMES = new Set([
	'set_autopilot_config',
	'generate_proposals',
	'adjust_proposal',
	'execute_proposal',
	'dismiss_proposal',
	'undo_action',
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

test('write tools are annotated readOnlyHint:false; read tools readOnlyHint:true', () => {
	for (const tool of TOOLS) {
		const expectWrite = WRITE_NAMES.has(tool.name);
		assert.equal(
			tool.annotations.readOnlyHint,
			!expectWrite,
			`${tool.name} readOnlyHint should be ${!expectWrite}`,
		);
	}
});

test('read-only tools set destructiveHint: false explicitly (a read is never destructive)', () => {
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

test('execute_proposal is the funds-moving, destructive write', () => {
	const exec = TOOLS.find((t) => t.name === 'execute_proposal');
	assert.ok(exec, 'execute_proposal must exist');
	assert.equal(exec.annotations.readOnlyHint, false, 'execute_proposal must be a write');
	assert.equal(exec.annotations.destructiveHint, true, 'execute_proposal must be flagged destructive');
	assert.equal(exec.annotations.idempotentHint, false, 'execute_proposal is not idempotent');
});

test('config + adjust writes are idempotent; action writes are not', () => {
	const idempotent = new Set(['set_autopilot_config', 'adjust_proposal']);
	for (const tool of TOOLS) {
		if (!WRITE_NAMES.has(tool.name)) continue;
		assert.equal(
			tool.annotations.idempotentHint,
			idempotent.has(tool.name),
			`${tool.name} idempotentHint should be ${idempotent.has(tool.name)}`,
		);
	}
});

test('buildServer registers every tool with its annotations, without a credential', () => {
	const server = buildServer();
	const registered = server._registeredTools;
	assert.ok(registered, 'McpServer should expose its tool registry');
	for (const tool of TOOLS) {
		const entry = registered[tool.name];
		assert.ok(entry, `${tool.name} not registered on the server`);
		assert.deepEqual(entry.annotations, tool.annotations, `${tool.name} annotations must survive registration`);
	}
});
