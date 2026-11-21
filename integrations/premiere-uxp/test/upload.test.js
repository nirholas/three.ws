'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createClient } = require('../src/core/client');
const { uploadFile, partRange, resumeKey, PARALLEL_PARTS } = require('../src/core/upload');
const { CancelToken } = require('../src/core/retry');
const { startC4Server, memoryStore, bufferFile, instantSleep, KEY } = require('./c4-server');

const payload = (n) => crypto.randomBytes(n);

function setup(server, extra = {}) {
	const client = createClient({ origin: server.origin, getKey: async () => KEY, sleep: instantSleep });
	return { client, store: memoryStore(), token: new CancelToken(), ...extra };
}

test('partRange covers the file exactly with a short last part', () => {
	assert.deepEqual(partRange(1, 1024, 2500), { start: 0, end: 1024 });
	assert.deepEqual(partRange(3, 1024, 2500), { start: 2048, end: 2500 });
	assert.equal(PARALLEL_PARTS, 4);
});

test('uploads a multi-part file with 4 parts in flight and the server reassembles identical bytes', async () => {
	const server = await startC4Server({ partSize: 1024, putDelayMs: 40 });
	try {
		const data = payload(1024 * 11 + 77);
		const { client, store, token } = setup(server);
		const progress = [];
		const out = await uploadFile({ client, file: bufferFile('a.mp4', data), store, token, sleep: instantSleep, onProgress: (p) => progress.push(p.sentBytes) });
		assert.equal(out.size_bytes, data.length);
		assert.equal(out.resumed_parts, 0);
		const up = [...server.uploads.values()][0];
		assert.ok(up.assembled.equals(data), 'assembled bytes match');
		assert.equal(server.peakInFlight, 4);
		assert.equal(progress.at(-1), data.length);
		assert.ok(progress.every((v, i) => i === 0 || v >= progress[i - 1]), 'progress never goes backwards');
		assert.equal(store.map.size, 0, 'resume state is cleared on success');
	} finally {
		await server.close();
	}
});

test('a 403 on a part re-signs it and the upload still completes', async () => {
	const server = await startC4Server({ partSize: 1024 });
	try {
		const data = payload(1024 * 3);
		const { client, store, token } = setup(server);
		const origCreate = client.createUpload;
		client.createUpload = async (f) => {
			const c = await origCreate(f);
			server.faults.forbidOnce.add(`${c.upload_id}:2`);
			return c;
		};
		await uploadFile({ client, file: bufferFile('a.mp4', data), store, token, sleep: instantSleep });
		const signs = server.log.filter((l) => l.includes('/sign')).length;
		assert.ok(signs >= 2, `part 2 was signed again (sign calls: ${signs})`);
		assert.ok([...server.uploads.values()][0].assembled.equals(data));
	} finally {
		await server.close();
	}
});

test('a transient 503 from storage is retried with backoff', async () => {
	const server = await startC4Server({ partSize: 1024 });
	try {
		const data = payload(2048);
		const { client, store, token } = setup(server);
		const origCreate = client.createUpload;
		client.createUpload = async (f) => {
			const c = await origCreate(f);
			server.faults.failPutOnce.add(`${c.upload_id}:1`);
			return c;
		};
		const sleeps = [];
		await uploadFile({ client, file: bufferFile('a.mp4', data), store, token, sleep: async (ms) => sleeps.push(ms) });
		assert.deepEqual(sleeps, [750]);
		assert.ok([...server.uploads.values()][0].assembled.equals(data));
	} finally {
		await server.close();
	}
});

test('resume: a second run reconciles with the server and sends only the missing parts', async () => {
	const server = await startC4Server({ partSize: 1024 });
	try {
		const data = payload(1024 * 6);
		const file = bufferFile('big.mp4', data);
		const { client, store } = setup(server);

		// First run dies after 2 parts: cancel from the progress callback.
		const first = new CancelToken();
		let parts = 0;
		await assert.rejects(
			uploadFile({
				client,
				file,
				store,
				token: first,
				sleep: instantSleep,
				concurrency: 1,
				onProgress: () => {
					if (++parts === 3) first.cancel();
				},
			}),
			(err) => err.code === 'cancelled',
		);
		// Cancel aborts server-side, so simulate a crash instead: rebuild the state a crashed panel leaves behind.
		const server2 = await startC4Server({ partSize: 1024 });
		try {
			const c2 = setup(server2);
			const created = await c2.client.createUpload(file);
			const sent = [1, 2, 3];
			for (const n of sent) {
				const signed = await c2.client.signParts(created, [n]);
				const { start, end } = partRange(n, created.part_size, file.size);
				const res = await fetch(signed.urls[n], { method: 'PUT', body: data.subarray(start, end) });
				assert.equal(res.status, 200);
			}
			await c2.store.save(resumeKey(file), { upload: created, etags: {}, createdAt: Date.now() });
			const putsBefore = server2.log.filter((l) => l.startsWith('PUT')).length;
			const out = await uploadFile({ client: c2.client, file, store: c2.store, token: new CancelToken(), sleep: instantSleep });
			const putsAfter = server2.log.filter((l) => l.startsWith('PUT')).length - putsBefore;
			assert.equal(out.resumed_parts, 3);
			assert.equal(putsAfter, 3, 'only the 3 missing parts were uploaded');
			assert.ok([...server2.uploads.values()][0].assembled.equals(data));
		} finally {
			await server2.close();
		}
	} finally {
		await server.close();
	}
});

test('resume: an upload the server forgot falls back to a fresh create', async () => {
	const server = await startC4Server({ partSize: 1024 });
	try {
		const data = payload(2500);
		const file = bufferFile('lost.mp4', data);
		const { client, store, token } = setup(server);
		await store.save(resumeKey(file), { upload: { upload_id: 'gone', key: 'k', part_size: 1024, part_count: 3 }, etags: { 1: '"x"' } });
		const out = await uploadFile({ client, file, store, token, sleep: instantSleep });
		assert.equal(out.resumed_parts, 0);
		assert.ok([...server.uploads.values()].find((u) => u.completed).assembled.equals(data));
	} finally {
		await server.close();
	}
});

test('cancel aborts the upload on the server and removes the saved state', async () => {
	const server = await startC4Server({ partSize: 1024, putDelayMs: 30 });
	try {
		const data = payload(1024 * 8);
		const { client, store, token } = setup(server);
		let n = 0;
		await assert.rejects(
			uploadFile({ client, file: bufferFile('c.mp4', data), store, token, sleep: instantSleep, onProgress: () => ++n === 2 && token.cancel() }),
			(e) => e.code === 'cancelled',
		);
		assert.equal(server.uploads.size, 0, 'server dropped the multipart upload');
		assert.ok(server.log.some((l) => l.includes('/abort')));
		assert.equal(store.map.size, 0);
	} finally {
		await server.close();
	}
});

test('create errors surface with the visitor message and no operator hint', async () => {
	const server = await startC4Server();
	try {
		server.faults.failCreate = { status: 429, body: { error: 'daily_quota_exceeded', message: 'x', hint: 'set REDIS_URL' } };
		const { client, store, token } = setup(server);
		await assert.rejects(uploadFile({ client, file: bufferFile('q.mp4', payload(10)), store, token, sleep: instantSleep }), (e) => {
			assert.equal(e.code, 'daily_quota_exceeded');
			assert.equal(e.retryable, false);
			assert.ok(!/REDIS|hint/i.test(e.message));
			return true;
		});
	} finally {
		await server.close();
	}
});
