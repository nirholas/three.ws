import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const store = new Map();
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => ({ id: 'user-1' })),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
	hasScope: vi.fn(() => false),
}));
vi.mock('../api/_lib/r2.js', () => ({
	putObject: vi.fn(async ({ key, body }) => { store.set(key, body); }),
	getObjectBuffer: vi.fn(async (key) => { if (!store.has(key)) throw new Error('NoSuchKey'); return store.get(key); }),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({ limits: { upload: vi.fn(async () => ({ success: true })) } }));

const { default: handler } = await import('../api/avatars/layer-upload.js');

function call(method, { url = '/api/avatars/layer-upload', body } = {}) {
	return new Promise((resolve) => {
		const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
		const req = {
			method, url, headers: { 'content-type': 'application/json', host: 'x' },
			[Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; },
			rawBody: body ? chunks[0] : undefined,
			on() { return this; },
		};
		const headers = {};
		const res = {
			statusCode: 200,
			setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
			getHeader: (k) => headers[k.toLowerCase()],
			writeHead(code, h) { this.statusCode = code; Object.assign(headers, h || {}); },
			end(data) { resolve({ status: this.statusCode, headers, body: data }); },
		};
		handler(req, res);
	});
}

beforeEach(() => store.clear());

describe('POST /api/avatars/layer-upload', () => {
	it('re-encodes an image, stores it under the owner prefix and returns an upload: source', async () => {
		const png = await sharp({ create: { width: 900, height: 300, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
		const out = await call('POST', { body: { png_base64: png.toString('base64') } });
		expect(out.status).toBe(200);
		const { data } = JSON.parse(out.body);
		expect(data.source).toBe(`upload:${data.id}`);
		const stored = store.get(`u/user-1/layers/${data.id}.png`);
		const meta = await sharp(stored).metadata();
		expect(meta.width).toBe(512);
		expect(meta.height).toBe(171);
	});

	it('rejects something that is not an image with a recoverable message', async () => {
		const out = await call('POST', { body: { png_base64: Buffer.alloc(500, 7).toString('base64') } });
		expect(out.status).toBe(422);
		expect(JSON.parse(out.body).error_description).toMatch(/PNG, JPEG or WebP/);
		expect(store.size).toBe(0);
	});

	it('GET reads back only the signed-in user\'s own upload', async () => {
		store.set('u/user-1/layers/abc.png', Buffer.from('png-bytes'));
		store.set('u/user-2/layers/def.png', Buffer.from('theirs'));
		const own = await call('GET', { url: '/api/avatars/layer-upload?id=abc' });
		expect(own.status).toBe(200);
		const other = await call('GET', { url: '/api/avatars/layer-upload?id=def' });
		expect(other.status).toBe(404);
		const bad = await call('GET', { url: '/api/avatars/layer-upload?id=../x' });
		expect(bad.status).toBe(400);
	});
});
