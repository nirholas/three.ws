#!/usr/bin/env node
// Reference-image eval for text-to-3D: does Grok Imagine make better forge
// reference images than the lane production serves today?
//
// For every prompt in data/evals/ref-image-prompts.json and every provider asked
// for, this runs the real production path end to end:
//
//   1. generateReferenceImage() from api/_lib/forge-reference-image.js, with
//      FORGE_REF_IMAGE_PROVIDER unset (baseline: whatever production serves) or
//      set to xai (Grok Imagine first, same composition instruction).
//   2. The self-hosted TRELLIS image-to-3D lane (workers/model-trellis) on that
//      image, with the standard tier's quality and background matting, exactly
//      as api/forge.js submits it.
//   3. /api/render/glb on the resulting GLB.
//
// It scores each result objectively (clean uniform background, one connected
// subject, centered with a sane fill, GLB triangle count and watertightness,
// render success), then, once both providers have a result for a prompt, asks a
// blind pairwise vision judge (the repo's free vision chain: NVIDIA Nemotron VL
// first, never Grok) which side is the better 3D asset. Sides are shuffled per
// prompt by a hash, so the judge cannot learn a position.
//
// Results land in data/evals/ref-image-results.json (resumable: a finished row
// is skipped unless --force or --retry-failed); the write-up is regenerated into
// docs/evals/grok-imagine-ref-image.md with six side-by-side images in
// docs/evals/img/. Raw images and renders are cached in .cache/ (gitignored).
//
//   npm run grok:eval-ref-image -- --prod-env                       baseline, all 40
//   npm run grok:eval-ref-image -- --prod-env --providers xai       add the xAI column
//   npm run grok:eval-ref-image -- --prod-env --only props-01,hard-05 --force
//   npm run grok:eval-ref-image -- --report-only                    rebuild the doc
//
// --providers     baseline,xai subset (default baseline)
// --only          comma-separated prompt ids
// --limit N       first N prompts after --only filtering
// --concurrency N prompts in flight per provider (1 to 6, default 3)
// --force         rerun finished rows; --retry-failed reruns rows with an error
// --no-judge      skip the pairwise judge
// --report-only   do not generate anything, rebuild the report from results
// --render-base   origin serving /api/render/glb (default https://three.ws)
// --prod-env      read the image, storage, TRELLIS, vision and xAI env from the
//                 three-ws-api Cloud Run service into this process only. The
//                 database and Redis are deliberately not loaded, so the eval
//                 never writes production usage rows or cooldown keys.
//
// Exit codes: 0 ok; 1 a stage failed for every row; 2 usage or setup error.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS_FILE = join(ROOT, 'data/evals/ref-image-prompts.json');
const RESULTS_FILE = join(ROOT, 'data/evals/ref-image-results.json');
const REPORT_FILE = join(ROOT, 'docs/evals/grok-imagine-ref-image.md');
const IMG_DIR = join(ROOT, 'docs/evals/img');
const CACHE_DIR = join(ROOT, '.cache/grok-eval-ref-image');
const PROVIDERS = ['baseline', 'xai'];
const PROVIDER_LABEL = { baseline: 'Production lane (baseline)', xai: 'Grok Imagine' };

// Everything the reference, persistence, TRELLIS, vision and xAI paths read.
// DATABASE_URL, REDIS_* and KV_* are left out on purpose.
const ENV_WANTED =
	/^(NVIDIA_|NIM_|HF_TOKEN$|S3_|R2_|STORAGE_|APP_ORIGIN$|PUBLIC_APP_ORIGIN$|GOOGLE_CLOUD_|GCP_RECONSTRUCTION_KEY$|GCP_REMBG_URL$|GCP_SERVICE_ACCOUNT_JSON$|MODEL_TRELLIS_URL$|VERTEX_|TEXT_TO_IMAGE_|REPLICATE_|GROK_API_KEY$|XAI_|OPENROUTER_|CLOUDFLARE_ACCOUNT_ID$|CLOUDFLARE_AI_|OPENAI_API_KEY$|FORGE_REFERENCE_)/;

const TRELLIS_POLL_MS = 5_000;
const TRELLIS_TIMEOUT_MS = 10 * 60_000;
const RENDER_SIZE = 512;
const RENDER_TIMEOUT_MS = 120_000;
// xAI bills in ticks: 1 cent = 100,000,000 ticks, so 1 USD = 1e10 ticks.
const TICKS_PER_USD = 1e10;

// Objective score weights (sum 100). Image-side checks predict whether TRELLIS
// gets a clean single subject; mesh and render checks are the outcome.
const WEIGHTS = { bgClean: 15, singleSubject: 20, centered: 10, saneFill: 10, notCropped: 5, mesh: 15, closed: 10, render: 15 };
// A TRELLIS mesh with under 1% open edges reads as closed in practice; a
// strict zero-boundary test is reported alongside.
const CLOSED_BOUNDARY_RATIO = 0.01;

function usage(msg) {
	if (msg) console.error(`grok-eval-ref-image: ${msg}`);
	console.error(
		'Usage: npm run grok:eval-ref-image -- [--prod-env] [--providers baseline,xai] [--only ids] [--limit N] [--concurrency N] [--force] [--retry-failed] [--no-judge] [--report-only] [--render-base URL]',
	);
	process.exit(2);
}

