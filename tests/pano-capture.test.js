// /api/pano-capture end to end on the real schema (api/_lib/schema.sql plus
// every migration, on PGlite). The worker side is a local HTTP server that
// speaks contract C1 (POST /infer, GET and DELETE /tasks/{id}) and serves the
// finished files, so every request the endpoint makes is a real HTTP request
// to GCP_PANO2SPLAT_URL. Only the bucket is in memory: an S3 command sink that
// stores what the real multipart uploader (api/_lib/r2-stream.js) sends it.

import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';

const holder = vi.hoisted(() => ({ db: null, user: null }));

// The bucket: objects by key, plus counters the idempotency tests read.
const bucket = vi.hoisted(() => {
	const state = { objects: new Map(), uploads: new Map(), writes: 0, deletes: 0, nextUpload: 1 };
	async function send(cmd) {
		const name = cmd.constructor.name;
		const i = cmd.input;
		if (name === 'PutObjectCommand') {
			state.writes++;
			state.objects.set(i.Key, { body: Buffer.from(i.Body), type: i.ContentType });
			return { ETag: '"put"' };
		}
		if (name === 'CreateMultipartUploadCommand') {
			const UploadId = `up-${state.nextUpload++}`;
			state.uploads.set(UploadId, { key: i.Key, type: i.ContentType, parts: new Map() });
			return { UploadId };
		}
		if (name === 'UploadPartCommand') {
			state.uploads.get(i.UploadId).parts.set(i.PartNumber, Buffer.from(i.Body));
			return { ETag: `"part-${i.PartNumber}"` };
		}
		if (name === 'CompleteMultipartUploadCommand') {
			const up = state.uploads.get(i.UploadId);
			const order = i.MultipartUpload.Parts.map((p) => p.PartNumber);
			state.writes++;
			state.objects.set(up.key, { body: Buffer.concat(order.map((n) => up.parts.get(n))), type: up.type });
			state.uploads.delete(i.UploadId);
			return {};
		}
		if (name === 'AbortMultipartUploadCommand') {
			state.uploads.delete(i.UploadId);
			return {};
		}
		throw new Error(`unexpected S3 command ${name}`);
	}
	return { state, send };
});

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/auth.js', () => ({
	getRequestUser: vi.fn(async () => holder.user),
	hasScope: (granted, required) => String(granted || '').split(/\s+/).includes(required),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		mcp3dGenerate: vi.fn(async () => ({ success: true })),
		mcp3dStatus: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/r2.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		r2: { send: bucket.send },
		deleteObject: vi.fn(async (key) => {
			bucket.state.deletes++;
			bucket.state.objects.delete(key);
		}),
		listObjectsPage: vi.fn(async ({ prefix }) => ({
			objects: [...bucket.state.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: 0 })),
			nextToken: null,
		})),
	};
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.S3_ENDPOINT = 'https://bucket.test';
process.env.S3_ACCESS_KEY_ID = 'test-access';
process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_PUBLIC_DOMAIN = 'https://pub.bucket.test';
process.env.CRON_SECRET = 'cron-test-secret';
const WORKER_KEY = 'worker-test-key';

// ── A worker that speaks contract C1 ────────────────────────────────────────
const worker = {
	server: null,
	base: '',
	tasks: new Map(),
	calls: [],
	files: new Map(),
	nextTask: 1,
	// The answer to the next POST /infer, when a test wants a refusal.
	inferReply: null,
};
const PLY = Buffer.concat([Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex 4096\nend_header\n'), randomBytes(4096 * 62)]);
const SPZ = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), randomBytes(50_000)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), randomBytes(20_000)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(8_000)]);
const sha = (b) => createHash('sha256').update(b).digest('hex');

