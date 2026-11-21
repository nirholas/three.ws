// /api/pano-scene: a 360 photo (or a raw Insta360 .insp) becomes a depth shell
// you can stand inside.
//
// Two real HTTP servers on 127.0.0.1 speak the worker contracts from
// prompts/finish/_context/insta360-00-CONTEXT.md: C1 (model-pano2splat, task
// "stitch") and C2 (model-panodepth). The handler reaches them over real
// sockets through GCP_PANO2SPLAT_URL / GCP_PANODEPTH_URL. Object storage is an
// in-memory bucket that honours If-None-Match / If-Match exactly as R2 does,
// so the cross-instance claims are exercised for real.

import http from 'node:http';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const auth = vi.hoisted(() => ({ user: { id: 'user-a' } }));
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => auth.user,
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true, reset: Date.now() + 1000 }) }),
	clientIp: () => '203.0.113.7',
}));

// In-memory bucket with R2's conditional-write semantics.
const bucket = vi.hoisted(() => {
	const objects = new Map();
	let version = 0;
	const etag = () => `"v${++version}"`;
	const preconditionFailed = () =>
		Object.assign(new Error('At least one of the pre-conditions you specified did not hold'), {
			name: 'PreconditionFailed',
			$metadata: { httpStatusCode: 412 },
		});
	return {
		objects,
		storageOn: true,
		puts: [],
		async send(cmd) {
			const name = cmd.constructor.name;
			const { Key, Body, IfNoneMatch, IfMatch, ContentType } = cmd.input;
			if (name === 'GetObjectCommand') {
				const obj = objects.get(Key);
				if (!obj) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
				return { ETag: obj.etag, Body: (async function* () { yield obj.body; })() };
			}
			if (name === 'PutObjectCommand') {
				const existing = objects.get(Key);
				if (IfNoneMatch === '*' && existing) throw preconditionFailed();
				if (IfMatch && (!existing || existing.etag !== IfMatch)) throw preconditionFailed();
				const obj = { body: Buffer.from(Body), etag: etag(), contentType: ContentType };
				objects.set(Key, obj);
				return { ETag: obj.etag };
			}
			throw new Error(`unexpected command ${name}`);
		},
	};
});

vi.mock('../api/_lib/r2.js', () => ({
	r2: { send: (cmd) => bucket.send(cmd) },
	objectStorageConfigured: () => bucket.storageOn,
	cdnUrl: (key) => `https://three.ws/cdn/${key}`,
	workerReadableUrl: (url) => url,
	async putObject({ key, body, contentType }) {
		bucket.puts.push(key);
		bucket.objects.set(key, { body: Buffer.from(body), etag: `"p${bucket.puts.length}"`, contentType });
		return `https://three.ws/cdn/${key}`;
	},
}));

process.env.JWT_SECRET ||= 'pano-scene-test-secret-0123456789abcdef';
process.env.S3_BUCKET ||= 'pano-scene-test-bucket';

const PUBLIC_PHOTO = 'https://93.184.216.34/uploads/room.jpg';
const PUBLIC_INSP = 'https://93.184.216.34/uploads/IMG_001.insp';
const STITCHED = 'https://93.184.216.34/stitched/eq.jpg';

// ── contract servers ─────────────────────────────────────────────────────────

function contractServer(name) {
	const state = { tasks: new Map(), submits: [], polls: 0, auth: [], nextId: 1, files: new Map() };
	const server = http.createServer((req, res) => {
		state.auth.push(req.headers.authorization);
		const send = (status, body, type = 'application/json') => {
			res.writeHead(status, { 'content-type': type });
			res.end(type === 'application/json' ? JSON.stringify(body) : body);
		};
		if (req.method === 'POST' && req.url === '/infer') {
			let raw = '';
			req.on('data', (c) => (raw += c));
			req.on('end', () => {
				const body = JSON.parse(raw);
				state.submits.push(body);
				if (state.rejectSubmit) return send(400, { error: { code: 'unsupported_input', message: 'Not an equirectangular image.' } });
				const id = `${name}-task-${state.nextId++}`;
				state.tasks.set(id, { status: 'queued', progress: 0 });
				send(202, { task_id: id });
			});
			return;
		}
		const m = req.url.match(/^\/tasks\/([^/?]+)$/);
		if (req.method === 'GET' && m) {
			state.polls++;
			const t = state.tasks.get(decodeURIComponent(m[1]));
			if (!t) return send(404, { error: 'not_found' });
			return send(200, t);
		}
		const f = state.files.get(req.url);
		if (req.method === 'GET' && f) return send(200, f, 'application/octet-stream');
		send(404, { error: 'not_found' });
	});
	return {
		state,
		server,
		get url() {
			return `http://127.0.0.1:${server.address().port}`;
		},
		listen: () => new Promise((r) => server.listen(0, '127.0.0.1', r)),
		close: () => new Promise((r) => server.close(r)),
	};
}