function parseArgs(argv) {
	const out = {
		prodEnv: false,
		providers: ['baseline'],
		only: null,
		limit: null,
		concurrency: 3,
		force: false,
		retryFailed: false,
		judge: true,
		reportOnly: false,
		renderBase: 'https://three.ws',
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => (i + 1 < argv.length ? argv[++i] : usage(`${a} needs a value`));
		if (a === '--prod-env') out.prodEnv = true;
		else if (a === '--providers') out.providers = next().split(',').map((s) => s.trim()).filter(Boolean);
		else if (a === '--only') out.only = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
		else if (a === '--limit') out.limit = Number(next());
		else if (a === '--concurrency') out.concurrency = Number(next());
		else if (a === '--force') out.force = true;
		else if (a === '--retry-failed') out.retryFailed = true;
		else if (a === '--no-judge') out.judge = false;
		else if (a === '--report-only') out.reportOnly = true;
		else if (a === '--render-base') out.renderBase = next().replace(/\/+$/, '');
		else usage(`unknown argument ${a}`);
	}
	for (const p of out.providers) if (!PROVIDERS.includes(p)) usage(`unknown provider ${p} (use ${PROVIDERS.join(', ')})`);
	if (out.limit !== null && (!Number.isInteger(out.limit) || out.limit < 1)) usage('--limit must be a positive integer');
	if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 6) usage('--concurrency must be 1 to 6');
	if (!/^https?:\/\//.test(out.renderBase)) usage('--render-base must be an http(s) origin');
	return out;
}

const hash32 = (s) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16);
const seedFor = (id) => hash32(`seed:${id}`) % 2 ** 31;
const median = (xs) => {
	const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	if (!v.length) return null;
	const m = Math.floor(v.length / 2);
	return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const mean = (xs) => {
	const v = xs.filter((x) => Number.isFinite(x));
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const secs = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : 'n/a');
const errText = (e) => String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300);

function loadResults() {
	if (!existsSync(RESULTS_FILE)) return { rows: {}, judgments: {}, runs: [] };
	const data = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
	return { rows: data.rows || {}, judgments: data.judgments || {}, runs: data.runs || [] };
}

function saveResults(results) {
	const sorted = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
	const body = {
		description:
			'Per-prompt results of scripts/grok-eval-ref-image.mjs. Rows are keyed provider:promptId; judgments are keyed promptId. Written by the harness, do not edit by hand.',
		rows: sorted(results.rows),
		judgments: sorted(results.judgments),
		runs: results.runs,
	};
	const tmp = `${RESULTS_FILE}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(body, null, '\t')}\n`);
	renameSync(tmp, RESULTS_FILE);
}