function startWorker() {
	worker.server = createServer(async (req, res) => {
		const send = (status, body) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const url = new URL(req.url, 'http://x');
		if (url.pathname.startsWith('/files/')) {
			const name = url.pathname.slice('/files/'.length);
			const file = worker.files.get(name);
			worker.calls.push({ method: 'FILE', path: name });
			if (!file) return send(403, { error: 'SignatureDoesNotMatch' });
			res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': file.length });
			return res.end(file);
		}
		if (req.headers.authorization !== `Bearer ${WORKER_KEY}`) return send(401, { error: { code: 'unauthorized', message: 'bad bearer' } });
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
		worker.calls.push({ method: req.method, path: url.pathname, body });
		if (req.method === 'POST' && url.pathname === '/infer') {
			if (worker.inferReply) {
				const { status, body: reply } = worker.inferReply;
				worker.inferReply = null;
				return send(status, reply);
			}
			const id = `task-${worker.nextTask++}`;
			worker.tasks.set(id, { status: 'queued', stage: 'probe', progress: 0, request: body });
			return send(202, { task_id: id });
		}
		const m = url.pathname.match(/^\/tasks\/([^/]+)$/);
		if (m) {
			const task = worker.tasks.get(decodeURIComponent(m[1]));
			if (!task) return send(404, { detail: 'Not Found' });
			if (req.method === 'DELETE') {
				task.status = 'cancelled';
				return send(200, { task_id: m[1], status: 'cancelled' });
			}
			const { request, ...state } = task;
			return send(200, { task_id: m[1], ...state });
		}
		return send(404, { detail: 'Not Found' });
	});
	return new Promise((resolve) => {
		worker.server.listen(0, '127.0.0.1', () => {
			worker.base = `http://127.0.0.1:${worker.server.address().port}`;
			resolve();
		});
	});
}

/** Make the worker report `taskId` finished with the four files it serves. */
function succeed(taskId, { withPreview = true } = {}) {
	const t = Date.now().toString(36);
	worker.files.set(`${t}-scene.ply`, PLY);
	worker.files.set(`${t}-scene.spz`, SPZ);
	if (withPreview) {
		worker.files.set(`${t}-preview.mp4`, MP4);
		worker.files.set(`${t}-poster.jpg`, JPG);
	}
	Object.assign(worker.tasks.get(taskId), {
		status: 'succeeded',
		stage: 'done',
		progress: 1,
		result: {
			ply_url: `${worker.base}/files/${t}-scene.ply`,
			spz_url: `${worker.base}/files/${t}-scene.spz`,
			preview_url: withPreview ? `${worker.base}/files/${t}-preview.mp4` : null,
			poster_url: withPreview ? `${worker.base}/files/${t}-poster.jpg` : null,
			equirect_url: null,
			stats: { gaussians: 4096, frames: 180, iterations: 7000, psnr: 27.4, seconds: 912 },
		},
	});
}

const workerCalls = (method, pathPrefix) =>
	worker.calls.filter((c) => c.method === method && c.path.startsWith(pathPrefix)).length;

// ── Harness ─────────────────────────────────────────────────────────────────
let handler;
let cron;
let lib;
let OWNER;
let STRANGER;

beforeAll(async () => {
	await startWorker();
	const { pg } = await createFullSchemaDb();
	holder.db = createPgliteSql({ pg });
	lib = await import('../api/_lib/pano-capture.js');
	({ default: handler } = await import('../api/pano-capture.js'));
	({ default: cron } = await import('../api/cron/pano-captures.js'));
	const [a] = await holder.db.sql`INSERT INTO users (email, display_name) VALUES ('pano-owner@example.invalid', 'Pano owner') RETURNING id`;
	const [b] = await holder.db.sql`INSERT INTO users (email, display_name) VALUES ('pano-stranger@example.invalid', 'Stranger') RETURNING id`;
	OWNER = a.id;
	STRANGER = b.id;
}, 120_000);

afterAll(() => new Promise((resolve) => worker.server.close(resolve)));

beforeEach(async () => {
	process.env.GCP_PANO2SPLAT_URL = worker.base;
	process.env.GCP_RECONSTRUCTION_KEY = WORKER_KEY;
	process.env.S3_ENDPOINT = 'https://bucket.test';
	holder.user = { id: OWNER, source: 'session' };
	worker.tasks.clear();
	worker.files.clear();
	worker.calls.length = 0;
	worker.inferReply = null;
	worker.nextTask = 1;
	bucket.state.objects.clear();
	bucket.state.writes = 0;
	bucket.state.deletes = 0;
	await holder.db.sql`DELETE FROM pano_captures`;
});

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

