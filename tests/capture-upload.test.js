// Contract C4 capture-upload: validation, part math, ownership, limits, size check.
// The R2 client is replaced by an in-memory multipart store so the real command
// objects (CreateMultipartUpload, UploadPart, ...) are what the code under test builds.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.S3_BUCKET = 'test-bucket';
process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
process.env.S3_ACCESS_KEY_ID = 'k';
process.env.S3_SECRET_ACCESS_KEY = 's';

const store = vi.hoisted(() => ({ uploads: new Map(), objects: new Map(), nextId: 1, finalSize: null }));

vi.mock('../api/_lib/r2.js', () => ({
	r2: {
		send: vi.fn(async (cmd) => {
			const i = cmd.input;
			switch (cmd.constructor.name) {
				case 'CreateMultipartUploadCommand': {
					const id = `up-${store.nextId++}`;
					store.uploads.set(id, { key: i.Key, meta: i.Metadata, initiated: new Date(), parts: new Map() });
					return { UploadId: id };
				}
				case 'ListMultipartUploadsCommand':
					return {
						Uploads: [...store.uploads.entries()]
							.filter(([, u]) => u.key.startsWith(i.Prefix))
							.map(([id, u]) => ({ UploadId: id, Key: u.key, Initiated: u.initiated })),
					};
				case 'CompleteMultipartUploadCommand': {
					const u = store.uploads.get(i.UploadId);
					if (!u || u.key !== i.Key) throw Object.assign(new Error('x'), { name: 'NoSuchUpload' });
					store.uploads.delete(i.UploadId);
					store.objects.set(i.Key, { ContentLength: store.finalSize ?? Number(u.meta.size_bytes), Metadata: u.meta });
					return {};
				}
				case 'HeadObjectCommand':
					return store.objects.get(i.Key);
				case 'DeleteObjectCommand':
					store.objects.delete(i.Key);
					return {};
				case 'AbortMultipartUploadCommand':
					if (!store.uploads.has(i.UploadId)) throw Object.assign(new Error('x'), { name: 'NoSuchUpload' });
					store.uploads.delete(i.UploadId);
					return {};
				case 'ListPartsCommand': {
					const u = store.uploads.get(i.UploadId);
					if (!u) throw Object.assign(new Error('x'), { name: 'NoSuchUpload' });
					return { Parts: [{ PartNumber: 1, ETag: '"a"', Size: 5 }], IsTruncated: false };
				}
				default:
					throw new Error(`unexpected ${cmd.constructor.name}`);
			}
		}),
	},
	presignGet: vi.fn(async ({ key, expiresIn }) => `https://signed.example/${key}?exp=${expiresIn}`),
	listObjectsPage: vi.fn(async ({ prefix }) => ({
		objects: [...store.objects.entries()]
			.filter(([k]) => k.startsWith(prefix))
			.map(([key, o]) => ({ key, size: o.ContentLength, lastModified: new Date() })),
		nextToken: null,
	})),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: vi.fn(async (_c, cmd, o) => `https://r2.example/${cmd.input.Key}?part=${cmd.input.PartNumber}&exp=${o.expiresIn}`),
}));

const lib = await import('../api/_lib/capture-upload.js');
const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const ok = { filename: 'walk.mp4', content_type: 'video/mp4', size_bytes: 10 * MiB, kind: 'pano' };

async function code(promise) {
	try {
		await promise;
	} catch (e) {
		return e.error;
	}
	return null;
}

beforeEach(() => {
	store.uploads.clear();
	store.objects.clear();
	store.finalSize = null;
});

