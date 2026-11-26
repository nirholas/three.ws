// The paid pump signals (crypto-intel pump_trending and pump_volume_anomaly,
// and the whale sweep in /api/x402/pump-agent-audit) each fetched swap-api
// /v2/coins/<mint>/trades directly. pump.fun retired that route on 2026-11-25
// (410 "deprecated"), so trending scored zero trades, the anomaly detector
// answered 503 on every call, and the whale sweep found no wallets. They now
// read through fetchPumpTrades, which decodes trades from Solana.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const feed = vi.hoisted(() => ({ trades: vi.fn() }));
vi.mock('../api/_lib/pump-feed-fetch.js', async (orig) => ({
	...(await orig()),
	fetchPumpTrades: (...a) => feed.trades(...a),
}));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SYN = 'THREEsynthetic11111111111111111111111111pump';
const WHALE = 'THREEsyntheticCreator111111111111111111111';
const nowS = Math.floor(Date.now() / 1000);

const row = (type, amountSol, amountUsd, ago = 30) => ({
	type, txType: type, amountSol, amountUsd, userAddress: WHALE, user: WHALE, timestamp: nowS - ago, signature: `s${Math.random()}`,
});

const board = [
	{ mint: THREE, name: 'three.ws', symbol: 'three', usd_market_cap: 420000, market_cap: 2800 },
	{ mint: SYN, name: 'synthetic', symbol: 'SYN', usd_market_cap: 9000, market_cap: 60 },
];

let urls;
beforeEach(() => {
	urls = [];
	feed.trades.mockReset();
	vi.stubGlobal('fetch', vi.fn(async (url) => {
		urls.push(String(url));
		const u = new URL(String(url));
		if (u.hostname === 'frontend-api-v3.pump.fun') {
			return new Response(JSON.stringify(board), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		return new Response('gone', { status: 410 });
	}));
});
afterEach(() => vi.unstubAllGlobals());

const noSwapApi = () => expect(urls.filter((u) => u.includes('swap-api'))).toEqual([]);

describe('pump_trending', () => {
	it('scores buy pressure from the shared trade reader', async () => {
		feed.trades.mockImplementation(async (mint) => ({ rows: mint === THREE ? [row('buy', 12, 1800), row('buy', 1, 150), row('sell', 2, 300)] : [], stale: false }));
		const { detectPumpTrending } = await import('../api/_lib/x402/pump-trending-score.js');
		const sig = await detectPumpTrending();
		expect(feed.trades).toHaveBeenCalledWith(THREE, expect.objectContaining({ limit: expect.any(Number) }));
		expect(JSON.stringify(sig)).toContain(WHALE);
		noSwapApi();
	});
});

describe('pump_volume_anomaly', () => {
	it('sums windowed volume from the shared trade reader', async () => {
		feed.trades.mockImplementation(async (mint) => ({ rows: mint === THREE ? [row('buy', 50, 7500), row('sell', 10, 1500)] : [row('buy', 0.1, 15)], stale: false }));
		const { detectPumpVolumeAnomaly } = await import('../api/_lib/x402/pump-volume-anomaly.js');
		// The detector needs at least three active coins to call one an outlier.
		const peers = [1, 2, 3].map((i) => ({ mint: `THREEsynthetic${i}111111111111111111111111pump`, name: `peer${i}`, symbol: `P${i}` }));
		const fetchJson = async (url) => (urls.push(url), [board[0], ...peers]);
		const out = await detectPumpVolumeAnomaly({ fetchJson, candidates: 4, minUsd: 100, ratioThreshold: 2 });
		expect(out.mint).toBe(THREE);
		noSwapApi();
	});
});

describe('pump-agent-audit whale sweep', () => {
	it('finds whale wallets from the shared trade reader', async () => {
		feed.trades.mockImplementation(async (mint) => ({ rows: mint === THREE ? [row('buy', 12, 1800), row('buy', 8, 1200)] : [], stale: false }));
		const { detectWhaleActivity } = await import('../api/x402/pump-agent-audit.js');
		const out = await detectWhaleActivity(5);
		expect(JSON.stringify(out)).toContain(WHALE);
		noSwapApi();
	});
});
