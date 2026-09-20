// /api/coin/exchange: a derivatives venue must not render as an empty profile.
//
// CoinGecko keeps a stub record in the SPOT namespace for some derivatives
// venues. `/exchanges/whitebit_futures` answers 200 with zero tickers, zero
// volume and a zero trust score, while `/derivatives/exchanges/whitebit_futures`
// carries the real venue and its several hundred contracts. Because the
// namespace fallback was driven by a 404, that 200 shell won and
// /exchange/whitebit_futures showed "No markets to show for this exchange"
// about a venue clearing hundreds of thousands of BTC a day.
//
// These cases pin the recovery and its edges: the shell loses to a real
// derivatives record, a populated spot record is still preferred over a second
// lookup, and a venue that is thin in BOTH namespaces still serves rather than
// regressing a working page into a 404.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { marketDataIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.1',
}));
vi.mock('../../api/_lib/market-fallbacks.js', () => ({
	fetchCoinPriceUsdOrNull: async () => 80000,
}));

const geckoFetch = vi.fn();
vi.mock('../../api/_lib/coingecko.js', () => ({
	geckoFetch: (...args) => geckoFetch(...args),
	htmlToText: (s) => String(s || '').replace(/<[^>]+>/g, ''),
}));

const handler = (await import('../../api/coin/exchange.js')).default;

const HOLLOW_SPOT = {
	name: 'Acme Futures',
	year_established: 2022,
	country: 'Lithuania',
	trust_score: 0,
	trade_volume_24h_btc: 0,
	tickers: [],
};

const REAL_DERIVATIVES = {
	name: 'Acme Futures',
	open_interest_btc: 64361,
	trade_volume_24h_btc: '665745.73',
	number_of_perpetual_pairs: 398,
	number_of_futures_pairs: 0,
	// Upstream order, which is roughly alphabetical rather than by size.
	tickers: [
		{ symbol: '0G_PERP', last: 1, converted_volume: { usd: '1000' } },
		{
			symbol: 'ETH_PERP',
			last: 2578.4,
			index: 2577.86,
			funding_rate: 0.01,
			open_interest_usd: 1_154_998_184,
			converted_volume: { usd: '28364964045' },
			bid_ask_spread: 0.000138,
		},
	],
};

const REAL_SPOT = {
	name: 'Acme Exchange',
	trade_volume_24h_btc: 1234,
	tickers: [{ base: 'BTC', target: 'USDT', converted_last: { usd: 80000 }, converted_volume: { usd: 10 } }],
};

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

async function call(id) {
	const res = makeRes();
	await handler({ url: `/api/coin/exchange?id=${id}`, method: 'GET', headers: {} }, res);
	return { res, body: JSON.parse(res._body) };
}

const notFound = () => {
	const err = new Error('CoinGecko 404');
	err.status = 404;
	return err;
};

beforeEach(() => {
	geckoFetch.mockReset();
});

describe('GET /api/coin/exchange namespace choice', () => {
	it('prefers the derivatives record over an empty spot shell', async () => {
		geckoFetch.mockImplementation(async (path) => {
			if (path.startsWith('/exchanges/acme_futures/volume_chart')) throw notFound();
			if (path.startsWith('/exchanges/acme_futures')) return HOLLOW_SPOT;
			if (path.startsWith('/derivatives/exchanges/acme_futures')) return REAL_DERIVATIVES;
			if (path.startsWith('/exchanges?')) return [];
			throw notFound();
		});
		const { res, body } = await call('acme_futures');
		expect(res.statusCode).toBe(200);
		expect(body.detail.type).toBe('derivatives');
		expect(body.detail.tickers_count).toBe(2);
		expect(body.detail.number_of_perpetual_pairs).toBe(398);
		// The page calls this table the top contracts by volume, so the biggest
		// one has to lead regardless of the order upstream sent.
		expect(body.detail.tickers[0].symbol).toBe('ETH_PERP');
	});

	it('still serves a populated spot venue from the spot namespace', async () => {
		geckoFetch.mockImplementation(async (path) => {
			if (path.startsWith('/exchanges/acme/volume_chart')) return [[1, '10']];
			if (path.startsWith('/exchanges/acme')) return REAL_SPOT;
			if (path.startsWith('/exchanges?')) return [];
			throw new Error('derivatives namespace must not be consulted');
		});
		const { res, body } = await call('acme');
		expect(res.statusCode).toBe(200);
		expect(body.detail.type).toBe('spot');
		expect(body.detail.tickers_count).toBe(1);
	});

	it('falls back to the spot shell when neither namespace has anything better', async () => {
		geckoFetch.mockImplementation(async (path) => {
			if (path.startsWith('/exchanges/quiet_venue/volume_chart')) throw notFound();
			if (path.startsWith('/exchanges/quiet_venue')) return HOLLOW_SPOT;
			if (path.startsWith('/exchanges?')) return [];
			throw notFound(); // no derivatives record either
		});
		const { res, body } = await call('quiet_venue');
		expect(res.statusCode).toBe(200);
		expect(body.detail.type).toBe('spot');
		expect(body.detail.name).toBe('Acme Futures');
	});

	it('404s an id neither namespace knows', async () => {
		geckoFetch.mockImplementation(async () => {
			throw notFound();
		});
		const { res, body } = await call('nosuchvenue');
		expect(res.statusCode).toBe(404);
		expect(body.error).toBe('not_found');
	});
});
