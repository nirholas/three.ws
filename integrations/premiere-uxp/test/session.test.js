'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('../src/core/client');
const { runSend, deliver, inspectInput } = require('../src/core/session');
const { streamToFile } = require('../src/core/stream');
const { CancelToken } = require('../src/core/retry');
const { resultFolder } = require('../src/core/results');
const { startC4Server, memoryStore, bufferFile, instantSleep, resultBytes, KEY } = require('./c4-server');

const nodeSink = {
	open: (p) => fsp.open(p, 'w'),
	write: (h, chunk) => h.write(chunk),
	close: (h) => h.close(),
	remove: (p) => fsp.rm(p, { force: true }),
};

const box = (type, payload) => {
	const b = Buffer.alloc(8 + payload.length);
	b.writeUInt32BE(b.length, 0);
	b.write(type, 4, 'ascii');
	payload.copy(b, 8);
	return b;
};
function mp4(width, height, seconds) {
	const mvhd = Buffer.alloc(100);
	mvhd.writeUInt32BE(1000, 12);
	mvhd.writeUInt32BE(seconds * 1000, 16);
	const tkhd = Buffer.alloc(84);
	tkhd.writeUInt32BE(width * 65536, 76);
	tkhd.writeUInt32BE(height * 65536, 80);
	const payload = Buffer.concat([box('mdat', crypto.randomBytes(5000)), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('tkhd', tkhd))]))]);
	return Buffer.concat([box('ftyp', Buffer.from('isom0000isomiso2')), payload]);
}

function makeHost(server, files, tmp, { projectPath } = {}) {
	const imported = [];
	return {
		imported,
		openFile: async (p, contentType) => {
			const buf = files[p];
			if (!buf) throw new Error('missing');
			return bufferFile(path.basename(p), buf, contentType);
		},
		expandSplitPair: async (p) => [p],
		resumeStore: memoryStore(),
		fetchStream: (url) => fetch(url),
		async resultTarget(jobId, fileName) {
			const folder = resultFolder(projectPath, jobId);
			const dir = path.join(tmp, folder.levels.join(path.sep));
			await fsp.mkdir(dir, { recursive: true });
			return { path: path.join(dir, fileName), sink: nodeSink };
		},
		importFiles: async (paths) => imported.push(...paths),
		folderFor: (jobId) => ({ path: path.join(tmp, ...resultFolder(projectPath, jobId).levels), nextToProject: true }),
	};
}

async function withEnv(options, fn) {
	const server = await startC4Server(options);
	const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'uxp-session-'));
	try {
		const client = createClient({ origin: server.origin, getKey: async () => KEY, sleep: instantSleep });
		await fn({ server, tmp, client });
	} finally {
		await server.close();
		await fsp.rm(tmp, { recursive: true, force: true });
	}
}

test('inspectInput: a 2:1 clip with Premiere in/out points yields a lane, 360 proof and a trim', async () => {
	await withEnv({}, async ({ server, tmp }) => {
		const files = { '/m/a.mp4': mp4(5760, 2880, 60) };
		const host = makeHost(server, files, tmp);
		const info = await inspectInput({ host, path: '/m/a.mp4', clip: { path: '/m/a.mp4', inSeconds: 4, outSeconds: 20, durationSeconds: 60 } });
		assert.equal(info.lane, 'capture');
		assert.equal(info.is360, true);
		assert.deepEqual(info.trim, { start_s: 4, end_s: 20 });
		assert.equal(info.width, 5760);
		const flat = await inspectInput({ host: makeHost(server, { '/m/b.mp4': mp4(1920, 1080, 5) }, tmp), path: '/m/b.mp4' });
		assert.equal(flat.is360, false);
		assert.equal(flat.trim, null);
	});
});

