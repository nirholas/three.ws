// The pump-fun-skills scripts (swap, coin-fees, create-coin) share one
// lib/coin-api.mjs, copied byte-identical into each skill. Its fetchCoinV2 read
// GET frontend-api-v3.pump.fun/coins-v2/<mint>, which pump.fun retired on
// 2026-11-25 (404 for every mint, $THREE included), so `fetch-coin` failed for
// every coin. The coin record is now read from pump.fun's search route, keyed
// by the mint, taking only the exact match because search also returns fuzzy
// hits for other coins. PUMP_COINS_V2_BASE still reads <base>/<mint> for a
// devnet backend.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const OTHER = 'THREEsynthetic11111111111111111111111111pump';
const SKILLS = ['swap', 'coin-fees', 'create-coin'];

const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('pump-fun-skills lib/coin-api.mjs', () => {
	it('is byte-identical across the three skills', () => {
		const copies = SKILLS.map((s) => readFileSync(`pump-fun-skills/${s}/scripts/lib/coin-api.mjs`, 'utf8'));
		expect(new Set(copies).size).toBe(1);
	});

	for (const skill of SKILLS) {
		it(`${skill}: reads the coin from pump.fun search and keeps only the exact mint`, async () => {
			const seen = [];
			vi.stubGlobal('fetch', vi.fn(async (url) => {
				seen.push(new URL(String(url)));
				return respond(200, [{ mint: OTHER, name: 'fuzzy' }, { mint: THREE_MINT, name: 'three.ws', complete: true, bonding_curve: 'BC' }]);
			}));
			const { fetchCoinV2 } = await import(`../pump-fun-skills/${skill}/scripts/lib/coin-api.mjs`);
			const coin = await fetchCoinV2(THREE_MINT);
			expect(coin).toMatchObject({ mint: THREE_MINT, name: 'three.ws', complete: true });
			expect(seen[0].origin).toBe('https://frontend-api-v3.pump.fun');
			expect(seen[0].pathname).toBe('/coins/search-unrestricted');
			expect(seen[0].searchParams.get('searchTerm')).toBe(THREE_MINT);
		});
	}

	it('says so when pump.fun has no coin with that mint', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => respond(200, [{ mint: OTHER }])));
		const { fetchCoinV2 } = await import('../pump-fun-skills/swap/scripts/lib/coin-api.mjs');
		await expect(fetchCoinV2(THREE_MINT)).rejects.toThrow(/no coin with mint/);
	});

	it('reads <base>/<mint> when PUMP_COINS_V2_BASE names a devnet backend', async () => {
		vi.stubEnv('PUMP_COINS_V2_BASE', 'https://devnet.example/coins-v2/');
		const seen = [];
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			seen.push(new URL(String(url)));
			return respond(200, { mint: OTHER, complete: false });
		}));
		const { fetchCoinV2 } = await import('../pump-fun-skills/coin-fees/scripts/lib/coin-api.mjs');
		expect(await fetchCoinV2(OTHER)).toMatchObject({ mint: OTHER });
		expect(seen[0].href).toBe(`https://devnet.example/coins-v2/${OTHER}`);
	});
});
