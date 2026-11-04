// /api/play-og: the social card a pasted /play invite link unfurls with.
//
// Regression cover for two truth defects the card shipped with:
//   - it named a biome from its own 6-entry hash table, not the one the world
//     renders in (src/game/world-biomes.js), so most coins showed the wrong place;
//   - for $THREE the coin lookup returns no name, symbol or art, and the card
//     fell back to the generic "any coin" card with no artwork at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';

vi.mock('../api/_lib/self-origin.js', () => ({ selfOrigin: () => 'https://three.ws' }));

const { default: handler, cardModel, artProxyUrl } = await import('../api/play-og.js');
const { biomeForSeed, seedFromString } = await import('../src/game/world-biomes.js');
const { HOME_TOWN } = await import('../src/game/home-town.js');

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const OTHER_MINT = 'THREEsynthetic1111111111111111111111111111';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

// What production /api/pump/coin answers for $THREE today: no identity fields.
const NULL_IDENTITY = { mint: THREE_MINT, name: null, symbol: null, image_uri: null, usd_market_cap: 0 };

function mkReq(url, method = 'GET') {
	return { method, url, headers: { host: 'three.ws' } };
}

function mkRes() {
	const headers = {};
	return {
		statusCode: 200,
		headers,
		setHeader(k, v) { headers[k.toLowerCase()] = v; },
		getHeader(k) { return headers[k.toLowerCase()]; },
		end(body) { this._body = body; this._ended = true; },
	};
}

let artPng;
let calls;

beforeEach(async () => {
	artPng = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#3a7bd5' } }).png().toBuffer();
	calls = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch({ coin = NULL_IDENTITY, art = 'png' } = {}) {
	vi.stubGlobal('fetch', vi.fn(async (input) => {
		const url = String(input);
		calls.push(url);
		if (url.includes('/api/pump/coin')) {
			return new Response(JSON.stringify(coin), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (url.includes('/api/img')) {
			if (art === 'png') return new Response(artPng, { status: 200, headers: { 'content-type': 'image/png' } });
			if (art === 'none') return new Response(null, { status: 204 });
			throw new Error('gateway down');
		}
		throw new Error(`unexpected fetch ${url}`);
	}));
}

describe('cardModel', () => {
	it('names the biome the world really renders in', () => {
		const m = cardModel({ mint: OTHER_MINT, params: new URLSearchParams('symbol=othr') });
		expect(m.biome.id).toBe(biomeForSeed(seedFromString(OTHER_MINT)).id);
		expect(m.chips).toContain(m.biome.label);
	});

	it('gives $THREE its own identity and home-town biome when the lookup knows nothing', () => {
		const m = cardModel({ mint: THREE_MINT, coin: NULL_IDENTITY });
		expect(m.heading).toBe('$THREE');
		expect(m.subline).toBe('three.ws');
		expect(m.image).toBe(HOME_TOWN.image);
		expect(m.biome.id).toBe(HOME_TOWN.biome);
		expect(m.official).toBe(true);
		expect(m.chips[0]).toBe('Official town');
	});

	it('uses the invite link params when the lookup has no identity', () => {
		const params = new URLSearchParams({ name: 'Other Coin', symbol: '$othr', image: 'https://ipfs.io/ipfs/bafy' });
		const m = cardModel({ mint: OTHER_MINT, params, coin: null });
		expect(m.heading).toBe('$OTHR');
		expect(m.subline).toBe('Other Coin');
		expect(m.image).toBe('https://ipfs.io/ipfs/bafy');
		expect(m.official).toBe(false);
	});

	it('drops an image param that is not https or our proxy', () => {
		for (const image of ['javascript:alert(1)', 'http://evil.example/a.png', 'data:image/png;base64,AA']) {
			const m = cardModel({ mint: OTHER_MINT, params: new URLSearchParams({ symbol: 'x', image }) });
			expect(m.image).toBeNull();
		}
	});

	it('is the generic card without a valid mint', () => {
		for (const mint of ['', 'not a mint', '0OIl'.repeat(10)]) {
			const m = cardModel({ mint, params: new URLSearchParams('symbol=x') });
			expect(m.heading).toBe('Walk into any coin');
			expect(m.mint).toBe('');
		}
	});
});

describe('artProxyUrl', () => {
	it('keeps our own proxy path and asks for a small, placeholder-free image', () => {
		const u = new URL(artProxyUrl('https://three.ws', HOME_TOWN.image));
		expect(u.pathname).toBe('/api/img');
		expect(u.searchParams.get('w')).toBe('256');
		expect(u.searchParams.get('fallback')).toBe('none');
		expect(u.searchParams.get('seed')).toBe(THREE_MINT);
	});

	it('wraps a raw https URL in the proxy', () => {
		const u = new URL(artProxyUrl('https://three.ws', 'https://ipfs.io/ipfs/bafy'));
		expect(u.pathname).toBe('/api/img');
		expect(u.searchParams.get('url')).toBe('https://ipfs.io/ipfs/bafy');
	});
});

describe('GET /api/play-og', () => {
	it('renders the $THREE card with its art fetched through /api/img', async () => {
		stubFetch();
		const res = mkRes();
		await handler(mkReq(`/api/play-og?coin=${THREE_MINT}`), res);
		const art = calls.find((u) => u.includes('/api/img'));
		expect(art, 'the $THREE card must fetch its art').toBeTruthy();
		expect(new URL(art).searchParams.get('fallback')).toBe('none');
		expect(res.statusCode).toBe(200);
		expect(res.getHeader('content-type')).toBe('image/png');
		expect([...res._body.subarray(0, 4)]).toEqual(PNG_MAGIC);
		expect(res.getHeader('x-play-og-art')).toBe('coin');
	}, 30000);

	it('draws the monogram when the art is missing or the proxy fails', async () => {
		for (const art of ['none', 'throw']) {
			stubFetch({ art });
			const res = mkRes();
			await handler(mkReq(`/api/play-og?coin=${THREE_MINT}`), res);
			expect(res.statusCode).toBe(200);
			expect([...res._body.subarray(0, 4)]).toEqual(PNG_MAGIC);
			expect(res.getHeader('x-play-og-art')).toBe('monogram');
			vi.unstubAllGlobals();
		}
	}, 30000);

	it('refuses writes', async () => {
		stubFetch();
		const res = mkRes();
		await handler(mkReq('/api/play-og', 'POST'), res);
		expect(res.statusCode).toBe(405);
	});
});
