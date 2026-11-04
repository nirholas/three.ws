#!/usr/bin/env node
// Benchmark the MoMask backend of a model-text2motion worker against MDM on the
// same prompts. Sends real /infer requests, polls /tasks, downloads each
// AnimationClip JSON and checks every quaternion track is unit norm.
//
//   WORKER_KEY=... node workers/model-text2motion/scripts/benchmark-momask.mjs \
//     --url https://model-text2motion-...run.app [--models momask,mdm] [--runs 2]
//
// Run 1 on a cold container pays the checkpoint lazy-load, so the table reports
// the median of the warm runs (every run after the first). Nothing is deployed
// or written by this script.

import { fileURLToPath } from 'node:url';

export const PROMPTS = [
	'a person waves hello with the right hand',
	'a person walks forward and then turns around',
	'a person jumps up and lands on both feet',
	'a person kicks a ball with the right foot',
	'a person sits down on a chair and stands up again',
	'a person throws a punch with the left hand',
];

/** Largest deviation of any quaternion in a track from unit length. */
export function maxQuatNormError(values) {
	let worst = 0;
	for (let i = 0; i + 3 < values.length; i += 4) {
		const n = Math.hypot(values[i], values[i + 1], values[i + 2], values[i + 3]);
		worst = Math.max(worst, Math.abs(n - 1));
	}
	return worst;
}

/** Summarise an AnimationClip.toJSON() document: frames and quaternion health. */
export function analyseClip(clip, tolerance = 1e-3) {
	const tracks = Array.isArray(clip?.tracks) ? clip.tracks : [];
	const quat = tracks.filter((t) => t.type === 'quaternion');
	const frames = quat.length ? Math.max(...quat.map((t) => t.times.length)) : 0;
	const worst = quat.reduce((m, t) => Math.max(m, maxQuatNormError(t.values)), 0);
	return { tracks: tracks.length, quatTracks: quat.length, frames, worstNormError: worst, unitNorm: quat.length > 0 && worst <= tolerance };
}

export function median(xs) {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function renderTable(rows) {
	const head = ['model', 'prompt', 'frames', 'quat tracks', 'unit norm', 'worst err', 'cold ms', 'warm ms (median)'];
	const body = rows.map((r) => [
		r.model,
		r.prompt.slice(0, 40),
		r.frames,
		r.quatTracks,
		r.unitNorm ? 'yes' : 'NO',
		r.worstNormError.toExponential(2),
		r.coldMs,
		r.warmMs ?? '-',
	]);
	const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => String(b[i]).length)));
	const f = (c) => c.map((x, i) => String(x).padEnd(w[i])).join('  ').trimEnd();
	return [f(head), f(w.map((n) => '-'.repeat(n))), ...body.map(f)].join('\n');
}

async function call(url, key, path, init = {}) {
	const res = await fetch(`${url}${path}`, {
		...init,
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers || {}) },
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
	return res.json();
}

async function runOnce(url, key, model, prompt) {
	const t0 = Date.now();
	const { task_id } = await call(url, key, '/infer', { method: 'POST', body: JSON.stringify({ prompt, duration_seconds: 3, fps: 30, model }) });
	for (;;) {
		const t = await call(url, key, `/tasks/${task_id}`);
		if (t.status === 'failed' || t.status === 'error') throw new Error(`${model} task failed: ${t.error || t.status}`);
		if (t.result_url && (t.status === 'completed' || t.status === 'done' || t.status === 'succeeded')) {
			const clip = await (await fetch(t.result_url, { signal: AbortSignal.timeout(60_000) })).json();
			return { ms: Date.now() - t0, ...analyseClip(clip) };
		}
		if (Date.now() - t0 > 10 * 60_000) throw new Error(`${model} task ${task_id} timed out`);
		await new Promise((r) => setTimeout(r, 1500));
	}
}

async function main() {
	const argv = process.argv.slice(2);
	const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
	const url = (arg('--url') || process.env.WORKER_URL || '').replace(/\/$/, '');
	const key = process.env.WORKER_KEY || arg('--key');
	if (!url || !key) {
		console.error('usage: WORKER_KEY=... benchmark-momask.mjs --url <worker url> [--models momask,mdm] [--runs 2]');
		process.exit(2);
	}
	const models = arg('--models', 'momask,mdm').split(',');
	const runs = Math.max(2, Number(arg('--runs', '2')));
	const health = await call(url, key, '/health');
	console.log(`worker status=${health.status} models_loaded=${JSON.stringify(health.models_loaded)} available=${JSON.stringify(health.models_available)}`);
	const rows = [];
	let failed = false;
	for (const model of models) {
		if (health.models_available && !health.models_available.includes(model)) {
			console.error(`model ${model} is not available on this worker`);
			failed = true;
			continue;
		}
		for (const prompt of PROMPTS) {
			const results = [];
			for (let i = 0; i < runs; i++) results.push(await runOnce(url, key, model, prompt));
			const [cold, ...warm] = results;
			rows.push({ model, prompt, frames: cold.frames, quatTracks: cold.quatTracks, unitNorm: results.every((r) => r.unitNorm), worstNormError: Math.max(...results.map((r) => r.worstNormError)), coldMs: cold.ms, warmMs: median(warm.map((r) => r.ms)) });
			if (!rows.at(-1).unitNorm) failed = true;
		}
	}
	console.log(renderTable(rows));
	process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
