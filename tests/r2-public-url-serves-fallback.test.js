/**
 * publicUrl() used to build `<S3_PUBLIC_DOMAIN>/<key>`, the bucket's raw
 * *.r2.dev domain. That domain only serves objects that live in R2. Everything
 * written since R2 started refusing our credential on 2026-11-14 lives in the
 * GCS fallback bucket instead (api/_lib/storage-fallback.js), and only the
 * first-party /cdn/<key> proxy can read it. On 2026-11-25 /api/explore handed
 * out 38 avatar GLB links on r2.dev and every one answered 404, while the same
 * keys answered 200 through /cdn/. Upload endpoints returned the same dead
 * `public_url` for every fresh upload.
 *
 * publicUrl() now hands out the /cdn/ form (which serves R2 and the fallback
 * alike), and every place that recognises "our own storage URL" accepts it.
 * The raw domain survives only as bucketDomainUrl(), for the /cdn/ proxy's own
 * last-resort read, which must never point back at itself.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://pub-test.r2.dev',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
	delete process.env.PUBLIC_APP_ORIGIN;
});

const KEY = 'u/42/sharp-a69185.glb';

describe('publicUrl', () => {
	it('hands out the /cdn/ proxy URL, which serves both R2 and the GCS fallback', async () => {
		const { publicUrl } = await import('../api/_lib/r2.js');
		expect(publicUrl(KEY)).toBe('https://three.ws/cdn/u/42/sharp-a69185.glb');
		expect(publicUrl('u/42/file name.png')).toBe('https://three.ws/cdn/u/42/file%20name.png');
	});

	it('passes an absolute storage key through untouched', async () => {
		const { publicUrl } = await import('../api/_lib/r2.js');
		expect(publicUrl('https://three.ws/avatars/realistic-male.glb')).toBe('https://three.ws/avatars/realistic-male.glb');
	});

	it('still fails loud on a deployment without object storage, so an upload path cannot hand out a URL for bytes it has nowhere to put', async () => {
		const previous = process.env.S3_PUBLIC_DOMAIN;
		delete process.env.S3_PUBLIC_DOMAIN;
		vi.resetModules();
		try {
			const r2 = await import('../api/_lib/r2.js');
			expect(() => r2.publicUrl(KEY)).toThrow(/S3_PUBLIC_DOMAIN/);
		} finally {
			process.env.S3_PUBLIC_DOMAIN = previous;
			vi.resetModules();
		}
	});

	it('round-trips through keyFromPublicUrl', async () => {
		const { publicUrl, keyFromPublicUrl } = await import('../api/_lib/r2.js');
		expect(keyFromPublicUrl(publicUrl(KEY))).toBe(KEY);
	});

	it('keeps the raw bucket domain reachable only as bucketDomainUrl, for the proxy itself', async () => {
		const { bucketDomainUrl, bucketDomainUrlOrNull } = await import('../api/_lib/r2.js');
		expect(bucketDomainUrl(KEY)).toBe('https://pub-test.r2.dev/u/42/sharp-a69185.glb');
		expect(bucketDomainUrlOrNull(null)).toBeNull();
	});
});

describe('own-storage recognition accepts the /cdn/ form', () => {
	it('the provider-result fetch guard allows our /cdn/ URLs and nothing else on our origin', async () => {
		const { publicUrl } = await import('../api/_lib/r2.js');
		const { isAllowedProviderResultUrl } = await import('../api/_lib/provider-result-url.js');
		expect(isAllowedProviderResultUrl(publicUrl(KEY))).toBe(true);
		expect(isAllowedProviderResultUrl('https://three.ws/api/admin')).toBe(false);
		expect(isAllowedProviderResultUrl('https://three.ws.evil.example/cdn/u/42/a.glb')).toBe(false);
	});

	it('a world keeps a photo uploaded to our storage as its sourceImage', async () => {
		const { publicUrl } = await import('../api/_lib/r2.js');
		const { isOwnStorageUrl } = await import('../api/_lib/diorama-photo.js');
		expect(isOwnStorageUrl(publicUrl('u/42/photo.jpg'))).toBe(true);
		expect(isOwnStorageUrl('https://pub-test.r2.dev/u/42/photo.jpg')).toBe(true);
		expect(isOwnStorageUrl('https://three.ws/api/x.jpg')).toBe(false);
		expect(isOwnStorageUrl('https://elsewhere.example/cdn/u/42/photo.jpg')).toBe(false);
	});
});
