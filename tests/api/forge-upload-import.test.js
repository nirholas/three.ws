import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

// A person can paste an image link (or a page that shows one) into /forge.
// The browser cannot fetch most of those itself (no CORS), so
// POST /api/forge-upload { source_url } fetches it for them, through the SSRF
// guard, and hands back the image bytes for the page to prepare and upload like
// any dropped photo. The network boundary (the pinned fetch) is the only thing
// replaced here; the guard's own rules are tested in tests/ssrf-guard*.test.js.

const requestUser = vi.fn();
const uploadLimit = vi.fn();
const pinnedFetch = vi.fn();

vi.mock('../../api/_lib/auth.js', () => ({ getRequestUser: (req) => requestUser(req) }));
vi.mock('../../api/_lib/r2.js', () => ({
	presignUpload: async () => 'https://storage.example/signed',
	publicUrl: (key) => `https://three.ws/cdn/${key}`,
	objectStorageUsable: async () => ({ ok: true }),
}));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { upload: (key) => uploadLimit(key) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../../api/_lib/forge-store.js', () => ({ hashClient: () => 'h'.repeat(64) }));
vi.mock('../../api/_lib/ssrf-guard.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, fetchSafePublicUrlPinned: (...args) => pinnedFetch(...args) };
});

const { SsrfBlockedError, MaxBytesExceededError } = await import('../../api/_lib/ssrf-guard.js');
const { default: handler } = await import('../../api/forge-upload.js');

function call(body) {
	return new Promise((resolve) => {
		const sent = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { sent[k.toLowerCase()] = v; },
			getHeader(k) { return sent[k.toLowerCase()]; },
			removeHeader(k) { delete sent[k.toLowerCase()]; },
			writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
			write() { return true; },
			end(out) {
				this.headersSent = true;
				const raw = out == null ? Buffer.alloc(0) : Buffer.from(out);
				const isJson = String(sent['content-type'] || '').includes('json');
				resolve({ status: this.statusCode, headers: sent, raw, body: isJson ? JSON.parse(raw.toString('utf8')) : null });
			},
		};
		handler(
			{
				method: 'POST',
				url: '/api/forge-upload',
				headers: { host: 'three.ws', 'content-type': 'application/json' },
				rawBody: Buffer.from(JSON.stringify(body)),
				socket: { remoteAddress: '127.0.0.1' },
			},
			res,
		);
	});
}

const respond = (status, bytes, type) => new Response(bytes, { status, headers: type ? { 'content-type': type } : {} });
let jpeg;

beforeEach(async () => {
	requestUser.mockReset();
	uploadLimit.mockReset();
	pinnedFetch.mockReset();
	requestUser.mockResolvedValue({ id: 'user-1' });
	uploadLimit.mockResolvedValue({ success: true });
	jpeg ||= await sharp({ create: { width: 640, height: 480, channels: 3, background: '#a63' } }).jpeg().toBuffer();
});

