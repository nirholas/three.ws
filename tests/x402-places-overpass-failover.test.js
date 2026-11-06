import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchPlaces } from '../api/_lib/x402-services/places.js';

// 2026-11-05: /api/x402/places-search answered 502 after a 25s abort when the
// single public Overpass instance stalled. Overpass has several mirrors; one
// slow instance must not fail the request.
afterEach(() => vi.unstubAllGlobals());

const okBody = { elements: [{ type: 'node', id: 1, lat: 1, lon: 2, tags: { name: 'Cafe One', amenity: 'cafe' } }] };

describe('places overpass failover', () => {
	it('retries on a mirror when the first instance times out', async () => {
		const urls = [];
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			urls.push(String(url));
			if (urls.length === 1) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
			return new Response(JSON.stringify(okBody), { status: 200 });
		}));
		const out = await searchPlaces(1, 2, 500, 'cafe', 5);
		expect(urls.length).toBe(2);
		expect(new Set(urls).size).toBe(2);
		expect(out.source).toBe('overpass');
	});

	it('still fails with 502 when every instance is down', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 504 })));
		await expect(searchPlaces(1, 2, 500, 'cafe', 5)).rejects.toMatchObject({ status: 502, code: 'upstream_error' });
	});
});
