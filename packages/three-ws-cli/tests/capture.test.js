// `three-ws capture` against a real local HTTP server that speaks contract C4:
// /api/capture-upload/{create,sign,parts,complete}, presigned part PUTs that
// answer with an ETag, /api/pano-capture and /api/pano-scene jobs that progress
// to a result, and result files served over HTTP (one behind a redirect).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { writeStore } from '../src/store.js';
import { main } from '../src/cli.js';
import { classifyFile, captureKind } from '../src/commands/capture.js';

const KEY = 'sk_live_cli_capture_test_key_0000';
const PART_SIZE = 1024;

const RESULT = {
	'scene.ply': randomBytes(3000),
	'scene.spz': randomBytes(1200),
	'preview.mp4': randomBytes(2500),
	'poster.jpg': randomBytes(800),
	'scene.glb': randomBytes(1800),
	'room.ply': randomBytes(900),
};

/** The C4 server. `s.hooks` lets a test fail parts or jobs; `s.log` records every call. */
function c4Server() {
	const s = {
		uploads: new Map(),
		objects: new Map(),
		log: [],
		puts: [],
		captureBodies: [],
		sceneBodies: [],
		hooks: { putStatus: () => 200, captureOutcome: 'succeeded', createError: null },
		polls: new Map(),
		seq: 0,
	};
	const send = (res, status, body, headers = {}) => {
		res.writeHead(status, { 'content-type': 'application/json', ...headers });
		res.end(JSON.stringify(body));
	};
	const readBody = (req) =>
		new Promise((resolve) => {
			const chunks = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => resolve(Buffer.concat(chunks)));
		});

	s.server = http.createServer(async (req, res) => {
		const url = new URL(req.url, s.origin);
		const body = await readBody(req);
		const json = () => (body.length ? JSON.parse(body.toString('utf8')) : {});
		s.log.push(`${req.method} ${url.pathname}`);

		// Presigned storage: no bearer, the URL is the authority.
		if (url.pathname.startsWith('/storage/part/')) {
			const [, , , id, n] = url.pathname.split('/');
			const up = s.uploads.get(id);
			s.puts.push(Number(n));
			const status = s.hooks.putStatus(Number(n), s.puts.filter((p) => p === Number(n)).length);
			if (status !== 200 || !up) {
				res.writeHead(status === 200 ? 404 : status);
				return res.end();
			}
			const etag = `"${createHash('md5').update(body).digest('hex')}"`;
			up.parts.set(Number(n), { etag, data: body });
			res.writeHead(200, { etag });
			return res.end();
		}
		if (url.pathname.startsWith('/storage/object/')) {
			const data = s.objects.get(url.pathname.split('/').pop());
			res.writeHead(data ? 200 : 404);
			return res.end(data || '');
		}
		if (url.pathname === '/files/redirect-poster') {
			res.writeHead(302, { location: `${s.origin}/files/poster.jpg` });
			return res.end();
		}
		if (url.pathname.startsWith('/files/')) {
			const data = RESULT[url.pathname.slice(7)];
			res.writeHead(data ? 200 : 404, { 'content-type': 'application/octet-stream' });
			return res.end(data || '');
		}

		if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: 'unauthorized', message: 'sign in required' });

		if (url.pathname === '/api/capture-upload/create') {
			if (s.hooks.createError) return send(res, s.hooks.createError.status, s.hooks.createError.body);
			const { filename, content_type, size_bytes, kind } = json();
			if (kind !== 'pano') return send(res, 400, { error: 'invalid_kind', message: 'kind must be pano' });
			const id = `up${++s.seq}`;
			const part_count = Math.ceil(size_bytes / PART_SIZE);
			s.uploads.set(id, { key: `captures/raw/u1/${id}/${filename}`, size_bytes, content_type, part_count, parts: new Map() });
			return send(res, 200, { upload_id: id, key: `captures/raw/u1/${id}/${filename}`, part_size: PART_SIZE, part_count });
		}
		if (url.pathname === '/api/capture-upload/sign') {
			const { upload_id, key, part_numbers } = json();
			const up = s.uploads.get(upload_id);
			if (!up) return send(res, 404, { error: 'upload_not_found', message: 'That upload is gone. Start it again.' });
			if (up.key !== key) return send(res, 403, { error: 'forbidden', message: 'not your upload' });
			if (!Array.isArray(part_numbers) || part_numbers.length < 1 || part_numbers.length > 100) return send(res, 400, { error: 'invalid_parts', message: '1 to 100 part numbers' });
			return send(res, 200, { urls: Object.fromEntries(part_numbers.map((n) => [String(n), `${s.origin}/storage/part/${upload_id}/${n}`])) });
		}
		if (url.pathname === '/api/capture-upload/parts') {
			const up = s.uploads.get(json().upload_id);
			if (!up) return send(res, 404, { error: 'upload_not_found', message: 'That upload is gone. Start it again.' });
			return send(res, 200, { parts: [...up.parts].map(([part_number, p]) => ({ part_number, etag: p.etag, size: p.data.length })) });
		}
		if (url.pathname === '/api/capture-upload/complete') {
			const { upload_id, parts } = json();
			const up = s.uploads.get(upload_id);
			if (!up) return send(res, 404, { error: 'upload_not_found', message: 'That upload is gone. Start it again.' });
			for (const p of parts) if (up.parts.get(p.part_number)?.etag !== p.etag) return send(res, 400, { error: 'invalid_parts', message: `part ${p.part_number} does not match` });
			const data = Buffer.concat(parts.map((p) => up.parts.get(p.part_number).data));
			if (data.length !== up.size_bytes) return send(res, 422, { error: 'size_mismatch', expected_bytes: up.size_bytes, actual_bytes: data.length });
			s.objects.set(upload_id, data);
			s.uploads.delete(upload_id);
			return send(res, 200, { source_url: `${s.origin}/storage/object/${upload_id}`, size_bytes: data.length });
		}

		if (url.pathname === '/api/pano-capture') {
			if (req.method === 'POST') {
				const b = json();
				s.captureBodies.push(b);
				return send(res, 202, { job_id: `pcj_${s.captureBodies.length}abc`, status: 'queued', eta_seconds: { preview: 900, standard: 1800, high: 2700 }[b.quality] });
			}
			if (url.searchParams.get('mine') === '1') {
				return send(res, 200, {
					captures: [{ job_id: 'pcj_1abc', status: 'succeeded', created_at: '2026-11-21T10:00:00Z', poster_url: `${s.origin}/files/poster.jpg`, viewer_url: '/viewer?src=x', source_kind: 'equirect_video' }],
				});
			}
			const job = url.searchParams.get('job');
			const n = (s.polls.get(job) || 0) + 1;
			s.polls.set(job, n);
			if (n === 1) return send(res, 200, { job_id: job, status: 'running', stage: 'train', progress: 0.42 });
			if (s.hooks.captureOutcome === 'failed') {
				return send(res, 200, { job_id: job, status: 'failed', stage: 'poses', progress: 0.2, error: { code: 'too_few_poses', message: 'The camera barely moved. Walk through the space while recording.' } });
			}
			return send(res, 200, {
				job_id: job,
				status: 'succeeded',
				stage: 'done',
				progress: 1,
				result: {
					ply_url: `${s.origin}/files/scene.ply`,
					spz_url: `${s.origin}/files/scene.spz`,
					preview_url: `${s.origin}/files/preview.mp4`,
					poster_url: `${s.origin}/files/redirect-poster`,
					viewer_url: `/viewer?src=${encodeURIComponent(`${s.origin}/files/scene.spz`)}`,
				},
			});
		}
		if (url.pathname === '/api/pano-scene') {
			if (req.method === 'POST') {
				const b = json();
				s.sceneBodies.push(b);
				return send(res, 202, { job_id: 'psj.signed.token', status: 'queued', stage: b.source_kind === 'insp' ? 'stitch' : 'depth', progress: 0 });
			}
			const job = url.searchParams.get('job');
			const n = (s.polls.get(job) || 0) + 1;
			s.polls.set(job, n);
			if (n === 1) return send(res, 200, { job_id: job, status: 'running', stage: 'depth', progress: 0.5 });
			return send(res, 200, {
				job_id: job,
				status: 'succeeded',
				stage: 'done',
				progress: 1,
				result: { glb_url: `${s.origin}/files/scene.glb`, ply_url: `${s.origin}/files/room.ply`, viewer_url: '/viewer?src=g&title=360%20scene', stats: { vertices: 120000 } },
			});
		}
		return send(res, 404, { error: 'not_found', message: url.pathname });
	});
	return s;
}

