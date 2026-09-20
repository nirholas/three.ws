// tokenForPool(): the pair -> token resolver behind /api/coin/pair.
//
// Three things are pinned here, each of them a real trap rather than an
// implementation detail:
//
//   1. The dex id must NOT go through bareId(). Every token relationship id
//      GeckoTerminal returns is network-prefixed ("solana_<mint>") and the
//      module strips that prefix; the dex relationship is NOT prefixed, so
//      running it through the same helper silently turns "pump_fun" into "fun".
//   2. The DexScreener rung has to carry the whole answer. GeckoTerminal does
//      not index a pair for its first minutes of life, which is exactly the
//      window a freshly launched coin is being looked at in, so the fallback is
//      the common path for new pairs rather than an outage-only one.
//   3. A miss everywhere keeps GeckoTerminal's 404 verdict, so the route can
//      tell "no such market" apart from "we could not ask".

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/cache.js', () => ({
	cacheWrapLastGood: async (_key, _ttl, load) => load(),
}));

const fetchUpstream = vi.fn();
vi.mock('../../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: (...a) => fetchUpstream(...a),
}));

const { tokenForPool } = await import('../../api/_lib/market/ohlcv.js');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const WSOL = 'So11111111111111111111111111111111111111112';

const geckoOk = (body) => ({ text: async () => JSON.stringify(body) });
const tagged = (status) => Object.assign(new Error(`GeckoTerminal ${status}`), { status });

// A trimmed capture of GeckoTerminal's pool response, include= and all.
function geckoPool({ pool, dex }) {
	return {
		data: {
			id: `solana_${pool}`,
			attributes: { address: pool, name: 'three / SOL' },
			relationships: {
				base_token: { data: { id: `solana_${MINT}` } },
				quote_token: { data: { id: `solana_${WSOL}` } },
				dex: { data: { id: dex } },
			},
		},
		included: [
			{ id: `solana_${MINT}`, attributes: { name: 'three.ws', symbol: 'three' } },
			{ id: `solana_${WSOL}`, attributes: { name: 'Wrapped SOL', symbol: 'SOL' } },
		],
	};
}

describe('tokenForPool', () => {
	beforeEach(() => {
		fetchUpstream.mockReset();
		globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 }));
	});

	it('resolves the base token, the quote and their metadata from one call', async () => {
		const pool = 'CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa';
		fetchUpstream.mockResolvedValue(geckoOk(geckoPool({ pool, dex: 'meteora' })));

		const market = await tokenForPool(pool, 'solana');
		expect(market.pool).toBe(pool);
		expect(market.token).toEqual({ address: MINT, name: 'three.ws', symbol: 'three' });
		expect(market.quote.symbol).toBe('SOL');
		expect(market.pairName).toBe('three / SOL');
		// The metadata is only there because the request asks for it.
		expect(fetchUpstream.mock.calls[0][0]).toContain('include=base_token,quote_token');
	});

	it('keeps an underscored dex id whole', async () => {
		const pool = 'THREEsynthetic1111111111111111111111111pair1';
		fetchUpstream.mockResolvedValue(geckoOk(geckoPool({ pool, dex: 'pump_fun' })));

		const market = await tokenForPool(pool, 'solana');
		expect(market.dex).toBe('pump_fun');
	});

	it('falls back to DexScreener for a pair GeckoTerminal has not indexed', async () => {
		const pool = 'THREEsynthetic1111111111111111111111111pair2';
		fetchUpstream.mockRejectedValue(tagged(404));
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						pairs: [
							{
								chainId: 'solana',
								dexId: 'raydium',
								pairAddress: pool,
								baseToken: { address: MINT, name: 'three.ws', symbol: 'three' },
								quoteToken: { address: WSOL, name: 'Wrapped SOL', symbol: 'SOL' },
							},
						],
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
		);

		const market = await tokenForPool(pool, 'solana');
		expect(market.token.address).toBe(MINT);
		expect(market.dex).toBe('raydium');
		expect(market.pairName).toBe('three / SOL');
		expect(globalThis.fetch.mock.calls[0][0]).toContain('/latest/dex/pairs/solana/');
	});

	it('asks DexScreener for its own chain slug, not GeckoTerminal’s', async () => {
		// "polygon_pos" is a GeckoTerminal id DexScreener has never heard of. An
		// identity fallback made every rung-2 lookup on this chain a silent miss.
		const pool = '0xabcdef0123456789abcdef0123456789abcdef01';
		fetchUpstream.mockRejectedValue(tagged(404));
		globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 }));

		await expect(tokenForPool(pool, 'polygon_pos')).rejects.toThrow();
		expect(globalThis.fetch.mock.calls[0][0]).toContain('/latest/dex/pairs/polygon/');
	});

	it('keeps the 404 verdict when no source knows the pool', async () => {
		const pool = 'THREEsynthetic1111111111111111111111111pair3';
		fetchUpstream.mockRejectedValue(tagged(404));

		await expect(tokenForPool(pool, 'solana')).rejects.toMatchObject({ status: 404 });
	});

	it('surfaces an outage as 502 rather than pretending the pool is unknown', async () => {
		const pool = 'THREEsynthetic1111111111111111111111111pair4';
		fetchUpstream.mockRejectedValue(tagged(503));

		await expect(tokenForPool(pool, 'solana')).rejects.toMatchObject({ status: 502 });
	});
});
