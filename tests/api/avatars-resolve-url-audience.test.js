// resolveAvatarUrl has to answer differently depending on who receives the URL,
// and getting that wrong is invisible until storage breaks.
//
// A private avatar used to come back as a presigned S3 URL for every caller,
// including the dashboard. R2's S3 endpoint allows our origin on the preflight,
// so that looks correct right up until the credential is rejected: the 403 it
// answers with carries NO access-control-allow-origin, the browser hides the
// status, and the page sees an opaque "blocked by CORS policy" it can neither
// report nor retry. The authenticated sweep of 2026-09-08 measured exactly that,
// 32 confirmed errors across /dashboard and /dashboard/avatars, every one of
// them a private avatar whose real fault was a rotated storage secret.
//
// Browser callers now get the same-origin proxy, which enforces the identical
// owner-only rule, sends wildcard CORS and carries the public-bucket failover.
// Third parties we hand a URL to (the Avaturn edit session, an MCP client)
// cannot authenticate against that proxy, so they keep the presigned URL.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/db.js', () => ({ sql: async () => [] }));
vi.mock('../../api/_lib/cache.js', () => ({ cacheWrap: (_k, fn) => fn() }));
vi.mock('../../api/_lib/r2.js', () => ({
	publicUrl: (key) => `https://pub-test.r2.dev/${key}`,
	thumbnailUrl: (key) => (key ? `https://pub-test.r2.dev/${key}` : null),
	presignGet: async ({ key, expiresIn }) =>
		`https://bucket.r2.cloudflarestorage.com/${key}?X-Amz-Signature=deadbeef&X-Amz-Expires=${expiresIn}`,
	deleteObject: async () => {},
}));

const { resolveAvatarUrl } = await import('../../api/_lib/avatars.js');

const PRIVATE = { id: 'aaaaaaaa-0000-4000-8000-000000000001', visibility: 'private', storage_key: 'u/o/a.glb' };

beforeEach(() => vi.clearAllMocks());

describe('resolveAvatarUrl audience', () => {
	it('hands a browser the same-origin proxy for a private avatar, never a presigned URL', async () => {
		const r = await resolveAvatarUrl(PRIVATE, { browser: true });
		expect(r.url).toBe(`https://three.ws/api/avatars/${PRIVATE.id}/glb`);
		expect(r.url).not.toMatch(/X-Amz-Signature/);
		expect(r.cdn).toBe(false);
		// No expiry to strand a long-open tab on.
		expect(r.expires_in).toBeUndefined();
	});

	it('still presigns for a third party that cannot authenticate against the proxy', async () => {
		const r = await resolveAvatarUrl(PRIVATE, { expiresIn: 3600 });
		expect(r.url).toMatch(/X-Amz-Signature/);
		expect(r.expires_in).toBe(3600);
	});

	it('serves public and unlisted avatars from the CDN either way', async () => {
		for (const visibility of ['public', 'unlisted']) {
			const row = { ...PRIVATE, visibility };
			for (const opts of [{ browser: true }, {}]) {
				const r = await resolveAvatarUrl(row, opts);
				expect(r.url).toBe('https://pub-test.r2.dev/u/o/a.glb');
				expect(r.cdn).toBe(true);
			}
		}
	});

	it('serves the baked GLB through the proxy id, not the raw key', async () => {
		// The proxy resolves the served key itself, so a baked avatar needs no
		// different URL here; the id is the whole address.
		const baked = { ...PRIVATE, baked_storage_key: 'u/o/baked.glb', appearance_hash: 'x', appearance: {} };
		const r = await resolveAvatarUrl(baked, { browser: true });
		expect(r.url).toBe(`https://three.ws/api/avatars/${PRIVATE.id}/glb`);
	});
});
