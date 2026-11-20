#!/usr/bin/env node
// Hero clip end to end, outside the HTTP endpoint (docs/hero-clips.md).
//
// 1. Renders the clip's 16:9 first frame and N reference angles of one GLB
//    through the same code the endpoint uses (api/_lib/glb-turntable-refs.js)
//    and writes the PNGs to --out, with a JSON manifest of the angles and the
//    render time per angle.
// 2. Sends the real POST https://api.x.ai/v1/videos/generations through
//    api/_lib/xai-video.js. With no xAI key on this machine or on the
//    three-ws-api service, it sends no credentials and prints xAI's documented
//    401, which proves the endpoint, the auth header shape and the body.
// 3. With a key: polls the job to done, copies the clip into our object store,
//    and prints its URL, its public page and the seconds from start to a
//    playable clip.
//
// USAGE
//   node scripts/hero-clip-e2e.mjs --glb https://three.ws/cdn/forge/anon/3abac32f-ced2-4189-b822-d30c96dbc87e.glb --title "Chrome toy rocket"
//   node scripts/hero-clip-e2e.mjs --glb <url> --out docs/img/hero-clips --angles 6
//   node scripts/hero-clip-e2e.mjs --glb <url> --preset hero_push_in --duration 6 --tier lite
//   node scripts/hero-clip-e2e.mjs --glb <url> --renders-only
//
// The key (GROK_API_KEY or XAI_API_KEY) comes from this process's env, then from
// the three-ws-api Cloud Run service. Storage credentials (S3_*) follow the same
// order, and only when a clip is actually being stored. Keys are never printed.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';

import {
	renderFirstFrame,
	renderTurntableRefs,
	pngDataUri,
	DEFAULT_ANGLE_COUNT,
} from '../api/_lib/glb-turntable-refs.js';
import {
	buildVideoRequest,
	createVideoJob,
	pollVideoJob,
	storeVideo,
	videoModel,
	XaiVideoError,
} from '../api/_lib/xai-video.js';
import { presetPrompt, heroClipPreset, DEFAULT_PRESET, DEFAULT_DURATION, clipPagePath } from '../api/_lib/hero-clip.js';
import { serviceEnvValue } from './lib/service-env.mjs';

const STORAGE_VARS = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'APP_ORIGIN'];

function args() {
	const { values } = parseArgs({
		options: {
			glb: { type: 'string' },
			out: { type: 'string' },
			angles: { type: 'string', default: String(DEFAULT_ANGLE_COUNT) },
			preset: { type: 'string', default: DEFAULT_PRESET },
			duration: { type: 'string', default: String(DEFAULT_DURATION) },
			tier: { type: 'string', default: 'lite' },
			title: { type: 'string', default: '' },
			'renders-only': { type: 'boolean', default: false },
		},
	});
	if (!values.glb || !/^https:\/\//.test(values.glb)) {
		console.error('usage: node scripts/hero-clip-e2e.mjs --glb <https url of a .glb> [--out dir] [--angles 6] [--preset id] [--duration 6] [--tier lite|full] [--renders-only]');
		process.exit(2);
	}
	if (!heroClipPreset(values.preset)) {
		console.error(`unknown preset "${values.preset}"`);
		process.exit(2);
	}
	return values;
}

function serviceValue(name) {
	try {
		return serviceEnvValue(name) || null;
	} catch {
		return null;
	}
}

function resolveKey() {
	const fromEnv = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
	if (fromEnv) return { key: fromEnv, source: 'process.env' };
	const fromService = serviceValue('GROK_API_KEY') || serviceValue('XAI_API_KEY');
	if (fromService) return { key: fromService, source: 'cloud-run:three-ws-api' };
	return { key: null, source: null };
}

function ensureStorageEnv() {
	for (const name of STORAGE_VARS) {
		if (process.env[name]) continue;
		const v = serviceValue(name);
		if (v) process.env[name] = v;
	}
	const missing = STORAGE_VARS.filter((n) => !process.env[n]);
	if (missing.length) throw new Error(`storage is not configured here (missing ${missing.join(', ')})`);
}