function gitSha() {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

async function readImageRef(url) {
	if (url.startsWith('data:')) {
		const comma = url.indexOf(',');
		return Buffer.from(url.slice(comma + 1), 'base64');
	}
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!res.ok) throw new Error(`image download ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

// ── Image metrics ────────────────────────────────────────────────────────────
// Downscaled to a 256px grid: the median border color is the background, any
// pixel far from it is foreground, and 4-connected components of the foreground
// tell one subject from several.
const GRID = 256;
const BORDER = 6;
const BG_NEAR = 28;
const FG_FAR = 48;

export async function analyzeReferenceImage(buf) {
	const { data } = await sharp(buf)
		.flatten({ background: '#ffffff' })
		.resize(GRID, GRID, { fit: 'fill' })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const px = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
	const border = [];
	for (let y = 0; y < GRID; y++)
		for (let x = 0; x < GRID; x++)
			if (x < BORDER || y < BORDER || x >= GRID - BORDER || y >= GRID - BORDER) border.push(px(y * GRID + x));
	const bg = [0, 1, 2].map((c) => median(border.map((p) => p[c])));
	const dist = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);
	const bgUniformity = border.filter((p) => dist(p) <= BG_NEAR).length / border.length;

	const mask = new Uint8Array(GRID * GRID);
	for (let i = 0; i < mask.length; i++) mask[i] = dist(px(i)) > FG_FAR ? 1 : 0;
	const label = new Int32Array(GRID * GRID).fill(-1);
	const comps = [];
	const stack = new Int32Array(GRID * GRID);
	for (let start = 0; start < mask.length; start++) {
		if (!mask[start] || label[start] !== -1) continue;
		const id = comps.length;
		let top = 0;
		let area = 0;
		stack[top++] = start;
		label[start] = id;
		while (top) {
			const i = stack[--top];
			area++;
			const x = i % GRID;
			const y = (i - x) / GRID;
			const nb = [x > 0 ? i - 1 : -1, x < GRID - 1 ? i + 1 : -1, y > 0 ? i - GRID : -1, y < GRID - 1 ? i + GRID : -1];
			for (const j of nb) {
				if (j >= 0 && mask[j] && label[j] === -1) {
					label[j] = id;
					stack[top++] = j;
				}
			}
		}
		comps.push(area);
	}
	const minArea = GRID * GRID * 0.002;
	const significant = new Set(comps.map((a, i) => (a >= minArea ? i : -1)).filter((i) => i >= 0));
	const fgTotal = [...significant].reduce((s, i) => s + comps[i], 0);
	if (!fgTotal) {
		return { bgColor: bg.map(Math.round), bgUniformity: round(bgUniformity, 3), components: 0, mainShare: 0, centroidOffset: null, fillArea: 0, extent: 0, cropped: false, checks: { bgClean: bgUniformity >= 0.9, singleSubject: false, centered: false, saneFill: false, notCropped: false } };
	}
	let minX = GRID, minY = GRID, maxX = -1, maxY = -1, sx = 0, sy = 0;
	for (let i = 0; i < label.length; i++) {
		if (!significant.has(label[i])) continue;
		const x = i % GRID;
		const y = (i - x) / GRID;
		sx += x;
		sy += y;
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	const half = GRID / 2;
	const centroidOffset = Math.hypot((sx / fgTotal - half) / half, (sy / fgTotal - half) / half);
	const bboxCx = (minX + maxX) / 2;
	const bboxCy = (minY + maxY) / 2;
	const bboxOffset = Math.hypot((bboxCx - half) / half, (bboxCy - half) / half);
	const extent = Math.max(maxX - minX + 1, maxY - minY + 1) / GRID;
	const mainShare = Math.max(...[...significant].map((i) => comps[i])) / fgTotal;
	const cropped = minX <= 1 || minY <= 1 || maxX >= GRID - 2 || maxY >= GRID - 2;
	return {
		bgColor: bg.map(Math.round),
		bgUniformity: round(bgUniformity, 3),
		components: significant.size,
		mainShare: round(mainShare, 3),
		centroidOffset: round(centroidOffset, 3),
		bboxOffset: round(bboxOffset, 3),
		fillArea: round(fgTotal / (GRID * GRID), 3),
		extent: round(extent, 3),
		cropped,
		checks: {
			bgClean: bgUniformity >= 0.9,
			singleSubject: mainShare >= 0.92,
			centered: bboxOffset <= 0.12,
			saneFill: extent >= 0.45 && extent <= 0.95,
			notCropped: !cropped,
		},
	};
}

function round(n, d) {
	const f = 10 ** d;
	return Math.round(n * f) / f;
}

// ── GLB metrics ──────────────────────────────────────────────────────────────
let gltfIo = null;
async function getGltfIo() {
	if (gltfIo) return gltfIo;
	const { NodeIO } = await import('@gltf-transform/core');
	const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
	const { MeshoptDecoder } = await import('meshoptimizer');
	const draco3d = (await import('draco3dgltf')).default;
	await MeshoptDecoder.ready;
	gltfIo = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
		'meshopt.decoder': MeshoptDecoder,
		'draco3d.decoder': await draco3d.createDecoderModule(),
	});
	return gltfIo;
}

function applyMat4(m, x, y, z) {
	return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

// Triangle count, plus watertightness from welded edges: positions are welded
// on a grid of 1e-5 of the bounding-box diagonal (TRELLIS splits vertices at UV
// seams), then every undirected edge is counted. An edge used once is a hole
// boundary; used three or more times it is non-manifold.
export async function analyzeGlb(buf) {
	const io = await getGltfIo();
	const doc = await io.readBinary(new Uint8Array(buf));
	const tris = [];
	const positions = [];
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh();
		if (!mesh) continue;
		const m = node.getWorldMatrix();
		for (const prim of mesh.listPrimitives()) {
			if (prim.getMode() !== 4) continue;
			const pos = prim.getAttribute('POSITION');
			if (!pos) continue;
			const base = positions.length;
			for (let i = 0; i < pos.getCount(); i++) {
				const [x, y, z] = pos.getElement(i, []);
				positions.push(applyMat4(m, x, y, z));
			}
			const idx = prim.getIndices();
			const n = idx ? idx.getCount() : pos.getCount();
			for (let i = 0; i + 2 < n; i += 3) {
				tris.push(base + (idx ? idx.getScalar(i) : i), base + (idx ? idx.getScalar(i + 1) : i + 1), base + (idx ? idx.getScalar(i + 2) : i + 2));
			}
		}
	}
	const triangles = tris.length / 3;
	if (!triangles) return { triangles: 0, vertices: 0, boundaryEdges: null, nonManifoldEdges: null, edges: 0, boundaryRatio: null, watertight: false, closed: false };
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (const p of positions) for (let c = 0; c < 3; c++) {
		if (p[c] < lo[c]) lo[c] = p[c];
		if (p[c] > hi[c]) hi[c] = p[c];
	}
	const q = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1e-5 || 1e-9;
	const weld = new Map();
	const remap = new Int32Array(positions.length);
	positions.forEach((p, i) => {
		const key = `${Math.round(p[0] / q)},${Math.round(p[1] / q)},${Math.round(p[2] / q)}`;
		let id = weld.get(key);
		if (id === undefined) {
			id = weld.size;
			weld.set(key, id);
		}
		remap[i] = id;
	});
	const V = weld.size;
	const edges = new Map();
	const addEdge = (a, b) => {
		if (a === b) return;
		const k = a < b ? a * V + b : b * V + a;
		edges.set(k, (edges.get(k) || 0) + 1);
	};
	for (let t = 0; t < tris.length; t += 3) {
		const a = remap[tris[t]];
		const b = remap[tris[t + 1]];
		const c = remap[tris[t + 2]];
		if (a === b || b === c || a === c) continue;
		addEdge(a, b);
		addEdge(b, c);
		addEdge(c, a);
	}
	let boundaryEdges = 0;
	let nonManifoldEdges = 0;
	for (const n of edges.values()) {
		if (n === 1) boundaryEdges++;
		else if (n > 2) nonManifoldEdges++;
	}
	const boundaryRatio = edges.size ? boundaryEdges / edges.size : null;
	return {
		triangles,
		vertices: V,
		edges: edges.size,
		boundaryEdges,
		nonManifoldEdges,
		boundaryRatio: boundaryRatio === null ? null : round(boundaryRatio, 5),
		watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
		closed: boundaryRatio !== null && boundaryRatio < CLOSED_BOUNDARY_RATIO,
	};
}

export function objectiveScore(row) {
	const c = row.image?.checks || {};
	const parts = {
		bgClean: !!c.bgClean,
		singleSubject: !!c.singleSubject,
		centered: !!c.centered,
		saneFill: !!c.saneFill,
		notCropped: !!c.notCropped,
		mesh: !!row.mesh?.ok,
		closed: !!row.mesh?.metrics?.closed,
		render: !!row.render?.ok,
	};
	return Object.entries(parts).reduce((s, [k, v]) => s + (v ? WEIGHTS[k] : 0), 0);
}

// ── Pipeline stages ──────────────────────────────────────────────────────────
const costScope = new AsyncLocalStorage();

function installXaiCostMeter(xaiUrl) {
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const res = await realFetch(url, init);
		const scope = costScope.getStore();
		if (scope && String(url) === xaiUrl) {
			scope.xaiCalls++;
			if (res.ok) {
				const body = await res.clone().json().catch(() => null);
				const ticks = Number(body?.usage?.cost_in_usd_ticks);
				if (Number.isFinite(ticks)) scope.xaiTicks += ticks;
			}
		}
		return res;
	};
}

async function stageReference(mods, provider, item) {
	const scope = { xaiCalls: 0, xaiTicks: 0 };
	const startedAt = Date.now();
	const out = await costScope.run(scope, () =>
		mods.generateReferenceImage(item.prompt, { aspectRatio: '1:1', seed: seedFor(item.id) }),
	);
	const latencyMs = Date.now() - startedAt;
	const costUsd = provider === 'xai' ? scope.xaiTicks / TICKS_PER_USD : null;
	return { out, latencyMs, xaiCalls: scope.xaiCalls, costUsd };
}

async function stageMesh(mods, imageUrl, seed) {
	const startedAt = Date.now();
	const regen = mods.createRegenProvider();
	const job = await regen.submit({
		mode: 'trellis',
		sourceUrl: imageUrl,
		params: { images: [imageUrl], seed, quality: mods.selfhostQualityForTier('standard'), matte: true },
	});
	let last = null;
	while (Date.now() - startedAt < TRELLIS_TIMEOUT_MS) {
		await new Promise((r) => setTimeout(r, TRELLIS_POLL_MS));
		last = await regen.status(job.extJobId);
		if (last.status === 'done') return { glbUrl: last.resultGlbUrl, latencyMs: Date.now() - startedAt };
		if (last.status === 'failed') throw new Error(`trellis failed: ${last.error || 'no reason given'}`);
	}
	throw new Error(`trellis timed out after ${TRELLIS_TIMEOUT_MS / 60_000} min (last status ${last?.status})`);
}

function publicGlbUrl(url) {
	const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(url || '');
	return m ? `https://storage.googleapis.com/${m[1]}/${m[2]}` : url;
}

async function stageRender(renderBase, glbUrl) {
	const startedAt = Date.now();
	for (let attempt = 1; attempt <= 6; attempt++) {
		const res = await fetch(`${renderBase}/api/render/glb`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ glbUrl, width: RENDER_SIZE, height: RENDER_SIZE, background: '#ffffff' }),
			signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
		});
		if (res.status === 429) {
			const wait = Math.min(180, Number(res.headers.get('retry-after')) || 60);
			console.log(`  render rate limited, waiting ${wait}s (attempt ${attempt})`);
			await new Promise((r) => setTimeout(r, wait * 1000));
			continue;
		}
		if (!res.ok) throw new Error(`render ${res.status}: ${(await res.text()).slice(0, 200)}`);
		return { png: Buffer.from(await res.arrayBuffer()), latencyMs: Date.now() - startedAt };
	}
	throw new Error('render still rate limited after 6 attempts');
}

