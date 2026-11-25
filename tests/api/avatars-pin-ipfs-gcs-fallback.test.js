// POST /api/avatars/:id/pin-ipfs reads the avatar's bytes before pinning them.
// It read them with a bare signed R2 GET, so while R2 rejects our credential
// (since 2026-11-14) every pin failed with "IPFS pin failed: Unauthorized", and
// an avatar created during the outage (its GLB lives only in the GCS fallback
// bucket) could never be pinned at all. The read now goes through
// getObjectBuffer, which falls back to STORAGE_FALLBACK_BUCKET like every other
// storage read.

import { describe, it, expect, vi, afterAll } from 'vitest';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: async () => {} }));
vi.mock('../../api/_lib/env.js', () => ({
	env: { S3_BUCKET: 'test-bucket', S3_PUBLIC_DOMAIN: 'https://pub-test.r2.dev' },
}));

const ID = '22222222-2222-4222-8222-222222222222';
const KEY = 'u/owner-1/diverted.glb';
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(40, 9)]);

const sqlMock = vi.fn(async (strings) => {
	const q = strings.join('?');
	if (/SELECT id, owner_id/.test(q)) {
		return [{ id: ID, owner_id: 'owner-1', checksum_sha256: 'abc', storage_key: KEY, content_type: 'model/gltf-binary', name: 'diverted', source_meta: null }];
	}
	return [];
});
vi.mock('../../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => ({ id: 'owner-1' }),
	authenticateBearer: async () => null,
	extractBearer: () => null,
	hasScope: () => false,
}));
vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../../api/_lib/storage-mode.js', () => ({
	readStorageMode: async () => ({ attestation: {} }),
	storageModeSchema: { parse: (v) => v },
	defaultStorageMode: () => ({ attestation: {} }),
}));

const pinned = [];
vi.mock('../../api/_lib/ipfs-pin.js', () => ({
	ipfsPinningConfigured: () => true,
	pinToIPFS: async (bytes, filename) => {
		pinned.push({ bytes: Buffer.from(bytes), filename });
		return { cid: 'bafytestcid' };
	},
}));

// Stub only the S3 transport: r2.js reads through its own internal client, so
// replacing the exported `r2` would leave the real fallback path untested.
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
	const real = await importOriginal();
	class S3Client {
		async send() {
			throw Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', Code: 'Unauthorized', $metadata: { httpStatusCode: 401 } });
		}
	}
	return { ...real, S3Client };
});
vi.mock('../../api/_lib/storage-fallback.js', async (importOriginal) => ({
	...(await importOriginal()),
	fallbackGet: async (key) => (key === KEY ? { body: GLB, contentType: 'model/gltf-binary', metadata: {} } : null),
	fallbackFetch: async (key) => (key === KEY ? new Response(new Uint8Array(GLB), { status: 200 }) : null),
}));

const savedBucket = process.env.STORAGE_FALLBACK_BUCKET;
process.env.STORAGE_FALLBACK_BUCKET = 'fallback-bucket';
afterAll(() => {
	if (savedBucket === undefined) delete process.env.STORAGE_FALLBACK_BUCKET;
	else process.env.STORAGE_FALLBACK_BUCKET = savedBucket;
});

const handler = (await import('../../api/avatars/[id]/[action].js')).default;

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		body: '',
		headersSent: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		removeHeader(k) { delete this._h[k.toLowerCase()]; },
		end(b) { if (b) this.body += String(b); this.headersSent = true; this.writableEnded = true; },
		write(b) { this.body += String(b); return true; },
	};
}

describe('pin-ipfs while R2 rejects the credential', () => {
	it('pins the bytes the GCS fallback bucket holds instead of failing with Unauthorized', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const req = {
			method: 'POST',
			url: `/api/avatars/${ID}/pin-ipfs`,
			headers: { host: 'three.ws', origin: 'https://three.ws', 'content-type': 'application/json' },
			query: { id: ID, action: 'pin-ipfs' },
		};
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode, res.body).toBe(200);
		expect(pinned).toHaveLength(1);
		expect(pinned[0].bytes.equals(GLB)).toBe(true);
		expect(JSON.parse(res.body).storage_mode.ipfs.cid).toBe('bafytestcid');
	});
});
