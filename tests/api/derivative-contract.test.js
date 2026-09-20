// /api/coin/derivative and the contract-slug helpers behind /derivative/:venue/:symbol.
//
// Three contracts are pinned here because each of them was a real decision, not
// an implementation detail:
//
//   1. The slug. Venue symbols include "ETH/USDT", which cannot ride a path
//      segment: a percent-encoded slash is decoded before routing and splits
//      the route. The "~" fold has to round-trip exactly, and the browser copy
//      of the helper has to stay byte-identical to the server copy, because the
//      server build context excludes src/ and cannot import it.
//   2. The basis sign. CoinGecko publishes the INDEX's premium over the
//      contract; the page states "trading above/below its index" about the
//      CONTRACT, so the sign is flipped on the way out. Getting this backwards
//      is invisible in a diff and wrong on every page.
//   3. Fail-soft. Only the venue read is load-bearing. The cross-venue feed,
//      the venue directory and the spot lookup must each degrade to
//      empty/null rather than 502 a page whose headline numbers are already in
//      hand.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { marketDataIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.1',
}));

const geckoFetch = vi.fn();
vi.mock('../../api/_lib/coingecko.js', () => ({
	geckoFetch: (...args) => geckoFetch(...args),
	htmlToText: (s) => String(s || '').replace(/<[^>]+>/g, ''),
}));

vi.mock('../../api/_lib/hyperliquid.js', () => ({ fetchHyperliquidPerps: async () => [] }));
vi.mock('../../api/_lib/deribit.js', () => ({ fetchDeribitSummary: async () => null }));

const handler = (await import('../../api/coin/derivative.js')).default;
const listHandler = (await import('../../api/coin/derivatives.js')).default;
const slugServer = await import('../../api/_lib/derivative-slug.js');
const slugClient = await import('../../src/shared/derivative-slug.js');

// ── Fixtures: real-shaped, trimmed captures ─────────────────────────────────

const VENUE_DETAIL = {
	name: 'Acme Futures',
	image: 'https://cdn.example/acme.png',
	url: 'https://acme.example/futures',
	description: '<p>Acme Futures is a derivatives venue.</p>',
	country: 'Lithuania',
	year_established: 2022,
	open_interest_btc: 1000,
	trade_volume_24h_btc: 5000,
	number_of_perpetual_pairs: 3,
	number_of_futures_pairs: 0,
	tickers: [
		{
			symbol: 'ETH/USDT',
			base: 'ETH',
			target: 'USDT',
			coin_id: 'ethereum',
			trade_url: 'https://acme.example/trade/ETH_USDT',
			contract_type: 'perpetual',
			last: 2000,
			h24_percentage_change: -1.5,
			index: 1980,
			// Upstream convention: (index - last) / last, i.e. the index's premium.
			index_basis_percentage: -1,
			bid_ask_spread: 0.0002,
			funding_rate: 0.01,
			open_interest_usd: 600_000_000,
			h24_volume: 42,
			converted_volume: { usd: '800000000' },
			last_traded: 1789883238,
			expired_at: null,
		},
		{
			symbol: 'BTC_PERP',
			base: 'BTC',
			target: 'USDT',
			coin_id: 'bitcoin',
			contract_type: 'perpetual',
			last: 80000,
			funding_rate: 0.005,
			open_interest_usd: 400_000_000,
			converted_volume: { usd: '200000000' },
		},
	],
};

const VENUE_DIRECTORY = [
	{ id: 'acme_futures', name: 'Acme Futures', image: 'https://cdn.example/acme.png', open_interest_btc: 1000 },
	{ id: 'zeta_futures', name: 'Zeta (Futures)', image: 'https://cdn.example/zeta.png', open_interest_btc: 900 },
	{ id: 'dust_futures', name: 'Dust (Futures)', image: null, open_interest_btc: 1 },
];