async function call(fn, method, { path = '/api/pano-capture', query = {}, body, headers = {} } = {}) {
	const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
	const req = Readable.from(payload ? [payload] : []);
	req.method = method;
	const qs = new URLSearchParams(query).toString();
	req.url = qs ? `${path}?${qs}` : path;
	req.headers = { origin: 'http://localhost:3339', ...(payload ? { 'content-type': 'application/json' } : {}), ...headers };
	const res = mockRes();
	await fn(req, res);
	return { status: res.statusCode, body: res.json, headers: res._headers };
}
const api = (method, opts) => call(handler, method, opts);
const start = (body) => api('POST', { body });
const poll = (job) => api('GET', { query: { job } });
const VIDEO = { source_kind: 'equirect_video', source_url: 'https://1.1.1.1/footage/walkthrough.mp4' };

// Pretend the last worker poll was `seconds` ago.
const backdatePoll = (id, seconds = 10) =>
	holder.db.sql`UPDATE pano_captures SET polled_at = now() - make_interval(secs => ${seconds}) WHERE id = ${id}`;
const row = async (id) => (await holder.db.sql`SELECT * FROM pano_captures WHERE id = ${id}`)[0];

// ── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/pano-capture: create', () => {
	it('stores a job, hands it to the worker and answers 202 with an eta', async () => {
		const r = await start({ ...VIDEO, trim: { start_s: 2, end_s: 40 }, quality: 'high' });
		expect(r.status).toBe(202);
		expect(r.body).toEqual({ job_id: expect.any(String), status: 'queued', eta_seconds: 2700 });

		const infer = worker.calls.find((c) => c.path === '/infer');
		expect(infer.body).toEqual({
			task: 'splat',
			source_url: VIDEO.source_url,
			source_kind: 'equirect_video',
			trim: { start_s: 2, end_s: 40 },
			quality: 'high',
			job_id: r.body.job_id,
		});
		const stored = await row(r.body.job_id);
		expect(stored).toMatchObject({ user_id: OWNER, status: 'queued', worker_task_id: 'task-1', quality: 'high' });
		expect(stored.trim).toEqual({ start_s: 2, end_s: 40 });
	});

	it('accepts a photo set and a split-pair .insv recording', async () => {
		const photos = ['a', 'b', 'c', 'd'].map((n) => `https://1.1.1.1/set/${n}.jpg`);
		const r1 = await start({ source_kind: 'equirect_images', source_urls: photos });
		expect(r1.status).toBe(202);
		expect(worker.calls.at(-1).body).toMatchObject({ source_url: photos[0], source_urls: photos, quality: 'standard' });

		const pair = ['https://8.8.8.8/raw/VID_00_000.insv', 'https://8.8.8.8/raw/VID_10_000.insv'];
		const r2 = await start({ source_kind: 'insv', source_url: pair[0], source_urls: pair, quality: 'preview' });
		expect(r2.status).toBe(202);
		expect(r2.body.eta_seconds).toBe(900);
	});

	it.each([
		[{ source_url: VIDEO.source_url }, 'invalid_source_kind'],
		[{ source_kind: 'equirect_video' }, 'missing_source_url'],
		[{ source_kind: 'equirect_video', source_url: 'http://1.1.1.1/a.mp4' }, 'invalid_source_url'],
		[{ source_kind: 'equirect_video', source_url: 'https://10.0.0.5/a.mp4' }, 'invalid_source_url'],
		[{ source_kind: 'equirect_video', source_url: 'https://169.254.169.254/latest/meta-data' }, 'invalid_source_url'],
		[{ source_kind: 'equirect_video', source_url: 'https://127.0.0.1/a.mp4' }, 'invalid_source_url'],
		[{ source_kind: 'equirect_images', source_urls: ['https://1.1.1.1/a.jpg', 'https://1.1.1.1/b.jpg'] }, 'too_few_images'],
		[{ source_kind: 'equirect_images', source_urls: ['https://1.1.1.1/a.jpg', 'https://1.1.1.1/b.jpg', 'https://10.1.1.1/c.jpg'] }, 'invalid_source_url'],
		[{ source_kind: 'equirect_images', source_urls: 'https://1.1.1.1/a.jpg' }, 'invalid_source_urls'],
		[{ source_kind: 'insp', source_urls: ['https://1.1.1.1/a.insp', 'https://1.1.1.1/b.insp'] }, 'too_many_files'],
		[{ source_kind: 'insv', source_urls: ['https://1.1.1.1/a.insv', 'https://1.1.1.1/b.insv', 'https://1.1.1.1/c.insv'] }, 'too_many_files'],
		[{ ...VIDEO, quality: 'ultra' }, 'invalid_quality'],
		[{ ...VIDEO, trim: { start_s: 10, end_s: 4 } }, 'invalid_trim'],
		[{ ...VIDEO, trim: { start_s: -1 } }, 'invalid_trim'],
		[{ source_kind: 'insp', source_url: 'https://1.1.1.1/a.insp', trim: { start_s: 1 } }, 'invalid_trim'],
	])('refuses %j with %s and never calls the worker', async (body, code) => {
		const r = await start(body);
		expect(r.status).toBe(400);
		expect(r.body.error).toBe(code);
		expect(r.body.message).toEqual(expect.any(String));
		expect(workerCalls('POST', '/infer')).toBe(0);
		expect(await holder.db.sql`SELECT id FROM pano_captures`).toHaveLength(0);
	});

	it('refuses a body that is not JSON', async () => {
		const r = await start('not json');
		expect(r.status).toBe(400);
		expect(r.body.error).toBe('invalid_body');
	});

	it('asks an anonymous caller to sign in', async () => {
		holder.user = null;
		const r = await start(VIDEO);
		expect(r.status).toBe(401);
		expect(r.body.error).toBe('sign_in_required');
		expect((await poll('00000000-0000-4000-8000-000000000000')).status).toBe(401);
	});
});

