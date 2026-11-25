/**
 * Browser uploads during an R2 credential outage.
 *
 * Since 2026-11-14 R2 refuses every credential we hold. Server-side writes
 * already divert to the GCS fallback bucket (api/_lib/storage-fallback.js), but
 * the presigned-upload path still signed for R2: objectStorageUsable() reported
 * `rejected`, so /api/forge-upload, /api/scene-upload and /api/print/upload
 * answered 503 storage_unavailable, and every presign endpoint without that
 * gate handed the browser an R2 URL that answers 401. Reference photos, scene
 * uploads, avatar GLB uploads and print files all stopped working while a
 * bucket that could take the bytes sat right there.
 *
 * Now a rejected R2 credential with a fallback bucket configured counts as
 * usable-by-diversion, and presignUpload() signs a GCS V4 PUT for the same key,
 * so the object lands where every read helper (and /cdn/) already looks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createHash, createVerify } from 'node:crypto';

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
	getSignedUrl: async () => 'https://acct.r2.cloudflarestorage.com/bucket/signed-put',
}));

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = {
	type: 'service_account',
	client_email: 'uploader@test-project.iam.gserviceaccount.com',
	private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};

const ENV = {
	S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
	S3_BUCKET: 'bucket',
	S3_PUBLIC_DOMAIN: 'https://pub.r2.dev',
	S3_ACCESS_KEY_ID: 'a'.repeat(32),
	S3_SECRET_ACCESS_KEY: 'b'.repeat(64),
	STORAGE_FALLBACK_BUCKET: 'fallback-bucket',
	GCP_SERVICE_ACCOUNT_JSON: JSON.stringify(SA),
};

function credentialRejected() {
	const err = new Error('Unauthorized');
	err.name = 'Unauthorized';
	err.$metadata = { httpStatusCode: 401 };
	return err;
}

let r2;

beforeEach(async () => {
	for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
	sendMock.mockReset();
	vi.resetModules();
	r2 = await import('../api/_lib/r2.js');
	r2.resetObjectStorageUsableCache();
	r2.resetR2CredentialCooldown();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('presigned uploads while R2 refuses our credential', () => {
	it('reports storage usable by diversion instead of refusing the upload', async () => {
		sendMock.mockRejectedValue(credentialRejected());
		const v = await r2.objectStorageUsable();
		expect(v.ok).toBe(true);
		expect(v.diverted).toBe(true);
	});

	it('still refuses when there is no fallback bucket to divert to', async () => {
		vi.stubEnv('STORAGE_FALLBACK_BUCKET', '');
		sendMock.mockRejectedValue(credentialRejected());
		const v = await r2.objectStorageUsable();
		expect(v.ok).toBe(false);
		expect(v.reason).toBe('rejected');
	});

	it('signs a GCS V4 PUT for the same key that verifies against the signer key', async () => {
		sendMock.mockRejectedValue(credentialRejected());
		const url = new URL(await r2.presignUpload({ key: 'forge/uploads/ab/c d.png', contentType: 'image/png' }));

		expect(url.origin).toBe('https://storage.googleapis.com');
		expect(url.pathname).toBe('/fallback-bucket/forge/uploads/ab/c%20d.png');
		const q = url.searchParams;
		expect(q.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');
		expect(q.get('X-Goog-SignedHeaders')).toBe('content-type;host');
		expect(q.get('X-Goog-Expires')).toBe('300');
		const credential = q.get('X-Goog-Credential');
		expect(credential.startsWith(`${SA.client_email}/`)).toBe(true);
		const scope = credential.slice(SA.client_email.length + 1);
		expect(scope).toMatch(/^\d{8}\/auto\/storage\/goog4_request$/);

		// Rebuild the canonical request exactly as GCS does and check the signature.
		const signature = q.get('X-Goog-Signature');
		const params = [...q.entries()]
			.filter(([k]) => k !== 'X-Goog-Signature')
			.map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${k}=${v}`)
			.join('&');
		const canonical = ['PUT', url.pathname, params, 'content-type:image/png', 'host:storage.googleapis.com', '', 'content-type;host', 'UNSIGNED-PAYLOAD'].join('\n');
		const stringToSign = ['GOOG4-RSA-SHA256', q.get('X-Goog-Date'), scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
		const ok = createVerify('RSA-SHA256').update(stringToSign).verify(publicKey, Buffer.from(signature, 'hex'));
		expect(ok).toBe(true);
	});

	it('keeps signing for R2 while R2 accepts the credential', async () => {
		sendMock.mockResolvedValue({ KeyCount: 0 });
		const url = await r2.presignUpload({ key: 'forge/uploads/ab/x.png', contentType: 'image/png' });
		expect(url).toBe('https://acct.r2.cloudflarestorage.com/bucket/signed-put');
	});
});
