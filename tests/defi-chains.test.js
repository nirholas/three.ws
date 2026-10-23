import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchUpstream = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', () => ({ fetchUpstream: (...a) => fetchUpstream(...a) }));
vi.mock('../api/_lib/rate-limit.js', () => ({ limits: {}, clientIp: () => '0' }));

const { sumChainVolumes, normalizeChainKey } = await import('../api/defi/dex-volumes.js');
const { turnover, buildChains } = await import('../api/defi/chains.js');

const ok = (body) => ({ json: async () => body });

describe('turnover', () => {
	it('divides volume by TVL', () => expect(turnover(50, 100)).toBe(0.5));
	it('is null, never Infinity, when TVL is missing', () => {
		expect(turnover(50, 0)).toBeNull();
		expect(turnover(50, NaN)).toBeNull();
	});
	it('is null when no volume is reported', () => {
		expect(turnover(null, 100)).toBeNull();
		expect(turnover(0, 100)).toBeNull();
	});
});

describe('sumChainVolumes', () => {
	it('sums across protocols and normalizes chain keys', () => {
		const out = sumChainVolumes([
			{ breakdown24h: { arbitrum_nova: { A: 10, B: 5 }, ethereum: { A: 100 } } },
			{ breakdown24h: { ethereum: { C: 50 } } },
			{},
		]);
		expect(out).toEqual({ arbitrumnova: 15, ethereum: 150 });
		expect(normalizeChainKey('Arbitrum Nova')).toBe('arbitrumnova');
	});
});

describe('buildChains', () => {
	beforeEach(() => fetchUpstream.mockReset());

	it('joins DEX volume into each chain as turnover', async () => {
		fetchUpstream.mockImplementation(async (url) =>
			String(url).includes('overview/dexs')
				? ok({ total24h: 1, protocols: [{ breakdown24h: { ethereum: { A: 200 }, orphan: { A: 9 } } }] })
				: ok([
						{ name: 'Ethereum', tvl: 1000 },
						{ name: 'Base', tvl: 500 },
					]),
		);
		const { chains } = await buildChains();
		const eth = chains.find((c) => c.name === 'Ethereum');
		const base = chains.find((c) => c.name === 'Base');
		expect(eth.turnover).toBeCloseTo(0.2);
		expect(eth.dex_volume_24h).toBe(200);
		expect(base.turnover).toBeNull();
	});
});
