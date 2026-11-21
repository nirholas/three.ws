#!/usr/bin/env node
// A contract-C1 stand-in for the pano2splat worker, used only by the /capture
// 360 browser proof when the GPU worker is not deployed. It speaks the worker's
// HTTP side exactly as api/_lib/pano-capture.js calls it (POST /infer,
// GET and DELETE /tasks/:id, Bearer auth) and walks a task through the real
// stage names on a timer.
//
// What it does NOT do is reconstruct: the files it hands back are a real SPZ and
// a real PLY (valid 3DGS encodings that Spark renders) built from a real frame of
// a 360 video you point it at (a spherical shell of Gaussians coloured from the
// frame), plus a real H.264 preview clip and poster cut from the same video.
// Nothing here ships to production.
//
//   GCP_RECONSTRUCTION_KEY=<secret> PORT=3346 node scripts/capture-360-live-worker.mjs --video <360.mp4|webm>

import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const video = args.includes('--video') ? args[args.indexOf('--video') + 1] : null;
const KEY = String(process.env.GCP_RECONSTRUCTION_KEY || '').trim();
const PORT = Number(process.env.PORT || 3346);
const STAGE_SECONDS = Number(process.env.STAGE_SECONDS || 4);
if (!video || !existsSync(video) || !KEY) {
	process.stderr.write('usage: GCP_RECONSTRUCTION_KEY=<secret> capture-360-live-worker.mjs --video <file>\n');
	process.exit(2);
}

const W = 256;
const H = 128;
const dir = mkdtempSync(join(tmpdir(), 'c3-worker-'));

function ffmpeg(argv) {
	const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...argv], { maxBuffer: 1 << 28 });
	if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
	return r.stdout;
}

