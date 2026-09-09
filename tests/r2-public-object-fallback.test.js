/**
 * getPublicObjectBuffer() reads an object whose bytes are public anyway (a CC0
 * library manifest, a rendered thumbnail) with the signed S3 read first and the
 * bucket's own public CDN domain as the fallback.
 *
 * It exists because of a live outage: on 2026-09-09 the production S3 secret
 * stopped matching its access key id, every signed GET came back
 * SignatureDoesNotMatch, and /objects, /character-library, the animation clips
 * and the asset catalogue behind the agent tools all read as empty, while the
 * exact same manifests stayed downloadable by anyone on the public domain those
 * manifests already hand out. A credential fault must not be able to empty a
 * route that serves public bytes.
 *
 * The signed read stays FIRST (it is authoritative and sees a publish the
 * instant it lands), and a failure of both paths must rethrow the SIGNED error,
 * because the library endpoints branch on NoSuchKey to tell "not uploaded yet"
 * apart from "storage is broken".
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
	class Cmd { constructor(input) { this.input = input; } }
	return {
		S3Client: class { send(...a) { return send(...a); } },
		GetObjectCommand: Cmd,
		PutObjectCommand: Cmd,
		DeleteObjectCommand: Cmd,
		HeadObjectCommand: Cmd,
		CopyObjectCommand: Cmd,
		ListObjectsV2Command: Cmd,
	};
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://signed.example/x' }));

beforeAll(() => {
	Object.assign(process.env, {
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
});

const { getPublicObjectBuffer } = await import('../api/_lib/r2.js');

const KEY = 'objects/library/manifest.json';

function signedBody(text) {
	return { Body: (async function* () { yield Buffer.from(text, 'utf8'); })() };
}
function signatureError() {
	const err = new Error('The request signature we calculated does not match the signature you provided.');
	err.name = 'SignatureDoesNotMatch';
	err.$metadata = { httpStatusCode: 403 };
	return err;
}
function noSuchKey() {
	const err = new Error('NoSuchKey');
	err.name = 'NoSuchKey';
	err.$metadata = { httpStatusCode: 404 };
	return err;
}

afterEach(() => {
	send.mockReset();
	vi.unstubAllGlobals();
});

describe('getPublicObjectBuffer', () => {
	it('uses the signed read and never touches the network when it succeeds', async () => {
		send.mockResolvedValueOnce(signedBody('{"objects":[1]}'));
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		expect((await getPublicObjectBuffer(KEY)).toString('utf8')).toBe('{"objects":[1]}');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('falls back to the public CDN when the credential is rejected', async () => {
		send.mockRejectedValueOnce(signatureError());
		const fetchSpy = vi.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from('{"objects":[2]}') }));
		vi.stubGlobal('fetch', fetchSpy);

		expect((await getPublicObjectBuffer(KEY)).toString('utf8')).toBe('{"objects":[2]}');
		expect(fetchSpy.mock.calls[0][0]).toBe(`https://cdn.example.com/${KEY}`);
	});

	// The endpoints read NoSuchKey as "the manifest has not been published yet"
	// and serve a cacheable empty library for it. If a CDN 404 surfaced as its
	// own error instead, that branch would stop matching and a pre-launch
	// library would start logging and answering as a storage outage.
	it('rethrows the signed NoSuchKey when the CDN also has nothing', async () => {
		send.mockRejectedValueOnce(noSuchKey());
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) })));

		await expect(getPublicObjectBuffer(KEY)).rejects.toMatchObject({ name: 'NoSuchKey' });
	});

	it('rethrows the signed error when the public fetch itself throws', async () => {
		send.mockRejectedValueOnce(signatureError());
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); }));

		await expect(getPublicObjectBuffer(KEY)).rejects.toMatchObject({ name: 'SignatureDoesNotMatch' });
	});
});
