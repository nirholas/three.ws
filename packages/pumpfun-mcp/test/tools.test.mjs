// Tool-surface invariants for the vendored fallback catalog and the local
// annotations overlay. Every tool this bridge advertises must be a complete,
// explicitly read-only MCP tool definition — a new entry without annotations
// (or one marked destructive) fails here before it can ship.
//
// Run: node --test packages/pumpfun-mcp/test/tools.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
	FALLBACK_TOOLS,
	TOOL_ANNOTATIONS,
	TOOL_NAME_ALIASES,
	resolveToolName,
	alternateToolName,
} from '../src/tools.js';
import { NATIVE_TOOLS } from '../src/native.js';

test('FALLBACK_TOOLS is a non-empty array', () => {
	assert.ok(Array.isArray(FALLBACK_TOOLS));
	assert.ok(FALLBACK_TOOLS.length > 0);
});

test('every fallback tool has name, description, inputSchema, title', () => {
	for (const tool of FALLBACK_TOOLS) {
		assert.equal(typeof tool.name, 'string', 'name must be a string');
		assert.ok(tool.name.length > 0, 'name must be non-empty');
		assert.equal(typeof tool.description, 'string', `${tool.name}: description`);
		assert.ok(tool.description.length > 0, `${tool.name}: description non-empty`);
		assert.ok(tool.inputSchema, `${tool.name}: inputSchema`);
		assert.equal(tool.inputSchema.type, 'object', `${tool.name}: inputSchema.type`);
		assert.equal(typeof tool.title, 'string', `${tool.name}: title`);
		assert.ok(tool.title.length > 0, `${tool.name}: title non-empty`);
	}
});

test('every fallback tool carries read-only MCP annotations', () => {
	for (const tool of FALLBACK_TOOLS) {
		const a = tool.annotations;
		assert.ok(a && typeof a === 'object', `${tool.name}: annotations object`);
		assert.equal(typeof a.readOnlyHint, 'boolean', `${tool.name}: readOnlyHint boolean`);
		assert.equal(a.readOnlyHint, true, `${tool.name}: must be read-only`);
		// destructiveHint defaults to true in the MCP spec when omitted — this
		// surface must set it explicitly false, never true.
		assert.equal(a.destructiveHint, false, `${tool.name}: destructiveHint must be false`);
		assert.equal(typeof a.idempotentHint, 'boolean', `${tool.name}: idempotentHint boolean`);
		assert.equal(typeof a.openWorldHint, 'boolean', `${tool.name}: openWorldHint boolean`);
	}
});

test('fallback tool names are unique', () => {
	const names = FALLBACK_TOOLS.map((t) => t.name);
	assert.equal(new Set(names).size, names.length);
});

test('TOOL_ANNOTATIONS covers every fallback tool name', () => {
	for (const tool of FALLBACK_TOOLS) {
		assert.ok(
			Object.hasOwn(TOOL_ANNOTATIONS, tool.name),
			`${tool.name}: missing from TOOL_ANNOTATIONS overlay map`,
		);
	}
});

test('semantic spot checks: deterministic and local-compute tools', () => {
	assert.equal(TOOL_ANNOTATIONS.sns_resolve.idempotentHint, true);
	assert.equal(TOOL_ANNOTATIONS.sns_reverseLookup.idempotentHint, true);
	// Pure lexicon scorer: deterministic and closed-world.
	assert.equal(TOOL_ANNOTATIONS.social_cashtag_sentiment.idempotentHint, true);
	assert.equal(TOOL_ANNOTATIONS.social_cashtag_sentiment.openWorldHint, false);
	// Vanity grind: local compute, fresh keypair every call.
	assert.equal(TOOL_ANNOTATIONS.pumpfun_vanity_mint.idempotentHint, false);
	assert.equal(TOOL_ANNOTATIONS.pumpfun_vanity_mint.openWorldHint, false);
});

