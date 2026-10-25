import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

import { defineTool } from '../src/define-tool.js';
import { defineExecutor } from '../src/define-executor.js';
import { toMcpTools } from '../src/mcp-adapter.js';
import { guardedFetch, createRateLimiter, normalizePermissions } from '../src/permissions.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTool(overrides = {}) {
	return defineTool({
		id: 'test-org-price-feed',
		title: 'Test Price Feed',
		description: 'Fetches token prices from a test API.',
		version: '1.0.0',
		permissions: { network: ['api.example.com'] },
		apis: [
			{
				name: 'getPrice',
				description: 'Get the current USD price for a token symbol.',
				parameters: z.object({ symbol: z.string().min(1).describe('Token ticker, e.g. "ETH"') }),
			},
		],
		...overrides,
	});
}

// ---------------------------------------------------------------------------
// defineTool: schema -> JSON Schema conversion
// ---------------------------------------------------------------------------

describe('defineTool', () => {
	test('converts each api Zod schema to a JSON Schema on the manifest', () => {
		const tool = makeTool();
		expect(tool.manifest.id).toBe('test-org-price-feed');
		expect(tool.manifest.apis).toHaveLength(1);

		const [api] = tool.manifest.apis;
		expect(api.name).toBe('getPrice');
		expect(api.parameters).toMatchObject({
			type: 'object',
			properties: {
				symbol: { type: 'string', minLength: 1, description: 'Token ticker, e.g. "ETH"' },
			},
			required: ['symbol'],
		});
		// z.toJSONSchema's `$schema` meta key must be stripped.
		expect(api.parameters.$schema).toBeUndefined();
	});

	test('normalizes permissions onto the manifest', () => {
		const tool = makeTool();
		expect(tool.manifest.permissions).toEqual({
			network: ['api.example.com'],
			rateLimit: null,
			wallet: false,
		});
	});

	test('keeps the original Zod schema on _apis for executor validation', () => {
		const tool = makeTool();
		expect(tool._apis[0].parametersZod).toBeInstanceOf(z.ZodObject);
	});

	test('throws on missing required config fields', () => {
		expect(() => defineTool({})).toThrow(/"id"/);
		expect(() => defineTool({ id: 'x' })).toThrow(/"title"/);
		expect(() =>
			defineTool({ id: 'x', title: 'X', description: 'd', version: '1.0.0', apis: [] }),
		).toThrow(/non-empty array/);
	});

	test('throws on duplicate api names', () => {
		expect(() =>
			makeTool({
				apis: [
					{ name: 'getPrice', description: 'a', parameters: z.object({}) },
					{ name: 'getPrice', description: 'b', parameters: z.object({}) },
				],
			}),
		).toThrow(/duplicate api name/);
	});
});

// ---------------------------------------------------------------------------
// defineExecutor: validation + success/error wrapping
// ---------------------------------------------------------------------------

