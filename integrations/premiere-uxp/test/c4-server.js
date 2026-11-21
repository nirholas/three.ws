'use strict';

/**
 * A local HTTP server that speaks contract C4 (capture-upload create/sign/parts/complete/abort,
 * /api/pano-capture, /api/pano-scene) plus an R2-like part endpoint that answers PUT with an ETag.
 * It mirrors the response shapes of api/_lib/capture-upload.js and api/pano-capture.js so the
 * client is exercised over real sockets, with real bodies, headers and status codes.
 */

const http = require('node:http');
const crypto = require('node:crypto');

const KEY = 'tw_test_key';

/** Deterministic, per-path bytes (3 to 4 KB) for result downloads, so tests can check what landed on disk. */
function resultBytes(key) {
	const seed = crypto.createHash('sha256').update(key).digest();
	return Buffer.concat(Array.from({ length: 100 }, () => seed)).subarray(0, 3000 + (seed[0] % 1000));
}

function startC4Server(options = {}) {
	const partSize = options.partSize || 1024;
	const uploads = new Map();
	const jobs = new Map();
	const log = [];
	const faults = { forbidOnce: new Set(), failPutOnce: new Set(), failCreate: null, failStart: null };
	let inFlight = 0;
	let peakInFlight = 0;
	let jobSeq = 0;
	let origin = '';

	const send = (res, status, body, headers = {}) => {
		const text = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
		res.writeHead(status, { 'content-type': typeof body === 'string' || Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', ...headers });
		res.end(text);
	};
	const readBody = (req) =>
		new Promise((resolve) => {
			const chunks = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => resolve(Buffer.concat(chunks)));
		});
	const readJson = async (req) => {
		const buf = await readBody(req);
		try {
			return JSON.parse(buf.toString('utf8') || '{}');
		} catch {
			return {};
		}
	};

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, origin || 'http://127.0.0.1');
		const path = url.pathname;
		log.push(`${req.method} ${path}${url.search}`);

		if (path.startsWith('/r2/')) {
			const [, , uploadId, num] = path.split('/');
			const n = Number(num);
			if (req.method === 'PUT') {
				inFlight++;
				peakInFlight = Math.max(peakInFlight, inFlight);
				const body = await readBody(req);
				await new Promise((r) => setTimeout(r, options.putDelayMs || 15));
				inFlight--;
				const tag = `${uploadId}:${n}`;
				if (faults.forbidOnce.delete(tag)) return send(res, 403, { error: 'SignatureDoesNotMatch' });
				if (faults.failPutOnce.delete(tag)) return send(res, 503, { error: 'SlowDown' });
				const up = uploads.get(uploadId);
				if (!up) return send(res, 404, { error: 'NoSuchUpload' });
				const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
				up.parts.set(n, { etag, body });
				return send(res, 200, '', { etag });
			}
			if (req.method === 'GET') {
				const key = path.slice(4);
				if (options.missingFiles && options.missingFiles.some((m) => key.endsWith(m))) return send(res, 404, { error: 'NoSuchKey' });
				const file = resultBytes(key);
				return send(res, 200, file, { 'content-length': String(file.length) });
			}
		}

		const authed = req.headers.authorization === `Bearer ${KEY}`;
		if (!authed) return send(res, 401, { error: 'sign_in_required', message: 'Sign in to continue.' });

		if (path === '/api/capture-upload/create' && req.method === 'POST') {
			if (faults.failCreate) return send(res, faults.failCreate.status, faults.failCreate.body);
			const body = await readJson(req);
			if (!body.size_bytes || !body.filename) return send(res, 400, { error: 'invalid_size', message: 'Bad size.' });
			const id = `up_${crypto.randomUUID().slice(0, 8)}`;
			const part_count = Math.max(1, Math.ceil(body.size_bytes / partSize));
			uploads.set(id, { id, key: `captures/${id}/${body.filename}`, size: body.size_bytes, parts: new Map(), body });
			return send(res, 200, { upload_id: id, key: uploads.get(id).key, part_size: partSize, part_count });
		}
		if (path === '/api/capture-upload/sign' && req.method === 'POST') {
			const body = await readJson(req);
			const up = uploads.get(body.upload_id);
			if (!up) return send(res, 404, { error: 'upload_not_found', message: 'That upload no longer exists.' });
			const urls = {};
			for (const n of body.part_numbers) urls[String(n)] = `${origin}/r2/${up.id}/${n}`;
			return send(res, 200, { urls });
		}
		if (path === '/api/capture-upload/parts' && req.method === 'POST') {
			const body = await readJson(req);
			const up = uploads.get(body.upload_id);
			if (!up) return send(res, 404, { error: 'upload_not_found', message: 'That upload no longer exists.' });
			const parts = [...up.parts.entries()].map(([part_number, p]) => ({ part_number, etag: p.etag, size: p.body.length }));
			return send(res, 200, { parts });
		}
		if (path === '/api/capture-upload/complete' && req.method === 'POST') {
			const body = await readJson(req);
			const up = uploads.get(body.upload_id);
			if (!up) return send(res, 404, { error: 'upload_not_found', message: 'That upload no longer exists.' });
			const nums = (body.parts || []).map((p) => p.part_number).sort((a, b) => a - b);
			const expected = Math.ceil(up.size / partSize);
			if (nums.length !== expected) return send(res, 400, { error: 'invalid_parts', message: 'Some parts are missing.' });
			const assembled = Buffer.concat(nums.map((n) => up.parts.get(n).body));
			if (assembled.length !== up.size) return send(res, 400, { error: 'size_mismatch', message: 'Size mismatch.' });
			up.assembled = assembled;
			up.completed = true;
			return send(res, 200, { source_url: `${origin}/r2-source/${up.id}`, size_bytes: assembled.length });
		}
		if (path === '/api/capture-upload/abort' && req.method === 'POST') {
			const body = await readJson(req);
			const up = uploads.get(body.upload_id);
			if (up) up.aborted = true;
			uploads.delete(body.upload_id);
			return send(res, 200, { ok: true });
		}

		if (path === '/api/pano-capture' || path === '/api/pano-scene') {
			const lane = path === '/api/pano-scene' ? 'scene' : 'capture';
			if (req.method === 'POST') {
				if (faults.failStart) return send(res, faults.failStart.status, faults.failStart.body);
				const body = await readJson(req);
				const id = `job_${++jobSeq}`;
				jobs.set(id, { id, lane, body, polls: 0, status: 'queued', cancelled: false });
				return send(res, 202, { job_id: id, status: 'queued', eta_seconds: 90 });
			}
			if (req.method === 'GET' && url.searchParams.get('mine') === '1') {
				const captures = [...jobs.values()]
					.filter((j) => j.lane === 'capture')
					.map((j) => ({
						job_id: j.id,
						status: j.status,
						stage: null,
						progress: j.status === 'succeeded' ? 1 : 0,
						created_at: new Date().toISOString(),
						poster_url: j.status === 'succeeded' ? `${origin}/r2/files/${j.id}/poster.jpg` : null,
						viewer_url: j.status === 'succeeded' ? `/splat?job=${j.id}` : null,
						source_kind: j.body.source_kind,
						error: null,
					}));
				return send(res, 200, { captures });
			}
			if (req.method === 'GET') {
				const job = jobs.get(url.searchParams.get('job'));
				if (!job) return send(res, 404, { error: 'not_found', message: 'Job not found.' });
				job.polls++;
				if (job.cancelled) return send(res, 200, { job_id: job.id, status: 'cancelled', progress: 0 });
				if (options.failJob) return send(res, 200, { job_id: job.id, status: 'failed', progress: 0.4, error: options.failJob });
				const stages = lane === 'scene' ? ['stitch', 'depth', 'mesh', 'upload'] : ['download', 'stitch', 'frames', 'sfm', 'train', 'export', 'upload'];
				const step = job.polls - 1;
				if (step < stages.length) {
					job.status = 'running';
					return send(res, 200, { job_id: job.id, status: 'running', stage: stages[step], progress: (step + 1) / (stages.length + 1) });
				}
				job.status = 'succeeded';
				const base = `${origin}/r2/files/${job.id}`;
				const result =
					lane === 'scene'
						? { glb_url: `${base}/scene.glb`, ply_url: `${base}/scene.ply`, viewer_url: `/pano-scene?job=${job.id}` }
						: { ply_url: `${base}/scene.ply`, spz_url: `${base}/scene.spz`, preview_url: `${base}/preview.mp4`, poster_url: `${base}/poster.jpg`, viewer_url: `/splat?job=${job.id}` };
				return send(res, 200, { job_id: job.id, status: 'succeeded', stage: 'upload', progress: 1, result });
			}
			if (req.method === 'DELETE') {
				const job = jobs.get(url.searchParams.get('job'));
				if (job) job.cancelled = true;
				return send(res, 200, { ok: true });
			}
		}
		return send(res, 404, { error: 'not_found', message: 'No such route.' });
	});

	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			origin = `http://127.0.0.1:${server.address().port}`;
			resolve({
				origin,
				uploads,
				jobs,
				log,
				faults,
				get peakInFlight() {
					return peakInFlight;
				},
				close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))),
			});
		});
	});
}

/** An in-memory resume store with the same shape as host/storage.createResumeStore(). */
function memoryStore() {
	const map = new Map();
	return {
		map,
		async load(key) {
			const v = map.get(key);
			return v ? JSON.parse(JSON.stringify(v)) : null;
		},
		async save(key, state) {
			map.set(key, JSON.parse(JSON.stringify(state)));
		},
		async remove(key) {
			map.delete(key);
		},
	};
}

/** A file object over a Buffer. */
function bufferFile(name, buffer, contentType = 'video/mp4', mtimeMs = 1700000000000) {
	return {
		name,
		size: buffer.length,
		mtimeMs,
		contentType,
		async readRange(start, end) {
			const slice = buffer.subarray(start, end);
			return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
		},
	};
}

const instantSleep = async () => {};

module.exports = { resultBytes, startC4Server, memoryStore, bufferFile, instantSleep, KEY };
