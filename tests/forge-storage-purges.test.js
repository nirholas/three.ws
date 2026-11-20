/**
 * Bucket objects a deleted forge creation still owes (issue #639).
 *
 * From 2026-11-15 R2 rejected the production credential, so a delete could not
 * remove bytes, and /cdn/ kept streaming them from the public bucket domain.
 * A removed model must stop being served from three.ws the moment its row is
 * gone, and the bytes must be purged once storage answers again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'node:stream';

Object.assign(process.env, {
	S3_ENDPOINT: 'https://s3.example.com',
	S3_BUCKET: 'test-bucket',
	S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
	S3_ACCESS_KEY_ID: 'test-key',
	S3_SECRET_ACCESS_KEY: 'test-secret',
});

let pendingRows = [];
const sqlCalls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings, ...values) => {
		const text = strings.join('?').replace(/\s+/g, ' ').trim();
		sqlCalls.push({ text, values });
		if (text.startsWith('select target, kind from forge_storage_purges')) return pendingRows;
		if (text.startsWith('select count(*)')) return [{ n: pendingRows.length }];
		return [];
	},
	isDbUnavailableError: () => false,
}));

const send = vi.fn();
const deleteObject = vi.fn(async () => {});
const listObjectsPage = vi.fn(async () => ({ objects: [], nextToken: null }));
vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		r2: { send: (...a) => send(...a) },
		deleteObject: (...a) => deleteObject(...a),
		listObjectsPage: (...a) => listObjectsPage(...a),
	};
});

const purges = await import('../api/_lib/forge-storage-purges.js');
const { default: cdnHandler } = await import('../api/cdn-object.js');

const ID = '301676f1-cddf-49f5-ab6e-351203c47d44';
const GLB = `forge/678ab2f7d7cd/${ID}.glb`;
const unauthorized = () => Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', $metadata: { httpStatusCode: 401 } });

function makeRes() {
	const res = new Writable({ write(_c, _e, cb) { cb(); } });
	res.statusCode = 200;
	res.headers = {};
	res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = String(v); };
	res.getHeader = (k) => res.headers[k.toLowerCase()];
	res.removeHeader = (k) => { delete res.headers[k.toLowerCase()]; };
	const end = res.end.bind(res);
	res.end = (chunk) => { res.body = chunk ? String(chunk) : ''; return end(chunk); };
	return res;
}
const cdnReq = (key) => ({ method: 'GET', url: `/api/cdn-object?key=${key}`, headers: {}, query: { key } });

beforeEach(async () => {
	sqlCalls.length = 0;
	send.mockReset();
	deleteObject.mockReset();
	deleteObject.mockImplementation(async () => {});
	listObjectsPage.mockReset();
	listObjectsPage.mockImplementation(async () => ({ objects: [], nextToken: null }));
	pendingRows = [];
	// Invalidate the per-process block cache between tests.
	await purges.queueStoragePurges({ entries: [{ target: 'forge/x/reset', kind: 'object' }] });
	sqlCalls.length = 0;
});

describe('/cdn/ refuses a deleted creation whose bytes are still queued', () => {
	it('answers 410 without reading storage for a queued key, its prefix and its resized variants', async () => {
		pendingRows = [
			{ target: GLB, kind: 'object' },
			{ target: `forge/678ab2f7d7cd/${ID}-poster`, kind: 'prefix' },
			{ target: `forge/uploads/678ab2f7d7cd/89224ed8.png`, kind: 'object' },
		];
		for (const key of [GLB, `forge/678ab2f7d7cd/${ID}-poster.webp`, `_v/256/forge/uploads/678ab2f7d7cd/89224ed8.png`]) {
			const res = makeRes();
			await cdnHandler(cdnReq(key), res);
			expect(res.statusCode, key).toBe(410);
			expect(res.headers['cache-control']).toContain('no-store');
		}
		expect(send).not.toHaveBeenCalled();
	});

	it('serves every other key as before', async () => {
		pendingRows = [{ target: GLB, kind: 'object' }];
		send.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NoSuchKey', Code: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }));
		const res = makeRes();
		await cdnHandler(cdnReq(`forge/678ab2f7d7cd/0b7f2a52-6a3e-4f1c-9d55-1f4f8a2b9c10.glb`), res);
		expect(send).toHaveBeenCalled();
		expect(res.statusCode).not.toBe(410);
	});
});

describe('drainStoragePurges', () => {
	it('deletes queued objects and listed prefixes, then marks them purged', async () => {
		pendingRows = [
			{ target: GLB, kind: 'object' },
			{ target: `forge/678ab2f7d7cd/${ID}`, kind: 'prefix' },
		];
		listObjectsPage.mockResolvedValueOnce({ objects: [{ key: `forge/678ab2f7d7cd/${ID}.png` }], nextToken: null });
		const out = await purges.drainStoragePurges();
		expect(deleteObject.mock.calls.map(([k]) => k)).toEqual([GLB, `forge/678ab2f7d7cd/${ID}.png`]);
		expect(out.purged).toBe(2);
		expect(sqlCalls.filter((c) => c.text.includes('set purged_at = now()'))).toHaveLength(2);
	});

	it('stops at the first storage outage and records the error', async () => {
		pendingRows = [
			{ target: GLB, kind: 'object' },
			{ target: `forge/678ab2f7d7cd/${ID}.png`, kind: 'object' },
		];
		deleteObject.mockRejectedValue(unauthorized());
		const out = await purges.drainStoragePurges();
		expect(out).toMatchObject({ attempted: 1, purged: 0, storageDown: true });
		expect(sqlCalls.some((c) => c.text.includes('last_error ='))).toBe(true);
	});

	it('never queues a target outside the forge namespace', async () => {
		const n = await purges.queueStoragePurges({ entries: [{ target: 'u/someone/avatar.glb' }, { target: 'forge/../u/x' }] });
		expect(n).toBe(0);
	});
});
