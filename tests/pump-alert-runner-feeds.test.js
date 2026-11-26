// The pump alert cron (whale-buy and price rules) and agent automations read
// coins and trades through pump-alert-runner. On 2026-11-25 pump.fun retired
// both routes it used: GET /coins-v2/<mint> answers 404 and /trades/all/<mint>
// rejects every request (400 "chainId must match"), so price rules never
// priced a coin and whale rules never saw a buy. Coins now come from the
// search route (exact mint) and trades from the shared Solana trade feed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const feed = vi.hoisted(() => ({ trades: vi.fn() }));
vi.mock('../api/_lib/pump-feed-fetch.js', async (orig) => ({ ...(await orig()), fetchPumpTrades: (...a) => feed.trades(...a) }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
vi.mock('../api/_lib/alert-delivery.js', () => ({ deliverAlert: vi.fn() }));
vi.mock('../api/_lib/market-anomaly-store.js', () => ({ queryMarketAnomalies: vi.fn(async () => []) }));
vi.mock('../api/_lib/sol-price.js', () => ({ solPriceUsd: vi.fn(async () => 150) }));

const { fetchRecentTrades, fetchAlertCoin } = await import('../api/_lib/pump-alert-runner.js');

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const TS = 1_790_000_000;

let urls;
beforeEach(() => {
	urls = [];
	feed.trades.mockReset();
	vi.stubGlobal('fetch', vi.fn(async (url) => {
		urls.push(String(url));
		const u = new URL(String(url));
		if (u.pathname === '/coins/search-unrestricted' && u.searchParams.get('searchTerm') === THREE) {
			return new Response(JSON.stringify([{ mint: 'THREEsynthetic11111111111111111111111111pump', name: 'fuzzy' }, { mint: THREE, name: 'three.ws', symbol: 'three', usd_market_cap: 423737.4 }]), { status: 200 });
		}
		return new Response(JSON.stringify({ statusCode: 404 }), { status: 404 });
	}));
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchRecentTrades', () => {
	it('reads the shared Solana trade feed in the alert shape (SOL, USD, Date)', async () => {
		feed.trades.mockResolvedValue({
			rows: [
				{ signature: 'sigA', type: 'buy', amountSol: 12, amountUsd: 1800, userAddress: 'THREEsynthetic1111', timestamp: TS },
				{ signature: 'sigB', type: 'sell', amountSol: 2, amountUsd: null, userAddress: 'THREEsynthetic2222', timestamp: TS - 5 },
			],
			stale: false,
		});
		const out = await fetchRecentTrades(THREE, 150);
		expect(feed.trades).toHaveBeenCalledWith(THREE, { limit: 50 });
		expect(out).toEqual([
			{ signature: 'sigA', is_buy: true, sol_amount: 12, sol_value_usd: 1800, buyer: 'THREEsynthetic1111', ts: new Date(TS * 1000) },
			{ signature: 'sigB', is_buy: false, sol_amount: 2, sol_value_usd: 300, buyer: 'THREEsynthetic2222', ts: new Date((TS - 5) * 1000) },
		]);
		expect(urls.filter((u) => u.includes('/trades/all'))).toEqual([]);
	});

	it('returns no trades when the read fails', async () => {
		feed.trades.mockResolvedValue(null);
		expect(await fetchRecentTrades(THREE, 150)).toEqual([]);
	});
});

describe('fetchAlertCoin', () => {
	it('prices the coin from the search route, exact mint only', async () => {
		expect(await fetchAlertCoin(THREE)).toEqual({ mint: THREE, name: 'three.ws', symbol: 'three', market_cap_usd: 423737.4 });
		expect(urls.some((u) => u.includes('/coins-v2/'))).toBe(false);
	});
});
