/**
 * /cdn/_v/<width>/<key> while the R2 credential is rejected, unit test.
 *
 * On 2026-11-15 production's R2 credential stopped verifying. The plain /cdn
 * read already streams the public bucket domain on that fault, but the variant
 * route answered every HEAD failure with a 302 to the full-size original, so
 * every gallery card on /forge and /discover downloaded the untouched render
 * (2,662 KiB and 1,263 KiB PNGs in the Lighthouse trace) instead of a ~30 KB
 * WebP. The bytes were readable the whole time: the variant is now built from
 * whichever copy answers (the GCS fallback bucket, else the public domain).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';

const send = vi.fn();
vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, r2: { send: (...args) => send(...args) } };
});

// Public-domain reads copy the object into the fallback bucket on the way
// (storage-fallback.js mirrorWhileServing). Stub the token minter and accept the
// GCS PUT so the copy never leaves the test.
vi.mock('../api/_lib/gcp-auth.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, getGcpAccessToken: async () => 'test-token' };
});
const gcsPuts = [];
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
	if (String(url).startsWith('https://storage.googleapis.com/') && init.method === 'PUT') {
		gcsPuts.push({ url: String(url), body: Buffer.from(await new Response(init.body).arrayBuffer()) });
		return new Response('', { status: 200 });
	}
	return realFetch(url, init);
};

const fetchUpstream = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, fetchUpstream: (...args) => fetchUpstream(...args) };
});

const fallbackFetch = vi.fn();
vi.mock('../api/_lib/storage-fallback.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, fallbackFetch: (...args) => fallbackFetch(...args) };
});

const { default: handler } = await import('../api/cdn-object.js');

const KEYS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'STORAGE_FALLBACK_BUCKET'];
let saved;

function makeRes() {
	const res = { statusCode: 200, headers: {}, body: null };
	res.setHeader = (k, v) => {
		res.headers[k.toLowerCase()] = String(v);
	};
	res.getHeader = (k) => res.headers[k.toLowerCase()];
	res.removeHeader = (k) => {
		delete res.headers[k.toLowerCase()];
	};
	res.end = (chunk) => {
		res.ended = true;
		if (chunk) res.body = Buffer.from(chunk);
	};
	return res;
}

const req = (key) => ({ method: 'GET', url: `/api/cdn-object?key=${key}`, headers: {}, query: { key } });

// A HEAD carries no body, so a rejected credential arrives as name `Unknown`
// with only the 401 status saying what happened (what production logged).
function headCredentialFault() {
	const err = new Error('UnknownError');
	err.name = 'Unknown';
	err.$metadata = { httpStatusCode: 401 };
	return err;
}

function upstreamResponse(bytes, { status = 200, headers = {} } = {}) {
	return {
		status,
		ok: status >= 200 && status < 300,
		headers: new Headers({ 'content-length': String(bytes.length), ...headers }),
		body: { cancel: vi.fn() },
		arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
	};
}

let bigPng;

beforeEach(async () => {
	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	process.env.S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
	process.env.S3_BUCKET = 'three-ws';
	process.env.S3_PUBLIC_DOMAIN = 'https://pub-example.r2.dev';
	process.env.S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
	process.env.S3_SECRET_ACCESS_KEY = 'secret';
	delete process.env.STORAGE_FALLBACK_BUCKET;
	send.mockReset();
	fetchUpstream.mockReset();
	fallbackFetch.mockReset();
	bigPng ??= await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 200, g: 40, b: 90 } } })
		.png()
		.toBuffer();
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('/cdn/_v on a rejected storage credential', () => {
	it('builds the WebP from the public bucket domain instead of redirecting to the full-size original', async () => {
		send.mockRejectedValue(headCredentialFault());
		fetchUpstream.mockResolvedValue(upstreamResponse(bigPng));
		const res = makeRes();
		await handler(req('_v/512/forge/k/a.png'), res);
		expect(res.getHeader('location')).toBeUndefined();
		expect(res.statusCode).toBe(200);
		expect(fetchUpstream.mock.calls[0][0]).toBe('https://pub-example.r2.dev/forge/k/a.png');
		expect(res.getHeader('content-type')).toBe('image/webp');
		const meta = await sharp(res.body).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.width).toBe(512);
		expect(res.body.length).toBeLessThan(bigPng.length);
		// Built off the degraded path: kept briefly at the edge so the normal,
		// version-keyed variant takes over within a minute of R2 recovering.
		expect(res.getHeader('cache-control')).toBe('public, max-age=60, s-maxage=60');
	});

	it('prefers the GCS fallback copy when that bucket holds the object', async () => {
		process.env.STORAGE_FALLBACK_BUCKET = 'three-ws-fallback';
		send.mockRejectedValue(headCredentialFault());
		fallbackFetch.mockResolvedValue(upstreamResponse(bigPng));
		const res = makeRes();
		await handler(req('_v/256/thumb/b.png'), res);
		expect(fetchUpstream).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(200);
		expect((await sharp(res.body).metadata()).width).toBe(256);
	});

	it('copies an R2-only source into the fallback bucket while building from the public domain', async () => {
		process.env.STORAGE_FALLBACK_BUCKET = 'three-ws-fallback';
		gcsPuts.length = 0;
		send.mockRejectedValue(headCredentialFault());
		fallbackFetch.mockResolvedValue(null);
		fetchUpstream.mockResolvedValue(new Response(new Uint8Array(bigPng), { headers: { 'content-length': String(bigPng.length), 'content-type': 'image/png' } }));
		const res = makeRes();
		await handler(req('_v/256/thumb/r2-only.png'), res);
		expect(res.statusCode).toBe(200);
		expect((await sharp(res.body).metadata()).width).toBe(256);
		expect(gcsPuts).toHaveLength(1);
		expect(gcsPuts[0].url).toBe('https://storage.googleapis.com/three-ws-fallback/thumb/r2-only.png');
		expect(gcsPuts[0].body.equals(Buffer.from(bigPng))).toBe(true);
	});

	it('answers 404 when the public domain says the object does not exist', async () => {
		send.mockRejectedValue(headCredentialFault());
		fetchUpstream.mockResolvedValue(upstreamResponse(new Uint8Array(0), { status: 404 }));
		const res = makeRes();
		await handler(req('_v/512/thumb/gone.png'), res);
		expect(res.statusCode).toBe(404);
	});

	it('still serves the original when the degraded copy cannot be resized', async () => {
		send.mockRejectedValue(headCredentialFault());
		fetchUpstream.mockResolvedValue(upstreamResponse(new Uint8Array([1, 2, 3, 4])));
		const res = makeRes();
		await handler(req('_v/512/thumb/broken.png'), res);
		expect(res.statusCode).toBe(302);
		expect(res.getHeader('location')).toBe('/cdn/thumb/broken.png');
	});

	it('sends a source above the decode cap to the original without downloading it', async () => {
		send.mockRejectedValue(headCredentialFault());
		const huge = upstreamResponse(new Uint8Array(4), { headers: { 'content-length': String(26 * 1024 * 1024) } });
		fetchUpstream.mockResolvedValue(huge);
		const res = makeRes();
		await handler(req('_v/512/forge/k/huge.png'), res);
		expect(res.statusCode).toBe(302);
		expect(huge.body.cancel).toHaveBeenCalled();
	});
});
