// Display-sized variants on /cdn/ (src/shared/cdn-variant.js + api/cdn-object.js).
//
// Grids on /discover, /marketplace and /forge painted 768 px avatar PNGs (about
// 160 KB each) and multi-megabyte maker posters into 36 to 293 px boxes; the
// 2026-11-13 Lighthouse trace of /marketplace listed a dozen of them among its
// top transfers. `/cdn/_v/<width>/<key>` serves a WebP derivative that fits the
// box, built once per source version and persisted, while the original key keeps
// serving the untouched bytes to every other consumer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable, Readable } from 'node:stream';
import sharp from 'sharp';

const send = vi.fn();
vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, r2: { send: (...args) => send(...args) } };
});

const { default: handler } = await import('../api/cdn-object.js');
const { parseVariantKey, variantObjectKey, sizedImageUrl, variantWidthFor } = await import('../src/shared/cdn-variant.js');

function makeRes() {
	const chunks = [];
	const res = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(Buffer.from(chunk));
			cb();
		},
	});
	res.statusCode = 200;
	res.headers = {};
	res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = String(v); };
	res.getHeader = (k) => res.headers[k.toLowerCase()];
	res.removeHeader = (k) => { delete res.headers[k.toLowerCase()]; };
	res.written = () => Buffer.concat(chunks);
	const end = res.end.bind(res);
	res.done = new Promise((resolve) => { res.on('finish', resolve); });
	res.end = (chunk) => { res.ended = true; return end(chunk); };
	return res;
}

const req = (key, headers = {}, method = 'GET') => ({ method, url: `/api/cdn-object?key=${key}`, headers, query: { key } });

function notFound() {
	const err = new Error('nope');
	err.name = 'NoSuchKey';
	err.Code = 'NoSuchKey';
	err.$metadata = { httpStatusCode: 404 };
	return err;
}