// A frame from the middle of the clip, as raw RGB.
const rgb = ffmpeg(['-ss', '5', '-i', video, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
if (rgb.length !== W * H * 3) throw new Error(`unexpected frame size ${rgb.length}`);
ffmpeg(['-ss', '5', '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', join(dir, 'poster.jpg')]);
ffmpeg(['-ss', '2', '-t', '6', '-i', video, '-vf', 'scale=640:-2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(dir, 'preview.mp4')]);

// ── a shell of Gaussians coloured from the frame ────────────────────────────
const N = W * H;
const R = 4;
const pos = new Float32Array(N * 3);
const col = new Float32Array(N * 3);
const scale = Math.log((Math.PI * R) / (W * 0.9));
for (let y = 0; y < H; y++) {
	for (let x = 0; x < W; x++) {
		const i = y * W + x;
		const lon = ((x + 0.5) / W) * 2 * Math.PI - Math.PI;
		const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
		pos[i * 3] = R * Math.cos(lat) * Math.sin(lon);
		pos[i * 3 + 1] = R * Math.sin(lat);
		pos[i * 3 + 2] = -R * Math.cos(lat) * Math.cos(lon);
		for (let c = 0; c < 3; c++) col[i * 3 + c] = rgb[i * 3 + c] / 255;
	}
}

const SH_C0 = 0.28209479177387814;
const logit = (p) => Math.log(p / (1 - p));

function buildPly() {
	const header = Buffer.from(
		['ply', 'format binary_little_endian 1.0', `element vertex ${N}`,
			...['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].map((p) => `property float ${p}`),
			'end_header\n'].join('\n'));
	const body = Buffer.alloc(N * 17 * 4);
	for (let i = 0; i < N; i++) {
		const f = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 0, 0, 0,
			(col[i * 3] - 0.5) / SH_C0, (col[i * 3 + 1] - 0.5) / SH_C0, (col[i * 3 + 2] - 0.5) / SH_C0,
			logit(0.95), scale, scale, scale - 2, 1, 0, 0, 0];
		for (let k = 0; k < 17; k++) body.writeFloatLE(f[k], (i * 17 + k) * 4);
	}
	return Buffer.concat([header, body]);
}

function buildSpz() {
	const fractionalBits = 12;
	const header = Buffer.alloc(16);
	header.writeUInt32LE(0x5053474e, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(N, 8);
	header.writeUInt8(0, 12);
	header.writeUInt8(fractionalBits, 13);
	const p = Buffer.alloc(N * 9);
	const a = Buffer.alloc(N);
	const c = Buffer.alloc(N * 3);
	const s = Buffer.alloc(N * 3);
	const r = Buffer.alloc(N * 3);
	for (let i = 0; i < N; i++) {
		for (let k = 0; k < 3; k++) {
			const v = Math.round(pos[i * 3 + k] * (1 << fractionalBits));
			const o = i * 9 + k * 3;
			p[o] = v & 0xff;
			p[o + 1] = (v >> 8) & 0xff;
			p[o + 2] = (v >> 16) & 0xff;
			c[i * 3 + k] = Math.max(0, Math.min(255, Math.round((((col[i * 3 + k] - 0.5) / SH_C0) * 0.15 + 0.5) * 255)));
		}
		a[i] = Math.round(0.95 * 255);
		s[i * 3] = Math.round((scale + 10) * 16);
		s[i * 3 + 1] = Math.round((scale + 10) * 16);
		s[i * 3 + 2] = Math.round((scale - 2 + 10) * 16);
		r[i * 3] = 128;
		r[i * 3 + 1] = 128;
		r[i * 3 + 2] = 128;
	}
	return gzipSync(Buffer.concat([header, p, a, c, s, r]));
}

const files = {
	'scene.ply': { data: buildPly(), type: 'application/octet-stream' },
	'scene.spz': { data: buildSpz(), type: 'application/octet-stream' },
	'preview.mp4': { data: readFileSync(join(dir, 'preview.mp4')), type: 'video/mp4' },
	'poster.jpg': { data: readFileSync(join(dir, 'poster.jpg')), type: 'image/jpeg' },
};

// ── the worker's HTTP side ──────────────────────────────────────────────────
const STAGES = ['download', 'stitch', 'frames', 'sfm', 'train', 'export'];
const tasks = new Map();

function view(t) {
	const elapsed = (Date.now() - t.startedAt) / 1000;
	if (t.cancelled) return { status: 'cancelled', stage: t.stage };
	const stages = t.job.source_kind === 'insv' || t.job.source_kind === 'insp' ? STAGES : STAGES.filter((s) => s !== 'stitch');
	const idx = Math.floor(elapsed / STAGE_SECONDS);
	if (elapsed < 0.5) return { status: 'queued', stage: 'queued', progress: 0 };
	if (idx >= stages.length) {
		return {
			status: 'succeeded', stage: 'upload', progress: 1,
			result: {
				ply_url: `${t.base}/files/scene.ply`, spz_url: `${t.base}/files/scene.spz`,
				preview_url: `${t.base}/files/preview.mp4`, poster_url: `${t.base}/files/poster.jpg`,
				stats: { gaussians: N, frames: 60 },
			},
		};
	}
	return { status: 'running', stage: stages[idx], progress: (elapsed % STAGE_SECONDS) / STAGE_SECONDS };
}

function readBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { resolve({}); } });
	});
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
		const f = files[url.pathname.slice(7)];
		if (!f) return json(res, 404, { error: 'not_found' });
		res.writeHead(200, { 'content-type': f.type, 'content-length': f.data.length, 'access-control-allow-origin': '*' });
		return res.end(f.data);
	}
	if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: 'unauthorized' });
	if (req.method === 'POST' && url.pathname === '/infer') {
		const job = await readBody(req);
		const id = randomUUID();
		tasks.set(id, { job, startedAt: Date.now(), base: `http://localhost:${PORT}`, cancelled: false, stage: 'queued' });
		process.stdout.write(`task ${id} ${job.source_kind} ${job.quality}${job.trim ? ` trim ${job.trim.start_s}-${job.trim.end_s}` : ''}\n`);
		return json(res, 200, { task_id: id });
	}
	const m = url.pathname.match(/^\/tasks\/([^/]+)$/);
	if (m) {
		const t = tasks.get(m[1]);
		if (!t) return json(res, 404, { error: 'task_not_found' });
		if (req.method === 'DELETE') { t.cancelled = true; return json(res, 200, { status: 'cancelled' }); }
		return json(res, 200, view(t));
	}
	json(res, 404, { error: 'not_found' });
}).listen(PORT, () => process.stdout.write(`capture-360 stand-in worker on :${PORT}, ${N} Gaussians from ${video}\n`));

