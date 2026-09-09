/**
 * GET /api/animations/library — full motion library manifest proxy.
 *
 * The endpoint proxies the R2-hosted library manifest (published by
 * scripts/mixamo-all.mjs --upload). Contract under test:
 *   - pre-launch (manifest object missing) → 200 { clips: [], total: 0 },
 *     never an error, so the gallery/embed/studio feature-detect by emptiness;
 *   - published manifest ({ clips: [...] } shape) → clips passed through with
 *     total derived server-side;
 *   - bare-array manifest (legacy shape) → also accepted;
 *   - non-GET → 405.
 */

import { describe, it, expect, vi } from 'vitest';

const readManifest = vi.fn();
vi.mock('../api/_lib/r2.js', () => ({ getPublicObjectBuffer: (...a) => readManifest(...a) }));

const { default: handler } = await import('../api/animations/library.js');

function fakeReq(method = 'GET', url = '/api/animations/library') {
	return { method, url, headers: {} };
}

function fakeRes() {
	const headers = {};
	return {
		statusCode: 0,
		body: undefined,
		ended: false,
		setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return headers[String(k).toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; },
		_headers: headers,
	};
}

const CLIP = {
	name: 'mx-hip-hop-dancing',
	label: 'Hip Hop Dancing',
	icon: '💃',
	loop: true,
	duration: 4.4,
	bytes: 1174283,
	url: 'https://cdn.example/animations/library/clips/mx-hip-hop-dancing.json',
};

// No beforeEach reset: every test installs its own mockResolvedValue/
// mockRejectedValue, which fully replaces the previous implementation.
// (vitest 4's mockReset() leaves the fn throwing the prior rejection value
// during the reset window, which fails the rejection tests spuriously.)
describe('GET /api/animations/library', () => {
	it('returns an empty library when the manifest has not been uploaded yet', async () => {
		const missing = Object.assign(new Error('no such key'), { name: 'NoSuchKey' });
		readManifest.mockRejectedValue(missing);
		const res = fakeRes();
		await handler(fakeReq(), res);
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ clips: [], total: 0, generated_at: null });
	});

	it('degrades to an empty library on storage errors instead of failing', async () => {
		readManifest.mockRejectedValue(new Error('socket hang up'));
		const res = fakeRes();
		await handler(fakeReq(), res);
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body).clips).toEqual([]);
	});

	it('passes through a published { clips } manifest and derives total', async () => {
		readManifest.mockResolvedValue(Buffer.from(JSON.stringify({
			generated_at: '2026-07-04T00:00:00.000Z',
			total: 1,
			clips: [CLIP],
		})));
		const res = fakeRes();
		await handler(fakeReq(), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.clips).toEqual([CLIP]);
		expect(body.total).toBe(1);
		expect(body.generated_at).toBe('2026-07-04T00:00:00.000Z');
		expect(res.getHeader('cache-control')).toContain('s-maxage=300');
	});

	it('accepts a bare-array manifest shape', async () => {
		readManifest.mockResolvedValue(Buffer.from(JSON.stringify([CLIP])));
		const res = fakeRes();
		await handler(fakeReq(), res);
		expect(JSON.parse(res.body).clips).toEqual([CLIP]);
	});

	it('rejects non-GET methods', async () => {
		readManifest.mockResolvedValue(Buffer.from('[]'));
		const res = fakeRes();
		await handler(fakeReq('POST'), res);
		expect(res.statusCode).toBe(405);
	});

	// ── Bounded pagination (opt-in via ?limit) ──────────────────────────────
	const CLIPS = Array.from({ length: 5 }, (_, i) => ({ ...CLIP, name: `mx-clip-${i}` }));

	it('pages a large manifest with ?limit and exposes next_offset', async () => {
		readManifest.mockResolvedValue(Buffer.from(JSON.stringify({ clips: CLIPS })));
		const res = fakeRes();
		await handler(fakeReq('GET', '/api/animations/library?limit=2'), res);
		const body = JSON.parse(res.body);
		expect(body.total).toBe(5); // full catalog size, not the page size
		expect(body.clips.map((c) => c.name)).toEqual(['mx-clip-0', 'mx-clip-1']);
		expect(body.offset).toBe(0);
		expect(body.next_offset).toBe(2);
	});

	it('honors ?offset and returns next_offset=null on the final page', async () => {
		readManifest.mockResolvedValue(Buffer.from(JSON.stringify({ clips: CLIPS })));
		const res = fakeRes();
		await handler(fakeReq('GET', '/api/animations/library?limit=2&offset=4'), res);
		const body = JSON.parse(res.body);
		expect(body.clips.map((c) => c.name)).toEqual(['mx-clip-4']);
		expect(body.offset).toBe(4);
		expect(body.next_offset).toBe(null);
	});

	it('returns an empty page (not an error) when offset runs past the end', async () => {
		readManifest.mockResolvedValue(Buffer.from(JSON.stringify({ clips: CLIPS })));
		const res = fakeRes();
		await handler(fakeReq('GET', '/api/animations/library?limit=2&offset=99'), res);
		const body = JSON.parse(res.body);
		expect(body.clips).toEqual([]);
		expect(body.total).toBe(5);
		expect(body.next_offset).toBe(null);
	});

	it('omits pagination fields entirely when ?limit is absent (legacy contract)', async () => {
		readManifest.mockResolvedValue(Buffer.from(JSON.stringify({ clips: CLIPS })));
		const res = fakeRes();
		await handler(fakeReq('GET', '/api/animations/library'), res);
		const body = JSON.parse(res.body);
		expect(body).toEqual({ clips: CLIPS, total: 5, generated_at: null });
		expect('next_offset' in body).toBe(false);
	});
});
