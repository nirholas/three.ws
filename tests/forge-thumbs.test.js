// api/_lib/forge-thumbs.js — server-side thumbnail backfill for the Forge.
//
// The invariant under test: a `preview_image_url` is only ever persisted AFTER
// the PNG behind it has been uploaded to R2, and only when the slot is still
// empty (fill-only). Violating the first half puts a card's <img> at a missing
// object (net::ERR_BLOCKED_BY_ORB); violating the second clobbers a poster the
// maker captured. These tests pin both on the render path.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `sql` is a tagged template; route each call by its text and record order so a
// test can assert the R2-before-DB sequencing.
const sqlCalls = [];
let sqlRoutes = [];
const order = [];
const defaultSqlImpl = (strings, ...vals) => {
	const text = Array.isArray(strings) ? strings.join('?') : String(strings);
	sqlCalls.push({ text, vals });
	if (/UPDATE forge_creations/i.test(text)) order.push('db');
	const handler = sqlRoutes.find((r) => r.match.test(text));
	return Promise.resolve(handler ? handler.rows : []);
};
const sqlMock = vi.fn(defaultSqlImpl);
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));

const putObjectMock = vi.fn(async () => order.push('r2'));
const getObjectBufferMock = vi.fn();
vi.mock('../api/_lib/r2.js', () => ({
	putObject: (...a) => putObjectMock(...a),
	publicUrl: (key) => `https://cdn.example/${key}`,
	getObjectBuffer: (...a) => getObjectBufferMock(...a),
	// renderThumbnail persists this as a same-origin /cdn/ URL, not the raw
	// bucket domain (prompt-402 "console errors" work order: the raw domain
	// trips Chrome's ORB on an <img> load). Different domain than the
	// publicUrl mock above so a test can tell the two apart.
	cdnUrl: (key) => `https://app.example/cdn/${key}`,
}));

import sharp from 'sharp';
const realPng = await sharp({
	create: { width: 768, height: 768, channels: 3, background: '#335577' },
})
	.png()
	.toBuffer();
const renderGlbToPngMock = vi.fn(async () => realPng);
vi.mock('../api/_lib/render-glb.js', () => ({
	renderGlbToPng: (...a) => renderGlbToPngMock(...a),
	isBrowserInfrastructureError: () => false,
}));

// avatar-thumbs is imported only for thumbBackdropFor (a pure helper).
vi.mock('../api/_lib/avatar-thumbs.js', () => ({
	thumbBackdropFor: (id) => ({ inner: '#111', outer: '#000', _id: id }),
}));

const { renderThumbnail, forgeThumbKeyFor, THUMB_SIZE, upgradeLegacyBatch } = await import('../api/_lib/forge-thumbs.js');

beforeEach(() => {
	sqlCalls.length = 0;
	order.length = 0;
	sqlRoutes = [];
	sqlMock.mockClear();
	putObjectMock.mockClear();
	renderGlbToPngMock.mockClear();
});

describe('renderThumbnail', () => {
	it('uploads to R2 before it commits the preview key (ORB-safety)', async () => {
		sqlRoutes = [{ match: /UPDATE forge_creations/i, rows: [{ id: 'c-1' }] }];
		await renderThumbnail({ id: 'c-1', glb_url: 'https://cdn/x.glb' });
		expect(putObjectMock).toHaveBeenCalledTimes(1);
		// R2 write happens strictly before the DB commit.
		expect(order).toEqual(['r2', 'db']);
	});

	it('writes the thumbnail at the forge/thumb/<id>.webp key and fills preview + preview_key', async () => {
		sqlRoutes = [{ match: /UPDATE forge_creations/i, rows: [{ id: 'c-2' }] }];
		const r = await renderThumbnail({ id: 'c-2', glb_url: 'https://cdn/y.glb' });
		expect(putObjectMock.mock.calls[0][0].key).toBe(forgeThumbKeyFor('c-2'));
		expect(r.key).toBe('forge/thumb/c-2.webp');
		expect(r.url).toBe('https://app.example/cdn/forge/thumb/c-2.webp');
		expect(r.filled).toBe(true);
		// The UPDATE is fill-only — guarded by preview_image_url IS NULL.
		const upd = sqlCalls.find((c) => /UPDATE forge_creations/i.test(c.text));
		expect(upd.text).toMatch(/preview_image_url IS NULL/i);
	});

	it('reports filled:false when the slot was already taken (a poster won the race)', async () => {
		sqlRoutes = [{ match: /UPDATE forge_creations/i, rows: [] }]; // no row updated
		const r = await renderThumbnail({ id: 'c-3', glb_url: 'https://cdn/z.glb' });
		expect(r.filled).toBe(false);
		// Object was still uploaded (idempotent key), just not committed as the preview.
		expect(putObjectMock).toHaveBeenCalledTimes(1);
	});

	it('renders at the display size and uploads a small WebP, not a 768px PNG', async () => {
		sqlRoutes = [{ match: /UPDATE forge_creations/i, rows: [{ id: 'c-5' }] }];
		expect(THUMB_SIZE).toBe(512);
		await renderThumbnail({ id: 'c-5', glb_url: 'https://cdn/w.glb' });
		expect(renderGlbToPngMock.mock.calls[0][0].width).toBe(512);
		const up = putObjectMock.mock.calls[0][0];
		expect(up.contentType).toBe('image/webp');
		const meta = await sharp(up.body).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.width).toBeLessThanOrEqual(512);
		expect(up.body.length).toBeLessThan(60_000);
	});

	it('throws (and never commits) when the renderer returns no bytes', async () => {
		renderGlbToPngMock.mockResolvedValueOnce(Buffer.alloc(0));
		await expect(renderThumbnail({ id: 'c-4', glb_url: 'https://cdn/e.glb' })).rejects.toThrow(/no bytes/);
		expect(putObjectMock).not.toHaveBeenCalled();
		expect(sqlCalls.some((c) => /UPDATE forge_creations/i.test(c.text))).toBe(false);
	});
});

describe('upgradeLegacyBatch', () => {
	it('re-encodes a stored 768px PNG thumbnail to WebP and swaps the row to the new key', async () => {
		sqlRoutes = [
			{ match: /SELECT id, preview_key/i, rows: [{ id: 'c-9', preview_key: 'forge/thumb/c-9.png' }] },
			{ match: /UPDATE forge_creations/i, rows: [{ id: 'c-9' }] },
		];
		getObjectBufferMock.mockResolvedValueOnce(realPng);
		const r = await upgradeLegacyBatch({ limit: 5 });
		expect(r).toMatchObject({ scanned: 1, upgraded: 1, failed: 0 });
		const up = putObjectMock.mock.calls[0][0];
		expect(up.key).toBe('forge/thumb/c-9.webp');
		expect(up.contentType).toBe('image/webp');
		const upd = sqlCalls.find((c) => /UPDATE forge_creations/i.test(c.text));
		expect(upd.text).toMatch(/preview_key =/i);
		expect(order).toEqual(['r2', 'db']);
	});

	it('leaves the row on the old PNG when the object cannot be read', async () => {
		sqlRoutes = [{ match: /SELECT id, preview_key/i, rows: [{ id: 'c-8', preview_key: 'forge/thumb/c-8.png' }] }];
		getObjectBufferMock.mockRejectedValueOnce(new Error('NoSuchKey'));
		const r = await upgradeLegacyBatch({ limit: 5 });
		expect(r).toMatchObject({ scanned: 1, upgraded: 0, failed: 1 });
		expect(putObjectMock).not.toHaveBeenCalled();
	});
});
