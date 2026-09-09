// Tests for /cdn/<key> → /api/cdn-object — the first-party R2 proxy that
// replaced direct *.r2.dev URLs (Cloudflare rate-limits the public dev domain,
// which surfaced as `failed to load img / model-viewer` client errors on
// gallery pages).
//
// R2 is mocked at the client level; no network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'node:stream';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: async () => {} }));
vi.mock('../../api/_lib/env.js', () => ({ env: { S3_BUCKET: 'test-bucket', S3_PUBLIC_DOMAIN: 'https://pub-test.r2.dev' } }));

let sendImpl = async () => {
	throw new Error('r2.send not stubbed for this test');
};
// Only the S3 client is stubbed. The rest of the module stays real, so the
// handler's fallback branch is judged by the SAME `isStorageInfrastructureError`
// production runs; a factory that returned `r2` alone left that import
// undefined and turned every upstream 502 into a 500 the moment cdn-object.js
// started importing it.
vi.mock('../../api/_lib/r2.js', async (importOriginal) => ({
	...(await importOriginal()),
	r2: { send: (...args) => sendImpl(...args) },
}));

// The public-domain failover reads over the network. Stub only that call, so the
// branch that chooses it stays the real one.
let fetchUpstreamImpl = async () => {
	throw new Error('fetchUpstream not stubbed for this test');
};
vi.mock('../../api/_lib/upstream-fetch.js', async (importOriginal) => ({
	...(await importOriginal()),
	fetchUpstream: (...args) => fetchUpstreamImpl(...args),
}));

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

import handler from '../../api/cdn-object.js';

function makeBody() {
	return { pipe: vi.fn(), on: vi.fn(), destroy: vi.fn() };
}

function makeReq({ key, method = 'GET', headers = {} } = {}) {
	return { method, url: `/api/cdn-object?key=${key}`, headers, query: { key } };
}

function makeRes() {
	const chunks = [];
	const res = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(Buffer.from(chunk));
			cb();
		},
	});
	res.statusCode = 200;
	res._h = {};
	res.body = undefined;
	res.headersSent = false;
	res.setHeader = (k, v) => { res._h[k.toLowerCase()] = v; };
	res.getHeader = (k) => res._h[k.toLowerCase()];
	res.removeHeader = (k) => { delete res._h[k.toLowerCase()]; };
	res.written = () => Buffer.concat(chunks);
	const end = res.end.bind(res);
	res.end = (body) => {
		res.body = body;
		res.headersSent = true;
		return end(typeof body === 'string' || Buffer.isBuffer(body) ? body : undefined);
	};
	return res;
}

async function invoke(opts) {
	const req = makeReq(opts);
	const res = makeRes();
	await handler(req, res);
	return res;
}

beforeEach(() => {
	sendImpl = async () => {
		throw new Error('r2.send not stubbed for this test');
	};
	fetchUpstreamImpl = async () => {
		throw new Error('fetchUpstream not stubbed for this test');
	};
});

describe('GET /cdn/<key> — key validation', () => {
	it('rejects a missing key', async () => {
		const res = await invoke({ key: '' });
		expect(res.statusCode).toBe(400);
	});

	it('rejects path traversal', async () => {
		const res = await invoke({ key: 'u/../../secrets.env' });
		expect(res.statusCode).toBe(400);
	});

	it('rejects keys with disallowed characters', async () => {
		const res = await invoke({ key: 'u/owner/<script>.glb' });
		expect(res.statusCode).toBe(400);
	});

	it('rejects non-GET/HEAD methods', async () => {
		const res = await invoke({ key: 'thumb/a.png', method: 'POST' });
		expect(res.statusCode).toBe(405);
	});
});