async function runRow(mods, opts, provider, item) {
	const row = { provider, id: item.id, category: item.category, prompt: item.prompt, seed: seedFor(item.id), ranAt: new Date().toISOString() };
	const dir = join(CACHE_DIR, provider);
	mkdirSync(dir, { recursive: true });

	try {
		const ref = await stageReference(mods, provider, item);
		const lane = ref.out.lane || null;
		row.reference = { ok: true, lane, model: ref.out.model || null, latencyMs: ref.latencyMs, imageUrl: ref.out.imageUrl.startsWith('data:') ? 'inline' : ref.out.imageUrl, xaiCalls: ref.xaiCalls, costUsd: ref.costUsd };
		if (provider === 'xai' && !String(lane).startsWith('xai-reference')) {
			row.reference.ok = false;
			row.reference.error = `xai lane did not serve (lane=${lane}); see the fall-through log above`;
		}
		const bytes = await readImageRef(ref.out.imageUrl);
		const refPath = join(dir, `${item.id}.ref.png`);
		await sharp(bytes).png().toFile(refPath);
		row.reference.path = relative(ROOT, refPath);
		row.image = await analyzeReferenceImage(bytes);
		if (!row.reference.ok) throw new Error(row.reference.error);

		row.mesh = { ok: false };
		try {
			const mesh = await stageMesh(mods, ref.out.imageUrl, row.seed);
			const glbUrl = publicGlbUrl(mesh.glbUrl);
			row.mesh = { ok: true, glbUrl, latencyMs: mesh.latencyMs };
			const glb = await readImageRef(glbUrl);
			row.mesh.bytes = glb.length;
			row.mesh.metrics = await analyzeGlb(glb);
		} catch (err) {
			row.mesh = { ok: false, error: errText(err), glbUrl: row.mesh.glbUrl };
		}

		row.render = { ok: false };
		if (row.mesh.glbUrl) {
			try {
				const r = await stageRender(opts.renderBase, row.mesh.glbUrl);
				const renderPath = join(dir, `${item.id}.render.png`);
				writeFileSync(renderPath, r.png);
				row.render = { ok: true, latencyMs: r.latencyMs, path: relative(ROOT, renderPath) };
			} catch (err) {
				row.render = { ok: false, error: errText(err) };
			}
		} else {
			row.render = { ok: false, error: 'no GLB to render' };
		}
	} catch (err) {
		row.reference = { ...(row.reference || {}), ok: false, error: row.reference?.error || errText(err) };
	}
	row.score = objectiveScore(row);
	row.failed = !row.reference?.ok || !row.mesh?.ok || !row.render?.ok;
	return row;
}

async function pool(items, n, fn) {
	let next = 0;
	const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
		while (next < items.length) {
			const item = items[next++];
			await fn(item);
		}
	});
	await Promise.all(workers);
}

// ── Pairwise judge ───────────────────────────────────────────────────────────
const TILE = 512;

