/**
 * The poster handed to the describe worker must be a fetchable https URL. Some
 * older creations stored their preview inline as a data: URI; the worker's
 * SSRF guard refuses that scheme, so six rows in the 2026-11-11 backfill
 * (run2-3) failed with "scheme not allowed: data" and would have burned all
 * three attempts. Such a row falls back to the server render of its GLB.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: async () => [], isDbUnavailableError: () => false }));
vi.mock('../api/_lib/r2.js', () => ({ normalizeStoredUrl: (u) => (typeof u === 'string' && u ? u : null) }));

const { posterUrlFor } = await import('../api/_lib/creation-descriptions.js');

const GLB = 'https://three.ws/cdn/forge/abc/model.glb';

describe('posterUrlFor', () => {
	it('uses a stored https preview as is', () => {
		const url = 'https://three.ws/cdn/forge/abc/model.jpg';
		expect(posterUrlFor({ preview_image_url: url, glb_url: GLB, size_bytes: 1000 })).toBe(url);
	});

	it('falls back to the GLB render when the stored preview is an inline data: URI', () => {
		const url = posterUrlFor({ preview_image_url: 'data:image/png;base64,iVBORw0KGgo=', glb_url: GLB, size_bytes: 1000 });
		expect(url).toMatch(/^https:\/\/three\.ws\/api\/render\/glb\?/);
		expect(url).toContain(encodeURIComponent(GLB));
	});

	it('returns null for a data: preview with no renderable GLB', () => {
		expect(posterUrlFor({ preview_image_url: 'data:image/png;base64,iVBORw0KGgo=' })).toBeNull();
	});
});