// Zeta is liquid and funds cheapest; Dust funds far cheaper still but trades
// under the floor, so it must never be offered as somewhere to act.
const CROSS_VENUE_FEED = [
	{
		market: 'Acme Futures',
		symbol: 'ETH/USDT',
		index_id: 'ETH',
		contract_type: 'perpetual',
		price: 1999,
		price_percentage_change_24h: -1.4,
		funding_rate: 0.01,
		open_interest: 600_000_000,
		volume_24h: 800_000_000,
	},
	{
		market: 'Zeta (Futures)',
		symbol: 'ETHUSDT',
		index_id: 'ETH',
		contract_type: 'perpetual',
		price: 2010,
		price_percentage_change_24h: -1.2,
		funding_rate: -0.004,
		open_interest: 1_400_000_000,
		volume_24h: 5_000_000,
	},
	{
		market: 'Dust (Futures)',
		symbol: 'ETH-PERP',
		index_id: 'ETH',
		contract_type: 'perpetual',
		price: 2500,
		funding_rate: -9,
		open_interest: 10_000,
		volume_24h: 12,
	},
	// Different index, and an expiring future: neither belongs in the peer set.
	{ market: 'Zeta (Futures)', symbol: 'BTCUSDT', index_id: 'BTC', contract_type: 'perpetual', funding_rate: 0.002, volume_24h: 9_000_000 },
	{ market: 'Zeta (Futures)', symbol: 'ETH-0325', index_id: 'ETH', contract_type: 'futures', funding_rate: 0.5, volume_24h: 9_000_000 },
];

const SPOT_ROW = {
	id: 'ethereum',
	name: 'Ethereum',
	symbol: 'eth',
	image: 'https://cdn.example/eth.png',
	current_price: 1985,
	price_change_percentage_24h: -1.44,
	market_cap: 240_000_000_000,
	market_cap_rank: 2,
	total_volume: 11_000_000_000,
	high_24h: 2050,
	low_24h: 1970,
	ath: 4946,
	ath_change_percentage: -59.8,
};

function routeGecko(path) {
	if (path.startsWith('/derivatives/exchanges/acme_futures')) return VENUE_DETAIL;
	if (path.startsWith('/derivatives/exchanges?')) return VENUE_DIRECTORY;
	if (path.startsWith('/derivatives?')) return CROSS_VENUE_FEED;
	if (path.startsWith('/coins/markets')) return [SPOT_ROW];
	const err = new Error(`CoinGecko 404 for ${path}`);
	err.status = 404;
	throw err;
}

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		setHeader(k, v) {
			this._h[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this._h[k.toLowerCase()];
		},
		end(body) {
			this._body = body;
		},
	};
}

async function call(query) {
	const res = makeRes();
	await handler({ url: `/api/coin/derivative?${query}`, method: 'GET', headers: {} }, res);
	return { res, body: JSON.parse(res._body) };
}

beforeEach(() => {
	geckoFetch.mockReset();
	geckoFetch.mockImplementation(async (path) => routeGecko(path));
});

// ── Slug helpers ────────────────────────────────────────────────────────────

describe('derivative contract slugs', () => {
	it('keeps the browser and server copies byte-identical', () => {
		const server = readFileSync(
			fileURLToPath(new URL('../../api/_lib/derivative-slug.js', import.meta.url)),
			'utf8',
		);
		const client = readFileSync(
			fileURLToPath(new URL('../../src/shared/derivative-slug.js', import.meta.url)),
			'utf8',
		);
		expect(client).toBe(server);
	});

	it('round-trips every symbol shape the feed carries', () => {
		for (const symbol of ['ETH_PERP', 'BTCUSDT', 'ETH-USDT-SWAP', 'ETH/USDT', 'BTC.USD:PERP']) {
			const slug = slugServer.contractSlug(symbol);
			expect(slug).not.toBeNull();
			expect(slug).not.toContain('/');
			expect(slugServer.symbolFromSlug(slug)).toBe(symbol);
			expect(slugClient.contractSlug(symbol)).toBe(slug);
		}
	});

	it('refuses a symbol it cannot address, rather than mangling it', () => {
		expect(slugServer.contractSlug('')).toBeNull();
		expect(slugServer.contractSlug('ETH~USDT')).toBeNull(); // the fold char itself
		expect(slugServer.contractSlug('ETH USDT')).toBeNull();
		expect(slugServer.contractSlug('a'.repeat(49))).toBeNull();
		expect(slugServer.derivativePath('acme futures', 'ETH_PERP')).toBeNull();
	});

	it('tolerates a still-encoded path segment', () => {
		expect(slugServer.symbolFromSlug('ETH%7EUSDT')).toBe('ETH/USDT');
		expect(slugServer.symbolFromSlug('%E0%A4%A')).toBeNull(); // malformed escape
	});

	it('builds the canonical path', () => {
		expect(slugServer.derivativePath('Acme_Futures', 'ETH/USDT')).toBe(
			'/derivative/acme_futures/ETH~USDT',
		);
	});
});

