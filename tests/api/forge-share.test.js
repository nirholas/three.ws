// Integration test for GET /api/forge-share, the server-rendered share card a
// social crawler gets when it hits /forge/share/:id, and the poster the live
// /forge/embed viewer loads from its `og:image`/jsonLd `thumbnailUrl`.
//
// The regression this file exists for (prompt-402, "console errors" work
// order): a row written before the write-path fix that routes
// forge_creations.preview_image_url through cdnUrl() still carries the raw
// public *.r2.dev bucket domain. This handler read that column straight off
// the row and baked it into og:image / twitter:image / the embed poster
// param, so the raw r2.dev URL reached a browser via /forge/embed and tripped
// Chrome's Opaque Response Blocking. Every stored-URL column this handler
// serves to a browser must go through normalizeStoredUrl(), matching the
// convention in api/_lib/forge-store.js (see forge-store-listing-orb-safe.test.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn(async () => []);

vi.mock('../../api/_lib/db.js', () => ({
	sql: (...a) => sqlMock(...a),
	isDbUnavailableError: () => false,
}));
vi.mock('../../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'https://three.ws', S3_PUBLIC_DOMAIN: 'https://pub-legacy.r2.dev' },
}));

const { default: handler } = await import('../../api/forge-share.js');

const CREATION_ID = 'fce196ec-aaa1-417e-bb9c-e8a5b4d9f945';
const LEGACY_PREVIEW = 'https://pub-legacy.r2.dev/forge/thumb/legacy.png';

function mkReq(qs = `id=${CREATION_ID}`, method = 'GET') {
	return { method, url: `/api/forge-share?${qs}`, headers: { host: 'three.ws' } };
}

function mkRes() {
	return {
		statusCode: 200,
		_h: {},
		_body: undefined,
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(b) { this._body = b; this.writableEnded = true; },
	};
}

beforeEach(() => {
	sqlMock.mockReset();
	sqlMock.mockResolvedValue([]);
});

describe('GET /api/forge-share', () => {
	it('normalizes a legacy raw-r2.dev preview_image_url before using it as og:image', async () => {
		sqlMock.mockResolvedValueOnce([{
			id: CREATION_ID,
			prompt: 'a cardboard robot',
			preview_image_url: LEGACY_PREVIEW,
			status: 'generating',
			glb_url: null,
			web_glb_url: null,
			web_size_bytes: null,
			size_bytes: null,
			model_category: 'other',
			created_at: new Date().toISOString(),
			creator_username: null,
			creator_display_name: null,
		}]);
		const res = mkRes();
		await handler(mkReq(), res);

		expect(res.statusCode).toBe(200);
		expect(res._body).not.toMatch(/r2\.dev/);
		expect(res._body).toContain(
			'<meta property="og:image" content="https://three.ws/cdn/forge/thumb/legacy.png">',
		);
	});
});
