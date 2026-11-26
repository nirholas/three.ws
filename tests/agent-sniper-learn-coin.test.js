// The Coin Intelligence labeler reads each observed coin's outcome from
// pump.fun. Its /coins-v2/<mint> route went the way of /coins/<mint> on
// 2026-11-25 (404), and fetchCoin reads any non-2xx as "no data", so labeling
// stopped silently again and oracle_training_set froze. The search route keyed
// by the mint still serves the record; only an exact mint match counts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCoin } from '../workers/agent-sniper/intel/learn.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('agent-sniper fetchCoin', () => {
	it('reads the outcome fields from the search route', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			const u = new URL(String(url));
			if (u.pathname === '/coins/search-unrestricted' && u.searchParams.get('searchTerm') === THREE) {
				return json([
					{ mint: 'THREEsynthetic11111111111111111111111111pump', complete: false },
					{ mint: THREE, complete: true, pump_swap_pool: 'PoolSynthetic', usd_market_cap: 425045.9, market_cap: 2900, ath_market_cap: 16_000_000 },
				]);
			}
			return json({ statusCode: 404, message: 'Cannot GET' }, 404);
		}));
		expect(await fetchCoin(THREE)).toMatchObject({ mint: THREE, complete: true, pump_swap_pool: 'PoolSynthetic', ath_market_cap: 16_000_000 });
	});

	it('is null when the search has no exact match or fails', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json([{ mint: 'THREEsynthetic11111111111111111111111111pump' }])));
		expect(await fetchCoin(THREE)).toBeNull();
		vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'x' }, 503)));
		expect(await fetchCoin(THREE)).toBeNull();
	});
});
