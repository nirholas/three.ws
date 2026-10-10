// Tool-surface invariants for @three-ws/loom-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only connects
// when the file is the process entry point, and buildServer() needs no key. These
// tests run offline — they never touch the network.
//
// Run: node --test packages/loom-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';
import { validateGlbUrl, viewerUrl, decorateCreation } from '../src/lib/viewer.js';

const EXPECTED_NAMES = ['get_loom_feed', 'get_creation', 'submit_creation'];
const WRITE_NAMES = new Set(['submit_creation']);

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

test('read tools are read-only with an explicit destructiveHint:false; the write tool is marked correctly', () => {
	for (const tool of TOOLS) {
		const expectWrite = WRITE_NAMES.has(tool.name);
		assert.equal(tool.annotations.readOnlyHint, !expectWrite, `${tool.name} readOnlyHint should be ${!expectWrite}`);
		if (!expectWrite) {
			// The spec defaults an omitted destructiveHint to true, so reads say false out loud.
			assert.equal(tool.annotations.destructiveHint, false, `${tool.name} is read-only, so destructiveHint must be an explicit false`);
			// Live feed/lookup move between calls — not idempotent.
			assert.equal(tool.annotations.idempotentHint, false, `${tool.name} reads live data, not idempotent`);
		}
	}
});

test('submit_creation is a non-idempotent, non-destructive public write', () => {
	const submit = TOOLS.find((t) => t.name === 'submit_creation');
	assert.ok(submit);
	assert.equal(submit.annotations.readOnlyHint, false);
	assert.equal(submit.annotations.idempotentHint, false);
	assert.equal(submit.annotations.destructiveHint, false);
});

test('validateGlbUrl enforces https + the host allowlist', () => {
	// Accepted hosts (mirror api/loom.js)
	assert.ok(validateGlbUrl('https://three.ws/models/x.glb'));
	assert.ok(validateGlbUrl('https://pub-abc.r2.dev/x.glb'));
	assert.ok(validateGlbUrl('https://replicate.delivery/abc/x.glb'));
	assert.ok(validateGlbUrl('https://raw.githubusercontent.com/o/r/main/x.glb'));
	// Rejected: http, bad host, garbage
	assert.equal(validateGlbUrl('http://three.ws/x.glb'), null);
	assert.equal(validateGlbUrl('https://evil.example.com/x.glb'), null);
	assert.equal(validateGlbUrl('not-a-url'), null);
	assert.equal(validateGlbUrl(''), null);
	assert.equal(validateGlbUrl(null), null);
	// No suffix-spoofing: notthree.ws must not pass as three.ws
	assert.equal(validateGlbUrl('https://notthree.ws/x.glb'), null);
});

test('decorateCreation adds a /forge/embed viewer URL + iframe', () => {
	const d = decorateCreation({ id: 'abc', prompt: 'a red cube', glbUrl: 'https://three.ws/x.glb', createdAt: 1 });
	assert.ok(d.viewer_url.startsWith('https://three.ws/forge/embed?src='));
	assert.ok(d.viewer_url.includes('title='));
	assert.ok(d.iframe_snippet.includes('<iframe'));
	assert.ok(d.og_image_url.includes('/api/avatar-og?src='));
	// A record without a GLB still decorates cleanly (nulls, no throw).
	const n = decorateCreation({ id: 'x' });
	assert.equal(n.viewer_url, null);
	assert.equal(decorateCreation(null), null);
});

test('viewerUrl encodes the GLB into the src param', () => {
	const u = viewerUrl('https://three.ws/a b.glb');
	assert.ok(u.includes('src=https'));
	assert.ok(!u.includes('a b.glb')); // space must be encoded
});

test('buildServer registers every tool with its annotations, without a key', () => {
	const server = buildServer();
	const registered = server._registeredTools;
	assert.ok(registered, 'McpServer should expose its tool registry');
	for (const tool of TOOLS) {
		const entry = registered[tool.name];
		assert.ok(entry, `${tool.name} not registered on the server`);
		assert.deepEqual(entry.annotations, tool.annotations, `${tool.name} annotations must survive registration`);
	}
});
