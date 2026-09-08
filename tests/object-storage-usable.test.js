/**
 * objectStorageUsable(), unit test.
 *
 * On 2026-09-07 the R2 token was rolled and production kept the old secret.
 * /api/forge-upload answered 200 with a perfectly formed presigned URL for
 * another day, because it only checked that the credential vars were PRESENT.
 * The bucket then answered the browser's PUT with 403 SignatureDoesNotMatch,
 * and that 403 carries no Access-Control-Allow-Origin, so the page could not
 * read a status and told every user "Network error during upload" over a photo
 * that was never the problem.
 *
 * This pins the gate that now stands in front of every presigned URL we hand a
 * browser, and the two judgement calls inside it: a rejected credential fails
 * CLOSED (it never recovers on retry, so every URL minted until a human fixes
 * it is waste), while a timeout fails OPEN (it may be the probe's own bad luck,
 * and taking uploads down over one flaky list would be a worse outage than the
 * one it guards).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
	S3Client: class {
		send(...args) {
			return sendMock(...args);
		}
	},
	PutObjectCommand: class {},
	GetObjectCommand: class {},
	DeleteObjectCommand: class {},
	HeadObjectCommand: class {},
	CopyObjectCommand: class {},
	ListObjectsV2Command: class {},
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: async () => 'https://signed.example/put',
}));

const ENV = {
	S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
	S3_BUCKET: 'bucket',
	S3_PUBLIC_DOMAIN: 'https://pub.r2.dev',
	S3_ACCESS_KEY_ID: 'a'.repeat(32),
	S3_SECRET_ACCESS_KEY: 'b'.repeat(64),
};

function signatureError() {
	const err = new Error(
		'The request signature we calculated does not match the signature you provided. Check your secret access key and signing method.',
	);
	err.name = 'SignatureDoesNotMatch';
	return err;
}

let r2;

beforeEach(async () => {
	for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
	sendMock.mockReset();
	r2 = await import('../api/_lib/r2.js');
	r2.resetObjectStorageUsableCache();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('objectStorageUsable', () => {
	it('reports usable when the bucket answers a signed list', async () => {
		sendMock.mockResolvedValue({ KeyCount: 0 });
		const v = await r2.objectStorageUsable();
		expect(v.ok).toBe(true);
		expect(v.reason).toBe(null);
	});

	it('reports the credential rejected, so no presigned URL is minted from it', async () => {
		sendMock.mockRejectedValue(signatureError());
		const v = await r2.objectStorageUsable();
		expect(v.ok).toBe(false);
		expect(v.reason).toBe('rejected');
		expect(v.message).toMatch(/does not match the signature/i);
	});

	it('stays usable through a transient timeout rather than taking uploads down', async () => {
		const err = new Error('socket hang up');
		err.name = 'TimeoutError';
		sendMock.mockRejectedValue(err);
		const v = await r2.objectStorageUsable();
		expect(v.ok).toBe(true);
	});

	it('reports unconfigured without touching the network', async () => {
		vi.stubEnv('S3_SECRET_ACCESS_KEY', '');
		const v = await r2.objectStorageUsable();
		expect(v).toEqual({ ok: false, reason: 'unconfigured', message: null });
		expect(sendMock).not.toHaveBeenCalled();
	});

	it('treats a secret that is only whitespace as unconfigured, not as a rejection', async () => {
		vi.stubEnv('S3_SECRET_ACCESS_KEY', '\n');
		const v = await r2.objectStorageUsable();
		expect(v.reason).toBe('unconfigured');
	});

	it('costs one probe for a burst of concurrent uploads, not one each', async () => {
		sendMock.mockResolvedValue({ KeyCount: 0 });
		const results = await Promise.all(
			Array.from({ length: 6 }, () => r2.objectStorageUsable()),
		);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(sendMock).toHaveBeenCalledTimes(1);
	});

	it('caches the verdict, so a second upload does not re-probe', async () => {
		sendMock.mockResolvedValue({ KeyCount: 0 });
		await r2.objectStorageUsable();
		await r2.objectStorageUsable();
		expect(sendMock).toHaveBeenCalledTimes(1);
	});
});
