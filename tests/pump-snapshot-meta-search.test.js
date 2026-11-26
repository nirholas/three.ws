// The pump_snapshot MCP tool (mcp-server) and the avatar-agent MCP package read
// coin metadata from GET frontend-api-v3.pump.fun/coins/<mint>, which pump.fun
// retired on 2026-11-25 (404 "Cannot GET"). Every paid snapshot came back with
// no name, image, creator or market cap. The search route keyed by the mint
// still carries the full record; only an exact mint match counts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const CREATOR = 'THREEsyntheticCreator111111111111111111111';

let seen;
beforeEach(() => {
	seen = [];
	vi.stubGlobal('fetch', vi.fn(async (url) => {
		const u = new URL(String(url));
		seen.push(u);
		if (u.hostname === 'frontend-api-v3.pump.fun' && u.pathname === '/coins/search-unrestricted' && u.searchParams.get('searchTerm') === THREE) {
			return new Response(JSON.stringify([
				{ mint: 'THREEsynthetic11111111111111111111111111pump', name: 'fuzzy' },
				{ mint: THREE, name: 'three.ws', symbol: 'three', creator: CREATOR, complete: true, usd_market_cap: 425045.9, pool_address: 'PoolSynthetic', program: 'pump' },
			]), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (u.pathname === '/coins/search-unrestricted') return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
		return new Response(JSON.stringify({ statusCode: 404, message: 'Cannot GET' }), { status: 404, headers: { 'content-type': 'application/json' } });
	}));
});
afterEach(() => vi.unstubAllGlobals());

const expected = { name: 'three.ws', symbol: 'three', creator: CREATOR, complete: true, marketCapUsd: 425045.9, poolAddress: 'PoolSynthetic', program: 'pump' };

describe('pump.fun coin metadata via search', () => {
	it('mcp-server pump_snapshot', async () => {
		const { getPumpFunMeta } = await import('../mcp-server/src/tools/pump-snapshot.js');
		expect(await getPumpFunMeta(THREE)).toMatchObject(expected);
		expect(seen.some((u) => u.pathname === `/coins/${THREE}`)).toBe(false);
	});

	it('avatar-agent-mcp', async () => {
		const { getPumpFunMeta } = await import('../packages/avatar-agent-mcp/src/lib/pumpfun.js');
		expect(await getPumpFunMeta(THREE)).toMatchObject(expected);
		expect(seen.some((u) => u.pathname === `/coins/${THREE}`)).toBe(false);
	});

	it('a mint the search does not return is null, not a fuzzy neighbour', async () => {
		const { getPumpFunMeta } = await import('../packages/avatar-agent-mcp/src/lib/pumpfun.js');
		expect(await getPumpFunMeta('THREEsynthetic22222222222222222222222222pump')).toBeNull();
	});
});
