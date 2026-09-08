#!/usr/bin/env node
/**
 * Mobile payload gate for high-resolution GLBs.
 *
 * A 4K albedo plus a matching 4K normal is the difference between a surface
 * that reads as leather and one that reads as brown plastic, and it is also the
 * fastest way to ship a model a phone cannot open. This script measures both
 * halves of that trade on a REAL asset: it runs the platform's own derive pass
 * (api/_lib/glb-pbr-derive.js) and its own compression chain
 * (scripts/compress-glbs.mjs) over the input, records the byte size after each
 * stage, then loads the finished GLB in the shipped /avatar-embed page under
 * WebKit and under Android Chrome emulation and reports whether it actually
 * rendered, how long it took, and how many bytes crossed the wire.
 *
 * Every number is measured: file sizes come from the filesystem, transfer bytes
 * come from CDP `Network.loadingFinished` encodedDataLength (not content-length
 * and not the uncompressed size), and "rendered" means a mesh from the model is
 * in the live scene graph, not that a request returned 200.
 *
 * Usage:
 *   npm run dev
 *   node scripts/glb-mobile-payload.mjs public/avatars/dancing-twerk.glb
 *   node scripts/glb-mobile-payload.mjs --tier=high --json=out.json <glb...>
 *   node scripts/glb-mobile-payload.mjs --max-texture=2048 <glb...>  # tiered
 *   node scripts/glb-mobile-payload.mjs --base=http://localhost:3000 <glb...>
 *
 * Exits 1 when any engine failed to render the finished GLB, so this doubles as
 * the regression gate on "does the high tier still open on a phone".
 */