let srv;
beforeAll(async () => {
	srv = c4Server();
	await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
	srv.origin = `http://127.0.0.1:${srv.server.address().port}`;
});
afterAll(() => new Promise((resolve) => srv.server.close(resolve)));

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-capture-'));
	return { home, platform: process.platform, cwd: home, vars: { THREE_WS_NO_BROWSER: '1', THREE_WS_CAPTURE_POLL_SECONDS: '0.1' } };
}

function writeFile(env, name, size) {
	const file = path.join(env.home, name);
	const data = randomBytes(size);
	fs.writeFileSync(file, data);
	return { file, data };
}

async function run(argv, env) {
	let out = '';
	let err = '';
	const w = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		out += String(chunk);
		return true;
	});
	const e = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
		err += String(chunk);
		return true;
	});
	try {
		const code = await main([...argv, '--origin', srv.origin], env);
		return { code, out, err, json: argv.includes('--json') && out ? JSON.parse(out) : null };
	} finally {
		w.mockRestore();
		e.mockRestore();
	}
}

describe('three-ws capture', () => {
	let env;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: srv.origin, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		srv.log.length = 0;
		srv.puts.length = 0;
		srv.captureBodies.length = 0;
		srv.sceneBodies.length = 0;
		srv.polls.clear();
		srv.hooks = { putStatus: () => 200, captureOutcome: 'succeeded', createError: null };
	});

	it('uploads a 360 video in parallel parts, starts the job, waits and saves every result file', async () => {
		const { data } = writeFile(env, 'walk.mp4', PART_SIZE * 9 + 123);
		const r = await run(['capture', '360', 'walk.mp4', '--quality', 'high', '--trim-start', '3', '--trim-end', '41.5', '--wait', '--out', 'out', '--json'], env);
		expect(r.code).toBe(0);

		const uploaded = [...srv.objects.values()].find((o) => o.length === data.length);
		expect(Buffer.compare(uploaded, data)).toBe(0);
		expect(new Set(srv.puts).size).toBe(10);
		expect(srv.captureBodies[0]).toEqual({ source_url: expect.stringMatching(/\/storage\/object\/up\d+$/), source_kind: 'equirect_video', quality: 'high', trim: { start_s: 3, end_s: 41.5 } });

		expect(r.json).toMatchObject({ job_id: 'pcj_1abc', status: 'succeeded', source_kind: 'equirect_video', quality: 'high', eta_seconds: 2700 });
		expect(r.json.uploads).toEqual([{ file: path.join(env.home, 'walk.mp4'), size_bytes: data.length, resumed: false, reused: false }]);
		expect(r.json.result.viewer_url).toBe(`${srv.origin}/viewer?src=${encodeURIComponent(`${srv.origin}/files/scene.spz`)}`);
		expect(r.json.files.map((f) => path.basename(f.path))).toEqual(['scene.ply', 'scene.spz', 'preview.mp4', 'poster.jpg']);
		for (const name of ['scene.ply', 'scene.spz', 'preview.mp4', 'poster.jpg']) {
			expect(Buffer.compare(fs.readFileSync(path.join(env.home, 'out', name)), RESULT[name])).toBe(0);
		}
		expect(JSON.stringify(r.json)).not.toContain('/storage/object/');
	});

	it('resumes an interrupted upload and sends only the parts still missing', async () => {
		writeFile(env, 'room.mov', PART_SIZE * 6);
		srv.hooks.putStatus = (n) => (n === 4 ? 400 : 200);
		const first = await run(['capture', '360', 'room.mov', '--json'], env);
		expect(first.code).toBe(6);
		expect(first.json).toMatchObject({ error: 'upload_failed' });
		expect(first.json.message).toMatch(/Run the same command again to resume/);
		expect(srv.captureBodies).toHaveLength(0);

		const sentFirst = new Set(srv.puts.filter((n) => n !== 4));
		expect(sentFirst.size).toBeGreaterThanOrEqual(3);
		srv.puts.length = 0;
		srv.log.length = 0;
		srv.hooks.putStatus = () => 200;
		const second = await run(['capture', '360', 'room.mov', '--json'], env);
		expect(second.code).toBe(0);
		expect(srv.puts).toContain(4);
		expect(srv.puts.filter((n) => sentFirst.has(n))).toEqual([]);
		expect(new Set([...sentFirst, ...srv.puts]).size).toBe(6);
		expect(srv.log).not.toContain('POST /api/capture-upload/create');
		expect(srv.log).toContain('POST /api/capture-upload/parts');
		expect(second.json.uploads[0]).toMatchObject({ resumed: true, reused: false });
		expect(second.json).toMatchObject({ job_id: expect.any(String), status: 'queued', source_kind: 'equirect_video', quality: 'standard', eta_seconds: 1800 });

		srv.log.length = 0;
		const third = await run(['capture', '360', 'room.mov', '--json'], env);
		expect(third.code).toBe(0);
		expect(third.json.uploads[0]).toMatchObject({ reused: true });
		expect(srv.log.filter((l) => l.includes('capture-upload'))).toEqual([]);
	});

	it('retries a failed part and signs again when a part URL is refused', async () => {
		writeFile(env, 'clip.mp4', PART_SIZE * 2 + 10);
		srv.hooks.putStatus = (n, attempt) => (n === 2 && attempt === 1 ? 403 : n === 3 && attempt === 1 ? 503 : 200);
		const r = await run(['capture', '360', 'clip.mp4', '--json'], env);
		expect(r.code).toBe(0);
		expect(srv.puts.filter((n) => n === 2)).toHaveLength(2);
		expect(srv.puts.filter((n) => n === 3)).toHaveLength(2);
		expect(srv.log.filter((l) => l === 'POST /api/capture-upload/sign').length).toBeGreaterThanOrEqual(2);
	}, 20_000);

	it('sends both files of a split-lens recording as one insv capture', async () => {
		writeFile(env, 'VID_1_00_001.insv', 1500);
		writeFile(env, 'VID_1_10_001.insv', 1600);
		const r = await run(['capture', '360', 'VID_1_00_001.insv', 'VID_1_10_001.insv', '--quality', 'preview', '--json'], env);
		expect(r.code).toBe(0);
		const body = srv.captureBodies[0];
		expect(body.source_kind).toBe('insv');
		expect(body.source_urls).toHaveLength(2);
		expect(body.source_url).toBe(body.source_urls[0]);
		expect(r.json.eta_seconds).toBe(900);
	});

	it('reports a failed reconstruction with the server reason and exit 1', async () => {
		writeFile(env, 'still.mp4', 500);
		srv.hooks.captureOutcome = 'failed';
		const r = await run(['capture', '360', 'still.mp4', '--wait', '--json'], env);
		expect(r.code).toBe(1);
		expect(r.json).toMatchObject({ status: 'failed', error: { code: 'too_few_poses' }, files: [] });
	});

	it('refuses proxies, mixed footage and trims on photos before touching the network', async () => {
		writeFile(env, 'LRV_001.lrv', 100);
		writeFile(env, 'a.mp4', 100);
		writeFile(env, 'b.jpg', 100);
		const lrv = await run(['capture', '360', 'LRV_001.lrv', '--json'], env);
		expect(lrv.code).toBe(2);
		expect(lrv.json.message).toMatch(/\.insv with the same name/);
		expect((await run(['capture', '360', 'a.mp4', 'b.jpg', '--json'], env)).code).toBe(2);
		const trim = await run(['capture', '360', 'b.jpg', 'b.jpg', 'b.jpg', '--trim-start', '2', '--json'], env);
		expect(trim.code).toBe(2);
		expect(trim.json.message).toMatch(/video only/);
		expect((await run(['capture', '360', 'a.mp4', '--quality', 'ultra', '--json'], env)).code).toBe(2);
		expect((await run(['capture', '360', 'a.mp4', '--trim-start', '9', '--trim-end', '4', '--json'], env)).code).toBe(2);
		expect(srv.log).toEqual([]);
	});

	it('maps file types to source kinds', () => {
		expect(classifyFile('x.MP4')).toMatchObject({ content_type: 'video/mp4', capture: 'equirect_video' });
		expect(classifyFile('x.insp')).toMatchObject({ capture: 'insp', scene: 'insp' });
		expect(captureKind(['a.jpg', 'b.png', 'c.exr'])).toBe('equirect_images');
		expect(() => captureKind(['a.insv', 'b.insv', 'c.insv'])).toThrow(/split-lens/);
		expect(() => captureKind(['a.jpg'])).toThrow(/capture scene/);
	});

	it('shows status, waits on an existing job and lists captures with absolute links', async () => {
		const status = await run(['capture', 'status', 'pcj_9xyz', '--json'], env);
		expect(status.code).toBe(0);
		expect(status.json).toEqual({ job_id: 'pcj_9xyz', status: 'running', stage: 'train', progress: 0.42 });

		const waited = await run(['capture', 'status', 'pcj_9xyz', '--wait', '--json'], env);
		expect(waited.code).toBe(0);
		expect(waited.json.status).toBe('succeeded');
		expect(fs.existsSync(path.join(env.home, 'capture-pcj9xyz', 'scene.spz'))).toBe(true);

		const list = await run(['capture', 'list', '--json'], env);
		expect(list.json.captures[0]).toMatchObject({ job_id: 'pcj_1abc', viewer_url: `${srv.origin}/viewer?src=x` });
	});

	it('turns a local .insp photo into a scene and saves the GLB and PLY', async () => {
		const { data } = writeFile(env, 'IMG_001.insp', PART_SIZE + 77);
		const r = await run(['capture', 'scene', 'IMG_001.insp', '--wait', '--out', 'room', '--json'], env);
		expect(r.code).toBe(0);
		expect(srv.sceneBodies[0]).toEqual({ image_url: expect.stringMatching(/\/storage\/object\//), source_kind: 'insp' });
		expect(Buffer.compare([...srv.objects.values()].find((o) => o.length === data.length), data)).toBe(0);
		expect(r.json).toMatchObject({ job_id: 'psj.signed.token', status: 'succeeded', source_kind: 'insp', result: { viewer_url: `${srv.origin}/viewer?src=g&title=360%20scene` } });
		expect(Buffer.compare(fs.readFileSync(path.join(env.home, 'room', 'scene.glb')), RESULT['scene.glb'])).toBe(0);
		expect(Buffer.compare(fs.readFileSync(path.join(env.home, 'room', 'scene.ply')), RESULT['room.ply'])).toBe(0);
	});

	it('passes an https photo URL straight to the scene lane', async () => {
		const r = await run(['capture', 'scene', 'https://example.org/pano.jpg', '--json'], env);
		expect(r.code).toBe(0);
		expect(srv.sceneBodies[0]).toEqual({ image_url: 'https://example.org/pano.jpg', source_kind: 'equirect_image' });
		expect(srv.log.filter((l) => l.includes('capture-upload'))).toEqual([]);
	});

	it('exits 3 when signed out and 6 with the server message when uploads are switched off', async () => {
		writeFile(env, 'a.mp4', 100);
		writeStore({ origin: srv.origin, auth: { type: 'apikey', key: 'sk_live_wrong_key_000000000000', prefix: 'sk_live_wron' } }, env);
		const denied = await run(['capture', 'list', '--json'], env);
		expect(denied.code).toBe(3);

		writeStore({ origin: srv.origin, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		srv.hooks.createError = {
			status: 503,
			body: { error: 'unconfigured', message: 'Large capture uploads are not available right now. Try again later.', hint: 'Object storage env is unset on this deployment.' },
		};
		const off = await run(['capture', '360', 'a.mp4', '--json'], env);
		expect(off.code).toBe(6);
		expect(off.json).toMatchObject({ error: 'unconfigured', message: expect.stringContaining('Large capture uploads are not available right now') });
	});

	it('signs in with THREE_WS_API_KEY when nothing is stored, as the sign-in hint promises', async () => {
		const keyOnly = tempEnv();
		keyOnly.vars.THREE_WS_API_KEY = KEY;
		const r = await run(['capture', 'list', '--json'], keyOnly);
		expect(r.code).toBe(0);
		expect(r.json).toHaveProperty('captures');
	});
});