describe('POST /api/forge-upload { source_url }', () => {
	it('needs an account, like the upload itself, and fetches nothing anonymously', async () => {
		requestUser.mockResolvedValue(null);
		const got = await call({ source_url: 'https://images.example/mug.jpg' });
		expect(got.status).toBe(401);
		expect(pinnedFetch).not.toHaveBeenCalled();
	});

	it('fetches an image link through the SSRF guard and returns the exact bytes, never rendered inline', async () => {
		pinnedFetch.mockResolvedValue(respond(200, jpeg, 'image/jpeg'));
		const got = await call({ source_url: 'https://images.example/mug.jpg' });
		expect(got.status).toBe(200);
		expect(got.raw.equals(jpeg)).toBe(true);
		expect(got.headers['x-image-format']).toBe('jpeg');
		expect(got.headers['content-type']).toBe('application/octet-stream');
		expect(got.headers['x-content-type-options']).toBe('nosniff');
		expect(got.headers['content-disposition']).toMatch(/^attachment/);
		const [url, init, opts] = pinnedFetch.mock.calls[0];
		expect(url).toBe('https://images.example/mug.jpg');
		expect(init.signal).toBeTruthy();
		expect(opts.maxBytes).toBeGreaterThan(8 * 1024 * 1024);
		expect(uploadLimit).toHaveBeenCalledWith('forge:user:user-1');
	});

	it('judges the image by its bytes, not the content type the site claims', async () => {
		pinnedFetch.mockResolvedValue(respond(200, jpeg, 'application/octet-stream'));
		const got = await call({ source_url: 'https://cdn.example/download?id=7' });
		expect(got.status).toBe(200);
		expect(got.headers['x-image-format']).toBe('jpeg');
	});

	it('a link to a web page follows the page\'s preview image (og:image) once', async () => {
		const page = '<!doctype html><html><head><meta property="og:image" content="/media/shoe.jpg"><title>Shoe</title></head><body></body></html>';
		pinnedFetch.mockResolvedValueOnce(respond(200, page, 'text/html; charset=utf-8')).mockResolvedValueOnce(respond(200, jpeg, 'image/jpeg'));
		const got = await call({ source_url: 'https://shop.example/p/shoe' });
		expect(got.status).toBe(200);
		expect(got.raw.equals(jpeg)).toBe(true);
		expect(pinnedFetch.mock.calls[1][0]).toBe('https://shop.example/media/shoe.jpg');
	});

	it('a page with no preview image is refused with a message that says what to do', async () => {
		pinnedFetch.mockResolvedValue(respond(200, '<!doctype html><html><body>hi</body></html>', 'text/html'));
		const got = await call({ source_url: 'https://blog.example/post' });
		expect(got.status).toBe(415);
		expect(got.body.error).toBe('url_not_image');
		expect(got.body.message).toMatch(/web page/);
		expect(got.body.message).toMatch(/image address/i);
	});

	it('a link to a PDF is refused by content and names the formats that work', async () => {
		pinnedFetch.mockResolvedValue(respond(200, '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n', 'image/jpeg'));
		const got = await call({ source_url: 'https://files.example/scan.jpg' });
		expect(got.status).toBe(415);
		expect(got.body.error).toBe('url_not_image');
		expect(got.body.message).toMatch(/PDF/);
		expect(got.body.message).toMatch(/HEIC/);
	});

	it('a private or local address is blocked with a plain reason', async () => {
		pinnedFetch.mockRejectedValue(new SsrfBlockedError('host 10.0.0.5 is a blocked address'));
		const got = await call({ source_url: 'https://10.0.0.5/admin.png' });
		expect(got.status).toBe(400);
		expect(got.body.error).toBe('url_blocked');
		expect(got.body.message).not.toMatch(/10\.0\.0\.5/);
	});

	it('only http(s) links are fetched at all', async () => {
		for (const source_url of ['file:///etc/passwd', 'ftp://x.example/a.jpg', 'not a url', 42]) {
			const got = await call({ source_url });
			expect(got.status, String(source_url)).toBe(400);
			expect(got.body.error).toBe('url_blocked');
		}
		expect(pinnedFetch).not.toHaveBeenCalled();
	});

	it('a site that answers 404 gets a message naming what happened', async () => {
		pinnedFetch.mockResolvedValue(respond(404, 'nope', 'text/plain'));
		const got = await call({ source_url: 'https://images.example/gone.jpg' });
		expect(got.status).toBe(422);
		expect(got.body.error).toBe('url_unreachable');
		expect(got.body.message).toMatch(/404/);
	});

	it('a site that never answers, or drops the connection, is reported as unreachable', async () => {
		pinnedFetch.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
		const got = await call({ source_url: 'https://slow.example/a.jpg' });
		expect(got.status).toBe(502);
		expect(got.body.error).toBe('url_unreachable');
		expect(got.body.message).toMatch(/save the image/i);
	});

	it('an image too large to fetch is stopped mid-stream with a size message', async () => {
		pinnedFetch.mockRejectedValue(new MaxBytesExceededError(90_000_000, 25 * 1024 * 1024));
		const got = await call({ source_url: 'https://images.example/huge.tif' });
		expect(got.status).toBe(413);
		expect(got.body.error).toBe('url_too_large');
		expect(got.body.message).toMatch(/25 MB/);
	});

	it('is rate limited with the upload allowance', async () => {
		uploadLimit.mockResolvedValue({ success: false, reset: Date.now() + 30_000 });
		const got = await call({ source_url: 'https://images.example/mug.jpg' });
		expect(got.status).toBe(429);
		expect(pinnedFetch).not.toHaveBeenCalled();
	});
});