test('end to end: upload, create job, poll, download all four files, import, and report the viewer link', async () => {
	await withEnv({ partSize: 2048 }, async ({ server, tmp, client }) => {
		const video = mp4(5760, 2880, 30);
		const host = makeHost(server, { '/m/a.mp4': video }, tmp, { projectPath: path.join(tmp, 'Trip.prproj') });
		const events = [];
		const outcome = await runSend({
			client,
			host,
			token: new CancelToken(),
			sleep: instantSleep,
			uploadFetch: fetch,
			onEvent: (e) => events.push(e),
			input: { path: '/m/a.mp4', clip: { path: '/m/a.mp4', inSeconds: 2, outSeconds: 10, durationSeconds: 30 }, useTrim: true, quality: 'high', confirm360: false },
		});

		const job = [...server.jobs.values()][0];
		assert.equal(job.body.source_kind, 'equirect_video');
		assert.equal(job.body.quality, 'high');
		assert.deepEqual(job.body.trim, { start_s: 2, end_s: 10 });
		assert.ok([...server.uploads.values()][0].assembled.equals(video), 'server received the exact file');
		assert.ok(job.body.source_url.startsWith(`${server.origin}/r2-source/`));

		assert.deepEqual(outcome.paths.map((p) => path.basename(p)), ['preview.mp4', 'poster.jpg', 'scene.ply', 'scene.spz']);
		for (const p of outcome.paths) {
			const key = `files/${outcome.jobId}/${path.basename(p)}`;
			assert.ok(fs.readFileSync(p).equals(resultBytes(key)), `${path.basename(p)} bytes match`);
			assert.ok(p.includes('Trip_three.ws'));
		}
		assert.deepEqual(host.imported, outcome.paths);
		assert.equal(outcome.imported, 4);
		assert.equal(outcome.viewerUrl, `${server.origin}/splat?job=${outcome.jobId}`);
		assert.match(outcome.previewPath, /preview\.mp4$/);
		assert.deepEqual(outcome.missing, []);

		const phases = events.map((e) => e.phase);
		for (const p of ['inspect', 'upload', 'process', 'download', 'import', 'done']) assert.ok(phases.includes(p), p);
		assert.equal(phases.at(-1), 'done');
		const up = events.filter((e) => e.phase === 'upload').map((e) => e.progress);
		assert.equal(up.at(-1), 1);
	});
});

test('a single 360 photo goes to the pano-scene lane and returns a GLB', async () => {
	await withEnv({ partSize: 1024 }, async ({ server, tmp, client }) => {
		const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0x0b, 0xb8, 0x17, 0x70, 3, 0, 0, 0]), crypto.randomBytes(2500)]);
		const host = makeHost(server, { '/m/p.jpg': jpeg }, tmp, { projectPath: path.join(tmp, 'Trip.prproj') });
		const outcome = await runSend({ client, host, token: new CancelToken(), sleep: instantSleep, uploadFetch: fetch, input: { path: '/m/p.jpg' } });
		const job = [...server.jobs.values()][0];
		assert.equal(job.lane, 'scene');
		assert.equal(job.body.source_kind, 'equirect_image');
		assert.ok(job.body.image_url);
		assert.deepEqual(outcome.paths.map((p) => path.basename(p)), ['scene.glb', 'scene.ply']);
		assert.ok(outcome.viewerUrl.endsWith(`/pano-scene?job=${outcome.jobId}`));
	});
});

test('a clip that is not 2:1 is refused until the user confirms', async () => {
	await withEnv({}, async ({ server, tmp, client }) => {
		const host = makeHost(server, { '/m/f.mp4': mp4(1920, 1080, 5) }, tmp, { projectPath: path.join(tmp, 'T.prproj') });
		const run = (confirm360) => runSend({ client, host, token: new CancelToken(), sleep: instantSleep, uploadFetch: fetch, input: { path: '/m/f.mp4', confirm360 } });
		await assert.rejects(run(false), (e) => e.code === 'not_360');
		assert.equal(server.uploads.size, 0, 'nothing was uploaded');
		await run(true);
		assert.equal(server.jobs.size, 1);
	});
});

test('a failed job reports the visitor message and nothing is imported', async () => {
	await withEnv({ failJob: { code: 'reconstruction_quality', message: 'raw', hint: 'GPU' } }, async ({ server, tmp, client }) => {
		const host = makeHost(server, { '/m/a.mp4': mp4(4096, 2048, 5) }, tmp, { projectPath: path.join(tmp, 'T.prproj') });
		await assert.rejects(
			runSend({ client, host, token: new CancelToken(), sleep: instantSleep, uploadFetch: fetch, input: { path: '/m/a.mp4' } }),
			(e) => e.code === 'reconstruction_quality' && !/GPU/.test(e.message),
		);
		assert.equal(host.imported.length, 0);
	});
});