const c1 = contractServer('stitch');
const c2 = contractServer('depth');

beforeAll(async () => {
	await Promise.all([c1.listen(), c2.listen()]);
});
afterAll(async () => {
	await Promise.all([c1.close(), c2.close()]);
});

function resetServer(s) {
	s.state.tasks.clear();
	s.state.submits.length = 0;
	s.state.auth.length = 0;
	s.state.files.clear();
	s.state.polls = 0;
	s.state.rejectSubmit = false;
	s.state.nextId = 1;
}

beforeEach(() => {
	auth.user = { id: 'user-a' };
	bucket.objects.clear();
	bucket.puts.length = 0;
	bucket.storageOn = true;
	resetServer(c1);
	resetServer(c2);
	process.env.GCP_PANO2SPLAT_URL = c1.url;
	process.env.GCP_PANODEPTH_URL = c2.url;
	process.env.GCP_RECONSTRUCTION_KEY = 'shared-test-key';
});

// ── request helpers ──────────────────────────────────────────────────────────

async function call({ method = 'GET', url = '/api/pano-scene', body } = {}) {
	const handler = (await import('../api/pano-scene.js')).default;
	const req = {
		method,
		url,
		headers: { 'content-type': 'application/json', origin: 'https://three.ws', 'x-forwarded-for': '203.0.113.7' },
		body,
	};
	const res = {
		statusCode: 200,
		headers: {},
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		writeHead(c) { this.statusCode = c; },
		end(b) { this.payload = b; this.headersSent = true; },
	};
	await handler(req, res);
	return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
}

const submit = (body) => call({ method: 'POST', body });
const poll = (job) => call({ url: `/api/pano-scene?job=${encodeURIComponent(job)}` });

