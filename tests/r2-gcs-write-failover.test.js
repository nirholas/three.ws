/**
 * Object storage write failover to a Google Cloud Storage bucket.
 *
 * Production, 2026-11-14 ~17:23 UTC: Cloudflare stopped accepting every R2
 * credential we hold (both access key pairs answered a bare 401 Unauthorized).
 * Every finished generation then died in materializeCreation, because
 * putObject() had nowhere else to put the GLB: 1 success out of 44 in the next
 * six hours, across every backend, while the GPU workers kept producing meshes.
 *
 * With STORAGE_FALLBACK_BUCKET set, a write R2 refuses for an infrastructure
 * reason lands in that GCS bucket under the same key, and every read helper
 * (and therefore /cdn/<key>) finds it there, so generation keeps working
 * through an R2 outage. A genuine object-level fault (or no fallback bucket)
 * still throws exactly as before.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
	class Cmd {
		constructor(input) {
			this.input = input;
			this.kind = this.constructor.name;
		}
	}
	class GetObjectCommand extends Cmd {}
	class PutObjectCommand extends Cmd {}
	class DeleteObjectCommand extends Cmd {}
	class HeadObjectCommand extends Cmd {}
	class CopyObjectCommand extends Cmd {}
	class ListObjectsV2Command extends Cmd {}
	return {
		S3Client: class {
			send(...a) {
				return send(...a);
			}
		},
		GetObjectCommand,
		PutObjectCommand,
		DeleteObjectCommand,
		HeadObjectCommand,
		CopyObjectCommand,
		ListObjectsV2Command,
	};
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://signed.example/x' }));
vi.mock('../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: async () => 'test-token' }));

beforeAll(() => {
	Object.assign(process.env, {
		S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://pub-example.r2.dev',
		S3_ACCESS_KEY_ID: 'revoked-key',
		S3_SECRET_ACCESS_KEY: 'revoked-secret',
	});
});

const r2mod = await import('../api/_lib/r2.js');
const { putObject, getObjectBuffer, getObjectWithMetadata, headObject, copyObject, getObjectRange, deleteObject } = r2mod;

/** R2's answer to a revoked or deleted access key id (measured 2026-11-15). */
function unauthorized() {
	const err = new Error('Unauthorized');
	err.name = 'Unauthorized';
	err.Code = 'Unauthorized';
	err.$metadata = { httpStatusCode: 401 };
	return err;
}

/**
 * R2's answer to a HEAD with a rejected credential: a HEAD response has no body,
 * so the SDK cannot read a code and raises name `Unknown`, message
 * `UnknownError`, with only the 401 status to go on (measured 2026-11-15).
 */
function bodylessUnauthorized() {
	const err = new Error('UnknownError');
	err.name = 'Unknown';
	err.$metadata = { httpStatusCode: 401 };
	return err;
}

function noSuchKey() {
	const err = new Error('The specified key does not exist.');
	err.name = 'NoSuchKey';
	err.Code = 'NoSuchKey';
	err.$metadata = { httpStatusCode: 404 };
	return err;
}

/**
 * An in-memory GCS XML API (storage.googleapis.com/<bucket>/<object>), enough of
 * it to answer PUT, server-side copy, GET (with Range), HEAD and DELETE.
 */