import { chromium, webkit, devices } from 'playwright';
import { readFile, writeFile, mkdir, stat, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = { tier: 'high', base: 'http://localhost:3000', inputs: [], json: null, maxTexture: null };
for (const raw of process.argv.slice(2)) {
	if (raw.startsWith('--')) {
		const [k, ...rest] = raw.replace(/^--/, '').split('=');
		const v = rest.join('=');
		if (k === 'tier') args.tier = v;
		else if (k === 'base') args.base = v;
		else if (k === 'json') args.json = v;
		else if (k === 'max-texture') args.maxTexture = Number(v);
		else throw new Error(`unknown flag --${k}`);
	} else args.inputs.push(raw);
}
if (!args.inputs.length) args.inputs = ['public/avatars/dancing-twerk.glb'];

// The finished GLBs are written under public/ because the page under test can
// only fetch what the dev server serves; they are removed again at the end so
// nothing lands in the working tree.
const STAGE_DIR = path.join(ROOT, 'public', '_payload-check');
const STAGE_URL_PREFIX = '/_payload-check';

// Real phone profiles rather than a bare viewport resize: the device descriptor
// carries the user agent, DPR and touch flags a viewer branches on.
const ENGINES = [
	{ id: 'webkit-iphone', browser: webkit, device: devices['iPhone 13'], label: 'WebKit (iPhone 13)' },
	{ id: 'chromium-pixel', browser: chromium, device: devices['Pixel 5'], label: 'Android Chrome (Pixel 5)' },
];

// Mid-tier Android on a Lighthouse-profile mobile connection. A 4K GLB that
// only opens on desktop fibre has not been verified for mobile at all.
const CPU_THROTTLE = 4;
const NET = { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150, offline: false };
const LOAD_TIMEOUT = 300_000;

const READBACK_HOOK = `
window.__THREE_DEVTOOLS__ = new EventTarget();
window.__payload_scenes = [];
window.__THREE_DEVTOOLS__.addEventListener('observe', (e) => {
	const o = e.detail;
	if (o && o.isScene) window.__payload_scenes.push(o);
});
// "Rendered" means a SKINNED or named mesh from the model is live. The viewer
// builds a shadow catcher and a stack of post-processing fullscreen quads before
// the GLB is even requested, so counting any mesh reports success instantly and
// measures nothing.
window.__payload_modelMeshes = () => {
	let n = 0;
	for (const scene of window.__payload_scenes || []) {
		scene.traverse((node) => {
			if (!node.isMesh) return;
			if (node.isSkinnedMesh || (node.name && node.name !== 'shadow_catcher' && node.material?.name)) n++;
		});
	}
	return n;
};
`;

function kib(bytes) {
	return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function sizeOf(file) {
	return (await stat(file)).size;
}

/** Run the platform's real derive pass, writing the result beside the input. */
async function derive(inputFile, outFile, tier) {
	const { derivePbrChannels } = await import(path.join(ROOT, 'api/_lib/glb-pbr-derive.js'));
	const buf = await readFile(inputFile);
	const result = await derivePbrChannels(buf, { tier });
	await writeFile(outFile, result.buffer);
	return result;
}

async function main() {
	await mkdir(STAGE_DIR, { recursive: true });
	const report = { tier: args.tier, base: args.base, capturedAt: new Date().toISOString(), models: [] };
	let anyFailure = false;

	for (const input of args.inputs) {
		const inputFile = path.resolve(ROOT, input);
		const stem = path.basename(inputFile, '.glb');
		const derivedFile = path.join(STAGE_DIR, `${stem}.derived.glb`);
		const finalFile = path.join(STAGE_DIR, `${stem}.glb`);

		const stages = { input: await sizeOf(inputFile) };
		const deriveResult = await derive(inputFile, derivedFile, args.tier);
		stages.derived = await sizeOf(derivedFile);

		// The real compression chain, invoked exactly as a release would: it
		// rewrites in place and refuses to grow a file.
		await copyFile(derivedFile, finalFile);
		// `--max-texture` is what tiered delivery looks like in practice: the same
		// chain, one ceiling, so the viewer's copy and the full-res download come
		// out of one encoder instead of two that can drift.
		const compressArgs = [path.join(ROOT, 'scripts/compress-glbs.mjs')];
		if (args.maxTexture) compressArgs.push(`--max-texture=${args.maxTexture}`);
		compressArgs.push(finalFile);
		await execFileAsync('node', compressArgs, { cwd: ROOT, maxBuffer: 1 << 26 });
		stages.compressed = await sizeOf(finalFile);
		stages.maxTexture = args.maxTexture || null;

		const modelUrl = `${STAGE_URL_PREFIX}/${stem}.glb`;
		const entry = {
			input,
			stages,
			changed: deriveResult.changed,
			materials: deriveResult.materials,
			engines: [],
		};
		console.log(
			`\n${input}${args.maxTexture ? ` (textures capped at ${args.maxTexture}px)` : ''}\n` +
				`  input ${kib(stages.input)} -> derived ${kib(stages.derived)} -> compressed ${kib(stages.compressed)}`,
		);

		for (const engine of ENGINES) {
			const browser = await engine.browser.launch({
				args: engine.browser === chromium ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [],
			});
			const context = await browser.newContext({ ...engine.device });
			const page = await context.newPage();
			await page.addInitScript(READBACK_HOOK);
			const consoleErrors = [];
			page.on('console', (m) => {
				if (m.type() === 'error' && !/\[vite\]|WebSocket/i.test(m.text())) consoleErrors.push(m.text());
			});
			page.on('pageerror', (e) => {
				const t = String(e?.message || e);
				if (!/WebSocket/i.test(t)) consoleErrors.push(t);
			});
			// WebKit's console says only "Failed to load resource" with no URL, which
			// is unactionable. Record the status and URL of every failed response so a
			// 404 names the file it was looking for.
			const failedRequests = [];
			page.on('response', (r) => {
				if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
			});

			// Chromium alone exposes CDP, so transfer bytes and throttling are
			// measured there and the WebKit leg reports timing and render only.
			let cdp = null;
			let transferBytes = 0;
			if (engine.browser === chromium) {
				cdp = await context.newCDPSession(page);
				await cdp.send('Network.enable');
				await cdp.send('Network.emulateNetworkConditions', NET);
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
				const wanted = new Set();
				cdp.on('Network.requestWillBeSent', (e) => {
					if (e.request?.url?.includes(modelUrl)) wanted.add(e.requestId);
				});
				cdp.on('Network.loadingFinished', (e) => {
					if (wanted.has(e.requestId)) transferBytes += e.encodedDataLength || 0;
				});
			}

			const url = `${args.base}/avatar-embed?model=${encodeURIComponent(modelUrl)}&hide-chrome=1`;
			const started = Date.now();
			let rendered = false;
			await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT }).catch(() => {});
			await page
				.waitForFunction(() => (window.__payload_modelMeshes?.() || 0) > 0, null, { timeout: LOAD_TIMEOUT })
				.then(() => {
					rendered = true;
				})
				.catch(() => {});
			const ms = Date.now() - started;
			const meshes = await page.evaluate(() => window.__payload_modelMeshes?.() || 0).catch(() => 0);

			entry.engines.push({
				engine: engine.id,
				label: engine.label,
				rendered,
				modelMeshes: meshes,
				msToFirstModelMesh: ms,
				transferBytes: engine.browser === chromium ? transferBytes : null,
				cpuThrottle: engine.browser === chromium ? CPU_THROTTLE : null,
				network: engine.browser === chromium ? 'slow4g (1.6 Mbps / 150 ms RTT)' : 'unthrottled',
				consoleErrors,
				failedRequests,
			});
			console.log(
				`  ${engine.label.padEnd(26)} ${rendered ? 'rendered' : 'FAILED  '} ${String(meshes).padStart(3)} mesh(es)  ${String(ms).padStart(6)} ms` +
					(engine.browser === chromium ? `  ${kib(transferBytes)} over the wire` : '') +
					(consoleErrors.length ? `  [${consoleErrors.length} console error(s)]` : '') +
					(failedRequests.length ? `  [${failedRequests.length} failed request(s)]` : ''),
			);
			if (!rendered) anyFailure = true;
			await browser.close();
		}

		report.models.push(entry);
	}

	if (args.json) {
		await mkdir(path.dirname(path.resolve(args.json)), { recursive: true });
		await writeFile(path.resolve(args.json), `${JSON.stringify(report, null, '\t')}\n`);
		console.log(`\nReport -> ${args.json}`);
	}
	await rm(STAGE_DIR, { recursive: true, force: true });
	if (anyFailure) {
		console.error('\nAt least one engine failed to render the finished GLB.');
		process.exit(1);
	}
}

main().catch(async (err) => {
	await rm(STAGE_DIR, { recursive: true, force: true }).catch(() => {});
	console.error('[glb-mobile-payload] fatal:', err);
	process.exit(1);
});
