/**
 * Model search over Florence-2 captions and tags (work order 819).
 *
 * Before: /api/search models only matched `prompt ilike` on the handful of
 * remixable creations. After: every public finished creation is searchable by
 * its prompt, its generated caption and detailed caption, and its tags; a tag
 * hit ranks first, and the remix block only appears on remixable rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

Object.assign(process.env, {
	DATABASE_URL: 'postgres://test:test@localhost:5432/test',
	S3_ENDPOINT: 'https://s3.example.com',
	S3_BUCKET: 'test-bucket',
	S3_PUBLIC_DOMAIN: 'https://cdn.three.ws',
	S3_ACCESS_KEY_ID: 'test-key',
	S3_SECRET_ACCESS_KEY: 'test-secret',
	APP_ORIGIN: 'https://three.ws',
});

let rows = [];
const sqlMock = vi.fn(async () => rows);
vi.mock('../api/_lib/db.js', () => ({
	sql: (...args) => sqlMock(...args),
	isDbUnavailableError: () => false,
}));

vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		putObject: vi.fn(async () => {}),
		deleteObject: vi.fn(async () => {}),
		objectStorageConfigured: () => true,
		publicUrl: actual.publicUrl,
		keyFromPublicUrl: actual.keyFromPublicUrl,
		normalizeStoredUrl: actual.normalizeStoredUrl,
		cdnUrl: actual.cdnUrl,
	};
});

const { searchPublicCreations } = await import('../api/_lib/forge-store.js');
const { searchModels } = await import('../api/_lib/cross-search.js');

function lastQuery() {
	const call = sqlMock.mock.calls.at(-1);
	return { text: call[0], params: call[1] };
}

beforeEach(() => {
	sqlMock.mockClear();
	rows = [];
});

describe('searchPublicCreations', () => {
	it('matches prompt, caption, detailed caption and tags of public done creations', async () => {
		await searchPublicCreations({ q: 'Lanterns', limit: 5 });
		const { text, params } = lastQuery();
		expect(text).toMatch(/left join forge_creation_descriptions/i);
		expect(text).toMatch(/fc\.status = 'done'/);
		expect(text).toMatch(/fc\.visibility is null or fc\.visibility = 'public'/);
		expect(text).toMatch(/fc\.prompt ilike/);
		expect(text).toMatch(/d\.caption ilike/);
		expect(text).toMatch(/d\.detailed ilike/);
		expect(text).toMatch(/d\.tags && \$\d+::text\[\]/);
		expect(params).toContain('%Lanterns%');
		expect(params).toContainEqual(['lanterns', 'lantern']);
		expect(params.at(-1)).toBe(5);
	});

	it('ranks a tag hit above a text-only hit', async () => {
		await searchPublicCreations({ q: 'lamp' });
		expect(lastQuery().text).toMatch(/order by \(d\.tags && \$\d+::text\[\]\) desc nulls last, fc\.created_at desc/i);
	});

	it('still searches text when the query is not a valid tag', async () => {
		await searchPublicCreations({ q: 'background' });
		const { text, params } = lastQuery();
		expect(params).toContainEqual([]);
		expect(text).toMatch(/fc\.prompt ilike/);
	});

	it('returns nothing without a query and never hits the database', async () => {
		expect(await searchPublicCreations({ q: '  ' })).toEqual([]);
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('maps rows with their caption and tags', async () => {
		rows = [
			{
				id: 'a1', prompt: 'camper van', glb_url: 'https://cdn.three.ws/a.glb', preview_image_url: null,
				created_at: '2026-11-01T00:00:00Z', remixable: false, remix_royalty_bps: null,
				creator_username: 'maker', caption: 'A white van.', tags: ['van', 'vehicle'], tag_hit: true,
			},
		];
		const [r] = await searchPublicCreations({ q: 'van' });
		expect(r).toMatchObject({ id: 'a1', caption: 'A white van.', tags: ['van', 'vehicle'], tagHit: true, remixable: false, ownerUsername: 'maker' });
	});
});

describe('searchModels', () => {
	it('links every model to its page and offers remix only when the creation is remixable', async () => {
		rows = [
			{ id: 'r1', prompt: 'a sword', glb_url: 'https://cdn.three.ws/r1.glb', created_at: '2026-11-01T00:00:00Z', remixable: true, remix_royalty_bps: 500, caption: 'A sword.', tags: ['sword'] },
			{ id: 'n1', prompt: 'a shield', glb_url: 'https://cdn.three.ws/n1.glb', created_at: '2026-11-01T00:00:00Z', remixable: false, caption: null, tags: null },
		];
		const out = await searchModels({ q: 'sword' });
		expect(out[0].assetUrl).toBe('/m/r1');
		expect(out[0].remix).toMatchObject({ sourceCreationId: 'r1', royaltyPercent: 5 });
		expect(out[0].tags).toEqual(['sword']);
		expect(out[1].remix).toBeNull();
		expect(out[1].creator).toBeNull();
		expect(out[1].description).toBe('a shield');
	});
});
