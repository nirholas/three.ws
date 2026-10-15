// Tool-surface invariants for @three-ws/x402-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only connects
// when the file is the process entry point, and buildServer() needs no signer.
// These tests run offline — they never touch the network or sign anything.
//
// Run: node --test packages/x402-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';
import registry from '../src/tools.json' with { type: 'json' };

const NAMED_SERVICE_NAMES = registry.tools.map((entry) => entry.name);
const READ_ONLY_TOOLS = new Set(['x402_wallet', 'find_services', 'inspect_endpoint', 'spending_report']);
const EXECUTION_TOOLS = new Set(['pay_and_call', ...NAMED_SERVICE_NAMES]);

test('exactly the expected tools are registered', () => {
	assert.equal(TOOLS.length, 5 + NAMED_SERVICE_NAMES.length);
	assert.deepEqual(
		new Set(TOOLS.map((t) => t.name)),
		new Set(['x402_wallet', 'find_services', 'inspect_endpoint', 'pay_and_call', 'spending_report', ...NAMED_SERVICE_NAMES]),
	);
});

test('every tool has a title, description, input schema and complete annotations', () => {
	for (const tool of TOOLS) {
		assert.equal(typeof tool.title, 'string', `${tool.name} is missing a title`);
		assert.ok(tool.title.length > 0, `${tool.name} has an empty title`);
		assert.equal(typeof tool.description, 'string', `${tool.name} is missing a description`);
		assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `${tool.name} is missing inputSchema`);
		assert.equal(typeof tool.handler, 'function', `${tool.name} is missing a handler`);
		assert.ok(tool.annotations, `${tool.name} is missing MCP ToolAnnotations`);
		assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', `${tool.name} must set readOnlyHint`);
		assert.equal(typeof tool.annotations.idempotentHint, 'boolean', `${tool.name} must set idempotentHint`);
		assert.equal(typeof tool.annotations.openWorldHint, 'boolean', `${tool.name} must set openWorldHint`);
	}
});

test('the read tools advertise readOnlyHint', () => {
	for (const name of READ_ONLY_TOOLS) {
		const tool = TOOLS.find((t) => t.name === name);
		assert.ok(tool, `${name} must exist`);
		assert.equal(tool.annotations.readOnlyHint, true, `${name} should be read-only`);
	}
});

test('the live-service read tools advertise openWorldHint; the local-only ledger tool does not', () => {
	for (const name of ['x402_wallet', 'find_services', 'inspect_endpoint']) {
		const tool = TOOLS.find((t) => t.name === name);
		assert.equal(tool.annotations.openWorldHint, true, `${name} talks to a live service`);
	}
	const spendingReport = TOOLS.find((t) => t.name === 'spending_report');
	assert.equal(spendingReport.annotations.openWorldHint, false, 'spending_report only reads a local file');
});

test('pay_and_call and the named service tools are the only destructive execution tools (spend real USDC)', () => {
	const destructive = TOOLS.filter((t) => t.annotations.destructiveHint === true).map((t) => t.name);
	assert.deepEqual(new Set(destructive), EXECUTION_TOOLS);
	for (const name of EXECUTION_TOOLS) {
		const tool = TOOLS.find((t) => t.name === name);
		assert.equal(tool.annotations.readOnlyHint, false, `${name} should not be read-only`);
		assert.equal(tool.annotations.destructiveHint, true, `${name} should be destructive`);
		assert.equal(tool.annotations.idempotentHint, false, `${name} should not be idempotent`);
	}
});

test('non-read-only tools set destructiveHint explicitly (spec default is TRUE when omitted)', () => {
	for (const tool of TOOLS) {
		if (tool.annotations.readOnlyHint === false) {
			assert.equal(typeof tool.annotations.destructiveHint, 'boolean', `${tool.name} must set destructiveHint`);
		}
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
