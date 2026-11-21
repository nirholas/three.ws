// /api/pano-scene job state survives an R2 credential outage.
//
// The .insp chain keeps its depth task id and its two one-at-a-time claims in
// small JSON objects beside the results. Production R2 has refused every
// credential the platform holds since 2026-11-14 (401 Unauthorized), and the
// rest of the platform writes to the STORAGE_FALLBACK_BUCKET instead. These
// claims must do the same WITHOUT losing their compare-and-swap guarantee, or
// two polls racing on two Cloud Run instances would submit the depth task
// twice. GCS expresses the same preconditions with generations
// (x-goog-if-generation-match: 0 to create, :<generation> to replace), so this
// suite runs the real storage-fallback.js against an in-memory GCS XML API that
// enforces them, behind an R2 client that answers 401 to everything.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const r2Mode = vi.hoisted(() => ({ value: 'revoked' }));
vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		r2: {
			async send() {
				if (r2Mode.value === 'missing') {
					throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
				}
				throw Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', $metadata: { httpStatusCode: 401 } });
			},
		},
	};
});

vi.mock('../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: async () => 'test-token' }));

const { claim, readJsonObject, writeJsonObject } = await import('../api/_lib/pano-scene-job.js');

// In-memory GCS XML API with generation preconditions, behind global fetch.
function fakeGcs() {
	const objects = new Map();
	let generation = 1_700_000_000_000_000;
	const keyOf = (url) => decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));
	async function handle(url, init = {}) {
		const key = keyOf(url);
		const method = init.method || 'GET';
		const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
		const existing = objects.get(key);
		if (method === 'GET' || method === 'HEAD') {
			if (!existing) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
			return new Response(method === 'HEAD' ? null : existing.body, {
				status: 200,
				headers: { 'content-type': existing.type, 'x-goog-generation': String(existing.generation), etag: `"${existing.generation}"` },
			});
		}
		if (method === 'PUT') {
			const want = headers['x-goog-if-generation-match'];
			if (want !== undefined) {
				const have = existing ? String(existing.generation) : '0';
				if (have !== String(want)) return new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 });
			}
			const obj = { body: Buffer.from(init.body), type: headers['content-type'], generation: ++generation };
			objects.set(key, obj);
			return new Response('', { status: 200, headers: { 'x-goog-generation': String(obj.generation) } });
		}
		if (method === 'DELETE') {
			objects.delete(key);
			return new Response(null, { status: 204 });
		}
		return new Response('', { status: 405 });
	}
	return { objects, handle };
}

let gcs;
let realFetch;
const KEY = 'captures/pano-scene/user-a/job-1/state.json';

beforeEach(() => {
	r2Mode.value = 'revoked';
	process.env.S3_BUCKET = 'pano-scene-test-bucket';
	process.env.STORAGE_FALLBACK_BUCKET = 'fallback-bucket';
	gcs = fakeGcs();
	realFetch = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		if (String(url).startsWith('https://storage.googleapis.com/fallback-bucket/')) return gcs.handle(String(url), init);
		throw new Error(`unexpected fetch ${url}`);
	};
});

afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.STORAGE_FALLBACK_BUCKET;
});

describe('pano-scene job state on the GCS fallback while R2 refuses the credential', () => {
	it('writes and reads back a state object', async () => {
		const etag = await writeJsonObject(KEY, { depth_task_id: 'depth-1' });
		expect(etag).toBeTruthy();
		const got = await readJsonObject(KEY);
		expect(got.data).toEqual({ depth_task_id: 'depth-1' });
		expect(gcs.objects.has(KEY)).toBe(true);
	});

	it('reads an absent object as null', async () => {
		expect(await readJsonObject(KEY)).toBeNull();
	});

	it('creates once: a second If-None-Match create loses', async () => {
		expect(await writeJsonObject(KEY, { claimed_at: 1 }, { ifNoneMatch: true })).toBeTruthy();
		expect(await writeJsonObject(KEY, { claimed_at: 2 }, { ifNoneMatch: true })).toBeNull();
		expect((await readJsonObject(KEY)).data).toEqual({ claimed_at: 1 });
	});

	it('replaces only the version read: a stale etag loses', async () => {
		await writeJsonObject(KEY, { claimed_at: 1 }, { ifNoneMatch: true });
		const first = await readJsonObject(KEY);
		const next = await writeJsonObject(KEY, { claimed_at: 2 }, { ifMatch: first.etag });
		expect(next).toBeTruthy();
		expect(await writeJsonObject(KEY, { claimed_at: 3 }, { ifMatch: first.etag })).toBeNull();
		expect((await readJsonObject(KEY)).data).toEqual({ claimed_at: 2 });
	});

	it('six polls racing for the same claim produce exactly one winner', async () => {
		const results = await Promise.all(Array.from({ length: 6 }, (_, i) => claim(KEY, { staleMs: 60_000, now: 1_000 + i })));
		expect(results.filter((r) => r.won)).toHaveLength(1);
	});

	it('a stale claim is taken over by exactly one of two racing polls', async () => {
		await claim(KEY, { staleMs: 60_000, now: 1_000 });
		const later = 1_000 + 120_000;
		const results = await Promise.all([claim(KEY, { staleMs: 60_000, now: later }), claim(KEY, { staleMs: 60_000, now: later + 1 })]);
		expect(results.filter((r) => r.won)).toHaveLength(1);
	});

	it('finds an object the outage left in GCS after R2 recovers (R2 answers NoSuchKey)', async () => {
		await writeJsonObject(KEY, { depth_task_id: 'depth-9' });
		r2Mode.value = 'missing';
		expect((await readJsonObject(KEY)).data).toEqual({ depth_task_id: 'depth-9' });
	});

	it('still surfaces the R2 fault when no fallback bucket is configured', async () => {
		delete process.env.STORAGE_FALLBACK_BUCKET;
		await expect(readJsonObject(KEY)).rejects.toThrow(/Unauthorized/);
	});
});
