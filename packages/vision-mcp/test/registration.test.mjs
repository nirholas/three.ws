// Tool-surface invariants for @three-ws/vision-mcp.
//
// Importing src/index.js is side-effect-free: the stdio transport only
// connects when the file is the process entry point, and buildServer() needs
// no key or signer. These tests run offline — they never touch the network.
//
// Run: node --test packages/vision-mcp/test/registration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, buildServer } from '../src/index.js';
import { buildVisionBody } from '../src/lib/image.js';

const EXPECTED_NAMES = ['analyze_image', 'describe_image', 'get_vision_status'];

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

test('every tool is a read-only, live-data query', () => {
	for (const tool of TOOLS) {
		assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
		assert.equal(tool.annotations.openWorldHint, true, `${tool.name} talks to a live model`);
		// A VLM is non-deterministic and the live provider chain moves — never idempotent.
		assert.equal(tool.annotations.idempotentHint, false, `${tool.name} is non-deterministic, not idempotent`);
	}
});

test('read-only tools set destructiveHint: false explicitly (spec default is TRUE when omitted)', () => {
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

test('buildVisionBody validates image input at the boundary', () => {
	// Exactly one source is required.
	assert.throws(() => buildVisionBody({ prompt: 'hi' }), /image is required/);
	assert.throws(
		() => buildVisionBody({ imageUrl: 'https://three.ws/a.png', image: 'AAAA' }),
		/not both/,
	);
	// URL: https only, no private hosts.
	assert.throws(() => buildVisionBody({ imageUrl: 'http://three.ws/a.png' }), /https/);
	assert.throws(() => buildVisionBody({ imageUrl: 'https://localhost/a.png' }), /public host/);
	assert.throws(() => buildVisionBody({ imageUrl: 'https://192.168.1.5/a.png' }), /public host/);
	// Base64: must be valid base64.
	assert.throws(() => buildVisionBody({ image: 'not valid base64 !!!' }), /base64/);

	// Happy paths produce the endpoint's body shape.
	const url = buildVisionBody({ imageUrl: 'https://three.ws/render.png', prompt: 'what is this?' });
	assert.equal(url.source, 'url');
	assert.equal(url.body.imageUrl, 'https://three.ws/render.png');
	assert.equal(url.body.prompt, 'what is this?');

	const b64 = buildVisionBody({ image: 'iVBORw0KGgo=', imageType: 'image/png', maxTokens: 99999 });
	assert.equal(b64.source, 'base64');
	assert.equal(b64.body.image, 'iVBORw0KGgo=');
	assert.equal(b64.body.imageType, 'image/png');
	// maxTokens clamped to the endpoint's ceiling.
	assert.equal(b64.body.maxTokens, 2048);

	// data: URI carries its own mime type.
	const dataUri = buildVisionBody({ image: 'data:image/webp;base64,UklGRg==' });
	assert.equal(dataUri.body.imageType, 'image/webp');
	assert.equal(dataUri.body.image, 'UklGRg==');
});