describe('GET /cdn/<key> — streaming', () => {
	it('streams an object with passthrough metadata and long content-key caching', async () => {
		const body = makeBody();
		let gotCmd;
		sendImpl = async (cmd) => {
			gotCmd = cmd.input;
			return { Body: body, ContentType: 'model/gltf-binary', ContentLength: 1234, ETag: '"abc"' };
		};
		const res = await invoke({ key: 'u/owner-1/draft-x/model.glb' });

		expect(gotCmd.Bucket).toBe('test-bucket');
		expect(gotCmd.Key).toBe('u/owner-1/draft-x/model.glb');
		expect(res.statusCode).toBe(200);
		expect(res.getHeader('content-type')).toBe('model/gltf-binary');
		expect(res.getHeader('content-length')).toBe('1234');
		expect(res.getHeader('etag')).toBe('"abc"');
		expect(res.getHeader('cache-control')).toContain('s-maxage=2592000');
		expect(body.pipe).toHaveBeenCalledWith(res);
	});

	it('uses a shorter, revalidating cache policy for regenerable thumbnails', async () => {
		sendImpl = async () => ({ Body: makeBody(), ContentType: 'image/png', ContentLength: 10, ETag: '"t"' });
		const res = await invoke({ key: 'thumb/abcd-1234.png' });
		expect(res.getHeader('cache-control')).toContain('max-age=3600');
		expect(res.getHeader('cache-control')).toContain('s-maxage=86400');
	});

	it('derives content-type from the extension when R2 stored octet-stream', async () => {
		sendImpl = async () => ({ Body: makeBody(), ContentType: 'application/octet-stream', ContentLength: 10 });
		const res = await invoke({ key: 'thumb/abcd.png' });
		expect(res.getHeader('content-type')).toBe('image/png');
	});

	it('answers HEAD with headers only and releases the body stream', async () => {
		const body = makeBody();
		sendImpl = async () => ({ Body: body, ContentType: 'image/png', ContentLength: 10, ETag: '"h"' });
		const res = await invoke({ key: 'thumb/abcd.png', method: 'HEAD' });
		expect(res.statusCode).toBe(200);
		expect(res.writableEnded).toBe(true);
		expect(body.pipe).not.toHaveBeenCalled();
		expect(body.destroy).toHaveBeenCalled();
	});
});

describe('GET /cdn/<key> — error mapping', () => {
	it('maps NoSuchKey to 404', async () => {
		sendImpl = async () => {
			throw Object.assign(new Error('no such key'), { Code: 'NoSuchKey' });
		};
		const res = await invoke({ key: 'u/owner/gone.glb' });
		expect(res.statusCode).toBe(404);
	});

	it('returns 304 when the client ETag still matches', async () => {
		sendImpl = async () => {
			throw Object.assign(new Error('not modified'), { $metadata: { httpStatusCode: 304 } });
		};
		const res = await invoke({ key: 'thumb/abcd.png', headers: { 'if-none-match': '"abc"' } });
		expect(res.statusCode).toBe(304);
		expect(res.getHeader('etag')).toBe('"abc"');
	});

	it('maps other upstream failures to 502', async () => {
		sendImpl = async () => {
			throw new Error('connection reset');
		};
		const res = await invoke({ key: 'u/owner/a.glb' });
		expect(res.statusCode).toBe(502);
	});

	// A rejected credential takes the signed read down for every object at once
	// while the public bucket domain keeps serving those same keys, so this route
	// serves them from there rather than 502ing every avatar, thumbnail and GLB on
	// the site. Live on 2026-09-07, which is what the fallback was written for.
	// Both wordings are covered because the SDK reports the same rejection two
	// ways and the compact code was all the predicate used to match.
	//
	// It streams; it must never redirect. pub-*.r2.dev sends no
	// access-control-allow-origin, and a browser re-runs the CORS check on a
	// redirect's target, so a 302 discards the wildcard grant this route sets and
	// every cross-origin read of /cdn fails outright (measured from a foreign
	// origin on 2026-09-09).
	for (const [label, build] of [
		['the compact SDK code', () => Object.assign(new Error('signature mismatch'), { name: 'SignatureDoesNotMatch' })],
		[
			'the sentence the SDK writes instead',
			() =>
				new Error(
					'The request signature we calculated does not match the signature you provided. Check your secret access key and signing method.',
				),
		],
	]) {
		it(`serves the public bucket domain when the credential is rejected, reported as ${label}`, async () => {
			sendImpl = async () => {
				throw build();
			};
			fetchUpstreamImpl = async () => upstreamResponse([1, 2, 3]);
			const res = await invoke({ key: 'u/owner/a.glb' });
			expect(res.statusCode).toBe(200);
			expect(res.getHeader('location')).toBeUndefined();
			expect(res.written()).toEqual(Buffer.from([1, 2, 3]));
			// The response stays on three.ws, so the grant callers depend on
			// survives the degraded path.
			expect(res.getHeader('cross-origin-resource-policy')).toBe('cross-origin');
			// Cached briefly, not forever and not never: a burst of gallery
			// thumbnails costs the rate-limited domain one read, and traffic
			// returns to the signed path within a minute of the credential
			// being healthy again.
			expect(res.getHeader('cache-control')).toBe('public, max-age=60, s-maxage=60');
		});
	}
});