describe('unconfigured deployment', () => {
	it('answers 503 unconfigured when GCP_PANO2SPLAT_URL is unset', async () => {
		delete process.env.GCP_PANO2SPLAT_URL;
		const r = await start(VIDEO);
		expect(r.status).toBe(503);
		expect(r.body.error).toBe('unconfigured');
		expect(r.body.message).toMatch(/360 capture is offline/);
		expect(r.body.hint).toMatch(/GCP_PANO2SPLAT_URL/);
		expect(worker.calls).toHaveLength(0);
		expect(await holder.db.sql`SELECT id FROM pano_captures`).toHaveLength(0);
	});

	it('answers 503 unconfigured when there is no bucket to save results in', async () => {
		delete process.env.S3_ENDPOINT;
		const r = await start(VIDEO);
		expect(r.status).toBe(503);
		expect(r.body.error).toBe('unconfigured');
		expect(worker.calls).toHaveLength(0);
	});

	it('still validates input first, so a bad request is a 400 everywhere', async () => {
		delete process.env.GCP_PANO2SPLAT_URL;
		expect((await start({ source_kind: 'nope' })).status).toBe(400);
	});
});

describe('per-account active limit', () => {
	it('allows two active jobs, refuses a third, and frees a slot on cancel', async () => {
		const a = await start(VIDEO);
		const b = await start(VIDEO);
		expect([a.status, b.status]).toEqual([202, 202]);

		const c = await start(VIDEO);
		expect(c.status).toBe(429);
		expect(c.body.error).toBe('too_many_active');
		expect(workerCalls('POST', '/infer')).toBe(2);

		// Another account is not affected by this one's cap.
		holder.user = { id: STRANGER, source: 'session' };
		expect((await start(VIDEO)).status).toBe(202);
		holder.user = { id: OWNER, source: 'session' };

		const del = await api('DELETE', { query: { job: a.body.job_id } });
		expect(del.status).toBe(200);
		expect(del.body).toEqual({ job_id: a.body.job_id, status: 'cancelled' });
		expect(workerCalls('DELETE', '/tasks/')).toBe(1);
		expect(worker.tasks.get('task-1').status).toBe('cancelled');

		expect((await start(VIDEO)).status).toBe(202);
	});

	it('frees a slot when a job fails on the worker', async () => {
		const a = await start(VIDEO);
		await start(VIDEO);
		Object.assign(worker.tasks.get('task-1'), { status: 'failed', error: { code: 'decode_failed', message: 'x' } });
		await backdatePoll(a.body.job_id);
		expect((await poll(a.body.job_id)).body.status).toBe('failed');
		expect((await start(VIDEO)).status).toBe(202);
	});

	it('holds under concurrent creates: never more than two active', async () => {
		const out = await Promise.all([start(VIDEO), start(VIDEO), start(VIDEO), start(VIDEO)]);
		expect(out.map((r) => r.status).sort()).toEqual([202, 202, 429, 429]);
		const active = await holder.db.sql`SELECT active_slot FROM pano_captures WHERE status IN ('queued', 'running') ORDER BY active_slot`;
		expect(active.map((r) => r.active_slot)).toEqual([1, 2]);
	});
});

