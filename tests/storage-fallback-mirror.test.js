/**
 * Copy-on-read from the R2 public domain into the GCS fallback bucket.
 *
 * Measured 2026-11-25: R2 has refused our credential since 2026-11-14, so every
 * object written BEFORE the outage (it is in R2 only, not in the fallback
 * bucket) was served by streaming the rate-limited r2.dev public domain. That
 * was 5000+ reads a day, and about 20 a day timed out after 20s and answered
 * 502 (/cdn/u/<id>/keen-d4b849.glb, Baidu's crawler through Cloud CDN, twice
 * in a row). Each object paid the slow hop on every edge-cache miss forever.
 *
 * Now the first public-domain read of an object also writes it into the
 * fallback bucket under the same key, so every later read is the in-region
 * GCS rung. The response's end waits (bounded) for the copy to commit, because
 * Cloud Run throttles CPU once a response finishes and a detached upload would
 * stall.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';

vi.mock('../api/_lib/gcp-auth.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, getGcpAccessToken: async () => 'test-token' };
});

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
const { mirrorWhileServing } = await import('../api/_lib/storage-fallback.js');

const ENV = {
	S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
	S3_BUCKET: 'three-ws',
	S3_PUBLIC_DOMAIN: 'https://pub-example.r2.dev',
	S3_ACCESS_KEY_ID: 'revoked',
	S3_SECRET_ACCESS_KEY: 'revoked',
	STORAGE_FALLBACK_BUCKET: 'fallback-bucket',
};
let saved;
let origFetch;
let gcs;

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
		res.endedAt = gcs.committed.length;
		return end(chunk);
	};
	return res;
}

const req = (key, headers = {}) => ({ method: 'GET', url: `/api/cdn-object?key=${key}`, headers, query: { key } });

function unauthorized() {
	const err = new Error('Unauthorized');
	err.name = 'Unauthorized';
	err.Code = 'Unauthorized';
	err.$metadata = { httpStatusCode: 401 };
	return err;
}

function publicResponse(bytes, headers = {}, status = 200) {
	return new Response(new Uint8Array(bytes), { status, headers: { 'content-length': String(bytes.length), ...headers } });
}

// A fake GCS XML API: GET answers 404 (the object is R2-only), PUT records the
// uploaded bytes and headers.
function fakeGcs() {
	const state = { puts: [], committed: [] };
	state.fetch = vi.fn(async (url, init = {}) => {
		const u = new URL(String(url));
		if (u.host !== 'storage.googleapis.com') throw new Error(`unexpected fetch ${url}`);
		if ((init.method || 'GET') === 'GET') return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
		if (init.method === 'PUT') {
			const body = Buffer.from(await new Response(init.body).arrayBuffer());
			const entry = { path: u.pathname, body, headers: init.headers, duplex: init.duplex };
			state.puts.push(entry);
			state.committed.push(entry.path);
			return new Response('', { status: 200 });
		}
		throw new Error(`unexpected ${init.method} ${url}`);
	});
	return state;
}

beforeEach(() => {
	saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
	Object.assign(process.env, ENV);
	send.mockReset();
	fetchUpstream.mockReset();
	origFetch = global.fetch;
	gcs = fakeGcs();
	global.fetch = gcs.fetch;
});

afterEach(() => {
	global.fetch = origFetch;
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe('/cdn copies an R2-only object into the fallback bucket on its public-domain read', () => {
	it('serves the bytes and commits the same bytes to the fallback bucket before ending', async () => {
		send.mockRejectedValue(unauthorized());
		const bytes = [103, 108, 84, 70, 2, 0, 0, 0];
		fetchUpstream.mockResolvedValue(publicResponse(bytes, { 'content-type': 'model/gltf-binary' }));
		const res = makeRes();
		await handler(req('u/owner-1/keen-d4b849.glb'), res);

		expect(res.statusCode).toBe(200);
		expect(res.written()).toEqual(Buffer.from(bytes));
		expect(gcs.puts).toHaveLength(1);
		const put = gcs.puts[0];
		expect(put.path).toBe('/fallback-bucket/u/owner-1/keen-d4b849.glb');
		expect(put.body).toEqual(Buffer.from(bytes));
		expect(put.headers['content-type']).toBe('model/gltf-binary');
		expect(put.headers['content-length']).toBe(String(bytes.length));
		expect(put.headers['x-goog-meta-mirrored-from']).toBe('r2-public-domain');
		expect(put.duplex).toBe('half');
		// The copy committed before the response ended, so a throttled CPU after
		// the response cannot strand it.
		expect(res.endedAt).toBe(1);
	});

	it('does not copy a ranged read', async () => {
		send.mockRejectedValue(unauthorized());
		fetchUpstream.mockResolvedValue(publicResponse([1, 2], { 'content-range': 'bytes 0-1/10' }, 206));
		const res = makeRes();
		await handler(req('u/owner-1/big.glb', { range: 'bytes=0-1' }), res);
		expect(res.statusCode).toBe(206);
		expect(gcs.puts).toHaveLength(0);
	});
});

describe('mirrorWhileServing', () => {
	it('skips a compressed body, whose length header does not match the decoded bytes', async () => {
		const out = mirrorWhileServing('thumb/a.json', publicResponse([1, 2, 3], { 'content-encoding': 'gzip' }));
		expect(await out.settled).toBe(false);
		expect(gcs.puts).toHaveLength(0);
	});

	it('skips an object above the size cap', async () => {
		const out = mirrorWhileServing('u/x/huge.glb', publicResponse([1, 2, 3]), { maxBytes: 2 });
		expect(await out.settled).toBe(false);
		expect(gcs.puts).toHaveLength(0);
	});

	it('copies a key once while a copy of it is already in flight', async () => {
		const a = mirrorWhileServing('u/x/same.glb', publicResponse([5, 5]));
		const b = mirrorWhileServing('u/x/same.glb', publicResponse([5, 5]));
		await Promise.all([new Response(a.body).arrayBuffer(), new Response(b.body).arrayBuffer()]);
		expect(await a.settled).toBe(true);
		expect(await b.settled).toBe(false);
		expect(gcs.puts).toHaveLength(1);
	});

	it('still serves the client in full when the copy is refused', async () => {
		global.fetch = vi.fn(async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }));
		const out = mirrorWhileServing('u/x/denied.glb', publicResponse([4, 3, 2, 1]));
		const served = Buffer.from(await new Response(out.body).arrayBuffer());
		expect(served).toEqual(Buffer.from([4, 3, 2, 1]));
		expect(await out.settled).toBe(false);
	});

	it('does nothing when no fallback bucket is configured', async () => {
		delete process.env.STORAGE_FALLBACK_BUCKET;
		const upstream = publicResponse([1]);
		const out = mirrorWhileServing('u/x/a.glb', upstream);
		expect(out.body).toBe(upstream.body);
		expect(await out.settled).toBe(false);
	});
});
