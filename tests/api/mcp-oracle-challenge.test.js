// The hosted Oracle MCP endpoint (api/mcp-oracle.js) must advertise its OWN
// bazaar discovery example in the 402 envelope. ORACLE_CHALLENGE once carried a
// description and service name but no `bazaar` block, so build402Body fell back
// to the main /api/mcp example: a validate_model call on a GLB. Every x402
// indexer that crawled /api/mcp-oracle saw a 3D validation server whose sample
// call does not exist on this endpoint.

import { describe, it, expect } from 'vitest';
import { ORACLE_CHALLENGE } from '../../api/_mcporacle/discovery.js';
import { TOOL_CATALOG, isPublicTool } from '../../api/_mcporacle/catalog.js';
import { build402Body } from '../../api/_lib/x402-spec.js';

const ORACLE_TOOL_NAMES = new Set(TOOL_CATALOG.map((t) => t.name));

describe('Oracle MCP 402 discovery', () => {
	it('carries its own bazaar extension', () => {
		expect(ORACLE_CHALLENGE.bazaar).toBeTruthy();
		expect(ORACLE_CHALLENGE.bazaar.discoverable).toBe(true);
	});

	it('the sample call names a free tool this server actually serves', () => {
		const call = ORACLE_CHALLENGE.bazaar?.info?.input?.body;
		expect(call?.method).toBe('tools/call');
		expect(ORACLE_TOOL_NAMES.has(call?.params?.name)).toBe(true);
		expect(isPublicTool(call?.params?.name)).toBe(true);
	});

	it('the built 402 envelope never advertises a 3D tool', async () => {
		const envelope = await build402Body({
			resourceUrl: 'https://three.ws/api/mcp-oracle',
			accepts: [],
			...ORACLE_CHALLENGE,
		});
		const serialized = JSON.stringify(envelope.extensions.bazaar);
		expect(serialized).not.toMatch(/validate_model|inspect_model|\.glb/);
		expect(envelope.extensions.bazaar.info.input.body.params.name).toMatch(/^oracle_/);
	});

	it('the method description lists only Oracle tool names', () => {
		const desc = ORACLE_CHALLENGE.bazaar?.schema?.properties?.input?.properties?.body?.properties?.params?.description || '';
		const named = desc.match(/\boracle_[a-z_]+/g) || [];
		expect(named.length).toBeGreaterThan(0);
		for (const n of named) expect(ORACLE_TOOL_NAMES.has(n)).toBe(true);
	});
});
