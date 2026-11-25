// GET /api/avatars/:id/glb must read the GCS fallback bucket.
//
// While R2 refuses our credential (since 2026-11-14), putObject diverts every new
// GLB into STORAGE_FALLBACK_BUCKET (api/_lib/storage-fallback.js), and /cdn/<key>
// learned to read it back (tests/cdn-object-gcs-fallback.test.js). This route did
// not: it tried the signed R2 read, then the public r2.dev domain, and both miss
// an object R2 never received. On 2026-11-25 it answered 502 "failed to fetch
// avatar glb" for avatars whose GLBs sat in the fallback bucket the whole time
// (u/492621a3-.../zenith-aced97.glb among them), so the widget, /walk and every
// embed swapped the user's model for the robot placeholder.
//
// R2, the public-domain fetch and the GCS read are stubbed at the module
// boundary; no network.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: async () => {} }));
vi.mock('../../api/_lib/db.js', () => ({ sql: async () => [] }));
vi.mock('../../api/_lib/env.js', () => ({
	env: { S3_BUCKET: 'test-bucket', S3_PUBLIC_DOMAIN: 'https://pub-test.r2.dev' },
}));

const AVATAR_ID = '00000000-0000-4000-8000-000000000002';
const KEY = 'u/owner/diverted.glb';
const GLB_BYTES = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(60, 3)]);

vi.mock('../../api/_lib/avatars.js', () => ({
	getAvatar: async () => ({
		id: AVATAR_ID,
		visibility: 'public',
		owner_id: 'owner-1',
		storage_key: KEY,
		baked_storage_key: null,
		appearance_hash: null,
	}),
	resolveAvatarUrl: () => `https://pub-test.r2.dev/${KEY}`,
}));

let sendImpl;
vi.mock('../../api/_lib/r2.js', async (importOriginal) => ({
	...(await importOriginal()),
	r2: { send: (...args) => sendImpl(...args) },
}));

let fetchUpstreamImpl;
vi.mock('../../api/_lib/upstream-fetch.js', async (importOriginal) => ({
	...(await importOriginal()),
	fetchUpstream: (...args) => fetchUpstreamImpl(...args),
}));

// The public-domain rung copies the GLB into the fallback bucket on the way
// (storage-fallback.js mirrorWhileServing). Its token minter and the GCS PUT
// are stubbed so the copy never leaves the test.
vi.mock('../../api/_lib/gcp-auth.js', async (importOriginal) => ({
	...(await importOriginal()),
	getGcpAccessToken: async () => 'test-token',
}));
const gcsPuts = [];
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
	if (String(url).startsWith('https://storage.googleapis.com/') && init.method === 'PUT') {
		gcsPuts.push({ url: String(url), body: Buffer.from(await new Response(init.body).arrayBuffer()), headers: init.headers });
		return new Response('', { status: 200 });
	}
	throw new Error(`unexpected fetch in test: ${url}`);
};
afterAll(() => {
	global.fetch = realFetch;
});

let fallbackFetchImpl;
vi.mock('../../api/_lib/storage-fallback.js', async (importOriginal) => ({
	...(await importOriginal()),
	fallbackFetch: (...args) => fallbackFetchImpl(...args),
}));

const savedBucket = process.env.STORAGE_FALLBACK_BUCKET;
process.env.STORAGE_FALLBACK_BUCKET = 'fallback-bucket';
afterAll(() => {
	if (savedBucket === undefined) delete process.env.STORAGE_FALLBACK_BUCKET;
	else process.env.STORAGE_FALLBACK_BUCKET = savedBucket;
});

const handler = (await import('../../api/avatars/[id]/[action].js')).default;

function makeRes() {
	const chunks = [];
	return {
		statusCode: 200,
		_h: {},
		chunks,
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		removeHeader(k) { delete this._h[k.toLowerCase()]; },
		write(c) { chunks.push(Buffer.from(c)); this.headersSent = true; return true; },
		end(body) { if (body) chunks.push(Buffer.from(body)); this.writableEnded = true; this.headersSent = true; if (this._fin) this._fin(); },
		on(ev, fn) { if (ev === 'finish' || ev === 'close') this._fin = fn; return this; },
		once(ev, fn) { return this.on(ev, fn); },
		emit() {},
		removeListener() { return this; },
		destroy() { this.writableEnded = true; },
		get body() { return Buffer.concat(chunks).toString('utf8'); },
	};
}