const KEYS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
let saved;
let sourcePng;
beforeEach(async () => {
	send.mockReset();
	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	process.env.S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
	process.env.S3_BUCKET = 'three-ws';
	process.env.S3_PUBLIC_DOMAIN = 'https://pub-example.r2.dev';
	process.env.S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
	process.env.S3_SECRET_ACCESS_KEY = 'secret';
	sourcePng ??= await sharp({ create: { width: 768, height: 768, channels: 3, background: { r: 200, g: 40, b: 90 } } })
		.png()
		.toBuffer();
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('variant grammar', () => {
	it('parses allowed widths over raster sources only', () => {
		expect(parseVariantKey('_v/512/thumb/a.png')).toEqual({ width: 512, source: 'thumb/a.png' });
		expect(parseVariantKey('_v/300/thumb/a.png')).toBeNull();
		expect(parseVariantKey('_v/512/u/x/model.glb')).toBeNull();
		expect(parseVariantKey('_v/512/_v/256/a.png')).toBeNull();
		expect(parseVariantKey('thumb/a.png')).toBeNull();
	});

	it('keys a derivative by source version', () => {
		expect(variantObjectKey('thumb/a.png', 256, '"abc123"')).toBe('variants/256/thumb/a.png.abc123.webp');
		expect(variantObjectKey('thumb/a.png', 256, '"abc123"')).not.toBe(variantObjectKey('thumb/a.png', 256, '"def456"'));
	});

	it('picks the smallest width covering the box at 2x', () => {
		expect(variantWidthFor(36)).toBe(128);
		expect(variantWidthFor(120)).toBe(256);
		expect(variantWidthFor(293)).toBe(512);
	});

	it('rewrites first-party /cdn/ rasters and leaves everything else alone', () => {
		const origin = 'http://localhost:3000';
		expect(sizedImageUrl('https://three.ws/cdn/thumb/a.png', 293, { origin })).toBe('https://three.ws/cdn/_v/512/thumb/a.png');
		expect(sizedImageUrl('/cdn/forge/k/a.jpg', 100, { origin })).toBe('/cdn/_v/256/forge/k/a.jpg');
		expect(sizedImageUrl('http://localhost:3000/cdn/thumb/a.png', 36, { origin })).toBe('http://localhost:3000/cdn/_v/128/thumb/a.png');
		expect(sizedImageUrl('https://evil.example/cdn/thumb/a.png', 293, { origin })).toBe('https://evil.example/cdn/thumb/a.png');
		expect(sizedImageUrl('https://three.ws/cdn/u/x/model.glb', 293, { origin })).toBe('https://three.ws/cdn/u/x/model.glb');
		expect(sizedImageUrl('https://three.ws/cdn/forge/thumb/id.webp', 293, { origin })).toBe('https://three.ws/cdn/forge/thumb/id.webp');
		expect(sizedImageUrl('https://three.ws/cdn/_v/512/thumb/a.png', 293, { origin })).toBe('https://three.ws/cdn/_v/512/thumb/a.png');
		expect(sizedImageUrl(null, 293)).toBeNull();
	});
});

describe('GET /cdn/_v/<width>/<key>', () => {
	it('builds, persists and serves a WebP that fits the width', async () => {
		const puts = [];
		send.mockImplementation(async (cmd) => {
			const name = cmd.constructor.name;
			const { Key } = cmd.input;
			if (name === 'HeadObjectCommand') return { ETag: '"etag1"', ContentLength: sourcePng.length };
			if (name === 'GetObjectCommand' && Key.startsWith('variants/')) throw notFound();
			if (name === 'GetObjectCommand' && Key === 'thumb/a.png') return { Body: Readable.from([sourcePng]) };
			if (name === 'PutObjectCommand') { puts.push(cmd.input); return {}; }
			throw new Error(`unexpected ${name} ${Key}`);
		});
		const res = makeRes();
		await handler(req('_v/256/thumb/a.png'), res);
		await res.done;
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('image/webp');
		expect(res.headers['cache-control']).toMatch(/max-age=3600/);
		const body = res.written();
		const meta = await sharp(body).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.width).toBe(256);
		expect(body.length).toBeLessThan(sourcePng.length);
		expect(puts).toHaveLength(1);
		expect(puts[0].Key).toBe('variants/256/thumb/a.png.etag1.webp');
		expect(puts[0].ContentType).toBe('image/webp');
	});

	it('serves a persisted derivative without re-encoding', async () => {
		const stored = await sharp(sourcePng).resize(512).webp().toBuffer();
		send.mockImplementation(async (cmd) => {
			const name = cmd.constructor.name;
			if (name === 'HeadObjectCommand') return { ETag: '"etag1"' };
			if (name === 'GetObjectCommand' && cmd.input.Key === 'variants/512/thumb/a.png.etag1.webp') return { Body: Readable.from([stored]) };
			throw new Error(`unexpected ${name} ${cmd.input.Key}`);
		});
		const res = makeRes();
		await handler(req('_v/512/thumb/a.png'), res);
		await res.done;
		expect(res.statusCode).toBe(200);
		expect(res.written().equals(stored)).toBe(true);
	});

	it('answers 404 when the source is missing', async () => {
		send.mockImplementation(async () => { throw notFound(); });
		const res = makeRes();
		await handler(req('_v/512/thumb/missing.png'), res);
		expect(res.statusCode).toBe(404);
	});

	it('falls back to the original when the source cannot be decoded', async () => {
		send.mockImplementation(async (cmd) => {
			const name = cmd.constructor.name;
			if (name === 'HeadObjectCommand') return { ETag: '"e"', ContentLength: 9 };
			if (name === 'GetObjectCommand' && cmd.input.Key.startsWith('variants/')) throw notFound();
			if (name === 'GetObjectCommand') return { Body: Readable.from([Buffer.from('not a png')]) };
			throw new Error(`unexpected ${name}`);
		});
		const res = makeRes();
		await handler(req('_v/512/thumb/broken.png'), res);
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe('/cdn/thumb/broken.png');
	});

	it('answers 304 for a matching If-None-Match', async () => {
		send.mockImplementation(async (cmd) => {
			if (cmd.constructor.name === 'HeadObjectCommand') return { ETag: '"etag1"' };
			throw new Error('should not read');
		});
		const res = makeRes();
		await handler(req('_v/512/thumb/a.png', { 'if-none-match': '"etag1-w512"' }), res);
		expect(res.statusCode).toBe(304);
	});
});