describe('defineExecutor', () => {
	test('validates params against the Zod schema before invoking the method', async () => {
		const tool = makeTool();
		const method = vi.fn(async ({ symbol }) => ({ symbol, price: 100 }));
		const executor = defineExecutor(tool, { getPrice: method });

		const result = await executor.invoke('getPrice', {});
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('INVALID_PARAMS');
		expect(result.error.message).toMatch(/symbol/);
		expect(method).not.toHaveBeenCalled();
	});

	test('wraps a plain return value into { success: true, content, state }', async () => {
		const tool = makeTool();
		const executor = defineExecutor(tool, {
			async getPrice({ symbol }) {
				return { symbol, price: 42 };
			},
		});

		const result = await executor.invoke('getPrice', { symbol: 'ETH' });
		expect(result).toEqual({
			success: true,
			content: { symbol: 'ETH', price: 42 },
			state: { symbol: 'ETH', price: 42 },
		});
	});

	test('passes through an implementation-returned full result envelope unchanged', async () => {
		const tool = makeTool();
		const envelope = { success: true, content: 'custom content', state: { raw: true } };
		const executor = defineExecutor(tool, { async getPrice() { return envelope; } });

		const result = await executor.invoke('getPrice', { symbol: 'ETH' });
		expect(result).toBe(envelope);
	});

	test('wraps a thrown error into { success: false, error: { message, code } }', async () => {
		const tool = makeTool();
		const executor = defineExecutor(tool, {
			async getPrice() {
				throw Object.assign(new Error('upstream exploded'), { code: 'upstream_error' });
			},
		});

		const result = await executor.invoke('getPrice', { symbol: 'ETH' });
		expect(result.success).toBe(false);
		expect(result.error.message).toBe('upstream exploded');
		expect(result.error.code).toBe('upstream_error');
		expect(result.content).toMatch(/getPrice failed: upstream exploded/);
	});

	test('rejects unknown API names without touching the implementation', async () => {
		const tool = makeTool();
		const executor = defineExecutor(tool, { async getPrice() { return {}; } });

		const result = await executor.invoke('nonexistent', {});
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('API_NOT_FOUND');
	});

	test('rejects a declared api with no implemented method', async () => {
		const tool = makeTool();
		const executor = defineExecutor(tool, {});

		const result = await executor.invoke('getPrice', { symbol: 'ETH' });
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('METHOD_NOT_IMPLEMENTED');
	});

	test('getApiNames / hasApi reflect the tool manifest', () => {
		const tool = makeTool();
		const executor = defineExecutor(tool, { async getPrice() { return {}; } });
		expect(executor.getApiNames()).toEqual(['getPrice']);
		expect(executor.hasApi('getPrice')).toBe(true);
		expect(executor.hasApi('nope')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Rate limiting (fake timers)
// ---------------------------------------------------------------------------

describe('rate limiting', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test('createRateLimiter allows up to `calls` within the window, then blocks', () => {
		const limiter = createRateLimiter({ calls: 2, perSeconds: 60 });
		expect(limiter.tryTake('k', 0)).toBe(true);
		expect(limiter.tryTake('k', 0)).toBe(true);
		expect(limiter.tryTake('k', 0)).toBe(false);
	});

	test('createRateLimiter refills tokens over time', () => {
		const limiter = createRateLimiter({ calls: 1, perSeconds: 10 });
		expect(limiter.tryTake('k', 0)).toBe(true);
		expect(limiter.tryTake('k', 1000)).toBe(false); // 1s elapsed, not enough to refill 1 token over 10s
		expect(limiter.tryTake('k', 10_000)).toBe(true); // full window elapsed -> refilled
	});

	test('createRateLimiter returns null when no rate limit is declared', () => {
		expect(createRateLimiter(null)).toBeNull();
		expect(createRateLimiter(undefined)).toBeNull();
	});

	test('defineExecutor enforces the tool-declared rate limit per API name', async () => {
		const tool = makeTool({ permissions: { rateLimit: { calls: 1, perSeconds: 60 } } });
		const method = vi.fn(async ({ symbol }) => ({ symbol, price: 1 }));
		const executor = defineExecutor(tool, { getPrice: method });

		const first = await executor.invoke('getPrice', { symbol: 'ETH' });
		expect(first.success).toBe(true);

		const second = await executor.invoke('getPrice', { symbol: 'ETH' });
		expect(second.success).toBe(false);
		expect(second.error.code).toBe('RATE_LIMITED');
		expect(method).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// guardedFetch
// ---------------------------------------------------------------------------

describe('guardedFetch', () => {
	const originalFetch = globalThis.fetch;
	beforeEach(() => {
		globalThis.fetch = vi.fn(async () => new Response('ok'));
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test('allows a request to an allowlisted host', async () => {
		const fetchGuarded = guardedFetch({ network: ['api.example.com'] });
		await fetchGuarded('https://api.example.com/v1/price');
		expect(globalThis.fetch).toHaveBeenCalledWith('https://api.example.com/v1/price', undefined);
	});

	test('denies a request to a host outside the allowlist', async () => {
		const fetchGuarded = guardedFetch({ network: ['api.example.com'] });
		await expect(fetchGuarded('https://evil.example.net/steal')).rejects.toMatchObject({
			code: 'NETWORK_NOT_ALLOWED',
			hostname: 'evil.example.net',
		});
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	test('denies everything when no network permission is declared (deny-by-default)', async () => {
		const fetchGuarded = guardedFetch({});
		await expect(fetchGuarded('https://api.example.com/v1/price')).rejects.toMatchObject({
			code: 'NETWORK_NOT_ALLOWED',
		});
	});

	test('normalizePermissions dedupes hosts and drops invalid rate limits', () => {
		expect(normalizePermissions({ network: ['a.com', 'a.com', 'b.com'] })).toEqual({
			network: ['a.com', 'b.com'],
			rateLimit: null,
			wallet: false,
		});
		expect(normalizePermissions({ rateLimit: { calls: 0, perSeconds: 60 } }).rateLimit).toBeNull();
		expect(normalizePermissions({ rateLimit: { calls: 5, perSeconds: 60 } }).rateLimit).toEqual({
			calls: 5,
			perSeconds: 60,
		});
	});
});

// ---------------------------------------------------------------------------
// toMcpTools: adapter output shape vs. the repo's current registration format
// ---------------------------------------------------------------------------

describe('toMcpTools', () => {
	// Fixture mirrors packages/naming-mcp/src/tools/sns-resolve.js's `def` shape
	// exactly, so this test doubles as a regression guard on the adapter contract.
	const CURRENT_REGISTRATION_FIXTURE_KEYS = ['name', 'title', 'description', 'inputSchema', 'annotations', 'handler'];

	function makeAnnotatedTool() {
		return defineTool({
			id: 'sns-resolve',
			title: 'Resolve a .sol name to its owner wallet',
			description: 'Resolve a Solana Name Service (.sol) name to the base58 wallet address that owns it.',
			version: '1.0.0',
			permissions: { network: ['three.ws'] },
			apis: [
				{
					name: 'sns_resolve',
					description: 'Resolve a .sol name to its owner wallet.',
					annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
					parameters: z.object({
						name: z.string().min(1).describe('A .sol label to resolve.'),
					}),
				},
			],
		});
	}

	test('produces one MCP tool def per api, matching the current registration keys exactly', () => {
		const tool = makeAnnotatedTool();
		const executor = defineExecutor(tool, { async sns_resolve({ name }) { return { ok: true, name, address: null, resolved: false }; } });

		const defs = toMcpTools(tool, executor);
		expect(defs).toHaveLength(1);
		expect(Object.keys(defs[0]).sort()).toEqual(CURRENT_REGISTRATION_FIXTURE_KEYS.sort());
	});

	test('inputSchema is a raw Zod shape (not JSON Schema) — what McpServer.registerTool expects', () => {
		const tool = makeAnnotatedTool();
		const executor = defineExecutor(tool, { async sns_resolve({ name }) { return { name }; } });
		const [def] = toMcpTools(tool, executor);

		expect(def.inputSchema.name).toBeInstanceOf(z.ZodType);
		// A raw shape has no `type`/`properties` at the top level (unlike JSON Schema).
		expect(def.inputSchema.type).toBeUndefined();
	});

	test('annotations pass through per-api, with a safe default when omitted', () => {
		const tool = makeAnnotatedTool();
		const executor = defineExecutor(tool, { async sns_resolve() { return {}; } });
		const [def] = toMcpTools(tool, executor);
		expect(def.annotations).toEqual({ readOnlyHint: true, idempotentHint: false, openWorldHint: true });

		const unannotated = defineTool({
			id: 'x', title: 'X', description: 'd', version: '1.0.0',
			apis: [{ name: 'op', description: 'd', parameters: z.object({}) }],
		});
		const unannotatedExecutor = defineExecutor(unannotated, { async op() { return {}; } });
		expect(toMcpTools(unannotated, unannotatedExecutor)[0].annotations).toEqual({
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: true,
		});
	});

	test('handler returns the content on success (matching hand-written tool handlers)', async () => {
		const tool = makeAnnotatedTool();
		const executor = defineExecutor(tool, {
			async sns_resolve({ name }) {
				return { ok: true, name, address: 'Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v', resolved: true };
			},
		});
		const [def] = toMcpTools(tool, executor);

		const out = await def.handler({ name: 'bonfida' });
		expect(out).toEqual({ ok: true, name: 'bonfida', address: 'Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v', resolved: true });
	});

	test('handler throws on failure (matching hand-written tools whose server wrapper try/catches)', async () => {
		const tool = makeAnnotatedTool();
		const executor = defineExecutor(tool, {
			async sns_resolve() {
				throw Object.assign(new Error('three.ws /api/sns timed out after 20000ms'), { code: 'timeout' });
			},
		});
		const [def] = toMcpTools(tool, executor);

		await expect(def.handler({ name: 'bonfida' })).rejects.toMatchObject({
			message: 'three.ws /api/sns timed out after 20000ms',
			code: 'timeout',
		});
	});

	test('throws a clear error if an api parameter schema is not a z.object', () => {
		const badTool = defineTool({
			id: 'bad', title: 'Bad', description: 'd', version: '1.0.0',
			apis: [{ name: 'op', description: 'd', parameters: z.string() }],
		});
		const executor = defineExecutor(badTool, { async op() { return {}; } });
		expect(() => toMcpTools(badTool, executor)).toThrow(/z\.object/);
	});
});