describe('ownership', () => {
	it('hides another account\'s job from GET and DELETE', async () => {
		const mine = await start(VIDEO);
		holder.user = { id: STRANGER, source: 'session' };
		const g = await poll(mine.body.job_id);
		expect(g.status).toBe(404);
		expect(g.body.error).toBe('not_found');
		const d = await api('DELETE', { query: { job: mine.body.job_id } });
		expect(d.status).toBe(404);
		expect(workerCalls('DELETE', '/tasks/')).toBe(0);
		expect((await row(mine.body.job_id)).status).toBe('queued');
		expect((await api('GET', { query: { mine: '1' } })).body.captures).toEqual([]);
	});

	it('lists only the caller\'s captures, newest first', async () => {
		const first = await start(VIDEO);
		const second = await start({ source_kind: 'insp', source_url: 'https://1.1.1.1/IMG_001.insp' });
		holder.user = { id: STRANGER, source: 'session' };
		await start(VIDEO);
		holder.user = { id: OWNER, source: 'session' };

		const r = await api('GET', { query: { mine: '1' } });
		expect(r.status).toBe(200);
		expect(r.headers['cache-control']).toBe('no-store');
		expect(r.body.captures.map((c) => c.job_id)).toEqual([second.body.job_id, first.body.job_id]);
		expect(r.body.captures[0]).toMatchObject({
			status: 'queued',
			source_kind: 'insp',
			poster_url: null,
			viewer_url: null,
			created_at: expect.any(String),
		});
	});

	it('rejects a malformed or missing job id', async () => {
		expect((await poll('not-a-uuid')).body.error).toBe('invalid_job');
		expect((await api('GET')).body.error).toBe('missing_job');
	});
});

describe('poll throttle', () => {
	it('reads the worker at most once per 5 seconds per job', async () => {
		const { body } = await start(VIDEO);
		// Submitting counts as a poll.
		await poll(body.job_id);
		expect(workerCalls('GET', '/tasks/')).toBe(0);

		Object.assign(worker.tasks.get('task-1'), { status: 'running', stage: 'train', progress: 0.42 });
		await backdatePoll(body.job_id, 6);
		const burst = await Promise.all([poll(body.job_id), poll(body.job_id), poll(body.job_id)]);
		expect(workerCalls('GET', '/tasks/')).toBe(1);
		for (const r of burst) expect(r.status).toBe(200);
		const after = await poll(body.job_id);
		expect(after.body).toMatchObject({ status: 'running', stage: 'train', progress: expect.closeTo(0.42, 5) });
		expect(workerCalls('GET', '/tasks/')).toBe(1);

		await backdatePoll(body.job_id, 6);
		await poll(body.job_id);
		expect(workerCalls('GET', '/tasks/')).toBe(2);
	});
});

