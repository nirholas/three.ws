#!/usr/bin/env node
// Mask parity between two rembg-service lanes on real photos: the current CPU
// service (ONNX Runtime in-process) and the Triton GPU lane.
//
//   API_KEY=... node scripts/rembg-triton-parity.mjs \
//     --a https://rembg-service-...run.app --b https://rembg-triton-...run.app \
//     [--images scripts/rembg-triton-images.txt] [--model rmbg2] [--out docs/nvidia-triton-parity.json]
//
// Every image is cut out by both lanes through the public contract (POST
// /remove, poll /tasks/:id, download result_url). The alpha channels are
// compared pixel for pixel: mean and max absolute difference (0-255), the
// share of pixels that moved by more than 8 levels, and the IoU of the binary
// masks at alpha >= 128. Exits 1 if any image misses the thresholds below,
// so it doubles as the pre-promotion gate.

import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { values: args } = parseArgs({
	options: {
		a: { type: 'string' },
		b: { type: 'string' },
		images: { type: 'string', default: 'scripts/rembg-triton-images.txt' },
		model: { type: 'string', default: 'rmbg2' },
		out: { type: 'string' },
		concurrency: { type: 'string', default: '4' },
	},
});

const API_KEY = process.env.API_KEY;
if (!args.a || !args.b || !API_KEY) {
	console.error('usage: API_KEY=... node scripts/rembg-triton-parity.mjs --a <cpu url> --b <triton url>');
	process.exit(2);
}

// GPU kernels (cuDNN) accumulate in a different order than the CPU provider,
// so soft edge pixels may shift a few levels; the subject mask must not.
const LIMITS = { minIou: 0.995, maxMean: 1.0, maxMovedShare: 0.005 };

const headers = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

async function cutout(base, image) {
	const submit = await fetch(`${base.replace(/\/$/, '')}/remove`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ image, model: args.model }),
	});
	if (submit.status !== 202) throw new Error(`${base} submit HTTP ${submit.status}: ${await submit.text()}`);
	const { task_id: id } = await submit.json();
	const deadline = Date.now() + 180_000;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 1000));
		const poll = await fetch(`${base.replace(/\/$/, '')}/tasks/${id}`, { headers });
		if (!poll.ok) continue;
		const task = await poll.json();
		if (task.status === 'failed') throw new Error(`${base} task failed: ${task.error}`);
		if (task.status === 'done') {
			const png = await fetch(task.result_url);
			if (!png.ok) throw new Error(`${task.result_url} HTTP ${png.status}`);
			return { buf: Buffer.from(await png.arrayBuffer()), elapsedMs: task.elapsed_ms, taskId: id };
		}
	}
	throw new Error(`${base} task ${id} did not finish in 180 s`);
}

async function alpha(buf) {
	const { data, info } = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

function compare(x, y) {
	if (x.width !== y.width || x.height !== y.height) {
		return { sizeMismatch: `${x.width}x${x.height} vs ${y.width}x${y.height}` };
	}
	let sum = 0, max = 0, moved = 0, inter = 0, union = 0;
	for (let i = 0; i < x.data.length; i++) {
		const d = Math.abs(x.data[i] - y.data[i]);
		sum += d;
		if (d > max) max = d;
		if (d > 8) moved++;
		const mx = x.data[i] >= 128, my = y.data[i] >= 128;
		if (mx && my) inter++;
		if (mx || my) union++;
	}
	return {
		mean: sum / x.data.length,
		max,
		movedShare: moved / x.data.length,
		iou: union ? inter / union : 1,
	};
}

const images = (await readFile(args.images, 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean);
const results = [];
let next = 0;

async function worker() {
	while (next < images.length) {
		const image = images[next++];
		const name = image.split('/').slice(-2).join('/');
		try {
			const [ra, rb] = await Promise.all([cutout(args.a, image), cutout(args.b, image)]);
			const stats = compare(await alpha(ra.buf), await alpha(rb.buf));
			const pass = !stats.sizeMismatch && stats.iou >= LIMITS.minIou && stats.mean <= LIMITS.maxMean &&
				stats.movedShare <= LIMITS.maxMovedShare;
			results.push({ image: name, pass, ...stats, cpuMs: ra.elapsedMs, gpuMs: rb.elapsedMs, gpuTask: rb.taskId });
			console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}  iou ${stats.iou?.toFixed(5)}  mean ${stats.mean?.toFixed(3)}  max ${stats.max}  moved ${(100 * (stats.movedShare || 0)).toFixed(3)}%  cpu ${ra.elapsedMs} ms  gpu ${rb.elapsedMs} ms`);
		} catch (err) {
			results.push({ image: name, pass: false, error: String(err.message || err) });
			console.log(`FAIL  ${name}  ${err.message || err}`);
		}
	}
}

await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
results.sort((p, q) => p.image.localeCompare(q.image));

const passed = results.filter((r) => r.pass).length;
const ok = results.filter((r) => !r.error && !r.sizeMismatch);
const agg = (k, fn) => fn(...ok.map((r) => r[k]));
const report = {
	generated_at: new Date().toISOString(),
	lanes: { a: args.a, b: args.b },
	model: args.model,
	limits: LIMITS,
	images: results.length,
	passed,
	worst_iou: agg('iou', Math.min),
	worst_mean: agg('mean', Math.max),
	worst_max: agg('max', Math.max),
	results,
};
if (args.out) await writeFile(args.out, JSON.stringify(report, null, 2) + '\n');
console.log(`\n${passed}/${results.length} images within limits; worst IoU ${report.worst_iou?.toFixed(5)}, worst mean diff ${report.worst_mean?.toFixed(3)}`);
process.exit(passed === results.length ? 0 : 1);