// ── Endpoint ────────────────────────────────────────────────────────────────

describe('GET /api/coin/derivative', () => {
	it('rejects a venue or symbol it could not address', async () => {
		expect((await call('venue=not a venue&symbol=ETH_PERP')).res.statusCode).toBe(400);
		expect((await call('venue=acme_futures&symbol=')).res.statusCode).toBe(400);
	});

	it('404s a symbol the venue does not list', async () => {
		const { res, body } = await call('venue=acme_futures&symbol=NOPE');
		expect(res.statusCode).toBe(404);
		expect(body.error).toBe('not_found');
	});

	it('404s an unknown venue', async () => {
		const { res } = await call('venue=nosuchvenue&symbol=ETH_PERP');
		expect(res.statusCode).toBe(404);
	});

	it('reports basis as the contract premium over the index, not the reverse', async () => {
		const { res, body } = await call('venue=acme_futures&symbol=ETH%2FUSDT');
		expect(res.statusCode).toBe(200);
		// last 2000 over index 1980 is a contract trading ~1.01% ABOVE its index,
		// even though upstream called the same gap -1.
		expect(body.contract.basis_pct).toBeCloseTo(1.0101, 3);
	});

	it('annualizes funding at three settlements a day', async () => {
		const { body } = await call('venue=acme_futures&symbol=ETH%2FUSDT');
		expect(body.contract.funding_rate).toBe(0.01);
		expect(body.contract.funding_apr).toBeCloseTo(0.01 * 3 * 365, 6);
		expect(body.funding_periods_per_year).toBe(1095);
	});

	it('finds the contract case-insensitively and carries its own slug', async () => {
		const { body } = await call('venue=acme_futures&symbol=eth%2Fusdt');
		expect(body.contract.symbol).toBe('ETH/USDT');
		expect(body.contract.slug).toBe('ETH~USDT');
	});

	it('sizes the contract against its venue and its underlying', async () => {
		const { body } = await call('venue=acme_futures&symbol=ETH%2FUSDT');
		// 600 of 1000 open interest, 800 of 1000 volume across the venue's book.
		expect(body.contract.venue_oi_share_pct).toBeCloseTo(60, 6);
		expect(body.contract.venue_vol_share_pct).toBeCloseTo(80, 6);
		// 600M of the 2.00001B open across every venue listing an ETH perp.
		expect(body.peer_stats.oi_share_pct).toBeCloseTo((600_000_000 / 2_000_010_000) * 100, 6);
		expect(body.peer_stats.oi_rank).toBe(2);
	});

	it('marks the contract being viewed inside the cross-venue table', async () => {
		const { body } = await call('venue=acme_futures&symbol=ETH%2FUSDT');
		const current = body.peers.filter((p) => p.current);
		expect(current).toHaveLength(1);
		expect(current[0].venue_id).toBe('acme_futures');
		// The venue-scoped read is fresher, so its numbers win on that one row.
		expect(current[0].price).toBe(2000);
	});

	it('keeps only perpetuals on the same index, and resolves each venue id', async () => {
		const { body } = await call('venue=acme_futures&symbol=ETH%2FUSDT');
		expect(body.peers.map((p) => p.symbol).sort()).toEqual(['ETH-PERP', 'ETH/USDT', 'ETHUSDT']);
		expect(body.peers.find((p) => p.symbol === 'ETHUSDT').venue_id).toBe('zeta_futures');
		expect(body.peers.find((p) => p.symbol === 'ETH-PERP').slug).toBe('ETH-PERP');
	});

	it('never nominates a dormant book as somewhere to act', async () => {
		const { body } = await call('venue=acme_futures&symbol=ETH%2FUSDT');
		const s = body.peer_stats;
		expect(s.venues).toBe(3);
		expect(s.liquid_venues).toBe(2);
		// Dust funds at -9% and would win on rate alone; it trades $12 a day.
		expect(s.cheapest_long.venue_id).toBe('zeta_futures');
		expect(s.richest_short.venue_id).toBe('acme_futures');
		// Its 2500 print must not set the dispersion band either.
		expect(s.price_max).toBe(2010);
		// Totals still count every venue, dormant or not.
		expect(s.total_open_interest_usd).toBe(2_000_010_000);
	});

	it('lists the venue’s other contracts without repeating this one', async () => {
		const { body } = await call('venue=acme_futures&symbol=ETH%2FUSDT');
		expect(body.venue_contracts.map((t) => t.symbol)).toEqual(['BTC_PERP']);
		expect(body.venue.contracts_listed).toBe(2);
		expect(body.venue.description).toBe('Acme Futures is a derivatives venue.');
	});

	it('attaches the underlying spot market', async () => {
		const { body } = await call('venue=acme_futures&symbol=ETH%2FUSDT');
		expect(body.index.coin_id).toBe('ethereum');
		expect(body.index.symbol).toBe('ETH');
		expect(body.index.price_usd).toBe(1985);
	});

	it('still serves the contract when every secondary source is down', async () => {
		geckoFetch.mockImplementation(async (path) => {
			if (path.startsWith('/derivatives/exchanges/acme_futures')) return VENUE_DETAIL;
			throw new Error(`CoinGecko 429 for ${path}`);
		});
		const { res, body } = await call('venue=acme_futures&symbol=BTC_PERP');
		expect(res.statusCode).toBe(200);
		expect(body.contract.symbol).toBe('BTC_PERP');
		expect(body.peers).toEqual([]);
		expect(body.peer_stats).toBeNull();
		expect(body.index).toBeNull();
		// The venue read alone is enough to size the contract against its book.
		expect(body.contract.venue_vol_share_pct).toBeCloseTo(20, 6);
	});

	it('502s only when the venue read itself fails', async () => {
		geckoFetch.mockImplementation(async () => {
			throw new Error('CoinGecko 429');
		});
		const { res, body } = await call('venue=acme_futures&symbol=ETH_PERP');
		expect(res.statusCode).toBe(502);
		expect(body.error).toBe('upstream_error');
	});
});

