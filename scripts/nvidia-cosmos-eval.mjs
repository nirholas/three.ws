#!/usr/bin/env node
// Cosmos world-lane eval: the old hosted Text2World models against the current
// self-hosted Cosmos 3 Nano worker, on the same five prompts.
//
// Each prompt runs through the exact production code paths:
//   old  createNvidiaCosmosProvider().textToWorld() on each hosted predict1 route
//        (api/_providers/nvidia-cosmos.js), the rungs /api/cosmos used to serve;
//   new  submitWorld() + worldStatus() (api/_providers/cosmos-worker.js), the
//        first rung of api/_lib/cosmos-ladder.js, which also copies the finished
//        clip to R2.
// A route NVIDIA no longer serves is recorded with its HTTP status and lane
// code, never skipped silently or faked. Wall time is measured here from submit
// to a durable video URL; the worker's own phase timings (upsample, sample,
// encode) come from its task record. A mid-clip frame of every new world is
// extracted with ffmpeg for the side-by-side.
//
//   set -a; . ./.env.local; set +a          # NVIDIA_API_KEY, COSMOS_WORKER_URL/KEY, R2_*
//   node scripts/nvidia-cosmos-eval.mjs                  # run all five and write the report
//   node scripts/nvidia-cosmos-eval.mjs --report-only    # rebuild the report from the last run
//   node scripts/nvidia-cosmos-eval.mjs --resolution 480 --frames 61
//
// Results: data/evals/cosmos/runs/cosmos-<date>.json. Frames:
// docs/nvidia/evals/cosmos/<date>/. Report: docs/nvidia/evals/cosmos-<date>.md
// between the eval:begin / eval:end markers; prose outside the markers is kept.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DATE = process.env.EVAL_DATE || new Date().toISOString().slice(0, 10);
const RUN_PATH = join(ROOT, `data/evals/cosmos/runs/cosmos-${DATE}.json`);
const FRAME_DIR = join(ROOT, `docs/nvidia/evals/cosmos/${DATE}`);
const REPORT_PATH = join(ROOT, `docs/nvidia/evals/cosmos-${DATE}.md`);

const PROMPTS = [
	'a neon Tokyo street in the rain at night',
	'a windswept desert canyon at golden hour',
	'a bioluminescent forest at midnight',
	'a rooftop garden above a foggy city skyline',
	'a snowy mountain pass under aurora',
];
const SEED = 42;
const POLL_MS = 5000;
const JOB_DEADLINE_MS = 40 * 60_000;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};
const reportOnly = args.includes('--report-only');
const resolution = flag('resolution', '720');
const numFrames = Number(flag('frames', '121'));

// NVCF details have carried the account id; keep it out of committed results.
const redact = (s) => String(s || '').replace(/account '[^']*'/gi, "account '<redacted>'").slice(0, 240);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeHosted(prompt) {
	const { createNvidiaCosmosProvider, COSMOS_PREDICT1_7B_URL, COSMOS_PREDICT1_5B_URL } = await import(
		'../api/_providers/nvidia-cosmos.js'
	);
	const provider = createNvidiaCosmosProvider();
	const out = [];
	for (const [model, url] of [
		['cosmos-predict1-7b', COSMOS_PREDICT1_7B_URL],
		['cosmos-predict1-5b', COSMOS_PREDICT1_5B_URL],
	]) {
		const t0 = Date.now();
		try {
			const r = await provider.textToWorld({ prompt, seed: SEED, routes: [url] });
			out.push({ model, ok: true, submit_ms: Date.now() - t0, task_id: r.taskId || null, video_url: r.resultVideoUrl || null });
		} catch (err) {
			out.push({
				model,
				ok: false,
				submit_ms: Date.now() - t0,
				code: err?.code || 'error',
				http_status: err?.providerStatus ?? err?.status ?? null,
				detail: redact(err?.message),
			});
		}
	}
	return out;
}

