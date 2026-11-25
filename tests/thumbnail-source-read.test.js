// The avatar thumbnail backfill read each model's GLB through a presigned R2
// URL. While the production R2 secret was rejected, every presigned URL
// answered 401, so the CPU lane fell back to chromium, chromium's fetch got the
// same 401, and the batch charged each avatar an attempt for
// "glb fetch failed: upstream returned 401": a string neither failure classifier
// recognises. Production logged that pair for 8 avatars every five minutes, which
// retires the whole visible backlog permanently in three ticks.
//
// The fix reads bucket-held GLBs through the storage fallback ladder (signed R2,
// then the GCS fallback bucket, then the public bucket domain) and hands the
// bytes to the renderer, so a dead signing credential neither breaks the render
// nor blames the model. An absolute-URL storage key is still fetched as a URL.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAsymmetricGlb } from './_helpers/asymmetric-glb.js';

const sqlCalls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn((strings, ...vals) => {
		const text = Array.isArray(strings) ? strings.join('?') : String(strings);
		sqlCalls.push({ text, vals });
		if (/INSERT INTO avatar_thumbnail_backfill/i.test(text)) {
			return Promise.resolve([{ id: 'av-1', storage_key: 'u/1/model.glb', name: 'One' }]);
		}
		return Promise.resolve([]);
	}),
}));

const rejected = () => Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', $metadata: { httpStatusCode: 401 } });
const presignGetMock = vi.fn(async ({ key }) => (/^https?:/.test(key) ? key : `https://signed.example/${key}`));
const getPublicObjectBufferMock = vi.fn();
const putObjectMock = vi.fn(async () => {});
vi.mock('../api/_lib/r2.js', async (importActual) => ({
	...(await importActual()),
	presignGet: (...a) => presignGetMock(...a),
	getPublicObjectBuffer: (...a) => getPublicObjectBufferMock(...a),
	putObject: (...a) => putObjectMock(...a),
	publicUrl: (key) => `https://cdn.example/${key}`,
}));

// Any URL fetch stands in for the presigned R2 URL that the dead credential
// signed: it answers 401, exactly as production did.
const fetchModelMock = vi.fn(async () => {
	throw Object.assign(new Error('upstream returned 401'), { code: 'upstream_error' });
});
vi.mock('../api/_lib/fetch-model.js', async (importActual) => ({
	...(await importActual()),
	fetchModel: (...a) => fetchModelMock(...a),
}));

let glb;
beforeEach(async () => {
	if (!glb) glb = Buffer.from(await buildAsymmetricGlb());
	sqlCalls.length = 0;
	presignGetMock.mockClear();
	fetchModelMock.mockClear();
	putObjectMock.mockClear();
	getPublicObjectBufferMock.mockReset().mockImplementation(async () => glb);
	const { clearModelCache } = await import('../api/_lib/render-cpu.js');
	clearModelCache();
	delete process.env.RENDER_CPU_LANE;
});

describe('avatar thumbnail render while the R2 signing credential is rejected', () => {
	it('renders a bucket-held GLB from the storage ladder instead of a presigned URL', async () => {
		const { renderThumbnail } = await import('../api/_lib/avatar-thumbs.js');
		const r = await renderThumbnail({ id: 'av-1', storage_key: 'u/1/model.glb' });
		expect(getPublicObjectBufferMock).toHaveBeenCalledWith('u/1/model.glb');
		expect(fetchModelMock).not.toHaveBeenCalled();
		expect(r.key).toBe('thumb/av-1.png');
		const png = putObjectMock.mock.calls[0][0].body;
		expect(png.subarray(1, 4).toString()).toBe('PNG');
	});

	it('still fetches an absolute-URL storage key as a URL', async () => {
		const { renderThumbnail } = await import('../api/_lib/avatar-thumbs.js');
		await expect(renderThumbnail({ id: 'av-2', storage_key: 'https://models.example/a.glb' })).rejects.toThrow(/401/);
		expect(getPublicObjectBufferMock).not.toHaveBeenCalled();
		expect(fetchModelMock).toHaveBeenCalledWith('https://models.example/a.glb', expect.anything());
	});

	it('hands the attempt back when no storage rung can read the source', async () => {
		getPublicObjectBufferMock.mockImplementation(async () => { throw rejected(); });
		const { renderBatch } = await import('../api/_lib/avatar-thumbs.js');
		const out = await renderBatch({ limit: 1 });
		expect(out.failed).toBe(0);
		expect(out.aborted).toMatch(/unauthorized/i);
		const charged = sqlCalls.some((c) => /SET last_error/i.test(c.text));
		expect(charged).toBe(false);
	});
});

