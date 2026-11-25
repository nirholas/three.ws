/**
 * /api/coin/detail falls back to CoinMarketCap for long-tail coins.
 *
 * Measured 2026-11-25 in production: /api/coin/detail answered 502 for dozens
 * of long-tail coin ids every hour.
 * CoinGecko throttles Cloud Run's shared egress IP (even /coin/solana was being
 * served by the CoinPaprika rung), CoinPaprika's sixty-an-hour budget was spent
 * or it does not list the coin, and nothing else stood behind them. The
 * platform holds a CoinMarketCap Basic key (CMC_API_KEY) that lists the long
 * tail; it was unused for coin data.
 *
 * Fixtures follow the exact shape of live CMC and DefiLlama responses captured
 * 2026-11-25, with a synthetic coin in place of the real one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/coingecko.js', () => ({
	geckoFetch: async () => {
		const err = new Error('CoinGecko 429');
		err.status = 429;
		throw err;
	},
	isPlausibleCoinId: (id) => /^[a-z0-9][a-z0-9_-]*$/.test(id),
	htmlToText: (s) => String(s || ''),
}));

const { buildCoinDetail } = await import('../api/coin/detail.js');
const { resetCmcIdMemo, resetPaprikaIdMemo, pickCmcMatch } = await import('../api/_lib/coin-fallbacks.js');
const { resetCmcHealth, resetCmcBudget, isCmcBenched, reserveCmcCredits } = await import('../api/_lib/cmc.js');
const { cacheDel } = await import('../api/_lib/cache.js');
const { resetPaprikaHealth } = await import('../api/_lib/coinpaprika.js');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const QUOTE = {
	id: 900001,
	name: 'Synthetic Lantern',
	symbol: 'LNTRN',
	slug: 'synthetic-lantern',
	is_active: 1,
	circulating_supply: 0,
	total_supply: 20000000,
	max_supply: 100000000,
	cmc_rank: 5242,
	self_reported_market_cap: 184598.92,
	last_updated: '2026-11-25T19:47:18.160Z',
	quote: {
		USD: {
			price: 0.009229946212319037,
			volume_24h: 45.29,
			percent_change_1h: 1.54,
			percent_change_24h: -0.79,
			percent_change_7d: -7.41,
			percent_change_30d: -35.85,
			percent_change_60d: -51.44,
			market_cap: 0,
			fully_diluted_market_cap: 922994.62,
			last_updated: '2026-11-25T19:46:05.000Z',
		},
	},
};

const INFO = {
	id: 900001,
	name: 'Synthetic Lantern',
	symbol: 'LNTRN',
	description: 'Synthetic Lantern (LNTRN) is a fixture coin for this test.',
	slug: 'synthetic-lantern',
	logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/900001.png',
	'tag-names': ['Fixture Ecosystem'],
	urls: {
		website: ['https://lantern.example'],
		twitter: ['https://twitter.com/SynthLantern'],
		message_board: ['https://twitter.com/SynthLantern'],
		chat: ['https://t.me/synthlantern_chat'],
		explorer: ['https://solscan.io/token/THREEsynthetic11111111111111111111111111'],
		reddit: [],
		technical_doc: ['https://docs.lantern.example'],
		source_code: ['https://github.com/synthetic-lantern'],
		announcement: ['https://t.me/synthlantern_news'],
	},
	twitter_username: 'SynthLantern',
	date_launched: '2022-07-28T00:00:00.000Z',
	contract_address: [
		{ contract_address: 'THREEsynthetic11111111111111111111111111', platform: { name: 'Solana' } },
		{ contract_address: '0xsynthetic', platform: { name: 'Unlisted Fixture Chain' } },
	],
};

let calls;
function routes({ llama = { price: 0.009004032080831113, symbol: 'LNTRN' }, map, quotes } = {}) {
	calls = [];
	return vi.fn(async (input, init = {}) => {
		const url = String(input?.url || input);
		calls.push({ url, key: init.headers?.['X-CMC_PRO_API_KEY'] });
		if (url.includes('api.coinpaprika.com')) return json({ type: 'payment_required', error: 'request limits were reached' }, 402);
		if (url.includes('coins.llama.fi')) {
			const id = decodeURIComponent(url.split('coingecko:')[1]);
			return json({ coins: llama ? { [`coingecko:${id}`]: llama } : {} });
		}
		if (url.includes('/v1/cryptocurrency/map')) {
			return json({ data: map ?? [{ id: 900001, symbol: 'LNTRN', slug: 'synthetic-lantern', rank: 5242, is_active: 1 }] });
		}
		if (url.includes('/v2/cryptocurrency/quotes/latest')) return json({ data: quotes ?? { 900001: QUOTE } });
		if (url.includes('/v2/cryptocurrency/info')) return json({ data: { 900001: INFO } });
		throw new Error(`unexpected fetch ${url}`);
	});
}

let savedKey;
const IDS = ['synthetic-lantern', 'synthetic-unpriced'];
beforeEach(async () => {
	for (const id of IDS) {
		await cacheDel(`cmc:id:${id}`);
		await cacheDel(`cmc-fallback:detail:${id}`);
	}
	await cacheDel(`cmc:credits:${new Date().toISOString().slice(0, 10)}`);
	savedKey = process.env.CMC_API_KEY;
	process.env.CMC_API_KEY = 'test-cmc-key';
	resetCmcIdMemo();
	resetPaprikaIdMemo();
	resetCmcHealth();
	resetCmcBudget();
	resetPaprikaHealth();
});
afterEach(() => {
	vi.unstubAllGlobals();
	if (savedKey === undefined) delete process.env.CMC_API_KEY;
	else process.env.CMC_API_KEY = savedKey;
});

describe('buildCoinDetail CoinMarketCap rung', () => {
	it('serves a long-tail coin from CMC when CoinGecko and CoinPaprika both refuse', async () => {
		vi.stubGlobal('fetch', routes());
		const { coin, source } = await buildCoinDetail({ id: 'synthetic-lantern' });
		expect(source).toBe('coinmarketcap');
		expect(coin.id).toBe('synthetic-lantern');
		expect(coin.symbol).toBe('LNTRN');
		expect(coin.market.price).toBeCloseTo(0.00923, 5);
		expect(coin.market.fdv).toBe(922994.62);
		// CMC has not verified circulating supply: no market cap rather than the
		// project's self-reported claim.
		expect(coin.market.market_cap).toBeNull();
		expect(coin.market.circulating).toBeNull();
		// Mapped chains key by the CoinGecko platform id; an unknown chain is dropped.
		expect(coin.platforms).toEqual({ solana: 'THREEsynthetic11111111111111111111111111' });
		expect(coin.links.telegram).toBe('synthlantern_chat');
		expect(coin.links.twitter).toBe('SynthLantern');
		expect(coin.meta.genesis_date).toBe('2022-07-28');
		expect(calls.filter((c) => c.url.includes('coinmarketcap')).every((c) => c.key === 'test-cmc-key')).toBe(true);
	});

	it('refuses a same-symbol coin whose price disagrees, rather than serve the wrong asset', async () => {
		const other = { ...QUOTE, id: 1, slug: 'lantern-other', quote: { USD: { ...QUOTE.quote.USD, price: 0.5 } } };
		vi.stubGlobal('fetch', routes({ map: [{ id: 1, symbol: 'LNTRN', is_active: 1, rank: 10 }], quotes: { 1: other } }));
		await expect(buildCoinDetail({ id: 'synthetic-lantern' })).rejects.toMatchObject({ status: 429 });
	});

	it('does not spend a CMC credit when DefiLlama has no reading to prove the match', async () => {
		vi.stubGlobal('fetch', routes({ llama: null }));
		await expect(buildCoinDetail({ id: 'synthetic-unpriced' })).rejects.toMatchObject({ status: 429 });
		expect(calls.some((c) => c.url.includes('coinmarketcap'))).toBe(false);
	});

	it('benches CMC for the rest of the month on a monthly-credit rejection', async () => {
		const base = routes();
		vi.stubGlobal('fetch', vi.fn(async (input, init) => {
			if (String(input).includes('coinmarketcap')) {
				return json({ status: { error_code: 1010, error_message: 'monthly credit limit reached' } }, 429);
			}
			return base(input, init);
		}));
		await expect(buildCoinDetail({ id: 'synthetic-lantern' })).rejects.toMatchObject({ status: 429 });
		expect(isCmcBenched()).toBe(true);
	});
});

describe('reserveCmcCredits', () => {
	it('refuses once the day\'s shared budget is spent, and starts fresh the next day', async () => {
		const now = Date.UTC(2026, 10, 25, 12);
		expect(await reserveCmcCredits(2, { dailyCap: 3, now })).toBe(true);
		expect(await reserveCmcCredits(2, { dailyCap: 3, now })).toBe(false);
		expect(await reserveCmcCredits(1, { dailyCap: 3, now })).toBe(true);
		expect(await reserveCmcCredits(2, { dailyCap: 3, now: now + 86_400_000 })).toBe(true);
	});
});

describe('pickCmcMatch', () => {
	const identity = { symbol: 'FXT', price: 0.0060115 };
	const row = (id, slug, price, symbol = 'FXT') => ({ id, slug, symbol, quote: { USD: { price } } });
	it('takes the candidate whose price agrees, not the best-ranked one', () => {
		const quotes = { 101: row(101, 'fixture', 0.199), 202: row(202, 'fixture-sol', 0.00603) };
		expect(pickCmcMatch(quotes, ['101', '202'], identity, 'fixture-ai')?.id).toBe(202);
	});
	it('accepts an exact slug inside the wider tolerance and nothing looser', () => {
		const ident = { symbol: 'LNTRN', price: 0.009004 };
		expect(pickCmcMatch({ 1: row(1, 'synthetic-lantern', 0.00923, 'LNTRN') }, ['1'], ident, 'synthetic-lantern')?.id).toBe(1);
		expect(pickCmcMatch({ 1: row(1, 'synthetic-lantern-x', 0.00923, 'LNTRN') }, ['1'], ident, 'synthetic-lantern')).toBeNull();
		expect(pickCmcMatch({ 1: row(1, 'synthetic-lantern', 0.0125, 'LNTRN') }, ['1'], ident, 'synthetic-lantern')).toBeNull();
	});
});