async function writeRenders(outDir, glbUrl, frame, refs, totalMs) {
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, 'first-frame.png'), frame.png);
	const files = [];
	for (const [i, r] of refs.entries()) {
		const name = `angle-${String(i + 1).padStart(2, '0')}-az${r.azimuth}-el${r.elevation}.png`;
		await writeFile(join(outDir, name), r.png);
		files.push({ file: name, azimuth: r.azimuth, elevation: r.elevation, width: r.width, height: r.height, ms: r.ms, bytes: r.png.length });
	}
	const manifest = {
		glb_url: glbUrl,
		rendered_at: new Date().toISOString(),
		first_frame: { file: 'first-frame.png', width: frame.width, height: frame.height, ms: frame.ms, bytes: frame.png.length },
		angles: files,
		total_ms: totalMs,
		ms_per_angle: Math.round(totalMs / refs.length),
	};
	await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	return manifest;
}

async function main() {
	const a = args();
	const started = Date.now();
	const tier = a.tier === 'full' ? 'full' : 'lite';

	const frame = await renderFirstFrame({ glbUrl: a.glb });
	const { refs, totalMs, msPerAngle } = await renderTurntableRefs({ glbUrl: a.glb, count: Number(a.angles) });
	console.log(`renders: first frame ${frame.width}x${frame.height} in ${frame.ms} ms; ${refs.length} angles in ${totalMs} ms (${msPerAngle} ms per angle)`);
	for (const r of refs) console.log(`  azimuth ${String(r.azimuth).padStart(5)}  elevation ${String(r.elevation).padStart(3)}  ${r.png.length} bytes  ${r.ms} ms`);
	if (a.out) {
		const dir = resolve(a.out);
		await writeRenders(dir, a.glb, frame, refs, totalMs);
		console.log(`wrote ${refs.length + 1} PNGs and manifest.json to ${dir}`);
	}
	if (a['renders-only']) return;

	const body = buildVideoRequest({
		tier,
		prompt: presetPrompt(a.preset, { title: a.title }),
		duration: Number(a.duration),
		firstFrame: pngDataUri(frame.png),
		references: refs.map((r) => pngDataUri(r.png)),
		loop: heroClipPreset(a.preset).loop,
	});
	const { key, source } = resolveKey();
	console.log(`create: model ${body.model}, ${body.duration} s, ${body.resolution}, references ${body.reference_images?.length || 0}, key ${source || 'none (sending no credentials)'}`);

	let requestId;
	try {
		({ requestId } = await createVideoJob(body, { apiKey: key || '' }));
	} catch (err) {
		if (!(err instanceof XaiVideoError)) throw err;
		console.log(`create answered: HTTP ${err.status ?? '-'} code=${err.code} provider=${err.providerCode ?? '-'}`);
		console.log(`  detail: ${err.detail || err.message}`);
		// No key is the expected state until the production key lands; the 401 is the proof.
		process.exit(key ? 1 : 0);
	}
	console.log(`job: ${requestId}`);

	const done = await pollVideoJob(requestId, { apiKey: key });
	console.log(`done: ${done.duration ?? body.duration} s clip after ${Math.round((Date.now() - started) / 1000)} s`);
	ensureStorageEnv();
	const stored = await storeVideo({
		requestId,
		videoUrl: done.videoUrl,
		tier,
		seconds: done.duration ?? body.duration,
		metadata: { title: encodeURIComponent(a.title), preset: a.preset, duration: String(done.duration ?? body.duration) },
		usage: { meta: { preset: a.preset, source_kind: 'script' } },
	});
	const origin = process.env.APP_ORIGIN || 'https://three.ws';
	console.log(`stored: ${stored.clipUrl} (${stored.bytes ?? '?'} bytes, model ${videoModel(tier).id})`);
	console.log(`page:   ${origin}${clipPagePath(requestId)}`);
	console.log(`seconds from start to playable clip: ${Math.round((Date.now() - started) / 1000)}`);
}

main().catch((err) => {
	console.error(`hero-clip-e2e failed: ${err?.message || err}`);
	process.exit(1);
});
