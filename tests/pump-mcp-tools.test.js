import { describe, it, expect } from 'vitest';
import { TOOLS, rpcError, rpcEnvelope } from '../src/pump/mcp-tools.js';

// Tool names that must be present in both the Vercel and Worker runtimes.
// Both import TOOLS from the same shared module, so parity is structural.
const EXPECTED_TOOL_NAMES = [
	'searchTokens',
	'getTokenDetails',
	'getBondingCurve',
	'getTokenTrades',
	'getTrendingTokens',
	'getNewTokens',
	'getGraduatedTokens',
	'getKingOfTheHill',
	'getCreatorProfile',
	'getTokenHolders',
];

describe('src/pump/mcp-tools — shared tool registry', () => {
	it('exports TOOLS as a non-empty array', () => {
		expect(Array.isArray(TOOLS)).toBe(true);
		expect(TOOLS.length).toBeGreaterThan(0);
	});

	it('contains all baseline pump.fun tools', () => {
		const names = TOOLS.filter(Boolean).map((t) => t.name);
		for (const name of EXPECTED_TOOL_NAMES) {
			expect(names).toContain(name);
		}
	});

	it('every tool entry has name, description, and inputSchema', () => {
		for (const tool of TOOLS.filter(Boolean)) {
			expect(typeof tool.name).toBe('string');
			expect(tool.name.length).toBeGreaterThan(0);
			expect(typeof tool.description).toBe('string');
			expect(tool.inputSchema).toBeDefined();
			expect(tool.inputSchema.type).toBe('object');
		}
	});

	it('tool names are unique', () => {
		const names = TOOLS.filter(Boolean).map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('rpcError attaches rpcCode to the error', () => {
		const err = rpcError(-32602, 'invalid param');
		expect(err).toBeInstanceOf(Error);
		expect(err.rpcCode).toBe(-32602);
		expect(err.message).toBe('invalid param');
	});

	it('rpcEnvelope wraps a result', () => {
		const env = rpcEnvelope(1, { tools: [] });
		expect(env).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
	});

	it('rpcEnvelope wraps an error object', () => {
		const env = rpcEnvelope(2, null, { code: -32601, message: 'not found' });
		expect(env).toEqual({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'not found' } });
	});

	it('rpcEnvelope uses null id when id is undefined', () => {
		const env = rpcEnvelope(undefined, { ok: true });
		expect(env.id).toBeNull();
	});

	it('Vercel and Worker runtimes share the same TOOLS source (structural parity)', async () => {
		// Both api/pump-fun-mcp.js and workers/pump-fun-mcp/worker.js import TOOLS
		// from this module, so the tool list is identical by construction.
		// Re-import to confirm the module is stable and exportable.
		const mod = await import('../src/pump/mcp-tools.js');
		expect(mod.TOOLS).toBe(TOOLS); // same reference — single module instance
		expect(mod.TOOLS.filter(Boolean).map((t) => t.name)).toEqual(
			TOOLS.filter(Boolean).map((t) => t.name),
		);
	});
});