function finishDepth(taskId, { glb = 'GLB-BYTES', ply = 'PLY-BYTES' } = {}) {
	c2.state.files.set(`/out/${taskId}/scene.glb`, glb);
	c2.state.files.set(`/out/${taskId}/scene.ply`, ply);
	c2.state.tasks.set(taskId, {
		status: 'succeeded',
		progress: 1,
		result: {
			glb_url: `${c2.url}/out/${taskId}/scene.glb`,
			ply_url: `${c2.url}/out/${taskId}/scene.ply`,
			depth_url: `${c2.url}/out/${taskId}/depth.exr`,
			stats: { width: 4096, height: 2048, median_depth_m: 3.2, points: 1_800_000, faces: 3_400_000, model: 'depth-anything-360', license: 'Apache-2.0' },
		},
	});
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('input validation', () => {
	it('needs image_url', async () => {
		const got = await submit({ source_kind: 'equirect_image' });
		expect(got.status).toBe(400);
		expect(got.body.error).toBe('missing_image_url');
	});

	it('refuses an unknown source_kind', async () => {
		const got = await submit({ image_url: PUBLIC_PHOTO, source_kind: 'insv' });
		expect(got.status).toBe(400);
		expect(got.body.error).toBe('invalid_source_kind');
	});

	it('refuses a garbage job id', async () => {
		const got = await poll('not-a-job');
		expect(got.status).toBe(400);
		expect(got.body.error).toBe('invalid_job');
	});

	it('needs an account to start a job', async () => {
		auth.user = null;
		const got = await submit({ image_url: PUBLIC_PHOTO });
		expect(got.status).toBe(401);
		expect(got.body.error).toBe('sign_in_required');
		expect(c2.state.submits).toHaveLength(0);
	});
});

describe('SSRF', () => {
	for (const bad of ['http://169.254.169.254/latest', 'https://127.0.0.1/x.jpg', 'https://10.0.0.5/x.jpg', 'http://93.184.216.34/plain-http.jpg', 'file:///etc/passwd']) {
		it(`rejects ${bad} before any worker call`, async () => {
			const got = await submit({ image_url: bad, source_kind: 'equirect_image' });
			expect(got.status).toBe(400);
			expect(got.body.error).toBe('invalid_image_url');
			expect(c2.state.submits).toHaveLength(0);
		});
	}

	it('fails the job when the stitch worker hands back a private equirect_url', async () => {
		const start = await submit({ image_url: PUBLIC_INSP, source_kind: 'insp' });
		c1.state.tasks.set('stitch-task-1', { status: 'succeeded', progress: 1, result: { equirect_url: 'http://169.254.169.254/latest' } });
		const got = await poll(start.body.job_id);
		expect(got.body.status).toBe('failed');
		expect(got.body.error.code).toBe('stitch_no_output');
		expect(c2.state.submits).toHaveLength(0);
	});
});

describe('unconfigured', () => {
	it('answers 503 with a visitor message and an operator hint when the depth worker is unset', async () => {
		delete process.env.GCP_PANODEPTH_URL;
		const got = await submit({ image_url: PUBLIC_PHOTO, source_kind: 'equirect_image' });
		expect(got.status).toBe(503);
		expect(got.body.error).toBe('unconfigured');
		expect(got.body.message).toBe('Photo-to-3D is not switched on yet on this server.');
		expect(got.body.hint).toMatch(/GCP_PANODEPTH_URL/);
	});

	it('needs the stitch worker too for an .insp', async () => {
		delete process.env.GCP_PANO2SPLAT_URL;
		const insp = await submit({ image_url: PUBLIC_INSP, source_kind: 'insp' });
		expect(insp.status).toBe(503);
		expect(insp.body.hint).toMatch(/GCP_PANO2SPLAT_URL/);
		const photo = await submit({ image_url: PUBLIC_PHOTO, source_kind: 'equirect_image' });
		expect(photo.status).toBe(202);
	});

	it('reports which lanes are on without a job id', async () => {
		expect((await call()).body).toEqual({ lanes: { equirect_image: true, insp: true } });
		delete process.env.GCP_PANO2SPLAT_URL;
		expect((await call()).body).toEqual({ lanes: { equirect_image: true, insp: false } });
		delete process.env.GCP_RECONSTRUCTION_KEY;
		expect((await call()).body).toEqual({ lanes: { equirect_image: false, insp: false } });
	});

	it('is unconfigured without object storage, since results must be kept', async () => {
		bucket.storageOn = false;
		const got = await submit({ image_url: PUBLIC_PHOTO });
		expect(got.status).toBe(503);
		expect((await call()).body.lanes.equirect_image).toBe(false);
	});
});

describe('equirect photo: depth, mesh, save', () => {
	it('posts straight to C2 and reports combined progress through to R2 results', async () => {
		const start = await submit({ image_url: PUBLIC_PHOTO, source_kind: 'equirect_image' });
		expect(start.status).toBe(202);
		expect(start.body).toMatchObject({ status: 'queued', stage: 'depth', progress: 0 });
		expect(c1.state.submits).toHaveLength(0);
		expect(c2.state.submits).toEqual([{ image_url: PUBLIC_PHOTO, job_id: expect.any(String), max_points: 2_000_000, mesh: true }]);
		expect(c2.state.auth[0]).toBe('Bearer shared-test-key');

		c2.state.tasks.set('depth-task-1', { status: 'running', progress: 0.4 });
		let got = await poll(start.body.job_id);
		expect(got.body).toMatchObject({ status: 'running', stage: 'depth', progress: 0.38 });

		c2.state.tasks.set('depth-task-1', { status: 'running', progress: 0.8 });
		got = await poll(start.body.job_id);
		expect(got.body).toMatchObject({ status: 'running', stage: 'mesh', progress: 0.76 });

		finishDepth('depth-task-1');
		got = await poll(start.body.job_id);
		expect(got.body.status).toBe('succeeded');
		expect(got.body.stage).toBe('done');
		expect(got.body.progress).toBe(1);
		const prefix = 'captures/pano-scene/user-a/';
		expect(got.body.result.glb_url).toMatch(new RegExp(`^https://three\\.ws/cdn/${prefix}[0-9a-f]{32}/scene\\.glb$`));
		expect(got.body.result.ply_url).toMatch(/\/scene\.ply$/);
		expect(got.body.result.viewer_url).toBe(`/viewer?src=${encodeURIComponent(got.body.result.glb_url)}&title=360%20scene`);
		expect(got.body.result.stats).toMatchObject({ points: 1_800_000, glb_bytes: 9, ply_bytes: 9 });

		// The files really are in our bucket, copied from the worker.
		const glbKey = got.body.result.glb_url.replace('https://three.ws/cdn/', '');
		expect(bucket.objects.get(glbKey).body.toString()).toBe('GLB-BYTES');
		expect(bucket.objects.get(glbKey).contentType).toBe('model/gltf-binary');

		// A later poll answers from result.json and never copies twice.
		const putsBefore = bucket.puts.length;
		const again = await poll(start.body.job_id);
		expect(again.body).toEqual(got.body);
		expect(bucket.puts.length).toBe(putsBefore);
	});

	it('infers the .insp lane from the URL when source_kind is omitted', async () => {
		const got = await submit({ image_url: PUBLIC_INSP });
		expect(got.status).toBe(202);
		expect(got.body.stage).toBe('stitch');
		expect(c1.state.submits).toHaveLength(1);
	});

	it('passes the worker failure message through', async () => {
		const start = await submit({ image_url: PUBLIC_PHOTO });
		c2.state.tasks.set('depth-task-1', { status: 'failed', progress: 0.3, error: { code: 'not_equirect', message: 'This photo is not a full 360 panorama.' } });
		const got = await poll(start.body.job_id);
		expect(got.body).toMatchObject({ status: 'failed', error: { code: 'not_equirect', message: 'This photo is not a full 360 panorama.' } });
	});

	it('turns a worker 4xx at submit into a 422 with the worker message', async () => {
		c2.state.rejectSubmit = true;
		const got = await submit({ image_url: PUBLIC_PHOTO });
		expect(got.status).toBe(422);
		expect(got.body).toEqual({ error: 'unsupported_input', message: 'Not an equirectangular image.' });
	});

	it('fails with result_unavailable when the worker files expired before the copy', async () => {
		const start = await submit({ image_url: PUBLIC_PHOTO });
		finishDepth('depth-task-1');
		c2.state.files.clear();
		const got = await poll(start.body.job_id);
		expect(got.body).toMatchObject({ status: 'failed', error: { code: 'result_unavailable' } });
	});
});

describe('.insp: stitch, then depth', () => {
	it('stitches on C1, hands the equirect to C2 once, and maps stitch to the first 20%', async () => {
		const start = await submit({ image_url: PUBLIC_INSP, source_kind: 'insp' });
		expect(start.status).toBe(202);
		expect(start.body).toMatchObject({ status: 'queued', stage: 'stitch', progress: 0 });
		expect(c1.state.submits).toEqual([{ task: 'stitch', source_url: PUBLIC_INSP, source_kind: 'insp', job_id: expect.any(String) }]);
		expect(c2.state.submits).toHaveLength(0);
		const job = start.body.job_id;

		c1.state.tasks.set('stitch-task-1', { status: 'running', stage: 'stitch', progress: 0.5 });
		let got = await poll(job);
		expect(got.body).toMatchObject({ status: 'running', stage: 'stitch', progress: 0.1 });
		expect(c2.state.submits).toHaveLength(0);

		c1.state.tasks.set('stitch-task-1', { status: 'succeeded', stage: 'upload', progress: 1, result: { equirect_url: STITCHED } });
		got = await poll(job);
		expect(got.body).toMatchObject({ status: 'queued', stage: 'depth', progress: 0.2 });
		expect(c2.state.submits).toEqual([{ image_url: STITCHED, job_id: c1.state.submits[0].job_id, max_points: 2_000_000, mesh: true }]);

		// Further polls follow the depth task and never submit a second one.
		c2.state.tasks.set('depth-task-1', { status: 'running', progress: 0.5 });
		got = await poll(job);
		expect(got.body).toMatchObject({ status: 'running', stage: 'depth', progress: 0.575 });
		const stitchPolls = c1.state.polls;
		got = await poll(job);
		expect(c1.state.polls).toBe(stitchPolls);
		expect(c2.state.submits).toHaveLength(1);

		finishDepth('depth-task-1');
		got = await poll(job);
		expect(got.body.status).toBe('succeeded');
		expect(got.body.result.glb_url).toMatch(/captures\/pano-scene\/user-a\/[0-9a-f]{32}\/scene\.glb$/);
	});

	it('submits the depth task once when two polls race on two instances', async () => {
		const start = await submit({ image_url: PUBLIC_INSP, source_kind: 'insp' });
		c1.state.tasks.set('stitch-task-1', { status: 'succeeded', progress: 1, result: { equirect_url: STITCHED } });
		const [a, b] = await Promise.all([poll(start.body.job_id), poll(start.body.job_id)]);
		expect(c2.state.submits).toHaveLength(1);
		for (const r of [a, b]) expect(r.body).toMatchObject({ stage: 'depth', progress: 0.2 });
	});

	it('takes over a depth claim left by an instance that died mid-submit', async () => {
		const start = await submit({ image_url: PUBLIC_INSP, source_kind: 'insp' });
		const { decodeJobToken, jobPrefix } = await import('../api/_lib/pano-scene-job.js');
		const job = decodeJobToken(start.body.job_id);
		const key = `${jobPrefix(job.owner, job.jobId)}state.json`;
		await bucket.send(new (await import('@aws-sdk/client-s3')).PutObjectCommand({ Key: key, Body: JSON.stringify({ claimed_at: Date.now() - 10 * 60_000 }) }));
		c1.state.tasks.set('stitch-task-1', { status: 'succeeded', progress: 1, result: { equirect_url: STITCHED } });
		await poll(start.body.job_id);
		expect(c2.state.submits).toHaveLength(1);
	});

	it('reports a stitch failure with the worker message', async () => {
		const start = await submit({ image_url: PUBLIC_INSP, source_kind: 'insp' });
		c1.state.tasks.set('stitch-task-1', { status: 'failed', progress: 0.2, error: { code: 'unsupported_camera', message: 'This camera model is not supported yet.' } });
		const got = await poll(start.body.job_id);
		expect(got.body).toMatchObject({ status: 'failed', stage: 'stitch', error: { code: 'unsupported_camera', message: 'This camera model is not supported yet.' } });
	});
});

describe('job token', () => {
	it('rejects a tampered payload', async () => {
		const start = await submit({ image_url: PUBLIC_PHOTO });
		const [prefix, payload, sig] = start.body.job_id.split('.');
		const obj = JSON.parse(Buffer.from(payload, 'base64url').toString());
		obj.d = 'someone-elses-task';
		const forged = `${prefix}.${Buffer.from(JSON.stringify(obj)).toString('base64url')}.${sig}`;
		const got = await poll(forged);
		expect(got.status).toBe(400);
		expect(got.body.error).toBe('invalid_job');
		expect(c2.state.polls).toBe(0);
	});

	it('rejects a re-signed token made with another secret', async () => {
		const start = await submit({ image_url: PUBLIC_PHOTO });
		const [prefix, payload] = start.body.job_id.split('.');
		const { createHmac } = await import('node:crypto');
		const sig = createHmac('sha256', 'not-the-server-secret').update(`three.ws/pano-scene/v1:${payload}`).digest('base64url');
		expect((await poll(`${prefix}.${payload}.${sig}`)).status).toBe(400);
	});

	it('rejects a truncated signature', async () => {
		const start = await submit({ image_url: PUBLIC_PHOTO });
		expect((await poll(start.body.job_id.slice(0, -3))).status).toBe(400);
	});
});

describe('ownership', () => {
	it('hides one account\'s job from another', async () => {
		const start = await submit({ image_url: PUBLIC_PHOTO });
		auth.user = { id: 'user-b' };
		const got = await poll(start.body.job_id);
		expect(got.status).toBe(404);
		expect(got.body.error).toBe('job_not_found');
		expect(c2.state.polls).toBe(0);
	});

	it('needs a signed-in caller to poll', async () => {
		const start = await submit({ image_url: PUBLIC_PHOTO });
		auth.user = null;
		const got = await poll(start.body.job_id);
		expect(got.status).toBe(401);
		expect(c2.state.polls).toBe(0);
	});
});
