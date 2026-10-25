/**
 * cad/store.js writes and reads (work order 439, "ORB-blocking raw R2 URL").
 *
 * uploadArtifacts() persisted every CAD artifact URL with the raw
 * publicUrl() bucket-domain helper instead of cdnUrl(), and getDesign(),
 * getLineage(), and listDesigns() returned those (or any legacy) raw URLs
 * verbatim. Chrome's Opaque Response Blocking rejects the raw *.r2.dev
 * domain on an <img>/GLTFLoader load. Every write must use cdnUrl(), and
 * every read must self-heal an already-stored raw URL via
 * normalizeStoredUrl(), matching forge-store.js's established convention.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

Object.assign(process.env, {
	DATABASE_URL: 'postgres://test:test@localhost:5432/test',
	S3_ENDPOINT: 'https://s3.example.com',
	S3_BUCKET: 'test-bucket',
	S3_PUBLIC_DOMAIN: 'https://pub-legacy.r2.dev',
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
		objectStorageConfigured: () => true,
		publicUrl: actual.publicUrl,
		keyFromPublicUrl: actual.keyFromPublicUrl,
		normalizeStoredUrl: actual.normalizeStoredUrl,
		cdnUrl: actual.cdnUrl,
	};
});

vi.mock('../api/_lib/env.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, databaseConfigured: () => true };
});

vi.mock('../api/_lib/streaks.js', () => ({
	recordDailyActivity: vi.fn(async () => {}),
	maybeAwardFirstCreation: vi.fn(async () => {}),
}));

const { uploadArtifacts, getDesign, getLineage, listDesigns } = await import('../api/_lib/cad/store.js');
const { publicUrl, cdnUrl } = await import('../api/_lib/r2.js');

const LEGACY_THUMB = publicUrl('cad/d1/thumb.svg');
const LEGACY_GLB = publicUrl('cad/d1/part.glb');

afterEach(() => {
	sqlMock.mockClear();
});

describe('cad/store.js writes and reads are ORB-safe', () => {
	it('uploadArtifacts: returns cdnUrl()-shaped URLs, not raw publicUrl() ones', async () => {
		const urls = await uploadArtifacts('cad/d1', {
			glb: Buffer.from('glb-bytes').toString('base64'),
			thumb_svg: Buffer.from('<svg/>').toString('base64'),
		});
		expect(urls.glb).toBe(cdnUrl('cad/d1/part.glb'));
		expect(urls.thumb_svg).toBe(cdnUrl('cad/d1/thumb.svg'));
		expect(urls.glb).not.toMatch(/r2\.dev/);
		expect(urls.thumb_svg).not.toMatch(/r2\.dev/);
	});

	it('getDesign: normalizes a legacy files map stored with raw publicUrl() entries', async () => {
		rows = [{
			id: 'd1', parent_id: null, title: 't', summary: null, prompt: 'x', code: 'c',
			params: [], metrics: {}, files: { glb: LEGACY_GLB, thumb_svg: LEGACY_THUMB },
			adjustments: [], model: null, views: 0, creator_username: null,
			created_at: new Date().toISOString(),
		}];
		const design = await getDesign('d1');
		expect(design.files.glb).toBe(cdnUrl('cad/d1/part.glb'));
		expect(design.files.thumb_svg).toBe(cdnUrl('cad/d1/thumb.svg'));
		expect(design.files.glb).not.toMatch(/r2\.dev/);
	});

	it('getLineage: normalizes a legacy thumb value', async () => {
		rows = [{ id: 'd2', title: 't', prompt: 'x', thumb: LEGACY_THUMB, created_at: new Date().toISOString(), rel: 'child' }];
		const { children } = await getLineage('d1');
		expect(children[0].thumb).toBe(cdnUrl('cad/d1/thumb.svg'));
		expect(children[0].thumb).not.toMatch(/r2\.dev/);
	});

	it('listDesigns: normalizes a legacy thumb value', async () => {
		rows = [{
			id: 'd3', title: 't', summary: null, prompt: 'x', thumb: LEGACY_THUMB,
			size_mm: null, views: 0, created_at: new Date().toISOString(),
		}];
		const [design] = await listDesigns({});
		expect(design.thumb).toBe(cdnUrl('cad/d1/thumb.svg'));
		expect(design.thumb).not.toMatch(/r2\.dev/);
	});
});