test('resolveToolName maps every legacy alias to canonical and passes others through', () => {
	for (const [legacy, canonical] of Object.entries(TOOL_NAME_ALIASES)) {
		assert.equal(resolveToolName(legacy), canonical);
		// Canonical names are already resolved — they must not change.
		assert.equal(resolveToolName(canonical), canonical);
	}
	assert.equal(resolveToolName('some_unknown_tool'), 'some_unknown_tool');
	assert.equal(resolveToolName(42), 42, 'non-strings pass through untouched');
});

test('resolveToolName never resolves inherited object members', () => {
	for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
		assert.equal(resolveToolName(name), name, `${name} must pass through unresolved`);
	}
});

test('alternateToolName round-trips both spellings and rejects everything else', () => {
	for (const [legacy, canonical] of Object.entries(TOOL_NAME_ALIASES)) {
		assert.equal(alternateToolName(legacy), canonical);
		assert.equal(alternateToolName(canonical), legacy);
	}
	assert.equal(alternateToolName('pumpfun_vanity_mint'), null, 'unaliased tools have no alternate');
	assert.equal(alternateToolName('nope'), null);
	assert.equal(alternateToolName(undefined), null);
	assert.equal(alternateToolName(123), null);
});

test('every alias targets an advertised canonical tool; legacy spellings are not advertised', () => {
	const advertised = new Set(FALLBACK_TOOLS.map((t) => t.name));
	for (const [legacy, canonical] of Object.entries(TOOL_NAME_ALIASES)) {
		assert.ok(advertised.has(canonical), `${canonical} missing from FALLBACK_TOOLS`);
		assert.ok(!advertised.has(legacy), `legacy name ${legacy} must not be advertised`);
	}
});

test('inputSchema integrity: required fields exist and defaults respect their bounds', () => {
	for (const tool of FALLBACK_TOOLS) {
		const { properties = {}, required = [] } = tool.inputSchema;
		for (const field of required) {
			assert.ok(
				Object.hasOwn(properties, field),
				`${tool.name}: required field "${field}" missing from properties`,
			);
		}
		for (const [field, schema] of Object.entries(properties)) {
			if (schema.default === undefined || typeof schema.default !== 'number') continue;
			if (typeof schema.minimum === 'number') {
				assert.ok(schema.default >= schema.minimum, `${tool.name}.${field}: default below minimum`);
			}
			if (typeof schema.maximum === 'number') {
				assert.ok(schema.default <= schema.maximum, `${tool.name}.${field}: default above maximum`);
			}
			if (schema.enum) {
				assert.ok(schema.enum.includes(schema.default), `${tool.name}.${field}: default not in enum`);
			}
		}
	}
});

// A pump.fun coin is priced by the bonding curve before graduation and by the
// PumpSwap pool after it. Both accounts now carry a field spelled
// virtual_quote_reserves, and they are NOT the same quantity. These tools are
// read by a model with no human in the loop, so each pricing tool has to say
// which account it reads. Dropping that wording is a real regression: it lets a
// caller apply pool math to curve reserves (or vice versa) and get a confidently
// wrong price with no error anywhere.
const byName = (name) => {
	const tool = FALLBACK_TOOLS.find((t) => t.name === name);
	assert.ok(tool, `${name}: missing from FALLBACK_TOOLS`);
	return tool;
};

test('get_bonding_curve documents the renamed quote-side curve fields', () => {
	const tool = byName('get_bonding_curve');
	assert.match(tool.description, /bonding[- ]curve account/i);
	assert.match(tool.description, /virtual_quote_reserves/);
	// The rename is the trap: a decoder still reading virtual_sol_reserves gets
	// undefined, which coerces to a 0 price rather than throwing.
	assert.match(tool.description, /virtual_sol_reserves/);
	// Reserve fields must name their on-chain source so the rename is traceable.
	const props = tool.outputSchema.properties;
	assert.match(props.solReserves.description, /real_quote_reserves/);
	assert.match(props.virtualSolReserves.description, /virtual_quote_reserves/);
});

