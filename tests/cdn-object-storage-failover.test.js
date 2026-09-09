/**
 * /cdn/<key> failover, unit test.
 *
 * The signed read exists to dodge the public bucket domain's rate limit, not
 * because the public domain is unavailable: the same bytes are readable there,
 * unauthenticated, the whole time. On 2026-09-07 the R2 credential stopped
 * verifying and this route answered `upstream_error` for every avatar, thumbnail
 * and GLB on the site while `pub-….r2.dev` was serving those same keys with a
 * 200. A credential fault now serves those bytes instead of 502ing the page.
 *
 * It STREAMS them; it must never redirect to them. `pub-….r2.dev` sends no
 * access-control-allow-origin, and a browser re-runs the CORS check on a
 * redirect's target, so a 302 discards the wildcard grant this route sets and
 * turns a 502 into a cross-origin "Failed to fetch" for every embed, every
 * GLTFLoader and every model-viewer off three.ws. Measured from a foreign origin
 * on 2026-09-09, which is what took the stages on /spatial-mcp dark.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';

const send = vi.fn();
vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, r2: { send: (...args) => send(...args) } };
});

const fetchUpstream = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, fetchUpstream: (...args) => fetchUpstream(...args) };
});

const { default: handler } = await import('../api/cdn-object.js');

const KEYS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
let saved;

/** A response sink that is a real Writable, so `pipeline()` drives it for real. */
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
	res.setHeader = (k, v) => {
		res.headers[k.toLowerCase()] = String(v);
	};
	res.getHeader = (k) => res.headers[k.toLowerCase()];
	res.removeHeader = (k) => {
		delete res.headers[k.toLowerCase()];
	};
	res.written = () => Buffer.concat(chunks);
	const end = res.end.bind(res);
	res.end = (chunk) => {
		res.ended = true;
		return end(chunk);
	};
	return res;
}

const req = (key, headers = {}, method = 'GET') => ({ method, url: `/api/cdn-object?key=${key}`, headers, query: { key } });

function s3Error(name, message) {
	const err = new Error(message);
	err.name = name;
	err.Code = name;
	err.$metadata = { httpStatusCode: 403 };
	return err;
}

/** A `fetch` Response as the handler consumes it: web stream body plus headers. */
function upstreamResponse(bytes, { status = 200, headers = {} } = {}) {
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(bytes));
			controller.close();
		},
	});
	return { status, ok: status >= 200 && status < 300, body, headers: new Headers(headers) };
}

const CREDENTIAL_FAULT = s3Error(
	'SignatureDoesNotMatch',
	'The request signature we calculated does not match the signature you provided. Check your secret access key and signing method.',
);

beforeEach(() => {
	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	process.env.S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
	process.env.S3_BUCKET = 'three-ws';
	process.env.S3_PUBLIC_DOMAIN = 'https://pub-example.r2.dev';
	process.env.S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
	process.env.S3_SECRET_ACCESS_KEY = 'secret';
	send.mockReset();
	fetchUpstream.mockReset();
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('/cdn on a storage credential fault', () => {
	it('streams the public bucket domain instead of 502ing the object', async () => {
		send.mockRejectedValue(CREDENTIAL_FAULT);
		fetchUpstream.mockResolvedValue(upstreamResponse([1, 2, 3, 4], { headers: { 'content-length': '4' } }));
		const res = makeRes();
		await handler(req('thumb/abc.png'), res);
		expect(fetchUpstream.mock.calls[0][0]).toBe('https://pub-example.r2.dev/thumb/abc.png');
		expect(res.statusCode).toBe(200);
		expect(res.written()).toEqual(Buffer.from([1, 2, 3, 4]));
	});

	it('never redirects, because the public domain answers with no CORS header', async () => {
		send.mockRejectedValue(s3Error('InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.'));
		fetchUpstream.mockResolvedValue(upstreamResponse([9]));
		const res = makeRes();
		await handler(req('u/1/model.glb'), res);
		expect(res.statusCode).toBe(200);
		expect(res.getHeader('location')).toBeUndefined();
	});

	it('keeps serving the server-chosen content type on the degraded path', async () => {
		send.mockRejectedValue(CREDENTIAL_FAULT);
		fetchUpstream.mockResolvedValue(upstreamResponse([0], { headers: { 'content-type': 'text/html' } }));
		const res = makeRes();
		await handler(req('u/1/model.glb'), res);
		expect(res.getHeader('content-type')).toBe('model/gltf-binary');
		expect(res.getHeader('cross-origin-resource-policy')).toBe('cross-origin');
	});

	it('forwards a range request and answers 206 with the upstream range', async () => {
		send.mockRejectedValue(CREDENTIAL_FAULT);
		fetchUpstream.mockResolvedValue(
			upstreamResponse([7, 8], { status: 206, headers: { 'content-range': 'bytes 0-1/100', 'content-length': '2' } }),
		);
		const res = makeRes();
		await handler(req('u/1/model.glb', { range: 'bytes=0-1' }), res);
		expect(fetchUpstream.mock.calls[0][1].headers.range).toBe('bytes=0-1');
		expect(res.statusCode).toBe(206);
		expect(res.getHeader('content-range')).toBe('bytes 0-1/100');
	});

	it('caches the degraded hop briefly so a burst costs the rate-limited domain one read', async () => {
		send.mockRejectedValue(CREDENTIAL_FAULT);
		fetchUpstream.mockResolvedValue(upstreamResponse([1]));
		const res = makeRes();
		await handler(req('thumb/abc.png'), res);
		expect(res.getHeader('cache-control')).toBe('public, max-age=60, s-maxage=60');
	});

	it('answers 404 when the public domain says the object is genuinely absent', async () => {
		send.mockRejectedValue(CREDENTIAL_FAULT);
		fetchUpstream.mockResolvedValue(upstreamResponse([], { status: 404 }));
		const res = makeRes();
		await handler(req('thumb/gone.png'), res);
		expect(res.statusCode).toBe(404);
	});

	it('502s once the public domain fails too, with no length left pinned to the object', async () => {
		send.mockRejectedValue(CREDENTIAL_FAULT);
		fetchUpstream.mockRejectedValue(new Error('r2.dev unreachable'));
		const res = makeRes();
		await handler(req('thumb/abc.png'), res);
		expect(res.statusCode).toBe(502);
		expect(res.getHeader('content-length')).toBeUndefined();
	});

	it('still 404s a missing object rather than bouncing it to the public domain', async () => {
		send.mockRejectedValue(s3Error('NoSuchKey', 'The specified key does not exist.'));
		const res = makeRes();
		await handler(req('thumb/gone.png'), res);
		expect(res.statusCode).toBe(404);
		expect(fetchUpstream).not.toHaveBeenCalled();
	});

	it('keeps 502ing a fault that says nothing about our credentials', async () => {
		const err = new Error('unexpected upstream state');
		err.$metadata = { httpStatusCode: 500 };
		send.mockRejectedValue(err);
		const res = makeRes();
		await handler(req('thumb/abc.png'), res);
		expect(res.statusCode).toBe(502);
		expect(fetchUpstream).not.toHaveBeenCalled();
	});
});
