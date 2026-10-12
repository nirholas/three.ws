/**
 * listCreations() surfaces engine_version for Tripo rows (work order
 * 084-partners-01, task 5: attribution). Tripo's model version is a
 * deployment-wide setting (TRIPO_MODEL_VERSION or the provider's default),
 * not a stored column, so this is computed live the same way pollJob does
 * in api/forge.js rather than requiring a schema change.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		DATABASE_URL: 'postgres://test:test@localhost:5432/test',
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
});

let rows = [];
const sqlMock = vi.fn(async () => rows);

vi.mock('../api/_lib/db.js', () => ({
	sql: (...args) => sqlMock(...args),
	isDbUnavailableError: () => false,
}));

vi.mock('../api/_lib/r2.js', () => ({
	putObject: vi.fn(async () => {}),
	objectStorageConfigured: () => true,
	publicUrl: (key) => `https://cdn.example.com/${key}`,
	deleteObject: vi.fn(async () => {}),
	keyFromPublicUrl: () => null,
}));

const { listCreations } = await import('../api/_lib/forge-store.js');

afterEach(() => {
	sqlMock.mockClear();
	delete process.env.TRIPO_MODEL_VERSION;
});

describe('listCreations: engine_version', () => {
	it('names the live Tripo model version for a tripo-backed row', async () => {
		rows = [
			{
				id: 'c1', prompt: 'a brass owl', aspect: '1:1', glb_url: 'https://cdn/x.glb',
				web_glb_url: null, preview_image_url: null, outcome: 'generated', downloaded: false,
				views_used: null, multiview: false, backend: 'tripo', tier: 'high', path: 'geometry',
				model_category: 'other', created_at: new Date().toISOString(),
			},
		];
		const [row] = await listCreations({ clientKey: 'client-1' });
		expect(row.engine_version).toBe('v3.1-20260211');
	});

	it('reflects TRIPO_MODEL_VERSION when the operator overrides it', async () => {
		process.env.TRIPO_MODEL_VERSION = 'v3.2-beta';
		rows = [
			{
				id: 'c2', prompt: 'x', aspect: null, glb_url: 'https://cdn/y.glb',
				web_glb_url: null, preview_image_url: null, outcome: 'generated', downloaded: false,
				views_used: null, multiview: false, backend: 'tripo', tier: 'high', path: 'geometry',
				model_category: 'other', created_at: new Date().toISOString(),
			},
		];
		const [row] = await listCreations({ clientKey: 'client-1' });
		expect(row.engine_version).toBe('v3.2-beta');
	});

	it('is null for a non-Tripo backend', async () => {
		rows = [
			{
				id: 'c3', prompt: 'x', aspect: null, glb_url: 'https://cdn/z.glb',
				web_glb_url: null, preview_image_url: null, outcome: 'generated', downloaded: false,
				views_used: null, multiview: false, backend: 'trellis', tier: 'standard', path: 'image',
				model_category: 'other', created_at: new Date().toISOString(),
			},
		];
		const [row] = await listCreations({ clientKey: 'client-1' });
		expect(row.engine_version).toBeNull();
	});
});
