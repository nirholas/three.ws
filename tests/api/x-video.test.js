/**
 * Tests for the free X video tool: POST /api/x-video/extract and the
 * GET /api/x-video/download proxy. The reader is exercised against stubbed
 * network responses; the proxy tests pin that it never reaches any host other
 * than X's two media CDNs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		clientIp: () => '203.0.113.9',
		limits: {
			...actual.limits,
			xVideoExtract: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			xVideoDownload: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
	};
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { default: extract } = await import('../../api/x-video/extract.js');
const { default: download } = await import('../../api/x-video/download.js');

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(n, v) {
			this.headers[String(n).toLowerCase()] = v;
		},
		end(b) {
			this.body = b ?? null;
		},
	};
}

function makeReq({ method = 'POST', url = '/api/x-video/extract', body = null } = {}) {
	const stream = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]);
	stream.method = method;
	stream.url = url;
	stream.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
	return stream;
}

const POST_URL = 'https://x.com/trythreews/status/1894000000000000000';
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const videoPost = {
	text: 'demo',
	created_at: '2026-10-01T12:00:00.000Z',
	favorite_count: 3,
	conversation_count: 1,
	user: { name: 'three.ws', screen_name: 'trythreews' },
	mediaDetails: [
		{
			type: 'video',
			media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/t.jpg',
			video_info: {
				duration_millis: 5000,
				variants: [{ content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/a/640x360/v.mp4' }],
			},
		},
	],
};

beforeEach(() => fetchMock.mockReset());

describe('POST /api/x-video/extract', () => {
	it('returns the post and its mp4 variants', async () => {
		fetchMock.mockResolvedValue(ok(videoPost));
		const res = makeRes();
		await extract(makeReq({ body: { url: POST_URL } }), res);
		expect(res.statusCode).toBe(200);
		const out = JSON.parse(res.body);
		expect(out.videos[0]).toMatchObject({ quality: '480p', contentType: 'video/mp4' });
		expect(out.post.metrics.likes).toBe(3);
		expect(out.duration_ms).toBe(5000);
		expect(out.source).toBe('syndication');
	});

	it('answers 404 post_unavailable for a deleted post', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => '' });
		const res = makeRes();
		await extract(makeReq({ body: { url: POST_URL } }), res);
		expect(res.statusCode).toBe(404);
		expect(JSON.parse(res.body).error).toBe('post_unavailable');
	});

	it('answers 404 no_video for a post without video', async () => {
		fetchMock.mockResolvedValue(ok({ ...videoPost, mediaDetails: [] }));
		const res = makeRes();
		await extract(makeReq({ body: { url: POST_URL } }), res);
		expect(res.statusCode).toBe(404);
		expect(JSON.parse(res.body).error).toBe('no_video');
	});

	it('answers 400 invalid_url without any network call', async () => {
		const res = makeRes();
		await extract(makeReq({ body: { url: 'https://example.com/a' } }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_url');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('GET /api/x-video/download', () => {
	it.each([
		'https://evil.example/a.mp4',
		'http://video.twimg.com/a.mp4',
		'https://video.twimg.com.evil.example/a.mp4',
		'https://169.254.169.254/latest/meta-data',
		'',
	])('refuses %s without fetching', async (target) => {
		const res = makeRes();
		await download(makeReq({ method: 'GET', url: `/api/x-video/download?url=${encodeURIComponent(target)}` }), res);
		expect(res.statusCode).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('streams an allowed CDN file as an attachment and never follows redirects', async () => {
		fetchMock.mockResolvedValue(
			new Response(Buffer.from('mp4-bytes'), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '9' } }),
		);
		const chunks = [];
		const res = Object.assign(new (await import('node:stream')).Writable({
			write(c, _e, cb) {
				chunks.push(c);
				cb();
			},
		}), { statusCode: 200, headers: {}, setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; } });
		await download(
			makeReq({
				method: 'GET',
				url: `/api/x-video/download?url=${encodeURIComponent('https://video.twimg.com/a/v.mp4')}&handle=trythreews&id=123`,
			}),
			res,
		);
		expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
		expect(res.headers['content-disposition']).toBe('attachment; filename="trythreews_123.mp4"');
		expect(Buffer.concat(chunks).toString()).toBe('mp4-bytes');
	});

	it('does not stream a redirect to another host', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }));
		const res = makeRes();
		await download(makeReq({ method: 'GET', url: `/api/x-video/download?url=${encodeURIComponent('https://video.twimg.com/a/v.mp4')}` }), res);
		expect(res.statusCode).toBe(502);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
