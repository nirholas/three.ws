// Tests for GET /api/avatars/:id/glb, the same-origin, CORS-friendly proxy the
// avatar widget, the embed SDK and every cross-origin GLTFLoader read models
// through.
//
// The route it mirrors, /api/cdn-object, grew a public-bucket failover on
// 2026-09-07 and this one did not, so when R2 rejected our credential every
// avatar on the site 502ed and the widget swapped the user's model for the
// `robot` placeholder on nearly every page. The authenticated page sweep of
// 2026-09-08 found it as the only real error class on the site.
//
// The two routes must NOT fail over the same way, which is the point of these
// tests: cdn-object redirects, this one streams the bytes through. A 302 here
// would send the browser to the public r2.dev domain, which sends no
// access-control-allow-origin at all, converting the 502 into a CORS failure for
// exactly the callers this endpoint exists to serve.
//
// R2 and the public-domain fetch are stubbed at the module boundary; no network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: async () => {} }));
vi.mock('../../api/_lib/db.js', () => ({ sql: async () => [] }));
vi.mock('../../api/_lib/env.js', () => ({
	env: { S3_BUCKET: 'test-bucket', S3_PUBLIC_DOMAIN: 'https://pub-test.r2.dev' },
}));

const AVATAR_ID = '00000000-0000-4000-8000-000000000001';
const GLB_BYTES = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(28, 7)]);

vi.mock('../../api/_lib/avatars.js', () => ({
	getAvatar: async () => ({
		id: AVATAR_ID,
		visibility: 'public',
		owner_id: 'owner-1',
		storage_key: 'u/owner/a.glb',
		baked_storage_key: null,
		appearance_hash: null,
	}),
	resolveAvatarUrl: () => 'https://pub-test.r2.dev/u/owner/a.glb',
}));

let sendImpl = async () => {
	throw new Error('r2.send not stubbed for this test');
};
// Only the S3 client is stubbed. Everything else in r2.js stays real so the
// handler's fallback branch is judged by the SAME isStorageInfrastructureError
// production runs.
vi.mock('../../api/_lib/r2.js', async (importOriginal) => ({
	...(await importOriginal()),
	r2: { send: (...args) => sendImpl(...args) },
}));

let fetchUpstreamImpl = async () => {
	throw new Error('fetchUpstream not stubbed for this test');
};
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
		chunks,
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		removeHeader(k) { delete this._h[k.toLowerCase()]; },
		// Enough of a writable for stream.pipeline to drive.
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

function publicDomainServes(bytes) {
	return async (url) => {
		expect(url).toBe('https://pub-test.r2.dev/u/owner/a.glb');
		return {
			ok: true,
			status: 200,
			headers: new Headers({ 'content-length': String(bytes.length), etag: '"abc"' }),
			body: Readable.toWeb(Readable.from([bytes])),
		};
	};
}

beforeEach(() => {
	sendImpl = async () => { throw new Error('r2.send not stubbed for this test'); };
	fetchUpstreamImpl = async () => { throw new Error('fetchUpstream not stubbed for this test'); };
});

describe('avatar glb proxy: public-bucket failover', () => {
	it('streams from R2 normally, with the long cache only the signed path earns', async () => {
		sendImpl = async () => ({
			Body: Readable.from([GLB_BYTES]),
			ContentLength: GLB_BYTES.length,
			ETag: '"signed"',
		});
		const res = await invoke();
		expect(res.statusCode).toBe(200);
		expect(res.getHeader('content-type')).toBe('model/gltf-binary');
		expect(res.getHeader('etag')).toBe('"signed"');
		// The healthy path is the cacheable one; the fallback below is no-store.
		expect(res.getHeader('cache-control')).toContain('s-maxage=86400');
	});

	// Both rejection wordings, plus the revoked-key shape, because the SDK
	// reports a bad credential three different ways and only one of them used to
	// reach this branch.
	for (const [label, build] of [
		['the compact SDK code', () => Object.assign(new Error('signature mismatch'), { name: 'SignatureDoesNotMatch' })],
		[
			'the sentence the SDK writes instead',
			() => new Error('The request signature we calculated does not match the signature you provided. Check your secret access key and signing method.'),
		],
		['a revoked access key id', () => Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', Code: 'Unauthorized' })],
	]) {
		it(`streams the public bucket domain when the credential is rejected, reported as ${label}`, async () => {
			sendImpl = async () => { throw build(); };
			fetchUpstreamImpl = publicDomainServes(GLB_BYTES);
			const res = await invoke();

			expect(res.statusCode).toBe(200);
			expect(Buffer.concat(res.chunks).equals(GLB_BYTES)).toBe(true);
			expect(res.getHeader('content-type')).toBe('model/gltf-binary');
			// The wildcard CORS header is the whole reason this route exists, so
			// it has to survive the degraded path. A redirect would lose it.
			expect(res.getHeader('access-control-allow-origin')).toBe('*');
			expect(res.getHeader('location')).toBeUndefined();
			// Never cached: traffic returns to the signed read the moment the
			// credential is healthy, with no stale hop pinned at the edge.
			expect(res.getHeader('cache-control')).toBe('no-store');
		});
	}

	it('does not fail over when the object itself is missing', async () => {
		sendImpl = async () => { throw Object.assign(new Error('nope'), { name: 'NoSuchKey' }); };
		const res = await invoke();
		expect(res.statusCode).toBe(404);
	});

	it('answers 502 with no stale content-length when the public domain fails too', async () => {
		sendImpl = async () => { throw Object.assign(new Error('sig'), { name: 'SignatureDoesNotMatch' }); };
		fetchUpstreamImpl = async () => { throw new Error('fetch failed'); };
		const res = await invoke();

		expect(res.statusCode).toBe(502);
		// The GLB's length and etag were set before the fallback fetch was
		// attempted. json() will not touch a committed response and never clears
		// headers, so leaving them on would pin the tiny error body to the
		// model's byte count and hang the client waiting for the rest.
		expect(res.getHeader('etag')).toBeUndefined();
		const declared = res.getHeader('content-length');
		if (declared !== undefined) {
			expect(Number(declared)).toBe(Buffer.byteLength(res.body));
		}
		expect(JSON.parse(res.body).error).toBe('upstream_error');
	});
});