describe('validateCreate matrix', () => {
	it('accepts every allowed type', () => {
		for (const [name, type] of [
			['a.mp4', 'video/mp4'], ['a.mov', 'video/quicktime'], ['a.jpg', 'image/jpeg'],
			['a.png', 'image/png'], ['a.exr', 'image/x-exr'], ['a.insv', 'application/octet-stream'],
			['a.INSP', 'application/octet-stream'], ['a.lrv', 'application/octet-stream'],
		]) {
			expect(lib.validateCreate({ ...ok, filename: name, content_type: type }).content_type).toBe(type);
		}
	});
	it('rejects octet-stream for non-raw extensions, unknown types, mismatched extensions', () => {
		expect(() => lib.validateCreate({ ...ok, filename: 'a.mp4', content_type: 'application/octet-stream' })).toThrow(/raw camera/);
		expect(() => lib.validateCreate({ ...ok, content_type: 'video/webm' })).toThrow(/content_type/);
		expect(() => lib.validateCreate({ ...ok, filename: 'a.png' })).toThrow(/ending in/);
		expect(() => lib.validateCreate({ ...ok, filename: 'noext' })).toThrow(/extension/);
		expect(() => lib.validateCreate({ ...ok, filename: '' })).toThrow();
	});
	it('rejects bad kind and sizes', () => {
		expect(() => lib.validateCreate({ ...ok, kind: 'avatar' })).toThrow(/kind/);
		for (const size_bytes of [0, -1, 1.5, '10', null, 8 * GiB + 1, Infinity]) {
			expect(() => lib.validateCreate({ ...ok, size_bytes })).toThrow(/size_bytes/);
		}
		expect(lib.validateCreate({ ...ok, size_bytes: 8 * GiB }).size_bytes).toBe(8 * GiB);
	});
	it('strips path components and unsafe characters from the filename', () => {
		expect(lib.validateCreate({ ...ok, filename: '../../etc/pass wd?.mp4' }).filename).toBe('pass_wd_.mp4');
		expect(lib.validateCreate({ ...ok, filename: 'C:\\clips\\VID 001.mp4' }).filename).toBe('VID_001.mp4');
	});
});

describe('planParts', () => {
	it('1 KB is one 8 MiB part', () => {
		expect(lib.planParts(1024)).toEqual({ part_size: 8 * MiB, part_count: 1 });
	});
	it('512 MB uses the 8 MiB floor', () => {
		const p = lib.planParts(512 * MiB);
		expect(p.part_size).toBe(8 * MiB);
		expect(p.part_count).toBe(64);
	});
	it('8 GiB stays at or below 1000 parts and covers the file', () => {
		const p = lib.planParts(8 * GiB);
		expect(p.part_count).toBeLessThanOrEqual(1000);
		expect(p.part_size * p.part_count).toBeGreaterThanOrEqual(8 * GiB);
		expect(p.part_size % MiB).toBe(0);
		expect(p.part_size).toBe(9 * MiB);
	});
});

describe('upload lifecycle', () => {
	it('creates under the owner prefix with the size recorded', async () => {
		const out = await lib.createUpload('user-1', ok);
		expect(out.key).toMatch(/^captures\/raw\/user-1\/[0-9a-f-]{36}\/walk\.mp4$/);
		expect(out).toMatchObject({ part_size: 8 * MiB, part_count: 2 });
		expect(store.uploads.get(out.upload_id).meta.size_bytes).toBe(String(10 * MiB));
	});

	it('signs up to 100 parts with a one hour expiry', async () => {
		const c = await lib.createUpload('user-1', ok);
		const { urls } = await lib.signParts('user-1', { ...c, part_numbers: [1, 2, 2] });
		expect(Object.keys(urls)).toEqual(['1', '2']);
		expect(urls['1']).toContain('exp=3600');
		const many = Array.from({ length: 100 }, (_, i) => i + 1);
		expect(Object.keys((await lib.signParts('user-1', { ...c, part_numbers: many })).urls)).toHaveLength(100);
		expect(await code(lib.signParts('user-1', { ...c, part_numbers: [...many, 101] }))).toBe('invalid_part_numbers');
		expect(await code(lib.signParts('user-1', { ...c, part_numbers: [0] }))).toBe('invalid_part_numbers');
		expect(await code(lib.signParts('user-1', { ...c, part_numbers: [] }))).toBe('invalid_part_numbers');
	});

	it('completes, checks the size and returns a 7 day source url', async () => {
		const c = await lib.createUpload('user-1', ok);
		const out = await lib.completeUpload('user-1', { ...c, parts: [{ part_number: 2, etag: '"b"' }, { part_number: 1, etag: '"a"' }] });
		expect(out.size_bytes).toBe(10 * MiB);
		expect(out.source_url).toContain('exp=604800');
	});

	it('discards and rejects an object whose size differs from the declared size', async () => {
		const c = await lib.createUpload('user-1', ok);
		store.finalSize = 10 * MiB - 1;
		expect(await code(lib.completeUpload('user-1', { ...c, parts: [{ part_number: 1, etag: '"a"' }] }))).toBe('size_mismatch');
		expect(store.objects.has(c.key)).toBe(false);
	});

	it('rejects a malformed part list and an unknown upload', async () => {
		const c = await lib.createUpload('user-1', ok);
		expect(await code(lib.completeUpload('user-1', { ...c, parts: [{ part_number: 1 }] }))).toBe('invalid_parts');
		expect(await code(lib.completeUpload('user-1', { ...c, upload_id: 'nope', parts: [{ part_number: 1, etag: 'x' }] }))).toBe('upload_not_found');
	});

	it('aborts, and a second abort is still ok', async () => {
		const c = await lib.createUpload('user-1', ok);
		expect(await lib.abortUpload('user-1', c)).toEqual({ ok: true });
		expect(store.uploads.size).toBe(0);
		expect(await lib.abortUpload('user-1', c)).toEqual({ ok: true });
	});

	it('lists stored parts for resume', async () => {
		const c = await lib.createUpload('user-1', ok);
		expect((await lib.listUploadedParts('user-1', c)).parts[0]).toMatchObject({ part_number: 1, etag: '"a"' });
	});
});