async function runWorker(prompt) {
	const { submitWorld, worldStatus } = await import('../api/_providers/cosmos-worker.js');
	const t0 = Date.now();
	const { taskId } = await submitWorld({ mode: 'text', prompt, seed: SEED, resolution, numFrames });
	const jobId = `cw_${taskId}`;
	let last = null;
	let loadingSeen = false;
	while (Date.now() - t0 < JOB_DEADLINE_MS) {
		await sleep(POLL_MS);
		last = await worldStatus(jobId, taskId);
		if (last.status === 'queued' && last.detail === 'model loading') loadingSeen = true;
		process.stdout.write(`  ${jobId} ${last.status} ${last.step ?? ''}/${last.total_steps ?? ''}        \r`);
		if (last.status === 'failed' || (last.status === 'done' && last.video_url)) break;
	}
	const wall_s = (Date.now() - t0) / 1000;
	process.stdout.write('\n');
	if (last?.status !== 'done') {
		return { model: 'cosmos3-nano', ok: false, job_id: jobId, wall_s, status: last?.status, code: last?.error_code, detail: redact(last?.worker_error || last?.diagnostic) };
	}
	return {
		model: 'cosmos3-nano',
		ok: true,
		job_id: jobId,
		wall_s,
		cold_start: loadingSeen,
		video_url: last.video_url,
		timings: last.timings || null,
		upsampler: last.upsampler || null,
		fps: last.fps ?? null,
		num_frames: last.num_frames ?? numFrames,
		resolution: last.resolution ?? resolution,
	};
}

function extractFrame(videoUrl, index) {
	mkdirSync(FRAME_DIR, { recursive: true });
	const local = join(tmpdir(), `cosmos-eval-${process.pid}-${index}.mp4`);
	execFileSync('curl', ['-sSfL', '-o', local, videoUrl]);
	const probe = JSON.parse(
		execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,r_frame_rate:format=duration,size', '-of', 'json', local]).toString(),
	);
	const dest = join(FRAME_DIR, `${index + 1}.jpg`);
	const mid = Number(probe.format?.duration || 4) / 2;
	execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(mid), '-i', local, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', dest]);
	const s = probe.streams?.[0] || {};
	return {
		frame: `cosmos/${DATE}/${index + 1}.jpg`,
		video: { width: s.width, height: s.height, frames: Number(s.nb_frames) || null, duration_s: Number(Number(probe.format?.duration).toFixed(2)), bytes: Number(probe.format?.size) || null },
	};
}

