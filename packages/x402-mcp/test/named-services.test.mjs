// Named commerce tools (order 521): one MCP tool per entry in ../src/tools.json,
// built by ../src/tools/named-services.js. These tests run offline: schema
// validation never touches the network, and the "dry run" test stubs
// globalThis.fetch so no real HTTP call and no signing happens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { NAMED_SERVICE_TOOLS } from '../src/tools/named-services.js';
import { jsonSchemaToZodShape } from '../src/lib/json-schema-to-zod.js';
import registry from '../src/tools.json' with { type: 'json' };

test('every registry entry became a named tool, 1:1', () => {
	assert.equal(NAMED_SERVICE_TOOLS.length, registry.tools.length);
	assert.deepEqual(
		new Set(NAMED_SERVICE_TOOLS.map((t) => t.name)),
		new Set(registry.tools.map((e) => e.name)),
	);
});

test('every named tool has a title, a price-stating description, a schema and a handler', () => {
	for (const tool of NAMED_SERVICE_TOOLS) {
		assert.equal(typeof tool.title, 'string', `${tool.name} is missing a title`);
		assert.match(tool.description, /^\[\$\d+(\.\d+)? USDC per call\]/, `${tool.name} description must state its price`);
		assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `${tool.name} is missing inputSchema`);
		assert.equal(typeof tool.handler, 'function', `${tool.name} is missing a handler`);
	}
});

test('named tools are execution tools: openWorldHint true, destructiveHint explicit', () => {
	for (const tool of NAMED_SERVICE_TOOLS) {
		assert.equal(tool.annotations.openWorldHint, true, `${tool.name} must set openWorldHint (pays a real external-feeling endpoint)`);
		assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} spends money, not read-only`);
		assert.equal(tool.annotations.destructiveHint, true, `${tool.name} must set destructiveHint explicitly`);
	}
});

test('every entry\'s inputSchema converts to a valid zod shape that accepts its own required fields', () => {
	for (const entry of registry.tools) {
		const shape = jsonSchemaToZodShape(entry.inputSchema);
		const schema = z.object(shape);
		const sample = sampleFor(entry.inputSchema);
		const parsed = schema.safeParse(sample);
		assert.ok(parsed.success, `${entry.name}: sample args ${JSON.stringify(sample)} should validate, got ${JSON.stringify(parsed.error?.issues)}`);
	}
});

test('a required field missing from the input fails validation', () => {
	for (const entry of registry.tools) {
		const required = entry.inputSchema.required || [];
		if (!required.length) continue;
		const shape = jsonSchemaToZodShape(entry.inputSchema);
		const schema = z.object(shape);
		const sample = sampleFor(entry.inputSchema);
		delete sample[required[0]];
		const parsed = schema.safeParse(sample);
		assert.equal(parsed.success, false, `${entry.name}: dropping required field "${required[0]}" should fail validation`);
	}
});

test('dry run: calling a named tool without confirm:true prices it and pays nothing (no fetch beyond the probe)', async () => {
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	try {
		for (const entry of registry.tools) {
			const tool = NAMED_SERVICE_TOOLS.find((t) => t.name === entry.name);
			const atomics = String(Math.round(entry.priceUsd * 1_000_000));
			globalThis.fetch = async () => {
				fetchCalls += 1;
				return new Response(
					JSON.stringify({
						x402Version: 2,
						accepts: [
							{
								scheme: 'exact',
								network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
								amount: atomics,
								asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
								extra: { name: 'USDC', decimals: 6 },
							},
						],
					}),
					{ status: 402, headers: { 'content-type': 'application/json' } },
				);
			};

			const before = fetchCalls;
			const result = await tool.handler({ ...sampleFor(entry.inputSchema), secret: 'dry-run-not-a-real-key' });

			assert.equal(result.ok, false, `${entry.name}: dry run should refuse without confirm`);
			assert.equal(result.error, 'confirm_required', `${entry.name}: dry run should ask for confirm`);
			assert.match(result.message, new RegExp(`\\$${entry.priceUsd}`), `${entry.name}: dry run must state the price $${entry.priceUsd}`);
			assert.equal(fetchCalls, before + 1, `${entry.name}: dry run should make exactly one probe call, no payment`);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/** Minimal valid arguments for a JSON Schema object, covering every required field. */
function sampleFor(schema) {
	const sample = {};
	for (const [key, prop] of Object.entries(schema.properties || {})) {
		if (!(schema.required || []).includes(key)) continue;
		sample[key] = sampleValue(prop);
	}
	return sample;
}

function sampleValue(prop) {
	if (Array.isArray(prop.enum)) return prop.enum[0];
	switch (prop.type) {
		case 'string':
			return 'example';
		case 'integer':
			return prop.minimum ?? 1;
		case 'number':
			return prop.minimum ?? 1;
		case 'boolean':
			return true;
		case 'array':
			return [sampleValue(prop.items || { type: 'string' })];
		default:
			return 'example';
	}
}
