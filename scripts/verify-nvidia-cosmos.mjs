#!/usr/bin/env node
// Live verification for the /api/cosmos world lane, rung by rung.
//
//   node scripts/verify-nvidia-cosmos.mjs                          # probe every rung, render one text world
//   node scripts/verify-nvidia-cosmos.mjs "a koi pond at dawn"     # custom prompt
//   node scripts/verify-nvidia-cosmos.mjs --mode image --image still.jpg
//   node scripts/verify-nvidia-cosmos.mjs --mode depth --video depth.webm
//   node scripts/verify-nvidia-cosmos.mjs --probe-only             # rung health only, no generation
//   node scripts/verify-nvidia-cosmos.mjs --out world.mp4          # also save the clip
//
// Walks the ladder in api/_lib/cosmos-ladder.js with the real provider code:
//   cosmos3-nano        GET /health on the self-hosted worker (ready, GPU, revision)
//   cosmos-predict1-*   an authenticated hosted Text2World submit (NVIDIA retires a
//                       model behind a gateway path that still answers, so only a
//                       submit tells whether this account can reach it)
// then renders one world end to end through submitToLadder + pollLadderJob,
// which includes the R2 copy, and checks the MP4 decodes (ftyp box, size).
//
// Needs the API env: COSMOS_WORKER_URL/KEY, NVIDIA_API_KEY, R2_* (from
// .env.local or the shell). Upstream details are printed with any account id
// redacted.

import { config as dotenv } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

dotenv({ path: new URL('../.env.local', import.meta.url) });
// .env.local can carry prod flags; clear them so nothing fails closed locally.
delete process.env.NODE_ENV;
delete process.env.VERCEL_ENV;

const args = process.argv.slice(2);
const valueFlags = new Set(['--mode', '--image', '--video', '--out', '--resolution', '--frames']);
const flag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? null : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));
const mode = flag('mode') || 'text';
const prompt = positional.join(' ') || 'a serene alpine lake at sunrise, mist drifting over the water, cinematic';
const redact = (s) => String(s || '').replace(/account '[^']*'/gi, "account '<redacted>'").slice(0, 300);

const { RUNGS, submitToLadder, pollLadderJob } = await import('../api/_lib/cosmos-ladder.js');
const { createNvidiaCosmosProvider, COSMOS_PREDICT1_7B_URL, COSMOS_PREDICT1_5B_URL } = await import(
	'../api/_providers/nvidia-cosmos.js'
);

async function probeWorker() {
	const base = (process.env.COSMOS_WORKER_URL || '').replace(/\/+$/, '');
	if (!base) return 'not configured (COSMOS_WORKER_URL unset)';
	try {
		const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(30_000) });
		const h = await res.json();
		if (h.load_error) return `DOWN ${res.status}: ${h.load_error}`;
		if (!h.ready) return `loading (attempt ${h.load_attempts}); a submit now waits for the model`;
		return `READY on ${h.gpu_name}, loaded in ${h.load_seconds}s, revision ${String(h.revision).slice(0, 12)}, modes ${h.modes.join('/')}, queue ${h.queue_depth}`;
	} catch (err) {
		return `unreachable: ${err?.message}`;
	}
}

async function probeHosted(url) {
	if (!process.env.NVIDIA_API_KEY) return 'not configured (NVIDIA_API_KEY unset)';
	try {
		const r = await createNvidiaCosmosProvider().textToWorld({ prompt: 'a quiet harbor at dawn', routes: [url] });
		return r.resultVideoUrl ? 'SERVED synchronously' : `SERVING (accepted request ${r.taskId})`;
	} catch (err) {
		return `${err?.code || 'error'} (HTTP ${err?.providerStatus ?? err?.status ?? '-'}): ${redact(err?.message)}`;
	}
}

console.log('[cosmos] ladder:');
const probes = {
	'cosmos3-nano': await probeWorker(),
	'cosmos-predict1-7b': await probeHosted(COSMOS_PREDICT1_7B_URL),
	'cosmos-predict1-5b': await probeHosted(COSMOS_PREDICT1_5B_URL),
};
for (const rung of RUNGS) console.log(`  ${rung.id.padEnd(20)} ${probes[rung.id]}`);
if (args.includes('--probe-only')) process.exit(0);

function dataUrl(path, kind) {
	const ext = extname(path).slice(1).toLowerCase();
	const type = kind === 'image' ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : `video/${ext}`;
	return `data:${type};base64,${readFileSync(path).toString('base64')}`;
}

const req = { mode, prompt };
if (flag('resolution')) req.resolution = flag('resolution');
if (flag('frames')) req.numFrames = Number(flag('frames'));
if (mode === 'image') {
	if (!flag('image')) throw new Error('--mode image needs --image <png|jpg|webp>');
	req.image = dataUrl(flag('image'), 'image');
}
if (mode === 'depth' || mode === 'edge') {
	if (!flag('video')) throw new Error(`--mode ${mode} needs --video <webm|mp4>`);
	req.controlVideo = dataUrl(flag('video'), 'video');
}

console.log(`[cosmos] ${mode} world: ${prompt}`);
const t0 = Date.now();
const start = await submitToLadder(req);
let videoUrl = start.videoUrl || null;
if (!start.done) {
	console.log(`[cosmos] ${start.rung.id} accepted ${start.jobId} (queue ${start.queuePosition ?? '-'})`);
	const deadline = t0 + 40 * 60_000;
	let last = '';
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 5000));
		const job = await pollLadderJob(start.jobId);
		const line = `${job.status}${job.detail && job.status === 'queued' ? ` (${job.detail})` : ''}${job.step != null ? ` step ${job.step}/${job.total_steps}` : ''}`;
		if (line !== last) console.log(`  ${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s ${line}`);
		last = line;
		if (job.status === 'failed') {
			console.error(`[cosmos] FAIL ${job.error_code}: ${redact(job.worker_error || job.diagnostic)}`);
			process.exit(2);
		}
		if (job.status === 'done' && job.video_url) {
			videoUrl = job.video_url;
			if (job.timings) console.log(`[cosmos] worker timings: ${JSON.stringify(job.timings)}`);
			break;
		}
	}
}
if (!videoUrl) {
	console.error('[cosmos] FAIL: no video after 40 minutes');
	process.exit(2);
}

const bytes = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
// MP4 files begin with an `ftyp` box; the type tag sits at bytes 4-8.
const looksMp4 = bytes.length > 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
const wall = ((Date.now() - t0) / 1000).toFixed(1);
if (!looksMp4) {
	console.error(`[cosmos] FAIL: ${videoUrl} is not an MP4 (${bytes.length} bytes)`);
	process.exit(2);
}
console.log(`[cosmos] PASS ${start.rung.id} ${mode}: ${(bytes.length / 1e6).toFixed(2)} MB in ${wall}s → ${videoUrl}`);
if (flag('out')) {
	writeFileSync(flag('out'), bytes);
	console.log(`[cosmos] wrote ${flag('out')}`);
}
