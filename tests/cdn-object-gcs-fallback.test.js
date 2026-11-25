/**
 * /cdn/<key> serves objects that were diverted to the GCS fallback bucket.
 *
 * Every forge creation hands its GLB out as /cdn/<key>. While R2 refuses our
 * credential (production, 2026-11-14), putObject lands those GLBs in the
 * STORAGE_FALLBACK_BUCKET instead (tests/r2-gcs-write-failover.test.js), so the
 * proxy must find them there, both during the outage (R2 answers Unauthorized)
 * and after it (R2 answers NoSuchKey until the backfill copies them back).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';

const send = vi.fn();
vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, r2: { send: (...args) => send(...args) } };
});

const fallbackFetch = vi.fn();
vi.mock('../api/_lib/storage-fallback.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, fallbackFetch: (...args) => fallbackFetch(...args) };
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

const { default: handler } = await import('../api/cdn-object.js');

const ENV = {
	S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
	S3_BUCKET: 'three-ws',
	S3_PUBLIC_DOMAIN: 'https://pub-example.r2.dev',
	S3_ACCESS_KEY_ID: 'revoked',
	S3_SECRET_ACCESS_KEY: 'revoked',
	STORAGE_FALLBACK_BUCKET: 'fallback-bucket',
};
let saved;

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

function s3Error(name, status) {
	const err = new Error(name);
	err.name = name;
	err.Code = name;
	err.$metadata = { httpStatusCode: status };
	return err;
}

function gcsResponse(bytes, { status = 200, headers = {} } = {}) {
	return new Response(new Uint8Array(bytes), { status, headers: { 'content-length': String(bytes.length), ...headers } });
}

beforeEach(() => {
	saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
	Object.assign(process.env, ENV);
	send.mockReset();
	fallbackFetch.mockReset();
	fetchUpstream.mockReset();
});

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe('/cdn with a GCS fallback bucket', () => {
	it('streams a diverted GLB while R2 rejects the credential', async () => {
		send.mockRejectedValue(s3Error('Unauthorized', 401));
		fallbackFetch.mockResolvedValue(gcsResponse([7, 7, 7], { headers: { etag: '"g1"' } }));
		const res = makeRes();
		await handler(req('forge/abc/model.glb'), res);
		expect(fallbackFetch).toHaveBeenCalledWith('forge/abc/model.glb', { range: undefined, method: 'GET' });
		expect(fetchUpstream).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('model/gltf-binary');
		expect(res.headers['access-control-allow-origin']).toBe('*');
		expect(res.headers['content-security-policy']).toContain('sandbox');
		expect(res.written()).toEqual(Buffer.from([7, 7, 7]));
	});

	it('streams a diverted object after R2 recovers but before the backfill copied it', async () => {
		send.mockRejectedValue(s3Error('NoSuchKey', 404));
		fallbackFetch.mockResolvedValue(gcsResponse([1, 2]));
		const res = makeRes();
		await handler(req('forge/abc/preview.png'), res);
		expect(res.statusCode).toBe(200);
		expect(res.written()).toEqual(Buffer.from([1, 2]));
	});

	it('passes a Range through and answers 206', async () => {
		send.mockRejectedValue(s3Error('Unauthorized', 401));
		fallbackFetch.mockResolvedValue(gcsResponse([1, 2], { status: 206, headers: { 'content-range': 'bytes 0-1/10' } }));
		const res = makeRes();
		await handler(req('forge/abc/model.glb', { range: 'bytes=0-1' }), res);
		expect(fallbackFetch).toHaveBeenCalledWith('forge/abc/model.glb', { range: 'bytes=0-1', method: 'GET' });
		expect(res.statusCode).toBe(206);
		expect(res.headers['content-range']).toBe('bytes 0-1/10');
	});

	it('still 404s a key neither store holds', async () => {
		send.mockRejectedValue(s3Error('NoSuchKey', 404));
		fallbackFetch.mockResolvedValue(null);
		const res = makeRes();
		await handler(req('forge/missing.glb'), res);
		expect(res.statusCode).toBe(404);
	});

	it('falls through to the public bucket domain when the fallback lacks an R2-only object', async () => {
		send.mockRejectedValue(s3Error('Unauthorized', 401));
		fallbackFetch.mockResolvedValue(null);
		fetchUpstream.mockResolvedValue({ status: 200, ok: true, body: new Response(new Uint8Array([9])).body, headers: new Headers({ 'content-length': '1' }) });
		const res = makeRes();
		await handler(req('thumb/old.png'), res);
		expect(fetchUpstream.mock.calls[0][0]).toBe('https://pub-example.r2.dev/thumb/old.png');
		// A throttled multi-megabyte body must not be cut at the header timeout.
		expect(fetchUpstream.mock.calls[0][2].bodyIdleMs).toBeGreaterThan(0);
		expect(res.written()).toEqual(Buffer.from([9]));
	});
});