describe('worker errors pass through unchanged', () => {
	it('a refused submit keeps the worker\'s code and message and is stored failed', async () => {
		worker.inferReply = {
			status: 422,
			body: { error: { code: 'unsupported_projection', message: 'This video is not equirectangular (aspect 16:9). Export it as a 2:1 360 video.' } },
		};
		const r = await start(VIDEO);
		expect(r.status).toBe(422);
		expect(r.body).toEqual({
			error: 'unsupported_projection',
			message: 'This video is not equirectangular (aspect 16:9). Export it as a 2:1 360 video.',
			job_id: expect.any(String),
		});
		const stored = await row(r.body.job_id);
		expect(stored.status).toBe('failed');
		expect(stored.error).toEqual({ code: 'unsupported_projection', message: 'This video is not equirectangular (aspect 16:9). Export it as a 2:1 360 video.' });
		// A refused job does not hold an active slot.
		expect((await start(VIDEO)).status).toBe(202);
	});

	it('a worker outage on submit is a 502 with the worker\'s own words', async () => {
		worker.inferReply = { status: 503, body: { error: 'gpu_busy', message: 'All GPUs are busy. Retry in a minute.' } };
		const r = await start(VIDEO);
		expect(r.status).toBe(502);
		expect(r.body).toMatchObject({ error: 'gpu_busy', message: 'All GPUs are busy. Retry in a minute.' });
	});

	it('a task the worker failed reports its code and message exactly', async () => {
		const { body } = await start(VIDEO);
		Object.assign(worker.tasks.get('task-1'), {
			status: 'failed',
			stage: 'pose',
			error: { code: 'too_little_parallax', message: 'The camera barely moved. Walk at least 3 metres while recording.' },
		});
		await backdatePoll(body.job_id);
		const r = await poll(body.job_id);
		expect(r.body).toMatchObject({
			status: 'failed',
			stage: 'pose',
			error: { code: 'too_little_parallax', message: 'The camera barely moved. Walk at least 3 metres while recording.' },
		});
		expect(r.body.result).toBeUndefined();
	});

	it('a task the worker lost becomes task_lost instead of polling forever', async () => {
		const { body } = await start(VIDEO);
		worker.tasks.clear();
		await backdatePoll(body.job_id);
		const r = await poll(body.job_id);
		expect(r.body.status).toBe('failed');
		expect(r.body.error.code).toBe('task_lost');
	});
});

