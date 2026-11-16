/**
 * Forge providers that persist a result into the bucket must hand back the
 * first-party /cdn/<key> URL, never the raw public bucket domain.
 *
 * Regression: the bucket's public *.r2.dev domain stopped serving (Cloudflare
 * answers 404 "Public access" for every key), yet the NVIDIA, Stability,
 * Cosmos and Hugging Face rehost paths still returned publicUrl(key). /forge
 * then pointed its viewer and Download link at a dead URL while the same object
 * answered 200 at https://three.ws/cdn/<key>.
 *
 * Real r2.js with env stubbed; only the network write (putObject) is replaced.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

const DEAD_PUBLIC_DOMAIN = 'https://pub-0000000000000000000000000000test.r2.dev';

beforeAll(() => {
	Object.assign(process.env, {
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: DEAD_PUBLIC_DOMAIN,
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
		PUBLIC_APP_ORIGIN: 'https://three.ws',
		NVIDIA_API_KEY: 'nvapi-test-key',
	});
});

const putObjectMock = vi.fn(async () => ({}));
vi.mock('../api/_lib/r2.js', async (importOriginal) => ({
	...(await importOriginal()),
	putObject: (...args) => putObjectMock(...args),
}));

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	putObjectMock.mockClear();
});

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function expectCdnUrlFor(url) {
	const key = putObjectMock.mock.calls[0][0].key;
	expect(url).toBe(`https://three.ws/cdn/${key}`);
	expect(url.startsWith(DEAD_PUBLIC_DOMAIN)).toBe(false);
}

describe('forge providers return /cdn/ URLs for bucket-persisted results', () => {
	it('NVIDIA TRELLIS: a synchronous GLB result', async () => {
		const { createNvidiaProvider } = await import('../api/_providers/nvidia.js');
		globalThis.fetch = vi.fn(async () => json({ artifacts: [{ base64: Buffer.from('glb').toString('base64') }] }));
		const job = await createNvidiaProvider().textTo3d({ prompt: 'a brass ship compass' });
		expectCdnUrlFor(job.resultGlbUrl);
	});

	it('NVIDIA TRELLIS: a polled GLB result', async () => {
		const { createNvidiaProvider } = await import('../api/_providers/nvidia.js');
		globalThis.fetch = vi.fn(async () => json({ artifacts: [{ base64: Buffer.from('glb').toString('base64') }] }));
		const res = await createNvidiaProvider().status({ taskId: 'req-1' });
		expect(res.status).toBe('done');
		expectCdnUrlFor(res.resultGlbUrl);
	});

});

describe('keyFromPublicUrl resolves both URL forms the bucket is served under', () => {
	it('maps a /cdn/ URL back to its key, so delete and purge paths remove the bytes', async () => {
		const { keyFromPublicUrl, cdnUrl } = await import('../api/_lib/r2.js');
		for (const key of ['forge/nvidia/abc.glb', 'forge/uploads/client/my photo (1).png']) {
			expect(keyFromPublicUrl(cdnUrl(key))).toBe(key);
		}
		expect(keyFromPublicUrl('https://three.ws/cdn/forge/a.glb?v=2#x')).toBe('forge/a.glb');
	});

	it('still rejects look-alike hosts and bare prefixes', async () => {
		const { keyFromPublicUrl } = await import('../api/_lib/r2.js');
		expect(keyFromPublicUrl('https://three.ws.evil.com/cdn/forge/a.glb')).toBeNull();
		expect(keyFromPublicUrl('https://three.ws/cdn/')).toBeNull();
		expect(keyFromPublicUrl('https://three.ws/cdnx/forge/a.glb')).toBeNull();
	});
});