async function invoke() {
	const req = { method: 'GET', url: `/api/avatars/${AVATAR_ID}/glb`, headers: {}, query: { id: AVATAR_ID, action: 'glb' } };
	const res = makeRes();
	await handler(req, res);
	return res;
}

const unauthorized = () => Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', Code: 'Unauthorized' });
const noSuchKey = () => Object.assign(new Error('nope'), { name: 'NoSuchKey', Code: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
const gcsServes = (bytes) => async (key) => {
	expect(key).toBe(KEY);
	return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.length), etag: '"gcs"' } });
};
const publicDomain404 = async () => {
	throw Object.assign(new Error('http 404 <!doctype html>'), { status: 404 });
};

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
	gcsPuts.length = 0;
	sendImpl = async () => { throw new Error('r2.send not stubbed'); };
	fetchUpstreamImpl = publicDomain404;
	fallbackFetchImpl = async () => null;
});

describe('avatar glb proxy: GCS fallback bucket', () => {
	it('streams a diverted GLB from the fallback bucket while R2 rejects the credential', async () => {
		sendImpl = async () => { throw unauthorized(); };
		fallbackFetchImpl = gcsServes(GLB_BYTES);
		const res = await invoke();
		expect(res.statusCode).toBe(200);
		expect(Buffer.concat(res.chunks).equals(GLB_BYTES)).toBe(true);
		expect(res.getHeader('content-type')).toBe('model/gltf-binary');
		expect(res.getHeader('access-control-allow-origin')).toBe('*');
		expect(res.getHeader('cache-control')).toBe('no-store');
	});

	it('streams it from the fallback bucket after R2 recovers but before the backfill copies it back', async () => {
		sendImpl = async () => { throw noSuchKey(); };
		fallbackFetchImpl = gcsServes(GLB_BYTES);
		const res = await invoke();
		expect(res.statusCode).toBe(200);
		expect(Buffer.concat(res.chunks).equals(GLB_BYTES)).toBe(true);
	});

	it('still answers 404 when neither R2 nor the fallback bucket has the object', async () => {
		sendImpl = async () => { throw noSuchKey(); };
		const res = await invoke();
		expect(res.statusCode).toBe(404);
	});

	// Production on 2026-11-25: two avatars point at draft GLBs no store holds.
	// R2 rejected the credential, the fallback bucket had no such object and the
	// public bucket domain answered 404, yet the route said 502 upstream_error,
	// which tells every client to retry a read that can never succeed.
	it('answers 404 when R2 rejects the credential and every other store says the object does not exist', async () => {
		sendImpl = async () => { throw unauthorized(); };
		const res = await invoke();
		expect(res.statusCode).toBe(404);
		expect(JSON.parse(res.body).error).toBe('not_found');
	});

	it('still answers 502 when the public bucket domain itself is failing', async () => {
		sendImpl = async () => { throw unauthorized(); };
		fetchUpstreamImpl = async () => {
			throw Object.assign(new Error('timed out after 20000ms'), { name: 'TimeoutError' });
		};
		const res = await invoke();
		expect(res.statusCode).toBe(502);
	});

	it('falls through to the public bucket domain when the fallback bucket does not hold the key', async () => {
		sendImpl = async () => { throw unauthorized(); };
		fetchUpstreamImpl = async () => ({
			ok: true,
			status: 200,
			headers: new Headers({ 'content-length': String(GLB_BYTES.length) }),
			body: Readable.toWeb(Readable.from([GLB_BYTES])),
		});
		const res = await invoke();
		expect(res.statusCode).toBe(200);
		expect(Buffer.concat(res.chunks).equals(GLB_BYTES)).toBe(true);
		// ...and copies it into the fallback bucket, so the next read is in-region.
		expect(gcsPuts).toHaveLength(1);
		expect(gcsPuts[0].url).toBe(`https://storage.googleapis.com/fallback-bucket/${KEY}`);
		expect(gcsPuts[0].body.equals(GLB_BYTES)).toBe(true);
		expect(gcsPuts[0].headers['x-goog-meta-mirrored-from']).toBe('r2-public-domain');
	});
});