describe('renderGlbToPng accepts the model bytes directly', () => {
	it('renders glbBytes on the CPU lane without fetching anything', async () => {
		const { renderGlbToPng } = await import('../api/_lib/render-glb.js');
		const png = await renderGlbToPng({ glbBytes: glb, width: 64, height: 64 });
		expect(png.subarray(1, 4).toString()).toBe('PNG');
		expect(fetchModelMock).not.toHaveBeenCalled();
	});

	it('enforces the byte cap on supplied bytes the way the fetcher does', async () => {
		const { renderGlbToPngCpu } = await import('../api/_lib/render-cpu.js');
		await expect(renderGlbToPngCpu({ glbBytes: glb, maxBytes: 16, width: 64, height: 64 })).rejects.toMatchObject({ code: 'file_too_large' });
	});

	it('still requires a model', async () => {
		const { renderGlbToPng } = await import('../api/_lib/render-glb.js');
		await expect(renderGlbToPng({})).rejects.toThrow(/glbUrl required/);
	});
});

// Avatars the presigned-URL era already retired. Their only failure was the
// signing credential, so they are released back into the candidate set; a
// genuinely missing or broken model keeps its retirement.
describe('releasing avatars the rejected signing credential retired', () => {
	it('matches the exact production failure and nothing model-attributable', async () => {
		const { SIGNED_READ_ERROR_PATTERN } = await import('../api/_lib/avatar-thumbs.js');
		const re = new RegExp(SIGNED_READ_ERROR_PATTERN, 'i');
		expect(re.test('glb fetch failed: upstream returned 401')).toBe(true);
		expect(re.test('glb fetch failed: upstream returned 403')).toBe(true);
		expect(re.test('glb fetch failed: upstream returned 404')).toBe(false);
		expect(re.test('render failed: glb decode failed: Unexpected token')).toBe(false);
	});

	it('deletes only bucket-key ledger rows whose last error is that failure', async () => {
		const { releaseSignedReadFailures, SIGNED_READ_ERROR_PATTERN } = await import('../api/_lib/avatar-thumbs.js');
		await releaseSignedReadFailures();
		const del = sqlCalls.find((c) => /DELETE FROM avatar_thumbnail_backfill/i.test(c.text));
		expect(del).toBeTruthy();
		expect(del.text).toMatch(/storage_key/);
		expect(del.vals).toContain(SIGNED_READ_ERROR_PATTERN);
	});

	it('runs on every backfill tick, before the render batch', async () => {
		process.env.CRON_SECRET = 'test-secret';
		vi.doMock('../api/_lib/r2.js', async (importActual) => ({
			...(await importActual()),
			objectStorageConfigured: () => true,
			getPublicObjectBuffer: (...a) => getPublicObjectBufferMock(...a),
			putObject: (...a) => putObjectMock(...a),
			headObject: async () => null,
			publicUrl: (key) => `https://cdn.example/${key}`,
		}));
		vi.resetModules();
		const { default: handler } = await import('../api/cron/avatar-thumbnail-backfill.js');
		const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; }, on() {} };
		await handler({ method: 'GET', url: '/api/cron/avatar-thumbnail-backfill', headers: { authorization: 'Bearer test-secret' } }, res);
		const order = sqlCalls.map((c) => c.text);
		const released = order.findIndex((t) => /DELETE FROM avatar_thumbnail_backfill[\s\S]*storage_key/i.test(t));
		const claimed = order.findIndex((t) => /INSERT INTO avatar_thumbnail_backfill/i.test(t));
		expect(released).toBeGreaterThanOrEqual(0);
		expect(claimed).toBeGreaterThan(released);
	});
});