// ── The table that links here ───────────────────────────────────────────────

describe('GET /api/coin/derivatives', () => {
	it('addresses every row it can, so the table rows are clickable', async () => {
		const res = makeRes();
		await listHandler({ url: '/api/coin/derivatives', method: 'GET', headers: {} }, res);
		const body = JSON.parse(res._body);
		const acme = body.tickers.find((t) => t.market === 'Acme Futures');
		expect(acme.venue_id).toBe('acme_futures');
		expect(acme.slug).toBe('ETH~USDT');
	});

	it('leaves a row unaddressed rather than pointing it at a 404', async () => {
		geckoFetch.mockImplementation(async (path) => {
			if (path.startsWith('/derivatives/exchanges?')) throw new Error('CoinGecko 429');
			return routeGecko(path);
		});
		// Both the ticker table and the venue directory hold module-level caches
		// that outlive a test, and a warm directory would answer from the copy the
		// earlier case fetched. A fresh registry is what actually exercises the
		// directory being unreachable.
		vi.resetModules();
		const freshList = (await import('../../api/coin/derivatives.js')).default;
		const res = makeRes();
		await freshList({ url: '/api/coin/derivatives', method: 'GET', headers: {} }, res);
		const body = JSON.parse(res._body);
		expect(body.tickers.length).toBeGreaterThan(0);
		for (const t of body.tickers) expect(t.venue_id ?? null).toBeNull();
	});
});
