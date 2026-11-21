import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import {
	planParts,
	batchPartNumbers,
	backoffDelay,
	fingerprint,
	createMemoryStore,
	findResumable,
	uploadFile,
	discardUpload,
	createSpeedMeter,
	UploadError,
	SIGN_BATCH,
	MAX_UPLOAD_BYTES,
} from '../src/multipart-upload.js';

// A local HTTP server that speaks the capture-upload contract (create, sign,
// complete, abort) and the presigned part PUTs, with switches to inject failures.
const PART_SIZE = 64 * 1024;
let server;
let base;
let state;

function resetState() {
	state = {
		uploads: new Map(),
		puts: [],
		signCalls: [],
		creates: 0,
		aborts: [],
		failPart: new Map(), // partNumber -> remaining failures (status)
		failStatus: 500,
		expireSignedUrl: new Set(),
		goneIds: new Set(),
		inflight: 0,
		maxInflight: 0,
		partDelayMs: 0,
	};
}

const readBody = (req) =>
	new Promise((resolve) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks)));
	});

beforeAll(async () => {
	server = http.createServer(async (req, res) => {
		const url = new URL(req.url, base);
		const send = (status, body, headers = {}) => {
			res.writeHead(status, { 'content-type': 'application/json', ...headers });
			res.end(body === undefined ? '' : JSON.stringify(body));
		};
		if (req.method === 'PUT' && url.pathname.startsWith('/part/')) {
			const [, , uploadId, partStr] = url.pathname.split('/');
			const partNumber = Number(partStr);
			state.inflight++;
			state.maxInflight = Math.max(state.maxInflight, state.inflight);
			const body = await readBody(req);
			if (state.partDelayMs) await new Promise((r) => setTimeout(r, state.partDelayMs));
			state.inflight--;
			state.puts.push(partNumber);
			if (state.goneIds.has(uploadId)) return send(404, { error: 'NoSuchUpload' });
			if (state.expireSignedUrl.has(partNumber) && url.searchParams.get('v') !== '2') {
				return send(403, { error: 'expired' });
			}
			const remaining = state.failPart.get(partNumber) || 0;
			if (remaining > 0) {
				state.failPart.set(partNumber, remaining - 1);
				if (state.failStatus === 0) return req.socket.destroy();
				return send(state.failStatus, { error: 'boom' });
			}
			const up = state.uploads.get(uploadId);
			const etag = `"${createHash('md5').update(body).digest('hex')}"`;
			up.parts.set(partNumber, { etag, body });
			return send(200, undefined, { etag });
		}
		const body = JSON.parse((await readBody(req)).toString() || '{}');
		if (url.pathname === '/api/capture-upload/create') {
			state.creates++;
			const id = `up${state.creates}`;
			const part_count = Math.ceil(body.size_bytes / PART_SIZE);
			state.uploads.set(id, { parts: new Map(), key: `captures/${id}/${body.filename}` });
			return send(200, { upload_id: id, key: state.uploads.get(id).key, part_size: PART_SIZE, part_count });
		}
		if (url.pathname === '/api/capture-upload/sign') {
			state.signCalls.push(body.part_numbers);
			if (body.part_numbers.length > 100) return send(400, { error: 'too_many_parts', message: 'Too many parts.' });
			if (state.goneIds.has(body.upload_id)) return send(404, { error: 'not_found', message: 'No such upload.' });
			const urls = {};
			for (const n of body.part_numbers) {
				const v = state.expireSignedUrl.has(n) && state.signCalls.filter((c) => c.includes(n)).length > 1 ? '2' : '1';
				urls[n] = `${base}/part/${body.upload_id}/${n}?v=${v}`;
			}
			return send(200, { urls });
		}
		if (url.pathname === '/api/capture-upload/complete') {
			const up = state.uploads.get(body.upload_id);
			for (const p of body.parts) {
				if (!up.parts.has(p.part_number) || up.parts.get(p.part_number).etag !== p.etag) {
					return send(400, { error: 'bad_part', message: `Part ${p.part_number} did not match.` });
				}
			}
			const joined = Buffer.concat([...up.parts.keys()].sort((a, b) => a - b).map((n) => up.parts.get(n).body));
			up.assembled = joined;
			return send(200, { source_url: `${base}/files/${body.upload_id}`, size_bytes: joined.length });
		}
		if (url.pathname === '/api/capture-upload/abort') {
			state.aborts.push(body.upload_id);
			return send(200, { ok: true });
		}
		return send(404, { error: 'not_found' });
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));
beforeEach(resetState);

// Put through fetch in tests: the production default is XMLHttpRequest (browser only).
const fetchPut = async ({ url, blob, onProgress, signal }) => {
	const buf = Buffer.from(await blob.arrayBuffer());
	let res;
	try {
		res = await fetch(url, { method: 'PUT', body: buf, signal });
	} catch (err) {
		throw new UploadError('network', 'The connection dropped.', { cause: err });
	}
	if (!res.ok) throw new UploadError(`part_http_${res.status}`, `Storage answered ${res.status}.`, { status: res.status });
	onProgress(blob.size);
	return { etag: res.headers.get('etag') };
};

const noSleep = async () => {};
const makeFile = (size, name = 'walk.insv') => new File([randomBytes(size)], name, { type: 'application/octet-stream', lastModified: 1700000000000 });
const opts = (extra = {}) => ({
	apiBase: `${base}/api/capture-upload`,
	putPart: fetchPut,
	store: createMemoryStore(),
	sleep: noSleep,
	...extra,
});

describe('part planning', () => {
	it('splits a file into 1-based contiguous parts with a short last part', () => {
		const parts = planParts(250, 100);
		expect(parts).toEqual([
			{ partNumber: 1, start: 0, end: 100 },
			{ partNumber: 2, start: 100, end: 200 },
			{ partNumber: 3, start: 200, end: 250 },
		]);
	});
	it('makes exactly one part for a file smaller than the part size', () => {
		expect(planParts(10, 100)).toEqual([{ partNumber: 1, start: 0, end: 10 }]);
	});
	it('rejects empty files and bad part sizes', () => {
		expect(() => planParts(0, 100)).toThrow(/empty/);
		expect(() => planParts(10, 0)).toThrow(UploadError);
	});
	it('batches sign requests at the contract limit of 100', () => {
		const nums = Array.from({ length: 250 }, (_, i) => i + 1);
		const batches = batchPartNumbers(nums);
		expect(SIGN_BATCH).toBe(100);
		expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
		expect(batches.flat()).toEqual(nums);
	});
	it('backs off exponentially, capped, with jitter in the upper half', () => {
		expect(backoffDelay(1, () => 0)).toBe(300);
		expect(backoffDelay(1, () => 1)).toBe(600);
		expect(backoffDelay(3, () => 1)).toBe(2400);
		expect(backoffDelay(20, () => 1)).toBe(15000);
	});
	it('refuses files over 8 GiB before any request', async () => {
		const big = { name: 'x.insv', size: MAX_UPLOAD_BYTES + 1, lastModified: 1 };
		await expect(uploadFile(big, opts())).rejects.toMatchObject({ code: 'file_too_large' });
		expect(state.creates).toBe(0);
	});
	it('measures speed over a rolling window', () => {
		let t = 0;
		const m = createSpeedMeter(() => t, 5000);
		m.push(0);
		t = 2000;
		m.push(2_000_000);
		expect(m.bytesPerSecond()).toBe(1_000_000);
	});
});

describe('upload against a C4-speaking server', () => {
	it('uploads every part, assembles the exact bytes, completes and clears the record', async () => {
		const file = makeFile(PART_SIZE * 5 + 123);
		const o = opts();
		const progress = [];
		const result = await uploadFile(file, { ...o, onProgress: (p) => progress.push(p) });
		const up = [...state.uploads.values()][0];
		expect(Buffer.compare(up.assembled, Buffer.from(await file.arrayBuffer()))).toBe(0);
		expect(result.size_bytes).toBe(file.size);
		expect(result.resumed).toBe(false);
		expect(progress.at(-1).fraction).toBe(1);
		expect(progress.at(-1).partsDone).toBe(6);
		expect(await o.store.get(fingerprint(file))).toBeUndefined();
	});

	it('keeps at most four parts in flight', async () => {
		state.partDelayMs = 25;
		const file = makeFile(PART_SIZE * 12);
		await uploadFile(file, opts());
		expect(state.maxInflight).toBe(4);
	});

	it('signs in batches of at most 100 parts', async () => {
		const file = makeFile(PART_SIZE * 130);
		await uploadFile(file, opts());
		expect(state.signCalls.map((c) => c.length)).toEqual([100, 30]);
	});

	it('retries a failing part with backoff and still completes', async () => {
		state.failPart.set(2, 2);
		const retries = [];
		const file = makeFile(PART_SIZE * 3);
		await uploadFile(file, opts({ onRetry: (r) => retries.push(r) }));
		expect(retries.map((r) => [r.partNumber, r.attempt])).toEqual([[2, 1], [2, 2]]);
		expect(retries[1].delayMs).toBeGreaterThanOrEqual(retries[0].delayMs / 2);
	});

	it('retries a dropped connection', async () => {
		state.failPart.set(1, 1);
		state.failStatus = 0;
		const file = makeFile(PART_SIZE * 2);
		const result = await uploadFile(file, opts());
		expect(result.size_bytes).toBe(file.size);
	});

	it('gives up on a part after five attempts and keeps the finished parts for resume', async () => {
		state.failPart.set(3, 99);
		const file = makeFile(PART_SIZE * 4);
		const o = opts({ parallel: 1 });
		await expect(uploadFile(file, o)).rejects.toMatchObject({ status: 500 });
		const found = await findResumable(file, { store: o.store });
		expect(found.partsDone).toBe(2);
		expect(found.partCount).toBe(4);
		expect(state.puts.filter((n) => n === 3)).toHaveLength(5);
	});

	it('re-signs a part whose presigned URL expired', async () => {
		state.expireSignedUrl.add(2);
		const file = makeFile(PART_SIZE * 3);
		const result = await uploadFile(file, opts());
		expect(result.size_bytes).toBe(file.size);
		expect(state.signCalls.some((c) => c.length === 1 && c[0] === 2)).toBe(true);
	});

	it('does not retry a permanent client error', async () => {
		state.failPart.set(1, 99);
		state.failStatus = 400;
		const file = makeFile(PART_SIZE * 2);
		await expect(uploadFile(file, opts({ parallel: 1 }))).rejects.toMatchObject({ status: 400 });
		expect(state.puts.filter((n) => n === 1)).toHaveLength(1);
	});

	it('surfaces the server error code and message from create', async () => {
		const file = makeFile(1024);
		const failing = opts({
			fetchImpl: async () => new Response(JSON.stringify({ error: 'unauthorized', message: 'Sign in to upload.' }), { status: 401, headers: { 'content-type': 'application/json' } }),
		});
		await expect(uploadFile(file, failing)).rejects.toMatchObject({ code: 'unauthorized', status: 401, message: 'Sign in to upload.' });
	});
});

describe('resume', () => {
	it('after a failure sends only the missing parts and signs only those', async () => {
		const file = makeFile(PART_SIZE * 6);
		const o = opts({ parallel: 1 });
		state.failPart.set(4, 99);
		await expect(uploadFile(file, o)).rejects.toThrow();
		const firstCreates = state.creates;
		state.failPart.clear();
		state.puts.length = 0;
		state.signCalls.length = 0;

		const found = await findResumable(file, { store: o.store });
		expect(found.partsDone).toBe(3);
		expect(found.bytesDone).toBe(PART_SIZE * 3);

		const progress = [];
		const result = await uploadFile(file, { ...o, parallel: 4, onProgress: (p) => progress.push(p) });
		expect(result.resumed).toBe(true);
		expect(state.creates).toBe(firstCreates);
		expect(state.signCalls.flat().sort()).toEqual([4, 5, 6]);
		expect(state.puts.sort()).toEqual([4, 5, 6]);
		expect(progress[0].fraction).toBeCloseTo(0.5, 5);
		const up = [...state.uploads.values()][0];
		expect(Buffer.compare(up.assembled, Buffer.from(await file.arrayBuffer()))).toBe(0);
	});

	it('does not offer resume for a different file with the same name', async () => {
		const file = makeFile(PART_SIZE * 3);
		const o = opts({ parallel: 1 });
		state.failPart.set(3, 99);
		await expect(uploadFile(file, o)).rejects.toThrow();
		const other = new File([randomBytes(PART_SIZE * 3 + 1)], file.name, { lastModified: file.lastModified });
		expect(await findResumable(other, { store: o.store })).toBeNull();
	});

	it('starts over once when the recorded upload is gone server-side', async () => {
		const file = makeFile(PART_SIZE * 3);
		const o = opts({ parallel: 1 });
		state.failPart.set(3, 99);
		await expect(uploadFile(file, o)).rejects.toThrow();
		state.failPart.clear();
		state.goneIds.add('up1');
		const result = await uploadFile(file, { ...o });
		expect(result.size_bytes).toBe(file.size);
		expect(result.resumed).toBe(false);
		expect(state.creates).toBe(2);
		expect(await o.store.get(fingerprint(file))).toBeUndefined();
	});

	it('cancel aborts the multipart upload and drops the record', async () => {
		const file = makeFile(PART_SIZE * 8);
		const o = opts();
		const ctrl = new AbortController();
		state.partDelayMs = 30;
		const p = uploadFile(file, { ...o, signal: ctrl.signal, onProgress: (e) => e.partsDone >= 1 && ctrl.abort() });
		await expect(p).rejects.toMatchObject({ code: 'aborted' });
		expect(state.aborts).toHaveLength(1);
		expect(await o.store.get(fingerprint(file))).toBeUndefined();
	});

	it('discardUpload aborts a recorded upload', async () => {
		const file = makeFile(PART_SIZE * 3);
		const o = opts({ parallel: 1 });
		state.failPart.set(3, 99);
		await expect(uploadFile(file, o)).rejects.toThrow();
		await discardUpload(file, { apiBase: o.apiBase, store: o.store });
		expect(state.aborts).toHaveLength(1);
		expect(await findResumable(file, { store: o.store })).toBeNull();
	});
});