describe('finaliser', () => {
	it('copies every file into captures/pano/<user>/<job>/ byte for byte and answers C4 result URLs', async () => {
		const { body } = await start(VIDEO);
		succeed('task-1');
		await backdatePoll(body.job_id);
		const r = await poll(body.job_id);
		expect(r.body.status).toBe('succeeded');
		expect(r.body.progress).toBe(1);

		const prefix = `captures/pano/${OWNER}/${body.job_id}/`;
		const want = { 'scene.ply': PLY, 'scene.spz': SPZ, 'preview.mp4': MP4, 'poster.jpg': JPG };
		for (const [name, bytes] of Object.entries(want)) {
			const obj = bucket.state.objects.get(prefix + name);
			expect(obj, name).toBeTruthy();
			expect(sha(obj.body)).toBe(sha(bytes));
		}
		const { env } = await import('../api/_lib/env.js');
		const cdn = (name) => `${env.APP_ORIGIN}/cdn/${prefix}${name}`;
		expect(r.body.result).toEqual({
			ply_url: cdn('scene.ply'),
			spz_url: cdn('scene.spz'),
			preview_url: cdn('preview.mp4'),
			poster_url: cdn('poster.jpg'),
			viewer_url: `/splat?src=${encodeURIComponent(cdn('scene.spz'))}`,
		});
		expect(r.body.stats).toMatchObject({ gaussians: 4096 });
		const stored = await row(body.job_id);
		expect(stored.result.files.ply).toEqual({ key: prefix + 'scene.ply', bytes: PLY.length, sha256: sha(PLY) });

		const list = await api('GET', { query: { mine: '1' } });
		expect(list.body.captures[0]).toMatchObject({ status: 'succeeded', poster_url: cdn('poster.jpg'), viewer_url: r.body.result.viewer_url });
	});

	it('is idempotent: a finished job is never copied again', async () => {
		const { body } = await start(VIDEO);
		succeed('task-1');
		await backdatePoll(body.job_id);
		await poll(body.job_id);
		const writes = bucket.state.writes;
		const files = workerCalls('FILE', '');
		expect(writes).toBe(4);

		const done = await row(body.job_id);
		const again = await lib.finalise(done);
		expect(again.status).toBe('succeeded');
		await backdatePoll(body.job_id);
		await poll(body.job_id);
		await lib.advanceUnwatched();
		expect(bucket.state.writes).toBe(writes);
		expect(workerCalls('FILE', '')).toBe(files);
		expect(workerCalls('GET', '/tasks/')).toBe(1);
	});

	it('lets only one of two concurrent finalisers copy', async () => {
		const { body } = await start(VIDEO);
		succeed('task-1');
		const result = worker.tasks.get('task-1').result;
		await holder.db.sql`
			UPDATE pano_captures SET status = 'running', worker_result = ${JSON.stringify(result)}::jsonb
			WHERE id = ${body.job_id}`;
		const pending = await row(body.job_id);
		const [x, y] = await Promise.all([lib.finalise(pending), lib.finalise(pending)]);
		expect(bucket.state.writes).toBe(4);
		expect([x.status, y.status]).toContain('succeeded');
		expect((await row(body.job_id)).status).toBe('succeeded');
	});

	it('keeps the scene when the worker made no flythrough or poster', async () => {
		const { body } = await start(VIDEO);
		succeed('task-1', { withPreview: false });
		await backdatePoll(body.job_id);
		const r = await poll(body.job_id);
		expect(r.body.status).toBe('succeeded');
		expect(r.body.result).toMatchObject({ preview_url: null, poster_url: null, viewer_url: expect.stringMatching(/^\/splat\?src=/) });
		expect(bucket.state.writes).toBe(2);
	});

	it('fails with result_unavailable when the worker\'s signed URLs are dead', async () => {
		const { body } = await start(VIDEO);
		succeed('task-1');
		worker.files.clear();
		await backdatePoll(body.job_id);
		const r = await poll(body.job_id);
		expect(r.body.status).toBe('failed');
		expect(r.body.error.code).toBe('result_unavailable');
		expect(bucket.state.writes).toBe(0);
	});

	it('retries after a storage fault instead of failing the capture', async () => {
		const { body } = await start(VIDEO);
		succeed('task-1');
		await backdatePoll(body.job_id);
		const { r2 } = await import('../api/_lib/r2.js');
		const healthy = r2.send;
		r2.send = async () => {
			throw new Error('R2 503 SlowDown');
		};
		try {
			const r = await poll(body.job_id);
			expect(r.body).toMatchObject({ status: 'running', stage: 'save' });
			expect((await row(body.job_id)).lease_until).toBeNull();
		} finally {
			r2.send = healthy;
		}
		const r = await poll(body.job_id);
		expect(r.body.status).toBe('succeeded');
		expect(bucket.state.writes).toBe(4);
	});
});

