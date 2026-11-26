// Claim alerts score a GitHub fee claim against the coin it was claimed for:
// the repo linked in the coin's description, website or socials, its creator,
// name and market cap (the impersonation check). That record came from
// GET /coins-v2/<mint>, which pump.fun retired on 2026-11-25 (404), so every
// claim lost its repo and impersonation evidence. The search route still
// carries description, website and twitter, keyed by the mint.
import { describe, it, expect, vi, afterEach } from 'vitest';

const { resolveCoinGithubContext } = await import('../api/_lib/pump-claims-github.js');

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const CREATOR = 'THREEsyntheticCreator111111111111111111111';

afterEach(() => vi.unstubAllGlobals());

describe('resolveCoinGithubContext', () => {
	it('reads the coin from the search route, exact mint only', async () => {
		const seen = [];
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			const u = new URL(String(url));
			seen.push(u);
			if (u.hostname === 'frontend-api-v3.pump.fun' && u.pathname === '/coins/search-unrestricted' && u.searchParams.get('searchTerm') === THREE) {
				return new Response(JSON.stringify([
					{ mint: 'THREEsynthetic11111111111111111111111111pump', name: 'fuzzy', creator: 'someone' },
					{ mint: THREE, name: 'three.ws', creator: CREATOR, usd_market_cap: 423737.4, description: 'agents', website: 'https://three.ws' },
				]), { status: 200 });
			}
			return new Response(JSON.stringify({ statusCode: 404 }), { status: 404 });
		}));
		const out = await resolveCoinGithubContext(THREE);
		expect(out).toMatchObject({ creatorWallet: CREATOR, tokenName: 'three.ws', usdMarketCap: 423737.4 });
		expect(seen.some((u) => u.pathname.startsWith('/coins-v2/'))).toBe(false);
	});
});
