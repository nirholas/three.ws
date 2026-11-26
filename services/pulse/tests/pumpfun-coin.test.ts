// pump.fun retired GET /coins/<mint> on 2026-11-25 (404 for every mint), so
// pulse's /api/pump/:mint answered "not found" for every coin. The search route
// keyed by the mint still serves the full record; only an exact mint match counts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pumpCoin } from '../src/sources/pumpfun.ts';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('pumpCoin', () => {
  it('reads the coin from the search route and keeps only the exact mint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.pathname === '/coins/search-unrestricted' && u.searchParams.get('searchTerm') === THREE) {
        return json([
          { mint: 'THREEsynthetic11111111111111111111111111pump', name: 'fuzzy' },
          { mint: THREE, name: 'three.ws', symbol: 'three', ath_market_cap: 16_000_000 },
        ]);
      }
      return json({ statusCode: 404, message: 'Cannot GET' }, 404);
    }));
    expect(await pumpCoin(THREE)).toMatchObject({ mint: THREE, name: 'three.ws', ath_market_cap: 16_000_000 });
  });

  it('is null when the search has no exact match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([{ mint: 'THREEsynthetic11111111111111111111111111pump' }])));
    expect(await pumpCoin(THREE)).toBeNull();
  });
});