async function tile(path) {
	return sharp(join(ROOT, path)).flatten({ background: '#ffffff' }).resize(TILE, TILE, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
}

async function sideBySide(leftPath, rightPath) {
	const gap = 16;
	return sharp({ create: { width: TILE * 2 + gap, height: TILE, channels: 3, background: '#808080' } })
		.composite([
			{ input: await tile(leftPath), left: 0, top: 0 },
			{ input: await tile(rightPath), left: TILE + gap, top: 0 },
		])
		.jpeg({ quality: 88 })
		.toBuffer();
}

function judgePrompt(prompt) {
	return [
		`Two independent results for the same text-to-3D request are shown side by side: "${prompt}".`,
		'The left half and the right half are separate candidates (each a rendered 3D model on white, or the reference picture it was built from).',
		'Pick the better usable 3D asset: faithful to the request, one complete subject, clean silhouette, plausible proportions, no missing, melted or fused parts, no slab of background built into the model.',
		'Answer with JSON only: {"winner":"left"|"right"|"tie","reason":"one short sentence"}',
	].join(' ');
}

async function judgePair(mods, item, a, b) {
	const basis = a.render?.ok && b.render?.ok ? 'render' : 'reference';
	const pathOf = (row) => (basis === 'render' ? row.render.path : row.reference.path);
	const xaiLeft = hash32(`side:${item.id}`) % 2 === 1;
	const [left, right] = xaiLeft ? [b, a] : [a, b];
	const image = await sideBySide(pathOf(left), pathOf(right));
	const res = await mods.describeImageJson({
		prompt: judgePrompt(item.prompt),
		imageBase64: image.toString('base64'),
		mimeType: 'image/jpeg',
		lead: mods.VISION_TASK_LEAD.seed_judge,
		maxTokens: 200,
		timeoutMs: 45_000,
	});
	if (/grok|xai|x-ai/i.test(`${res.provider} ${res.model}`)) throw new Error(`judge chain returned a Grok model (${res.model}); refusing a self-judgment`);
	const side = String(res.json?.winner || '').toLowerCase();
	if (!['left', 'right', 'tie'].includes(side)) throw new Error(`judge answered without a winner: ${JSON.stringify(res.json).slice(0, 160)}`);
	const winner = side === 'tie' ? 'tie' : side === 'left' ? left.provider : right.provider;
	return { basis, winner, leftProvider: left.provider, judgeProvider: res.provider, judgeModel: res.model, reason: String(res.json?.reason || '').slice(0, 240), judgedAt: new Date().toISOString() };
}

// ── Report ───────────────────────────────────────────────────────────────────
function providerSummary(rows) {
	const n = rows.length;
	const refOk = rows.filter((r) => r.reference?.ok);
	const count = (f) => rows.filter(f).length;
	const costs = refOk.map((r) => r.reference.costUsd).filter((c) => Number.isFinite(c));
	const models = {};
	for (const r of refOk) models[r.reference.model] = (models[r.reference.model] || 0) + 1;
	return {
		n,
		refOk: refOk.length,
		score: mean(rows.map((r) => r.score)),
		bgClean: count((r) => r.image?.checks?.bgClean),
		single: count((r) => r.image?.checks?.singleSubject),
		centered: count((r) => r.image?.checks?.centered),
		saneFill: count((r) => r.image?.checks?.saneFill),
		meshOk: count((r) => r.mesh?.ok),
		closed: count((r) => r.mesh?.metrics?.closed),
		watertight: count((r) => r.mesh?.metrics?.watertight),
		renderOk: count((r) => r.render?.ok),
		medianTris: median(rows.map((r) => r.mesh?.metrics?.triangles)),
		medianRefMs: median(refOk.map((r) => r.reference.latencyMs)),
		medianMeshMs: median(rows.map((r) => r.mesh?.latencyMs)),
		costPerImage: costs.length ? mean(costs) : null,
		xaiCallsPerImage: mean(refOk.map((r) => r.reference.xaiCalls)),
		models,
	};
}

function costCell(provider, s) {
	if (provider === 'xai') return s.costPerImage === null ? 'n/a' : `$${s.costPerImage.toFixed(4)} (metered, ${s.xaiCallsPerImage?.toFixed(2)} calls/image)`;
	const names = Object.keys(s.models);
	if (names.length && names.every((m) => /^nim\//.test(m))) return '$0 (NVIDIA NIM free tier)';
	return 'not metered per image (see served models)';
}

function decide(prompts, results) {
	const cats = [...new Set(prompts.map((p) => p.category))];
	const out = [];
	for (const cat of cats) {
		const ids = prompts.filter((p) => p.category === cat).map((p) => p.id);
		const js = ids.map((id) => results.judgments[id]).filter(Boolean);
		const base = ids.map((id) => results.rows[`baseline:${id}`]).filter(Boolean);
		const xai = ids.map((id) => results.rows[`xai:${id}`]).filter(Boolean);
		const xaiWins = js.filter((j) => j.winner === 'xai').length;
		const baseWins = js.filter((j) => j.winner === 'baseline').length;
		const decisive = xaiWins + baseWins;
		const scoreDelta = xai.length && base.length ? mean(xai.map((r) => r.score)) - mean(base.map((r) => r.score)) : null;
		const wins = decisive >= 3 && xaiWins / decisive >= 0.6 && scoreDelta !== null && scoreDelta >= -5;
		out.push({ cat, judged: js.length, xaiWins, baseWins, ties: js.length - decisive, scoreDelta, wins });
	}
	return out;
}

async function writeSideBySides(prompts, results) {
	mkdirSync(IMG_DIR, { recursive: true });
	const both = (id) => results.rows[`baseline:${id}`]?.reference?.ok && results.rows[`xai:${id}`]?.reference?.ok;
	const cats = [...new Set(prompts.map((p) => p.category))];
	const picks = [];
	for (const cat of cats) {
		const inCat = prompts.filter((p) => p.category === cat);
		const pick =
			inCat.find((p) => both(p.id) && results.rows[`baseline:${p.id}`].render?.ok && results.rows[`xai:${p.id}`].render?.ok) ||
			inCat.find((p) => both(p.id)) ||
			inCat.find((p) => results.rows[`baseline:${p.id}`]?.render?.ok) ||
			inCat.find((p) => results.rows[`baseline:${p.id}`]?.reference?.ok);
		if (pick) picks.push(pick);
	}
	const T = 320;
	const LABEL_H = 36;
	const written = [];
	for (const p of picks.slice(0, 6)) {
		const cells = [];
		for (const provider of PROVIDERS) {
			const row = results.rows[`${provider}:${p.id}`];
			if (!row?.reference?.ok) continue;
			for (const [kind, path] of [['reference', row.reference.path], ['render', row.render?.ok ? row.render.path : null]]) {
				if (!path || !existsSync(join(ROOT, path))) continue;
				cells.push({ label: `${provider === 'xai' ? 'Grok Imagine' : 'Baseline'} ${kind}`, path });
			}
		}
		if (!cells.length) continue;
		const width = cells.length * T;
		const svg = Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_H}"><rect width="100%" height="100%" fill="#111"/>${cells
				.map((c, i) => `<text x="${i * T + T / 2}" y="24" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" fill="#fff" text-anchor="middle">${c.label}</text>`)
				.join('')}</svg>`,
		);
		const tiles = await Promise.all(
			cells.map(async (c, i) => ({
				input: await sharp(join(ROOT, c.path)).flatten({ background: '#ffffff' }).resize(T, T, { fit: 'contain', background: '#ffffff' }).png().toBuffer(),
				left: i * T,
				top: LABEL_H,
			})),
		);
		const file = join(IMG_DIR, `ref-image-${p.id}.jpg`);
		await sharp({ create: { width, height: T + LABEL_H, channels: 3, background: '#ffffff' } })
			.composite([{ input: svg, left: 0, top: 0 }, ...tiles])
			.jpeg({ quality: 82 })
			.toFile(file);
		written.push({ id: p.id, category: p.category, prompt: p.prompt, file: relative(dirname(REPORT_FILE), file), cells: cells.map((c) => c.label) });
	}
	return written;
}

async function writeReport(prompts, results) {
	const byProvider = Object.fromEntries(
		PROVIDERS.map((p) => [p, prompts.map((x) => results.rows[`${p}:${x.id}`]).filter(Boolean)]),
	);
	const present = PROVIDERS.filter((p) => byProvider[p].length);
	const summaries = Object.fromEntries(present.map((p) => [p, providerSummary(byProvider[p])]));
	const decisions = decide(prompts, results);
	const judged = Object.keys(results.judgments).length;
	const images = await writeSideBySides(prompts, results);
	const cats = [...new Set(prompts.map((p) => p.category))];
	const lastRun = results.runs[results.runs.length - 1];
	const L = [];

	L.push('# Grok Imagine as a text-to-3D reference-image lane: eval');
	L.push('');
	L.push(`Generated by \`scripts/grok-eval-ref-image.mjs\` from \`data/evals/ref-image-results.json\`${lastRun ? ` (last run ${lastRun.finishedAt?.slice(0, 10)}, commit ${lastRun.commit || 'unknown'})` : ''}. Rerun the command at the bottom to refresh every number on this page.`);
	L.push('');
	L.push('## Decision');
	L.push('');
	if (!summaries.xai) {
		L.push(
			`**The production default is unchanged.** Only the baseline column exists: ${summaries.baseline?.n ?? 0} of ${prompts.length} prompts were run on the lane production serves today, and the Grok Imagine column has not been generated because no xAI API key is configured on this deployment yet. \`FORGE_REF_IMAGE_PROVIDER\` stays unset (the Vertex lane, then the text-to-image ladder). Once the key is set, one command adds the xAI column and the pairwise judgments, and this section is recomputed from them.`,
		);
	} else {
		const winners = decisions.filter((d) => d.wins).map((d) => d.cat);
		L.push(
			winners.length
				? `**Grok Imagine wins in: ${winners.join(', ')}.** A category counts as a win when Grok Imagine takes at least 60% of decisive blind judgments (with at least 3 decisive pairs) and its mean objective score is no more than 5 points below the baseline. Everywhere else the existing lane stays the default.`
				: '**Grok Imagine does not win any category by the rule below, so the production default is unchanged.** A category counts as a win when Grok Imagine takes at least 60% of decisive blind judgments (with at least 3 decisive pairs) and its mean objective score is no more than 5 points below the baseline.',
		);
	}
	L.push('');
	L.push('## Method');
	L.push('');
	L.push(`- **Prompts:** ${prompts.length} in \`data/evals/ref-image-prompts.json\`, across ${cats.join(', ')}. The hard category holds thin structures (spokes, wire, wings) and transparent objects (glass, crystal), the shapes image-to-3D handles worst.`);
	L.push('- **Baseline:** `generateReferenceImage()` with `FORGE_REF_IMAGE_PROVIDER` unset, i.e. exactly what the forge serves today. The served model is recorded per row.');
	L.push('- **Grok Imagine:** the same call with `FORGE_REF_IMAGE_PROVIDER=xai`, so the image comes from `grok-imagine-image-2.0` with the identical composition instruction (`buildReferenceInstruction`). A row where the xAI lane did not serve counts as an xAI failure, not a baseline result.');
	L.push('- **Image to 3D:** the self-hosted TRELLIS worker with the standard tier\'s quality settings and background matting on, as `api/forge.js` submits it. Same seed per prompt for both providers.');
	L.push(`- **Render:** \`/api/render/glb\` at ${RENDER_SIZE}px on white.`);
	L.push('- **Objective score (0 to 100):** ' + Object.entries(WEIGHTS).map(([k, w]) => `${k} ${w}`).join(', ') + '. Background clean: at least 90% of a 6px border within RGB distance 28 of the median border color. Single subject: the largest 4-connected foreground component holds at least 92% of foreground pixels. Centered: bounding-box center within 12% of the image center. Sane fill: subject extent between 45% and 95% of the frame. Closed: under 1% of welded mesh edges are open boundaries; strict watertightness (zero open and zero non-manifold edges) is reported separately.');
	L.push('- **Blind pairwise judge:** for every prompt with both results, the two renders (or the two reference images when a render is missing) are composited side by side, sides shuffled per prompt by a hash, and sent to the repo\'s free vision chain led by NVIDIA Nemotron 3.5 Super VL (`describeImageJson`, the `seed_judge` lead). Grok never judges its own output; the harness refuses any answer from a Grok model.');
	L.push('- **Cost and latency:** Grok Imagine cost is metered from the `usage.cost_in_usd_ticks` field of every xAI response, including best-of-2 retries. Latency is wall-clock time for the whole reference step (generation, QA scoring, persistence), as a user waits for it.');
	L.push('');
	L.push('## Results by provider');
	L.push('');
	L.push(`| Provider | Prompts | Reference ok | Mean score | Clean bg | Single subject | Centered | Sane fill | Mesh ok | Closed mesh | Watertight | Render ok | Median triangles | Median reference latency | Median TRELLIS latency | Cost per image |`);
	L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
	for (const p of present) {
		const s = summaries[p];
		L.push(
			`| ${PROVIDER_LABEL[p]} | ${s.n} | ${pct(s.refOk, s.n)} | ${s.score?.toFixed(1) ?? 'n/a'} | ${pct(s.bgClean, s.n)} | ${pct(s.single, s.n)} | ${pct(s.centered, s.n)} | ${pct(s.saneFill, s.n)} | ${pct(s.meshOk, s.n)} | ${pct(s.closed, s.n)} | ${pct(s.watertight, s.n)} | ${pct(s.renderOk, s.n)} | ${s.medianTris === null ? 'n/a' : Math.round(s.medianTris).toLocaleString('en-US')} | ${secs(s.medianRefMs)} | ${secs(s.medianMeshMs)} | ${costCell(p, s)} |`,
		);
	}
	L.push('');
	for (const p of present) {
		const models = Object.entries(summaries[p].models).sort((a, b) => b[1] - a[1]);
		if (models.length) L.push(`${PROVIDER_LABEL[p]} served models: ${models.map(([m, n]) => `\`${m}\` x${n}`).join(', ')}.`);
	}
	L.push('');
	L.push('## Results by category');
	L.push('');
	L.push('| Category | ' + present.map((p) => `${PROVIDER_LABEL[p]} mean score`).join(' | ') + ' | Judged pairs | Grok Imagine wins | Baseline wins | Ties | Grok Imagine win rate (decisive) | Default |');
	L.push('|---|' + present.map(() => '---|').join('') + '---|---|---|---|---|---|');
	for (const d of decisions) {
		const scores = present.map((p) => {
			const rows = byProvider[p].filter((r) => r.category === d.cat);
			const m = mean(rows.map((r) => r.score));
			return m === null ? 'n/a' : `${m.toFixed(1)} (n=${rows.length})`;
		});
		const decisive = d.xaiWins + d.baseWins;
		L.push(`| ${d.cat} | ${scores.join(' | ')} | ${d.judged} | ${d.xaiWins} | ${d.baseWins} | ${d.ties} | ${decisive ? pct(d.xaiWins, decisive) : 'n/a'} | ${d.wins ? 'Grok Imagine' : 'existing lane'} |`);
	}
	L.push('');
	if (!judged) L.push('No pairwise judgments yet: the judge runs once both providers have a result for a prompt.');
	L.push('');
	if (images.length) {
		L.push('## Side by side');
		L.push('');
		for (const im of images) {
			L.push(`**${im.category}: "${im.prompt}"** (\`${im.id}\`; ${im.cells.join(', ')})`);
			L.push('');
			L.push(`![${im.category}: ${im.prompt}](${im.file})`);
			L.push('');
		}
	}
	L.push('## Every prompt');
	L.push('');
	L.push('| Prompt | Provider | Served by | Clean bg | Single | Centered | Fill extent | Triangles | Open-edge ratio | Render | Score | Judge | Failure |');
	L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
	const yn = (b) => (b ? 'yes' : 'no');
	for (const item of prompts) {
		for (const p of present) {
			const r = results.rows[`${p}:${item.id}`];
			if (!r) continue;
			const j = results.judgments[item.id];
			const failure = [r.reference?.error, r.mesh?.error, r.render?.ok ? null : r.render?.error].filter(Boolean)[0] || '';
			L.push(
				`| \`${item.id}\` ${item.prompt} | ${p} | ${r.reference?.model ? `\`${r.reference.model}\`` : 'n/a'} | ${yn(r.image?.checks?.bgClean)} | ${yn(r.image?.checks?.singleSubject)} | ${yn(r.image?.checks?.centered)} | ${r.image?.extent ?? 'n/a'} | ${r.mesh?.metrics?.triangles?.toLocaleString('en-US') ?? 'n/a'} | ${r.mesh?.metrics?.boundaryRatio ?? 'n/a'} | ${yn(r.render?.ok)} | ${r.score} | ${j ? (j.winner === p ? 'won' : j.winner === 'tie' ? 'tie' : 'lost') : ''} | ${failure.replace(/\|/g, '/').slice(0, 120)} |`,
			);
		}
	}
	L.push('');
	L.push('## Reproduce');
	L.push('');
	L.push('```bash');
	L.push('npm run grok:eval-ref-image -- --prod-env                    # baseline column, resumable');
	L.push('npm run grok:eval-ref-image -- --prod-env --providers xai    # Grok Imagine column + blind judge (needs GROK_API_KEY on Cloud Run)');
	L.push('npm run grok:eval-ref-image -- --report-only                 # rebuild this page from the results file');
	L.push('```');
	L.push('');
	mkdirSync(dirname(REPORT_FILE), { recursive: true });
	writeFileSync(REPORT_FILE, `${L.join('\n')}\n`);
	return { summaries, decisions, images };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const spec = JSON.parse(readFileSync(PROMPTS_FILE, 'utf8'));
	let prompts = spec.prompts;
	const results = loadResults();

	if (opts.reportOnly) {
		const { summaries } = await writeReport(prompts, results);
		console.log(`report written: ${relative(ROOT, REPORT_FILE)}`);
		for (const [p, s] of Object.entries(summaries)) console.log(`  ${p}: ${s.n} rows, mean score ${s.score?.toFixed(1)}`);
		return;
	}

	if (opts.prodEnv) {
		const n = loadCloudRunEnv({ wanted: ENV_WANTED, required: ['MODEL_TRELLIS_URL', 'GCP_RECONSTRUCTION_KEY'] });
		console.log(`loaded ${n} env vars from Cloud Run (no database, no Redis)`);
	}
	for (const k of ['DATABASE_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[k];
	if (!process.env.MODEL_TRELLIS_URL || !process.env.GCP_RECONSTRUCTION_KEY) usage('MODEL_TRELLIS_URL and GCP_RECONSTRUCTION_KEY are unset; pass --prod-env');
	if (opts.providers.includes('xai') && !process.env.GROK_API_KEY && !process.env.XAI_API_KEY) {
		usage('the xai column needs GROK_API_KEY (or XAI_API_KEY) on the Cloud Run service; run `npm run setup:xai-key` first');
	}

	const [ref, gcp, tiers, vision, chat] = await Promise.all([
		import('../api/_lib/forge-reference-image.js'),
		import('../api/_providers/gcp.js'),
		import('../api/_lib/forge-tiers.js'),
		import('../api/_lib/vision.js'),
		import('../api/_lib/chat-models.js'),
	]);
	const mods = {
		generateReferenceImage: ref.generateReferenceImage,
		createRegenProvider: gcp.createRegenProvider,
		selfhostQualityForTier: tiers.selfhostQualityForTier,
		describeImageJson: vision.describeImageJson,
		VISION_TASK_LEAD: vision.VISION_TASK_LEAD,
	};
	installXaiCostMeter(chat.XAI_IMAGE_GENERATIONS_URL);

	if (opts.only) prompts = prompts.filter((p) => opts.only.has(p.id));
	if (opts.limit) prompts = prompts.slice(0, opts.limit);
	if (!prompts.length) usage('no prompts selected');

	const run = { startedAt: new Date().toISOString(), commit: gitSha(), providers: opts.providers, prompts: prompts.length, renderBase: opts.renderBase };
	for (const provider of opts.providers) {
		if (provider === 'xai') process.env.FORGE_REF_IMAGE_PROVIDER = 'xai';
		else delete process.env.FORGE_REF_IMAGE_PROVIDER;
		const todo = prompts.filter((p) => {
			const row = results.rows[`${provider}:${p.id}`];
			return !row || opts.force || (opts.retryFailed && row.failed);
		});
		console.log(`${provider}: ${todo.length} of ${prompts.length} prompts to run`);
		let done = 0;
		await pool(todo, opts.concurrency, async (item) => {
			const row = await runRow(mods, opts, provider, item);
			results.rows[`${provider}:${item.id}`] = row;
			delete results.judgments[item.id];
			saveResults(results);
			done++;
			const tri = row.mesh?.metrics?.triangles;
			console.log(
				`[${provider} ${done}/${todo.length}] ${item.id} score=${row.score} served=${row.reference?.model || 'none'} ref=${secs(row.reference?.latencyMs)} mesh=${row.mesh?.ok ? `${tri} tris, open ${row.mesh.metrics?.boundaryRatio}` : `FAIL ${row.mesh?.error || ''}`} render=${row.render?.ok ? 'ok' : `FAIL ${row.render?.error || ''}`}${row.reference?.ok ? '' : ` ref FAIL ${row.reference?.error}`}`,
			);
		});
	}
	delete process.env.FORGE_REF_IMAGE_PROVIDER;

	if (opts.judge) {
		const pending = spec.prompts.filter(
			(p) => results.rows[`baseline:${p.id}`]?.reference?.ok && results.rows[`xai:${p.id}`]?.reference?.ok && !results.judgments[p.id],
		);
		if (pending.length) console.log(`judge: ${pending.length} pairs`);
		for (const item of pending) {
			try {
				results.judgments[item.id] = await judgePair(mods, item, results.rows[`baseline:${item.id}`], results.rows[`xai:${item.id}`]);
				saveResults(results);
				console.log(`  ${item.id}: ${results.judgments[item.id].winner} (${results.judgments[item.id].judgeModel})`);
			} catch (err) {
				console.warn(`  ${item.id}: judge failed: ${errText(err)}`);
			}
		}
	}

	run.finishedAt = new Date().toISOString();
	results.runs.push(run);
	saveResults(results);
	const { summaries } = await writeReport(spec.prompts, results);
	console.log(`report written: ${relative(ROOT, REPORT_FILE)}`);
	for (const [p, s] of Object.entries(summaries)) {
		console.log(`  ${p}: ${s.n} rows, ref ok ${s.refOk}, mesh ok ${s.meshOk}, render ok ${s.renderOk}, mean score ${s.score?.toFixed(1)}, median ref ${secs(s.medianRefMs)}`);
	}
	const ranRows = opts.providers.flatMap((p) => prompts.map((x) => results.rows[`${p}:${x.id}`]).filter(Boolean));
	if (ranRows.length && ranRows.every((r) => !r.reference?.ok)) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`grok-eval-ref-image: ${err?.stack || err}`);
		process.exit(2);
	});
}
