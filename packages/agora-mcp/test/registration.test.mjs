// Tool-surface invariants for @three-ws/agora-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only connects
// when the file is the process entry point, and buildServer() needs no key or
// signer. The write tools import @three-ws/solana-agent LAZILY (only inside their
// handlers), so the whole tool surface loads — and these tests run — without the
// SDK build present and without ever touching the network or signing anything.
//
// Run: node --test packages/agora-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';

const READ_TOOLS = ['agora_board', 'agora_pulse', 'agora_citizens', 'agora_passport', 'agora_professions'];
const WRITE_TOOLS = ['agora_register', 'agora_claim_task', 'agora_complete_task', 'agora_post_task'];
const EXPECTED_NAMES = [...READ_TOOLS, ...WRITE_TOOLS];

const byName = (name) => TOOLS.find((t) => t.name === name);

test('exactly the expected read + write tools are registered', () => {
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
	}
});

test('read tools are read-only, live-data queries (openWorld, non-idempotent, no destructiveHint)', () => {
	for (const name of READ_TOOLS) {
		const tool = byName(name);
		assert.equal(tool.annotations.readOnlyHint, true, `${name} should be read-only`);
		assert.equal(tool.annotations.openWorldHint, true, `${name} talks to a live service`);
		assert.equal(tool.annotations.idempotentHint, false, `${name} reads live data, not idempotent`);
		// A read is never destructive; state it explicitly rather than leaning on the spec default.
		assert.equal(tool.annotations.destructiveHint, false, `${name} is read-only, so destructiveHint must be an explicit false`);
	}
});

test('write tools are honestly NOT read-only and talk to the live chain', () => {
	for (const name of WRITE_TOOLS) {
		const tool = byName(name);
		assert.equal(tool.annotations.readOnlyHint, false, `${name} performs a real on-chain action — not read-only`);
		assert.equal(tool.annotations.openWorldHint, true, `${name} writes to the live chain`);
	}
});

test('only agora_register is idempotent (reconciles an existing registration)', () => {
	assert.equal(byName('agora_register').annotations.idempotentHint, true);
	for (const name of ['agora_claim_task', 'agora_complete_task', 'agora_post_task']) {
		assert.equal(byName(name).annotations.idempotentHint, false, `${name} mutates fresh on-chain state each call`);
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

test('write-tool descriptions promise the key is never logged/stored/transmitted', () => {
	for (const name of WRITE_TOOLS) {
		const d = byName(name).description.toLowerCase();
		assert.ok(/never logged/.test(d), `${name} must state the signing key is never logged`);
	}
});

test('$THREE is the only coin referenced in tool descriptions (and only its mint)', () => {
	const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
	for (const tool of TOOLS) {
		// Any base58-ish token-address-shaped string must be the $THREE mint.
		const candidates = tool.description.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || [];
		for (const c of candidates) {
			assert.equal(c, THREE_MINT, `${tool.name} references a non-$THREE mint-shaped string: ${c}`);
		}
		// No competitor symbol slipped in: only $THREE / SOL / USDC are allowed coin words.
		assert.ok(!/\bSPL token\b/.test(tool.description) || /SPL `?mint/.test(tool.description), `${tool.name} mentions SPL token without a runtime-mint qualifier`);
	}
});
