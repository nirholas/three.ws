/**
 * normalizeStoredUrl() (prompt-402 "console errors" work order).
 *
 * forge_creations.preview_image_url / glb_url / web_glb_url are baked URL
 * strings, written once at creation time and returned verbatim by every
 * listing read (listShowcase, listCreations, ...). Rows created before the
 * fix that routed those writes through cdnUrl() still carry the raw public
 * *.r2.dev domain, which trips Chrome's Opaque Response Blocking on an <img>
 * or model-viewer load. normalizeStoredUrl() is the read-time rewrite for
 * already-existing rows: it resolves a raw-domain URL back to its bucket key
 * (keyFromPublicUrl) and re-renders it through cdnUrl(), same convention as
 * thumbnailUrl() for thumbnail_key.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://pub-abc123.r2.dev',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
		APP_ORIGIN: 'https://three.ws',
	});
});

const { normalizeStoredUrl, thumbnailUrl, publicUrl, cdnUrl } = await import('../api/_lib/r2.js');

describe('normalizeStoredUrl', () => {
	it('rewrites a legacy raw-bucket-domain URL to the same-origin /cdn/ form', () => {
		const legacy = publicUrl('forge/thumb/abc-123.png');
		expect(legacy).toMatch(/^https:\/\/pub-abc123\.r2\.dev\//);
		expect(normalizeStoredUrl(legacy)).toBe(cdnUrl('forge/thumb/abc-123.png'));
		expect(normalizeStoredUrl(legacy)).not.toMatch(/r2\.dev/);
	});

	it('passes an already-cdnUrl() value through untouched', () => {
		const good = cdnUrl('forge/thumb/already-good.png');
		expect(normalizeStoredUrl(good)).toBe(good);
	});

	it('passes a caller-supplied external reference image through untouched', () => {
		expect(normalizeStoredUrl('https://replicate.delivery/pbxt/thing.png')).toBe(
			'https://replicate.delivery/pbxt/thing.png',
		);
	});

	it('passes through null/undefined for a slot that was never filled', () => {
		expect(normalizeStoredUrl(null)).toBeNull();
		expect(normalizeStoredUrl(undefined)).toBeUndefined();
	});
});

// avatars.thumbnail_key is meant to hold a bare R2 key (see the
// `~ '^https?://'` guard in api/_lib/avatar-thumbs.js's own backfill query,
// which treats any absolute-URL value as legacy data to self-heal). A row
// backfill never reached still carries that raw-domain URL, and before this
// fix thumbnailUrl() only screened out the dead `*_og.png` subset of those,
// passing every other absolute URL straight through cdnUrl()'s
// already-resolved passthrough: a live, 200-rendering object still tripped
// Chrome's Opaque Response Blocking because it loaded on the bare r2.dev
// domain instead of the same-origin /cdn/ proxy.
describe('thumbnailUrl', () => {
	it('rewrites a legacy raw-bucket-domain thumbnail_key to the /cdn/ form', () => {
		const legacy = publicUrl('thumb/legacy-avatar.png');
		expect(thumbnailUrl(legacy)).toBe(cdnUrl('thumb/legacy-avatar.png'));
		expect(thumbnailUrl(legacy)).not.toMatch(/r2\.dev/);
	});

	it('still nulls out a legacy OG key', () => {
		expect(thumbnailUrl('https://three.ws/avatars/abc_og.png')).toBeNull();
	});

	it('still resolves a bare key the normal way', () => {
		expect(thumbnailUrl('thumb/bare-key.png')).toBe(cdnUrl('thumb/bare-key.png'));
	});

	it('still returns null for a falsy key', () => {
		expect(thumbnailUrl(null)).toBeNull();
		expect(thumbnailUrl('')).toBeNull();
	});
});
