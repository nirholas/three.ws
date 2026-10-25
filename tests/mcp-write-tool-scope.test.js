// Tools that write (mint an NFT, generate a garment) must demand avatars:write
// from a session or key. Only a caller who paid the per-call x402 price may
// stand in without the scope.

import { describe, it, expect } from 'vitest';
import { toolDefs as tokenizeDefs } from '../api/_mcp/tools/tokenize.js';
import { toolDefs as garmentDefs } from '../api/_mcp/tools/garments.js';
import { toolScopeSatisfied } from '../api/_mcp/dispatch.js';

const byName = (defs, n) => defs.find((d) => d.name === n);

describe('write tools declare a scope', () => {
	it('mint_3d_asset and generate_garment require avatars:write', () => {
		expect(byName(tokenizeDefs, 'mint_3d_asset').scope).toBe('avatars:write');
		expect(byName(garmentDefs, 'generate_garment').scope).toBe('avatars:write');
	});
});

describe('toolScopeSatisfied', () => {
	const tool = { scope: 'avatars:write' };
	it('rejects a read-only key', () => {
		expect(toolScopeSatisfied(tool, { source: 'api_key', scope: 'avatars:read' }, 'mint_3d_asset')).toBe(false);
	});
	it('accepts a key holding the scope', () => {
		expect(toolScopeSatisfied(tool, { source: 'api_key', scope: 'avatars:write' }, 'mint_3d_asset')).toBe(true);
	});
	it('accepts an x402 caller who paid the priced tool', () => {
		expect(toolScopeSatisfied(tool, { source: 'x402', scope: '', x402Paid: true }, 'mint_3d_asset')).toBe(true);
	});
	it('rejects an x402 caller who has not paid per call', () => {
		expect(toolScopeSatisfied(tool, { source: 'x402', scope: '' }, 'mint_3d_asset')).toBe(false);
	});
});
