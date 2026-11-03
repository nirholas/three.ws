// /.well-known/x402.json must answer from the last built catalog while the
// datapoint slice refreshes, instead of making the request that lands after the
// TTL wait on every upstream market feed. Production answered that request in
// 23 to 29 seconds (the smoke sweep timed out on it), then 1 second once warm.
// Every upstream feed is replaced here so the timing is deterministic and the
// test never touches the network.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

process.env.APP_ORIGIN = 'https://three.ws';

const feed = vi.hoisted(() => ({ calls: 0, next: null }));

vi.mock('../api/_lib/market-fallbacks.js', async (orig) => ({
	...(await orig()),
	fetchMarketsTable: async () => {
		feed.calls += 1;
		return feed.next();
	},
}));
vi.mock('../api/defi/protocols.js', () => ({
	buildProtocols: async () => ({ protocols: [{ slug: 'synthetic-protocol' }] }),
}));
vi.mock('../api/defi/yields.js', () => ({ loadYieldPools: async () => ({ pools: [] }) }));
vi.mock('../api/coin/exchanges.js', () => ({ buildExchanges: async () => ({ exchanges: [] }) }));
vi.mock('../api/_lib/market-data/datapoints.js', async (orig) => ({
	...(await orig()),
	allChains: async () => new Map(),
	allStablecoins: async () => new Map(),
	allCategories: async () => new Map(),
	allDexes: async () => new Map(),
	allFees: async () => new Map(),
	allDerivativeExchanges: async () => new Map(),
}));
vi.mock('../api/_lib/agent-paid-services.js', async (orig) => ({
	...(await orig()),
	listBazaarServices: async () => [],
}));
vi.mock('../api/_lib/agent-api-service.js', async (orig) => ({
	...(await orig()),
	listActiveAgentServices: async () => [],
}));

const { buildX402DiscoveryDoc } = await import('../api/wk.js');

const coinIds = (doc) =>
	new Set(
		doc.resources
			.map((r) => /^\/api\/x402\/d\/coin\/([^/]+)\//.exec(r.path || '')?.[1])
			.filter(Boolean),
	);

const firstIndex = (doc, family) =>
	doc.resources.findIndex((r) => (r.path || '').startsWith(`/api/x402/d/${family}/`));

const within = (promise, ms) =>
	Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))]);

let clock = Date.now();
beforeAll(() => {
	vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterAll(() => vi.restoreAllMocks());

describe('x402 discovery datapoint slice', () => {
	it('serves the stale slice immediately and refreshes it in the background', async () => {
		// Cold build: the coin feed is the slowest, yet its rows still come first.
		feed.next = async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			return { rows: [{ id: 'synthetic-coin-a' }] };
		};
		const first = await buildX402DiscoveryDoc();
		expect(coinIds(first).has('synthetic-coin-a')).toBe(true);
		expect(firstIndex(first, 'protocol')).toBeGreaterThan(firstIndex(first, 'coin'));
		const callsAfterFirst = feed.calls;

		// Past the 15-minute TTL, the upstream feed is slow.
		clock += 16 * 60 * 1000;
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		feed.next = async () => {
			await gate;
			return { rows: [{ id: 'synthetic-coin-b' }] };
		};

		const stale = await within(buildX402DiscoveryDoc(), 500);
		expect(stale).not.toBe('timeout');
		expect(coinIds(stale).has('synthetic-coin-a')).toBe(true);

		// Concurrent stale reads share one rebuild rather than each hitting the feed.
		await within(Promise.all([buildX402DiscoveryDoc(), buildX402DiscoveryDoc()]), 500);
		expect(feed.calls).toBe(callsAfterFirst + 1);

		release();
		await new Promise((resolve) => setTimeout(resolve, 20));
		const fresh = await buildX402DiscoveryDoc();
		expect(coinIds(fresh).has('synthetic-coin-b')).toBe(true);
	});
});