function median(xs) {
	const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	if (!v.length) return null;
	const m = Math.floor(v.length / 2);
	return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');

function renderReport(run) {
	const rows = run.results;
	const warm = rows.filter((r) => r.new.ok && !r.new.cold_start);
	const lines = [];
	lines.push(`Run ${run.date}, seed ${run.seed}, ${run.resolution}p, ${run.num_frames} frames, worker GPU ${run.worker?.gpu_name || 'unknown'}, checkpoint revision \`${(run.worker?.revision || 'unknown').slice(0, 12)}\`.`);
	lines.push('');
	lines.push('| # | Prompt | Old: predict1-7b | Old: predict1-5b | New: Cosmos 3 Nano wall time | Sampling | Upsample | Encode | Frame |');
	lines.push('|---|---|---|---|---|---|---|---|---|');
	rows.forEach((r, i) => {
		const old = (o) => (o.ok ? `served (${f1(o.submit_ms / 1000)} s submit)` : `${o.http_status ?? '-'} ${o.code}`);
		const n = r.new;
		const t = n.timings || {};
		const wall = n.ok ? `${f1(n.wall_s)} s${n.cold_start ? ' (cold start)' : ''}` : `failed: ${n.code || n.status}`;
		const frame = r.frame ? `![${r.prompt}](${r.frame.frame})` : '';
		lines.push(`| ${i + 1} | ${r.prompt} | ${old(r.old[0])} | ${old(r.old[1])} | ${wall} | ${f1(t.sample_s)} s | ${f1(t.upsample_s)} s | ${f1(t.encode_s)} s | ${frame} |`);
	});
	lines.push('');
	lines.push(`New lane, warm runs (${warm.length} of ${rows.length}): median wall time ${f1(median(warm.map((r) => r.new.wall_s)))} s, median sampling ${f1(median(warm.map((r) => r.new.timings?.sample_s)))} s, median worker total ${f1(median(warm.map((r) => r.new.timings?.total_s)))} s.`);
	const cold = rows.find((r) => r.new.cold_start);
	if (cold) lines.push(`Cold start (first world after the instance scaled to zero): ${f1(cold.new.wall_s)} s wall time including the checkpoint load.`);
	lines.push(`Old lane: ${rows.every((r) => r.old.every((o) => !o.ok)) ? 'no hosted predict1 route served a single request on this account; every submit was refused before generation, so there is no old-model clip or time to measure.' : 'see the per-route columns.'}`);
	lines.push('');
	lines.push('Clips (R2):');
	lines.push('');
	rows.forEach((r, i) => {
		if (r.new.ok) lines.push(`${i + 1}. [${r.prompt}](${r.new.video_url}) (${r.frame?.video?.width}x${r.frame?.video?.height}, ${r.frame?.video?.frames ?? '?'} frames, ${f1((r.frame?.video?.bytes || 0) / 1e6)} MB)`);
	});
	return lines.join('\n');
}

function writeReport(run) {
	const body = renderReport(run);
	const begin = '<!-- eval:begin -->';
	const end = '<!-- eval:end -->';
	let doc = existsSync(REPORT_PATH)
		? readFileSync(REPORT_PATH, 'utf8')
		: `# Cosmos world lane: old versus new, ${DATE}\n\n${begin}\n${end}\n`;
	const a = doc.indexOf(begin);
	const b = doc.indexOf(end);
	if (a === -1 || b === -1) doc += `\n${begin}\n${end}\n`;
	const s = doc.indexOf(begin) + begin.length;
	doc = `${doc.slice(0, s)}\n${body}\n${doc.slice(doc.indexOf(end))}`;
	writeFileSync(REPORT_PATH, doc);
	console.log(`[cosmos-eval] report → ${REPORT_PATH}`);
}

async function workerHealth() {
	const res = await fetch(`${process.env.COSMOS_WORKER_URL.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(30_000) });
	const h = await res.json();
	return { gpu_name: h.gpu_name, revision: h.revision, load_seconds: h.load_seconds, ready: h.ready, upsampler: h.upsampler };
}

if (reportOnly) {
	writeReport(JSON.parse(readFileSync(RUN_PATH, 'utf8')));
	process.exit(0);
}

for (const k of ['NVIDIA_API_KEY', 'COSMOS_WORKER_URL', 'COSMOS_WORKER_KEY']) {
	if (!process.env[k]) {
		console.error(`[cosmos-eval] ${k} is not set; source the API env first`);
		process.exit(1);
	}
}

const run = { date: DATE, seed: SEED, resolution, num_frames: numFrames, worker: await workerHealth(), results: [] };
for (const [i, prompt] of PROMPTS.entries()) {
	console.log(`[cosmos-eval] ${i + 1}/${PROMPTS.length} ${prompt}`);
	const old = await probeHosted(prompt);
	for (const o of old) console.log(`  old ${o.model}: ${o.ok ? 'served' : `${o.http_status} ${o.code}`}`);
	const fresh = await runWorker(prompt);
	console.log(`  new cosmos3-nano: ${fresh.ok ? `${f1(fresh.wall_s)} s ${fresh.video_url}` : `failed ${fresh.code}`}`);
	const frame = fresh.ok ? extractFrame(fresh.video_url, i) : null;
	run.results.push({ prompt, old, new: fresh, frame });
	mkdirSync(join(ROOT, 'data/evals/cosmos/runs'), { recursive: true });
	writeFileSync(RUN_PATH, `${JSON.stringify(run, null, 2)}\n`);
}
run.worker = { ...run.worker, ...(await workerHealth()) };
writeFileSync(RUN_PATH, `${JSON.stringify(run, null, 2)}\n`);
writeReport(run);