describe('DELETE a finished job', () => {
	it('removes its stored files and then its row', async () => {
		const { body } = await start(VIDEO);
		succeed('task-1');
		await backdatePoll(body.job_id);
		await poll(body.job_id);
		// An unrelated capture's files must survive.
		bucket.state.objects.set(`captures/pano/${OWNER}/other/scene.ply`, { body: Buffer.from('x') });

		const r = await api('DELETE', { query: { job: body.job_id } });
		expect(r.status).toBe(200);
		expect(r.body).toEqual({ job_id: body.job_id, deleted: true });
		expect([...bucket.state.objects.keys()]).toEqual([`captures/pano/${OWNER}/other/scene.ply`]);
		expect(await row(body.job_id)).toBeUndefined();
		expect(workerCalls('DELETE', '/tasks/')).toBe(0);
		expect((await poll(body.job_id)).status).toBe(404);
	});

	it('deletes a failed job that never stored anything', async () => {
		worker.inferReply = { status: 422, body: { error: { code: 'bad_source', message: 'unreadable' } } };
		const { body } = await start(VIDEO);
		const r = await api('DELETE', { query: { job: body.job_id } });
		expect(r.body).toEqual({ job_id: body.job_id, deleted: true });
		expect(await row(body.job_id)).toBeUndefined();
	});
});

describe('cron: /api/cron/pano-captures', () => {
	it('advances and finalises jobs nobody is polling, and leaves watched ones alone', async () => {
		const unwatched = await start(VIDEO);
		const watched = await start(VIDEO);
		succeed('task-1');
		Object.assign(worker.tasks.get('task-2'), { status: 'running', stage: 'train', progress: 0.5 });
		await backdatePoll(unwatched.body.job_id, 120);

		const r = await call(cron, 'GET', { path: '/api/cron/pano-captures', headers: { authorization: 'Bearer cron-test-secret' } });
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ ok: true, count: 1 });
		expect(r.body.advanced[0]).toMatchObject({ job_id: unwatched.body.job_id, from: 'queued', to: 'succeeded' });
		expect((await row(unwatched.body.job_id)).status).toBe('succeeded');
		expect((await row(watched.body.job_id)).status).toBe('queued');
		expect(bucket.state.writes).toBe(4);
	});

	it('refuses a caller without the cron secret', async () => {
		const r = await call(cron, 'GET', { path: '/api/cron/pano-captures' });
		expect(r.status).toBe(401);
	});

	it('does nothing on a deployment with no worker', async () => {
		delete process.env.GCP_PANO2SPLAT_URL;
		expect(await lib.advanceUnwatched()).toEqual({ skipped: 'unconfigured', advanced: [] });
	});

	it('fails a job whose submit never reached the worker', async () => {
		const [stuck] = await holder.db.sql`
			INSERT INTO pano_captures (user_id, source_kind, source_url, quality, active_slot, created_at)
			VALUES (${OWNER}, 'equirect_video', ${VIDEO.source_url}, 'standard', 1, now() - interval '10 minutes')
			RETURNING id`;
		await lib.advanceUnwatched();
		expect((await row(stuck.id)).error.code).toBe('submit_lost');
	});
});

describe('uploadStream: multipart streaming', () => {
	it('splits a large body into parts and stores it byte for byte', async () => {
		const { uploadStream } = await import('../api/_lib/r2-stream.js');
		const data = randomBytes(5 * 1024 * 1024 + 123);
		async function* chunks() {
			for (let i = 0; i < data.length; i += 700_000) yield data.subarray(i, i + 700_000);
		}
		const out = await uploadStream({ key: 'captures/pano/test/multipart.bin', stream: chunks(), partBytes: 1024 * 1024 });
		expect(out).toEqual({ key: 'captures/pano/test/multipart.bin', bytes: data.length, sha256: sha(data) });
		expect(sha(bucket.state.objects.get('captures/pano/test/multipart.bin').body)).toBe(sha(data));
		expect(bucket.state.uploads.size).toBe(0);
	});

	it('aborts the upload when a part fails, leaving no object', async () => {
		const { uploadStream } = await import('../api/_lib/r2-stream.js');
		async function* broken() {
			yield randomBytes(1024 * 1024);
			yield randomBytes(1024 * 1024);
			throw new Error('source reset');
		}
		await expect(uploadStream({ key: 'captures/pano/test/broken.bin', stream: broken(), partBytes: 512 * 1024 })).rejects.toThrow('source reset');
		expect(bucket.state.objects.has('captures/pano/test/broken.bin')).toBe(false);
		expect(bucket.state.uploads.size).toBe(0);
	});
});
