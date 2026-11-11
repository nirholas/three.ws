#!/usr/bin/env node
/**
 * Measure on-device photo preparation against the production TRELLIS.2 lane.
 *
 * For every photo in --photos this:
 *   1. runs the REAL browser pipeline (src/forge-photo-prep/client.js, ONNX
 *      Runtime Web in a Web Worker) in headless Chromium against the dev server,
 *   2. sends three variants to the production TRELLIS.2 worker:
 *        original  the photo as the visitor picked it (today's flow)
 *        prepared  the on-device square crop, original pixels, opaque, so the
 *                  worker still runs its own BiRefNet matting
 *        cutout    the same crop with the on-device U²-Netp alpha, which the
 *                  worker uses as the mask instead of BiRefNet
 *   3. records upload bytes, on-device prep time and GPU time, downloads each
 *      GLB and renders it with scripts/render-glb-poster.mjs.
 *
 * Output: <out>/results.json plus per-photo files. docs/forge-photo-prep.md is
 * written from results.json.
 *
 * Usage (dev server on 3109, GCP spend pre-approved for this lane):
 *   TRELLIS2_URL=https://model-trellis2-…run.app \
 *   TRELLIS2_KEY="$(gcloud secrets versions access latest --secret avatar-reconstruction-key)" \
 *   node scripts/forge-photo-prep-bench.mjs --photos=docs/forge-photo-prep/photos --out=<dir> [--base=http://localhost:3109] [--only=name,name] [--skip-generate]
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const flags = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		return m ? [m[1], m[2] ?? true] : [a, true];
	}),
);
const base = flags.base || 'http://localhost:3109';
const photosDir = resolve(flags.photos || 'docs/forge-photo-prep/photos');
const outDir = resolve(flags.out || 'docs/forge-photo-prep/bench');
const only = flags.only ? new Set(String(flags.only).split(',')) : null;
const workerUrl = process.env.TRELLIS2_URL;
const workerKey = process.env.TRELLIS2_KEY;
const POLL_MS = 5000;
const JOB_DEADLINE_MS = 20 * 60 * 1000;

if (!flags['skip-generate'] && (!workerUrl || !workerKey)) {
	console.error('Set TRELLIS2_URL and TRELLIS2_KEY (see the header), or pass --skip-generate.');
	process.exit(2);
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const photos = readdirSync(photosDir)
	.filter((f) => MIME[extname(f).toLowerCase()])
	.filter((f) => !only || only.has(basename(f, extname(f))))
	.sort();

mkdirSync(outDir, { recursive: true });
const resultsPath = join(outDir, 'results.json');
const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : { photos: {} };
const save = () => writeFileSync(resultsPath, JSON.stringify(results, null, '\t') + '\n');

async function prepareAll() {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	page.on('console', (m) => {
		if (m.type() === 'error') console.error('[browser]', m.text());
	});
	await page.goto(`${base}/forge`, { waitUntil: 'domcontentloaded' });
	for (const f of photos) {
		const name = basename(f, extname(f));
		const dir = join(outDir, name);
		mkdirSync(dir, { recursive: true });
		const bytes = readFileSync(join(photosDir, f));
		const out = await page.evaluate(
			async ({ b64, type }) => {
				const { preparePhoto, photoPrepSupport } = await import('/src/forge-photo-prep/client.js');
				const support = await photoPrepSupport();
				const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				const file = new File([bin], 'photo', { type });
				const r = await preparePhoto(file, { provider: support.provider });
				const enc = async (blob) => {
					if (!blob) return null;
					const buf = new Uint8Array(await blob.arrayBuffer());
					let s = '';
					for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
					return { type: blob.type, b64: btoa(s) };
				};
				return { ...r, support, prepared: await enc(r.prepared), cutout: await enc(r.cutout) };
			},
			{ b64: bytes.toString('base64'), type: MIME[extname(f).toLowerCase()] },
		);
		const entry = (results.photos[name] ||= {});
		entry.source = f;
		entry.prep = {
			provider: out.provider,
			width: out.width,
			height: out.height,
			warnings: out.warnings.map((w) => w.code),
			metrics: out.metrics,
			plan: out.plan || null,
			timings: out.timings,
		};
		entry.variants = { original: { bytes: bytes.length, type: MIME[extname(f).toLowerCase()] } };
		writeFileSync(join(dir, 'original' + extname(f).toLowerCase()), bytes);
		for (const key of ['prepared', 'cutout']) {
			if (!out[key]) continue;
			const ext = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' }[out[key].type];
			const buf = Buffer.from(out[key].b64, 'base64');
			writeFileSync(join(dir, key + ext), buf);
			entry.variants[key] = { bytes: buf.length, type: out[key].type };
		}
		console.log(`prepared ${name}: ${out.timings.totalMs} ms on ${out.provider}, warnings [${entry.prep.warnings.join(', ')}]`);
		save();
	}
	await browser.close();
}

async function api(path, init = {}) {
	const res = await fetch(workerUrl + path, {
		...init,
		headers: { authorization: `Bearer ${workerKey}`, 'content-type': 'application/json', ...(init.headers || {}) },
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
	return body;
}

async function generate(name, key) {
	const entry = results.photos[name];
	const v = entry.variants[key];
	if (!v || v.glb) return;
	const ext = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' }[v.type];
	const file = join(outDir, name, key + ext);
	const dataUri = `data:${v.type};base64,${readFileSync(file).toString('base64')}`;
	const t0 = Date.now();
	const { task_id } = await api('/infer', { method: 'POST', body: JSON.stringify({ images: [dataUri], resolution: 1024, seed: 42 }) });
	let task;
	for (;;) {
		await new Promise((r) => setTimeout(r, POLL_MS));
		task = await api(`/tasks/${task_id}`);
		if (task.status === 'done' || task.status === 'succeeded' || task.status === 'failed' || task.status === 'error') break;
		if (Date.now() - t0 > JOB_DEADLINE_MS) throw new Error(`task ${task_id} still ${task.status} after 20 min`);
	}
	v.gpuMs = Date.now() - t0;
	v.task = { id: task_id, status: task.status, resolution_served: task.resolution_served, error: task.error || null };
	const url = task.result_url || task.result_gcs_url;
	if (!url || task.error) {
		console.log(`  ${name}/${key}: ${task.status} ${task.error || 'no result url'}`);
		save();
		return;
	}
	const glbPath = join(outDir, name, `${key}.glb`);
	if (url.startsWith('gs://')) execFileSync('gcloud', ['storage', 'cp', url, glbPath], { stdio: 'ignore' });
	else writeFileSync(glbPath, Buffer.from(await (await fetch(url)).arrayBuffer()));
	v.glb = basename(glbPath);
	v.glbBytes = readFileSync(glbPath).length;
	execFileSync('node', [join(here, 'render-glb-poster.mjs'), glbPath, join(outDir, name, `${key}-render.webp`), '--size=512'], { stdio: 'ignore' });
	v.render = `${key}-render.webp`;
	console.log(`  ${name}/${key}: ${(v.gpuMs / 1000).toFixed(0)} s, ${v.bytes} B upload`);
	save();
}

await prepareAll();
if (!flags['skip-generate']) {
	for (const f of photos) {
		const name = basename(f, extname(f));
		for (const key of ['original', 'prepared', 'cutout']) {
			try {
				await generate(name, key);
			} catch (err) {
				console.error(`  ${name}/${key} failed: ${err.message}`);
			}
		}
	}
}
save();
console.log(`results → ${resultsPath}`);