test('pumpfun_quote_swap documents pricing against effective quote reserves', () => {
	const tool = byName('pumpfun_quote_swap');
	// effective = vault balance + pool.virtual_quote_reserves.
	assert.match(tool.description, /effective/i);
	assert.match(tool.description, /pool\.virtual_quote_reserves/);
	assert.match(tool.description, /pool_quote_token_account\.amount/);
	// The base side is explicitly unchanged upstream, so the description says so.
	// Without it, a reader may "symmetrically" add a virtual figure to the base.
	assert.match(tool.description, /pool_base_token_account\.amount/);
	assert.match(tool.outputSchema.properties.priceImpactBps.description, /effective quote reserve/i);
});

// Since 2026-09-30 Pool.virtual_quote_reserves is commonly negative: PumpSwap v2
// trades keep waiting protocol and creator fees in the quote vault and subtract
// them there. A model told the field is "0 on most pools" or allowed to read it
// unsigned overstates depth by exactly the waiting fees.
test('pumpfun_quote_swap says virtual_quote_reserves is signed and commonly negative', () => {
	const tool = byName('pumpfun_quote_swap');
	const props = tool.outputSchema.properties;
	assert.match(tool.description, /signed/i);
	assert.match(tool.description, /negative/i);
	const virt = props.virtual_quote_reserves.description;
	assert.match(virt, /i128/);
	assert.match(virt, /signed/i);
	assert.match(virt, /negative/i);
	assert.match(virt, /never unsigned/i);
	assert.match(virt, /never clamped/i);
	// The stale claim that non-boost pools always read 0 must not come back.
	assert.doesNotMatch(virt, /0 on non-boost pools/);
	assert.doesNotMatch(tool.description, /non-zero on launchpad coins/);
	// The raw vault includes fees waiting for a sweep, so it is not depth.
	assert.match(props.quote_reserve.description, /waiting/i);
	assert.match(props.effective_quote_reserve.description, /never negative/i);
});

test('get_bonding_curve documents the synthetic migration handoff', () => {
	const tool = byName('get_bonding_curve');
	assert.match(tool.description, /v3 buy/);
	assert.match(tool.description, /synthetic migration/i);
	assert.match(tool.description, /complete=true/);
});

test('claim tools explain that v3 and v2 creator fees appear only once swept', () => {
	const tool = byName('pumpfun_list_claims');
	assert.match(tool.description, /sweep_creator_fee/);
	assert.match(tool.description, /creator vault/);
});

test('native composed tools carry the same annotation contract', () => {
	assert.ok(NATIVE_TOOLS.length > 0);
	const fallbackNames = new Set(FALLBACK_TOOLS.map((t) => t.name));
	for (const { def } of NATIVE_TOOLS) {
		assert.ok(!fallbackNames.has(def.name), `${def.name}: collides with a fallback tool`);
		assert.equal(typeof def.title, 'string', `${def.name}: title`);
		const a = def.annotations;
		assert.ok(a && typeof a === 'object', `${def.name}: annotations object`);
		assert.equal(a.readOnlyHint, true, `${def.name}: must be read-only`);
		assert.equal(a.destructiveHint, false, `${def.name}: destructiveHint must be false`);
		assert.equal(typeof a.idempotentHint, 'boolean', `${def.name}: idempotentHint boolean`);
		assert.equal(typeof a.openWorldHint, 'boolean', `${def.name}: openWorldHint boolean`);
	}
});

test('server instructions only reference tools that actually exist', async () => {
	const src = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
	const match = src.match(/instructions:\s*((?:'[^']*'\s*\+?\s*)+)/);
	assert.ok(match, 'instructions string found in src/index.js');
	const instructions = match[1].match(/'([^']*)'/g).map((s) => s.slice(1, -1)).join('');
	const advertised = new Set([
		...FALLBACK_TOOLS.map((t) => t.name),
		...NATIVE_TOOLS.map(({ def }) => def.name),
	]);
	const mentioned = instructions.match(/[a-z][a-zA-Z0-9]*_[a-zA-Z0-9_]+/g) || [];
	assert.ok(mentioned.length >= 10, 'instructions should name the tool catalog');
	for (const name of mentioned) {
		assert.ok(advertised.has(name), `instructions mention unknown tool: ${name}`);
	}
});
