/**
 * Once R2 answers a bare 401 Unauthorized (revoked credential, production
 * 2026-11-14 onward), every /cdn/<key> request still paid a doomed R2 round
 * trip before the GCS fallback served the bytes. A credential rejection never
 * fixes itself in seconds, so after one the client short-circuits for a short
 * cooldown (no network call), then lets a request through to re-test R2.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
	class Cmd {
		constructor(input) {
			this.input = input;
		}
	}
	return {
		S3Client: class {
			send(...a) {
				return send(...a);
			}
		},
		GetObjectCommand: class extends Cmd {},
		PutObjectCommand: class extends Cmd {},
		DeleteObjectCommand: class extends Cmd {},
		HeadObjectCommand: class extends Cmd {},
		CopyObjectCommand: class extends Cmd {},
		ListObjectsV2Command: class extends Cmd {},
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
		STORAGE_FALLBACK_BUCKET: 'test-fallback',
	});
});

const r2mod = await import('../api/_lib/r2.js');
const { r2, isStorageInfrastructureError, resetR2CredentialCooldown, r2CredentialCooldownActive } = r2mod;

const unauthorized = () =>
	Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', $metadata: { httpStatusCode: 401 } });

beforeEach(() => {
	send.mockReset();
	resetR2CredentialCooldown();
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('R2 credential cooldown', () => {
	it('skips the R2 round trip after a credential rejection, with an error callers still classify', async () => {
		send.mockRejectedValueOnce(unauthorized());
		await expect(r2.send({ k: 1 })).rejects.toMatchObject({ name: 'Unauthorized' });
		expect(send).toHaveBeenCalledTimes(1);

		const err = await r2.send({ k: 2 }).catch((e) => e);
		expect(send).toHaveBeenCalledTimes(1);
		expect(isStorageInfrastructureError(err)).toBe(true);
		expect(r2CredentialCooldownActive()).toBe(true);
	});

	it('retests R2 once the cooldown expires and clears it on success', async () => {
		send.mockRejectedValueOnce(unauthorized());
		await r2.send({}).catch(() => {});
		vi.advanceTimersByTime(61_000);
		send.mockResolvedValueOnce({ ok: true });
		await expect(r2.send({})).resolves.toEqual({ ok: true });
		expect(send).toHaveBeenCalledTimes(2);
		expect(r2CredentialCooldownActive()).toBe(false);
	});

	it('does not start a cooldown for a missing key or a network fault', async () => {
		send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }));
		await r2.send({}).catch(() => {});
		send.mockRejectedValueOnce(new Error('socket hang up'));
		await r2.send({}).catch(() => {});
		expect(r2CredentialCooldownActive()).toBe(false);
		send.mockResolvedValueOnce({});
		await r2.send({});
		expect(send).toHaveBeenCalledTimes(3);
	});
});