test('cancel mid-run cancels the server job and aborts nothing left behind', async () => {
	await withEnv({ partSize: 4096 }, async ({ server, tmp, client }) => {
		const host = makeHost(server, { '/m/a.mp4': mp4(4096, 2048, 5) }, tmp, { projectPath: path.join(tmp, 'T.prproj') });
		const token = new CancelToken();
		await assert.rejects(
			runSend({ client, host, token, sleep: instantSleep, uploadFetch: fetch, input: { path: '/m/a.mp4' }, onEvent: (e) => e.phase === 'process' && e.stage === 'frames' && token.cancel() }),
			(e) => e.code === 'cancelled',
		);
		await new Promise((r) => setTimeout(r, 50));
		assert.equal([...server.jobs.values()][0].cancelled, true);
		assert.equal(host.imported.length, 0);
	});
});

test('Your captures: deliver re-downloads a finished job into its folder', async () => {
	await withEnv({}, async ({ server, tmp, client }) => {
		const { job_id } = await client.startCapture({ source_url: 'u', source_kind: 'insv' });
		let detail;
		for (let i = 0; i < 12; i++) detail = await client.getCapture(job_id);
		assert.equal(detail.status, 'succeeded');
		const list = await client.listCaptures();
		assert.equal(list.captures[0].job_id, job_id);
		assert.ok(list.captures[0].poster_url);
		const host = makeHost(server, {}, tmp, { projectPath: path.join(tmp, 'T.prproj') });
		const outcome = await deliver({ client, host, lane: 'capture', jobId: job_id, result: detail.result, token: new CancelToken(), sleep: instantSleep });
		assert.equal(outcome.paths.length, 4);
		assert.equal(host.imported.length, 4);
	});
});

test('a result file the storage cannot serve is retried, then reported as a download failure, with no partial file left', async () => {
	await withEnv({ missingFiles: ['scene.spz'] }, async ({ server, tmp, client }) => {
		const { job_id } = await client.startCapture({ source_url: 'u', source_kind: 'insv' });
		let detail;
		for (let i = 0; i < 12; i++) detail = await client.getCapture(job_id);
		const host = makeHost(server, {}, tmp, { projectPath: path.join(tmp, 'T.prproj') });
		await assert.rejects(
			deliver({ client, host, lane: 'capture', jobId: job_id, result: detail.result, token: new CancelToken(), sleep: instantSleep }),
			(e) => e.code === 'download_failed',
		);
		const dir = path.join(tmp, ...resultFolder(path.join(tmp, 'T.prproj'), job_id).levels);
		assert.ok(!fs.existsSync(path.join(dir, 'scene.spz')));
		assert.equal(host.imported.length, 0);
	});
});

test('streamToFile writes chunks, checks the length and removes a truncated file', async () => {
	const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'uxp-stream-'));
	try {
		const data = crypto.randomBytes(100000);
		const mk = (len) => new Response(new ReadableStream({ start(c) { for (let i = 0; i < data.length; i += 16384) c.enqueue(data.subarray(i, i + 16384)); c.close(); } }), { headers: { 'content-length': String(len) } });
		const out = path.join(tmp, 'ok.bin');
		const seen = [];
		const r = await streamToFile({ response: mk(data.length), sink: nodeSink, path: out, token: new CancelToken(), onBytes: (b) => seen.push(b) });
		assert.equal(r.bytes, data.length);
		assert.ok(fs.readFileSync(out).equals(data));
		assert.ok(seen.length > 3 && seen.at(-1) === data.length);

		const bad = path.join(tmp, 'bad.bin');
		await assert.rejects(streamToFile({ response: mk(data.length + 10), sink: nodeSink, path: bad, token: new CancelToken() }), (e) => e.code === 'download_failed');
		assert.ok(!fs.existsSync(bad));

		const token = new CancelToken();
		const gone = path.join(tmp, 'gone.bin');
		await assert.rejects(streamToFile({ response: mk(data.length), sink: nodeSink, path: gone, token, onBytes: () => token.cancel() }), (e) => e.code === 'cancelled');
		assert.ok(!fs.existsSync(gone));
	} finally {
		await fsp.rm(tmp, { recursive: true, force: true });
	}
});
