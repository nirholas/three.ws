import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchPlaces, placeDetail, OVERPASS_HEDGE_MS, OVERPASS_ATTEMPT_TIMEOUT_MS } from '../api/_lib/x402-services/places.js';

// 2026-11-05: /api/x402/places-search answered 502 after a 25s abort when the
// single public Overpass instance stalled. Overpass has several mirrors; one
// slow instance must not fail the request.
//
// 2026-11-10: every configured mirror was degraded at once (overpass-api.de
// 502, private.coffee and kumi.systems hanging past 20s) and the only healthy
// public instance took 19s to answer. Walking mirrors one after another with a
// 12s cap each could never reach it, so places-search 502'd for every caller
// (24.5s and 36s latencies in the request log: two and three dead attempts).
// Mirrors are now hedged in parallel, answers are cached, and the last good
// answer is served (marked stale) when every instance is down.
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// Each test uses its own coordinates so the shared answer cache never carries
// one test's result into another.
let seq = 0;
const nextCoords = () => { seq += 1; return [10 + seq / 1000, 20 + seq / 1000]; };

const okBody = (name = 'Cafe One') => ({ elements: [{ type: 'node', id: 1, lat: 1, lon: 2, tags: { name, amenity: 'cafe' } }] });

// A fetch that never answers until its signal aborts, the way a stalled
// Overpass instance behaves.
function hangUntilAborted(signal, aborted) {
	return new Promise((_, reject) => {
		signal?.addEventListener('abort', () => {
			aborted.push(true);
			reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
		});
	});
}

describe('places overpass failover', () => {
	it('retries on a mirror when the first instance fails outright', async () => {
		const [lat, lon] = nextCoords();
		const urls = [];
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			urls.push(String(url));
			if (urls.length === 1) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
			return new Response(JSON.stringify(okBody()), { status: 200 });
		}));
		const out = await searchPlaces(lat, lon, 500, 'cafe', 5);
		expect(urls.length).toBe(2);
		expect(new Set(urls).size).toBe(2);
		expect(out.source).toBe('overpass');
		expect(out.count).toBe(1);
	});

	it('answers from a slower healthy mirror while the first one hangs, then aborts the hung request', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const [lat, lon] = nextCoords();
		const urls = [];
		const aborted = [];
		vi.stubGlobal('fetch', vi.fn((url, init) => {
			urls.push(String(url));
			if (urls.length === 1) return hangUntilAborted(init?.signal, aborted);
			return Promise.resolve(new Response(JSON.stringify(okBody('Mirror Two Cafe')), { status: 200 }));
		}));
		const pending = searchPlaces(lat, lon, 500, 'cafe', 5);
		// Well before the hung attempt's own timeout, the hedge fires the next mirror.
		await vi.advanceTimersByTimeAsync(OVERPASS_HEDGE_MS + 10);
		const out = await pending;
		expect(OVERPASS_HEDGE_MS).toBeLessThan(OVERPASS_ATTEMPT_TIMEOUT_MS);
		expect(urls.length).toBe(2);
		expect(out.places[0].name).toBe('Mirror Two Cafe');
		expect(out.stale).toBeUndefined();
		expect(aborted.length).toBe(1);
	});

	it('serves a repeated query from cache without calling Overpass again', async () => {
		const [lat, lon] = nextCoords();
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody()), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		await searchPlaces(lat, lon, 500, 'cafe', 5);
		const calls = fetchMock.mock.calls.length;
		const again = await searchPlaces(lat, lon, 500, 'cafe', 5);
		expect(fetchMock.mock.calls.length).toBe(calls);
		expect(again.count).toBe(1);
	});

	it('serves the last good answer, marked stale, when every instance is down', async () => {
		const [lat, lon] = nextCoords();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(okBody('Remembered Cafe')), { status: 200 })));
		const first = await searchPlaces(lat, lon, 500, 'cafe', 5);
		const { expireFreshPlacesCacheForTests } = await import('../api/_lib/x402-services/places.js');
		await expireFreshPlacesCacheForTests();
		vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 504 })));
		const out = await searchPlaces(lat, lon, 500, 'cafe', 5);
		expect(out.stale).toBe(true);
		expect(out.places[0].name).toBe('Remembered Cafe');
		expect(out.retrievedAt).toBe(first.retrievedAt);
	});

	it('still fails with 502 when every instance is down and nothing was ever cached', async () => {
		const [lat, lon] = nextCoords();
		vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 504 })));
		await expect(searchPlaces(lat, lon, 500, 'cafe', 5)).rejects.toMatchObject({ status: 502, code: 'upstream_error' });
	});

	it('place detail uses the same hedged, cached path', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody('Detail Cafe')), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const osmId = 900000 + seq;
		const out = await placeDetail('node', osmId);
		expect(out.place.name).toBe('Detail Cafe');
		await placeDetail('node', osmId);
		expect(fetchMock.mock.calls.length).toBe(1);
	});
});