function fakeGcs() {
	const objects = new Map();
	const impl = vi.fn(async (url, init = {}) => {
		const u = new URL(url);
		const method = init.method || 'GET';
		const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
		if (headers.authorization !== 'Bearer test-token') return new Response('denied', { status: 401 });
		const prefix = '/fallback-bucket/';
		if (u.hostname !== 'storage.googleapis.com' || !u.pathname.startsWith(prefix)) {
			return new Response('unexpected', { status: 500 });
		}
		const name = u.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
		const obj = objects.get(name);
		if (method === 'PUT') {
			const source = headers['x-goog-copy-source'];
			if (source) {
				const src = objects.get(decodeURIComponent(source).replace(/^\/?fallback-bucket\//, ''));
				if (!src) return new Response('no source', { status: 404 });
				objects.set(name, { ...src });
				return new Response('<CopyObjectResult/>', { status: 200 });
			}
			const meta = {};
			for (const [k, v] of Object.entries(headers)) {
				if (k.startsWith('x-goog-meta-')) meta[k.slice('x-goog-meta-'.length)] = v;
			}
			const body = Buffer.from(await new Response(init.body).arrayBuffer());
			objects.set(name, { body, contentType: headers['content-type'], metadata: meta });
			return new Response('', { status: 200 });
		}
		if (method === 'DELETE') {
			if (!obj) return new Response('', { status: 404 });
			objects.delete(name);
			return new Response(null, { status: 204 });
		}
		if (!obj) return new Response('not found', { status: 404 });
		const out = {
			'content-type': obj.contentType,
			etag: '"gcs-etag"',
			'last-modified': 'Sun, 15 Nov 2026 03:00:00 GMT',
			...Object.fromEntries(Object.entries(obj.metadata).map(([k, v]) => [`x-goog-meta-${k}`, v])),
		};
		if (method === 'HEAD') return new Response(null, { status: 200, headers: { ...out, 'content-length': String(obj.body.length) } });
		if (headers.range) {
			const [, a, b] = headers.range.match(/bytes=(\d+)-(\d+)/);
			const slice = obj.body.subarray(Number(a), Number(b) + 1);
			return new Response(slice, {
				status: 206,
				headers: { ...out, 'content-length': String(slice.length), 'content-range': `bytes ${a}-${Number(a) + slice.length - 1}/${obj.body.length}` },
			});
		}
		return new Response(obj.body, { status: 200, headers: { ...out, 'content-length': String(obj.body.length) } });
	});
	return { impl, objects };
}

let gcs;
beforeEach(() => {
	send.mockReset();
	r2mod.resetR2CredentialCooldown();
	gcs = fakeGcs();
	vi.stubGlobal('fetch', gcs.impl);
	process.env.STORAGE_FALLBACK_BUCKET = 'fallback-bucket';
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.STORAGE_FALLBACK_BUCKET;
});

describe('putObject when R2 rejects the credential', () => {
	it('writes the object to the GCS fallback bucket instead of failing the generation', async () => {
		send.mockRejectedValue(unauthorized());
		await expect(
			putObject({ key: 'forge/abc/model.glb', body: Buffer.from('glTF-bytes'), contentType: 'model/gltf-binary', metadata: { creation: 'c1' } }),
		).resolves.toBeUndefined();
		const stored = gcs.objects.get('forge/abc/model.glb');
		expect(stored.body.toString()).toBe('glTF-bytes');
		expect(stored.contentType).toBe('model/gltf-binary');
		expect(stored.metadata).toEqual({ creation: 'c1' });
	});

	it('still throws when no fallback bucket is configured', async () => {
		delete process.env.STORAGE_FALLBACK_BUCKET;
		send.mockRejectedValue(unauthorized());
		await expect(putObject({ key: 'k.glb', body: Buffer.from('x'), contentType: 'model/gltf-binary' })).rejects.toThrow('Unauthorized');
		expect(gcs.impl).not.toHaveBeenCalled();
	});

	it('does not divert a fault that is not infrastructure', async () => {
		const err = new Error('EntityTooLarge');
		err.name = 'EntityTooLarge';
		send.mockRejectedValue(err);
		await expect(putObject({ key: 'k.glb', body: Buffer.from('x'), contentType: 'model/gltf-binary' })).rejects.toThrow('EntityTooLarge');
		expect(gcs.objects.size).toBe(0);
	});

	it('never touches GCS while R2 is healthy', async () => {
		send.mockResolvedValue({});
		await putObject({ key: 'k.glb', body: Buffer.from('x'), contentType: 'model/gltf-binary' });
		expect(gcs.impl).not.toHaveBeenCalled();
	});
});

describe('reads find objects that only exist in the fallback bucket', () => {
	beforeEach(async () => {
		send.mockRejectedValue(unauthorized());
		await putObject({ key: 'forge/abc/model.glb', body: Buffer.from('0123456789'), contentType: 'model/gltf-binary', metadata: { etag: 'v1' } });
	});

	it('getObjectBuffer serves GCS bytes while R2 rejects the credential', async () => {
		expect((await getObjectBuffer('forge/abc/model.glb')).toString()).toBe('0123456789');
	});

	it('getObjectBuffer serves GCS bytes after R2 recovers but never received the object', async () => {
		r2mod.resetR2CredentialCooldown(); // R2 recovered: the cooldown would otherwise outlast the test
		send.mockRejectedValue(noSuchKey());
		expect((await getObjectBuffer('forge/abc/model.glb')).toString()).toBe('0123456789');
	});

	it('getObjectBuffer rethrows the R2 error when GCS does not have the key either', async () => {
		r2mod.resetR2CredentialCooldown(); // R2 recovered: the cooldown would otherwise outlast the test
		send.mockRejectedValue(noSuchKey());
		await expect(getObjectBuffer('forge/missing.glb')).rejects.toMatchObject({ name: 'NoSuchKey' });
	});

	it('getObjectWithMetadata returns body, metadata and type from GCS, and null when absent everywhere', async () => {
		const out = await getObjectWithMetadata('forge/abc/model.glb');
		expect(out.body.toString()).toBe('0123456789');
		expect(out.metadata).toEqual({ etag: 'v1' });
		expect(out.contentType).toBe('model/gltf-binary');
		r2mod.resetR2CredentialCooldown(); // R2 recovered: the cooldown would otherwise outlast the test
		send.mockRejectedValue(noSuchKey());
		expect(await getObjectWithMetadata('forge/missing.glb')).toBeNull();
	});

	it('headObject answers in the S3 shape from GCS, and null when absent everywhere', async () => {
		const head = await headObject('forge/abc/model.glb');
		expect(head).toMatchObject({ ContentLength: 10, ContentType: 'model/gltf-binary', Metadata: { etag: 'v1' } });
		r2mod.resetR2CredentialCooldown(); // R2 recovered: the cooldown would otherwise outlast the test
		send.mockRejectedValue(noSuchKey());
		expect(await headObject('forge/missing.glb')).toBeNull();
	});

	it('getObjectRange reads only the requested head bytes from GCS', async () => {
		expect((await getObjectRange('forge/abc/model.glb', 4)).toString()).toBe('0123');
	});

	it('copyObject duplicates a fallback-only object inside the fallback bucket', async () => {
		await expect(copyObject({ fromKey: 'forge/abc/model.glb', toKey: 'u/owner/model.glb' })).resolves.toBe(true);
		expect(gcs.objects.get('u/owner/model.glb').body.toString()).toBe('0123456789');
	});

	it('headObject falls back on the bodyless 401 a HEAD gets from R2', async () => {
		send.mockRejectedValue(bodylessUnauthorized());
		expect(await headObject('forge/abc/model.glb')).toMatchObject({ ContentLength: 10 });
	});

	it('deleteObject succeeds for a diverted object while R2 rejects the credential', async () => {
		await expect(deleteObject('forge/abc/model.glb')).resolves.toBeUndefined();
		expect(gcs.objects.has('forge/abc/model.glb')).toBe(false);
	});

	it('deleteObject still throws for an object only R2 holds while R2 rejects the credential', async () => {
		await expect(deleteObject('forge/r2-only.glb')).rejects.toThrow('Unauthorized');
	});
});
