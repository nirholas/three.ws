/**
 * forge-store.js listing reads (prompt-402 "console errors" work order).
 *
 * glb_url / web_glb_url / preview_image_url are baked URL strings, written
 * once at creation time and returned verbatim by every listing read. A row
 * created before the write-path fix that routes those writes through
 * cdnUrl() still carries the raw public *.r2.dev bucket domain in the DB.
 * Chrome's Opaque Response Blocking rejects that domain on an <img> /
 * model-viewer load (net::ERR_BLOCKED_BY_ORB), confirmed live on /grok's
 * "Fresh from the Forge" strip (listShowcase, via GET /api/forge-gallery).
 *
 * Every browser-facing listing export must run each stored URL column
 * through normalizeStoredUrl() so an already-existing row self-heals at read
 * time, matching the thumbnailUrl() convention for thumbnail_key.
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
		deleteObject: vi.fn(async () => {}),
		objectStorageConfigured: () => true,
		publicUrl: actual.publicUrl,
		keyFromPublicUrl: actual.keyFromPublicUrl,
		normalizeStoredUrl: actual.normalizeStoredUrl,
		cdnUrl: actual.cdnUrl,
	};
});

const {
	listCreations, listCreationsByUser, listShowcase, listRecentCreations, listRemixable, listMostRemixed,
	getPublicCreation, listRelated,
} = await import('../api/_lib/forge-store.js');
const { publicUrl, cdnUrl } = await import('../api/_lib/r2.js');

const LEGACY_GLB = publicUrl('forge/client-1/legacy.glb');
const LEGACY_PREVIEW = publicUrl('forge/thumb/legacy.png');

afterEach(() => {
	sqlMock.mockClear();
});

describe('forge-store listing reads normalize legacy raw-domain URLs', () => {
	it('listCreations: glb_url, web_glb_url, preview_image_url', async () => {
		rows = [{
			id: 'c1', prompt: 'x', aspect: null, glb_url: LEGACY_GLB, web_glb_url: LEGACY_GLB,
			preview_image_url: LEGACY_PREVIEW, outcome: 'generated', downloaded: false,
			views_used: null, multiview: false, backend: 'trellis', tier: 'standard', path: 'image',
			model_category: 'other', created_at: new Date().toISOString(),
		}];
		const [row] = await listCreations({ clientKey: 'client-1' });
		expect(row.glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.web_glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.preview_image_url).toBe(cdnUrl('forge/thumb/legacy.png'));
		expect(row.glb_url).not.toMatch(/r2\.dev/);
	});

	it('listCreationsByUser: glbUrl, previewImageUrl', async () => {
		rows = [{
			id: 'c2', prompt: 'x', glb_url: LEGACY_GLB, preview_image_url: LEGACY_PREVIEW,
			model_category: 'other', parent_creation_id: null, remixable: true,
			created_at: new Date().toISOString(),
		}];
		const [row] = await listCreationsByUser({ userId: 'user-1' });
		expect(row.glbUrl).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.previewImageUrl).toBe(cdnUrl('forge/thumb/legacy.png'));
	});

	it('listShowcase: glb_url, web_glb_url, preview_image_url', async () => {
		rows = [{
			id: 'c3', prompt: 'x', glb_url: LEGACY_GLB, web_glb_url: LEGACY_GLB,
			preview_image_url: LEGACY_PREVIEW, views_used: null, multiview: false,
			backend: 'trellis', tier: 'standard', path: 'image', model_category: 'other',
			created_at: new Date().toISOString(), vote_count: 0, voted: false,
			x402_payer: null, x402_tx_sig: null, x402_price_atomic: null,
		}];
		const [row] = await listShowcase({});
		expect(row.glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.web_glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.preview_image_url).toBe(cdnUrl('forge/thumb/legacy.png'));
	});

	it('listRecentCreations: glbUrl, previewImageUrl', async () => {
		rows = [{
			id: 'c4', prompt: 'x', glb_url: LEGACY_GLB, web_glb_url: null,
			preview_image_url: LEGACY_PREVIEW, model_category: 'other',
			parent_creation_id: null, created_at: new Date().toISOString(),
			x402_payer: null, x402_tx_sig: null, x402_price_atomic: null,
			username: null, display_name: null, avatar_url: null,
		}];
		const [row] = await listRecentCreations({});
		expect(row.glbUrl).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.previewImageUrl).toBe(cdnUrl('forge/thumb/legacy.png'));
	});

	it('listRemixable: glb_url, preview_image_url', async () => {
		rows = [{
			id: 'c5', prompt: 'x', glb_url: LEGACY_GLB, preview_image_url: LEGACY_PREVIEW,
			remix_royalty_bps: 500, creator_wallet_solana: null, parent_creation_id: null,
			lineage_index: 0, backend: 'trellis', model_category: 'other',
			created_at: new Date().toISOString(), remix_count: 0,
			owner_username: null, owner_display_name: null, owner_avatar_url: null,
		}];
		const [row] = await listRemixable({});
		expect(row.glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.preview_image_url).toBe(cdnUrl('forge/thumb/legacy.png'));
	});

	it('listMostRemixed: glb_url, preview_image_url', async () => {
		rows = [{
			id: 'c6', prompt: 'x', glb_url: LEGACY_GLB, preview_image_url: LEGACY_PREVIEW,
			remix_royalty_bps: 0, creator_wallet_solana: null, remixable: true,
			model_category: 'other', created_at: new Date().toISOString(), remix_count: 3,
		}];
		const [row] = await listMostRemixed({});
		expect(row.glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.preview_image_url).toBe(cdnUrl('forge/thumb/legacy.png'));
	});

	it('getPublicCreation (model-page share/poster read): glb_url, web_glb_url, preview_image_url', async () => {
		rows = [{
			id: 'c7', prompt: 'x', aspect: null, glb_url: LEGACY_GLB, web_glb_url: LEGACY_GLB,
			web_size_bytes: null, preview_image_url: LEGACY_PREVIEW, outcome: 'generated',
			views_used: null, multiview: false, backend: 'trellis', tier: 'standard', path: 'image',
			model_category: 'other', created_at: new Date().toISOString(),
			x402_payer: null, x402_tx_sig: null, x402_price_atomic: null,
			vote_count: 0, size_bytes: 1024, remixable: false, remix_royalty_bps: null,
			parent_creation_id: null, refine_instruction: null, view_count: 0, remix_count: 0, voted: false,
			creator_username: null, creator_display_name: null, creator_avatar_url: null,
			sim_readiness: null, sim_readiness_graded_at: null,
		}];
		const row = await getPublicCreation({ id: 'c7' });
		expect(row.glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.web_glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.preview_image_url).toBe(cdnUrl('forge/thumb/legacy.png'));
		expect(row.glb_url).not.toMatch(/r2\.dev/);
	});

	it('listRelated (model-page sidebar poster read): glb_url, preview_image_url', async () => {
		rows = [{
			id: 'c8', prompt: 'x', glb_url: LEGACY_GLB, preview_image_url: LEGACY_PREVIEW,
			model_category: 'other', backend: 'trellis', vote_count: 0, view_count: 0,
			created_at: new Date().toISOString(), same_category: true,
		}];
		const [row] = await listRelated({ id: 'c7' });
		expect(row.glb_url).toBe(cdnUrl('forge/client-1/legacy.glb'));
		expect(row.preview_image_url).toBe(cdnUrl('forge/thumb/legacy.png'));
	});
});