describe('ownership and tamper rejection', () => {
	it('refuses every operation on another user\'s key', async () => {
		const c = await lib.createUpload('user-1', ok);
		for (const fn of [
			() => lib.signParts('user-2', { ...c, part_numbers: [1] }),
			() => lib.completeUpload('user-2', { ...c, parts: [{ part_number: 1, etag: 'x' }] }),
			() => lib.abortUpload('user-2', c),
			() => lib.listUploadedParts('user-2', c),
		]) {
			expect(await code(fn())).toBe('forbidden');
		}
		expect(store.uploads.has(c.upload_id)).toBe(true);
	});
	it('refuses tampered keys', async () => {
		const c = await lib.createUpload('user-1', ok);
		const swap = (k) => ({ ...c, key: k, part_numbers: [1] });
		for (const key of [
			c.key.replace('user-1', 'user-2'),
			c.key.replace('/walk.mp4', '/../../other/x.mp4'),
			'captures/raw/user-1/../user-2/x/y.mp4',
			'avatars/user-1/x.glb',
			`${c.key}/extra`,
			undefined,
		]) {
			expect(await code(lib.signParts('user-1', swap(key)))).toBe('forbidden');
		}
	});
	it('a prefix-sharing user id cannot reach another user', async () => {
		const c = await lib.createUpload('user-1', ok);
		expect(await code(lib.abortUpload('user-1-evil', c))).toBe('forbidden');
	});
	it('R2 itself binds an upload id to its key', async () => {
		const a = await lib.createUpload('user-1', ok);
		const b = await lib.createUpload('user-1', ok);
		expect(await code(lib.completeUpload('user-1', { upload_id: a.upload_id, key: b.key, parts: [{ part_number: 1, etag: 'x' }] }))).toBe('upload_not_found');
	});
});

describe('limits', () => {
	it('allows three open uploads and refuses the fourth with a readable message', async () => {
		for (let i = 0; i < 3; i++) await lib.createUpload('user-1', ok);
		const err = await lib.createUpload('user-1', ok).catch((e) => e);
		expect(err.status).toBe(429);
		expect(err.error).toBe('too_many_open_uploads');
		expect(err.message).toMatch(/3 uploads in progress/);
		await lib.createUpload('user-2', ok);
	});
	it('enforces the daily byte quota from completed objects', async () => {
		store.objects.set('captures/raw/user-1/00000000-0000-0000-0000-000000000000/old.mp4', { ContentLength: 30 * GiB, Metadata: {} });
		expect(await code(lib.createUpload('user-1', { ...ok, size_bytes: 3 * GiB }))).toBe('daily_quota_exceeded');
		expect((await lib.createUpload('user-1', { ...ok, size_bytes: 2 * GiB })).part_count).toBeGreaterThan(0);
	});
});

describe('handler shell', () => {
	function mkRes() {
		const r = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; }, end(b) { this.body = b || ''; }, writeHead(s) { this.statusCode = s; }, headersSent: false };
		return r;
	}
	it('answers 405 for a GET', async () => {
		const create = (await import('../api/capture-upload/create.js')).default;
		const res = mkRes();
		await create({ method: 'GET', url: '/api/capture-upload/create', headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
