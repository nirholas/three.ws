// GET /api/avatars/:id/glb for an avatar whose storage_key is an absolute URL.
//
// Catalog avatars imported from a static file keep that file's URL as their
// storage key (Michelle's is https://three.ws/avatars/michelle.glb); r2.js
// already treats such a key as "already a public URL, not a bucket object" in
// publicUrl(), cdnUrl() and delete. This route did not: it asked R2 for an
// object literally named "https://three.ws/avatars/michelle.glb", got
// NoSuchKey, and answered 404 "avatar glb missing from storage". The walk
// companion on /render-lab?avatar=<michelle> logged the 404 and swapped her
// for the robot placeholder, inside the frame of the X proof reel.
//
// The fix reads the absolute URL instead of the bucket and streams it through,
// so the wildcard CORS headers this route exists for still apply. Network and
// R2 are stubbed at the module boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: async () => {} }));
vi.mock('../../api/_lib/db.js', () => ({ sql: async () => [] }));
vi.mock('../../api/_lib/env.js', () => ({
	env: { S3_BUCKET: 'test-bucket', S3_PUBLIC_DOMAIN: 'https://pub-test.r2.dev' },
}));

const AVATAR_ID = '13f259c7-7024-4d68-b1f0-dbbf52c06209';
const STATIC_URL = 'https://three.ws/avatars/michelle.glb';
const GLB_BYTES = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(28, 3)]);

let storageKey = STATIC_URL;
vi.mock('../../api/_lib/avatars.js', () => ({
	getAvatar: async () => ({
		id: AVATAR_ID,
		visibility: 'public',
		owner_id: null,
		storage_key: storageKey,
		baked_storage_key: null,
		appearance_hash: null,
	}),
	resolveAvatarUrl: () => storageKey,
}));

let r2Calls = 0;
vi.mock('../../api/_lib/r2.js', async (importOriginal) => ({
	...(await importOriginal()),
	r2: {
		send: async () => {
			r2Calls++;
			throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey', Code: 'NoSuchKey' });
		},
	},
}));

let fetchUpstreamImpl;
vi.mock('../../api/_lib/upstream-fetch.js', async (importOriginal) => ({
	...(await importOriginal()),
	fetchUpstream: (...args) => fetchUpstreamImpl(...args),
}));

const handler = (await import('../../api/avatars/[id]/[action].js')).default;

function makeRes() {
	const chunks = [];
	return {
		statusCode: 200,
		_h: {},
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
		get bytes() { return Buffer.concat(chunks); },
		get body() { return Buffer.concat(chunks).toString('utf8'); },
	};
}

async function invoke() {
	const req = { method: 'GET', url: `/api/avatars/${AVATAR_ID}/glb`, headers: {}, query: { id: AVATAR_ID, action: 'glb' } };
	const res = makeRes();
	await handler(req, res);
	return res;
}

const served = (bytes, seen) => async (url) => {
	seen.push(url);
	return {
		ok: true,
		status: 200,
		headers: new Headers({ 'content-length': String(bytes.length), etag: '"static"' }),
		body: Readable.toWeb(Readable.from([bytes])),
	};
};

beforeEach(() => {
	storageKey = STATIC_URL;
	r2Calls = 0;
	fetchUpstreamImpl = async () => { throw new Error('fetchUpstream not stubbed for this test'); };
});

describe('avatar glb proxy: absolute-URL storage key', () => {
	it('streams the file the key points at instead of asking R2 for it', async () => {
		const seen = [];
		fetchUpstreamImpl = served(GLB_BYTES, seen);
		const res = await invoke();
		expect(res.statusCode).toBe(200);
		expect(seen).toEqual([STATIC_URL]);
		expect(r2Calls).toBe(0);
		expect(res.bytes.equals(GLB_BYTES)).toBe(true);
		expect(res.getHeader('content-type')).toBe('model/gltf-binary');
		expect(res.getHeader('access-control-allow-origin')).toBe('*');
		expect(res.getHeader('content-length')).toBe(String(GLB_BYTES.length));
	});

	it('answers 502 with a clean JSON error when the absolute URL cannot be read', async () => {
		fetchUpstreamImpl = async () => { throw new Error('upstream 404'); };
		const res = await invoke();
		expect(res.statusCode).toBe(502);
		expect(res.getHeader('content-length')).toBeUndefined();
		expect(JSON.parse(res.body).error).toBe('upstream_error');
	});

	it('refuses a plain-http key rather than fetching it', async () => {
		storageKey = 'http://169.254.169.254/latest/meta-data';
		fetchUpstreamImpl = async () => { throw new Error('must not fetch'); };
		const res = await invoke();
		expect(res.statusCode).toBe(404);
		expect(r2Calls).toBe(0);
	});

	it('streams a reconstruction GLB kept on Google Cloud Storage', async () => {
		storageKey = 'https://storage.googleapis.com/three-ws-avatar-reconstructions/avatars/a.glb';
		const seen = [];
		fetchUpstreamImpl = served(GLB_BYTES, seen);
		const res = await invoke();
		expect(res.statusCode).toBe(200);
		expect(seen).toEqual([storageKey]);
		expect(res.bytes.equals(GLB_BYTES)).toBe(true);
	});

	it('refuses an https key on a host it does not publish GLBs from', async () => {
		storageKey = 'https://internal.example.net/a.glb';
		fetchUpstreamImpl = async () => { throw new Error('must not fetch'); };
		const res = await invoke();
		expect(res.statusCode).toBe(404);
		expect(r2Calls).toBe(0);
	});

	it('still reads an ordinary bucket key from R2', async () => {
		storageKey = 'u/owner/a.glb';
		const res = await invoke();
		expect(r2Calls).toBe(1);
		expect(res.statusCode).toBe(404);
	});
});
