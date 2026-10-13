#!/usr/bin/env node
/**
 * Render poster thumbnails for every animation clip in the motion library.
 *
 * Drives scripts/thumbnail-harness.html (served by the Vite dev server so the
 * site's own retarget engine and preview avatar are used) in headless Chromium
 * and saves one WebP still per clip, posed ~40% into the motion:
 *
 *   • Curated clips  (public/animations/manifest.json)
 *       → public/animations/thumbs/<name>.webp   (committed, served statically)
 *   • Full library   (animation-sources/.cc0-library-clips/manifest.json)
 *       → animation-sources/.library-thumbs/<name>.webp   (gitignored; uploaded
 *         to R2 by `npm run cc0-library:upload`, which also writes each clip's
 *         `thumb` URL into the published library manifest)
 *
 * Resumable: existing outputs are skipped unless --force. A dev server already
 * listening on --port is reused; otherwise one is spawned for the run.
 *
 * Usage:
 *   node scripts/build-animation-thumbnails.mjs             # everything missing
 *   node scripts/build-animation-thumbnails.mjs --limit=20  # smoke run
 *   node scripts/build-animation-thumbnails.mjs --only=mx-… # one clip
 *   node scripts/build-animation-thumbnails.mjs --force     # re-render all
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		return m ? [m[1], m[2] ?? true] : [a, true];
	}),
);
const PORT = Number(args.port) || 3311;
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const FORCE = !!args.force;
const ONLY = typeof args.only === 'string' ? args.only : null;

const CURATED_MANIFEST = join(ROOT, 'public/animations/manifest.json');
const CURATED_CLIPS_DIR = join(ROOT, 'public/animations');
const CURATED_OUT = join(ROOT, 'public/animations/thumbs');
const LIBRARY_MANIFEST = join(ROOT, 'animation-sources/.cc0-library-clips/manifest.json');
const LIBRARY_CLIPS_DIR = join(ROOT, 'animation-sources/.cc0-library-clips');
const LIBRARY_OUT = join(ROOT, 'animation-sources/.library-thumbs');

async function serverListening(port) {
	try {
		const res = await fetch(`http://localhost:${port}/scripts/thumbnail-harness.html`);
		return res.ok;
	} catch {
		return false;
	}
}

async function ensureDevServer() {
	if (await serverListening(PORT)) return null;
	console.log(`Starting Vite dev server on :${PORT}…`);
	const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
		cwd: ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: false,
	});
	proc.stderr.on('data', (d) => {
		const s = d.toString();
		if (/error/i.test(s)) process.stderr.write(s);
	});
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (await serverListening(PORT)) return proc;
		await new Promise((r) => setTimeout(r, 500));
	}
	proc.kill();
	throw new Error(`Vite dev server did not come up on :${PORT} within 60s`);
}

function loadJobs() {
	const jobs = [];
	if (existsSync(CURATED_MANIFEST)) {
		const curated = JSON.parse(readFileSync(CURATED_MANIFEST, 'utf8'));
		for (const entry of curated) {
			jobs.push({
				name: entry.name,
				loop: entry.loop !== false,
				clipPath: join(CURATED_CLIPS_DIR, entry.url.replace(/^\/animations\//, '')),
				outPath: join(CURATED_OUT, `${entry.name}.webp`),
			});
		}
	}
	if (existsSync(LIBRARY_MANIFEST)) {
		const library = JSON.parse(readFileSync(LIBRARY_MANIFEST, 'utf8'));
		for (const entry of library) {
			jobs.push({
				name: entry.name,
				loop: entry.loop !== false,
				// Staged manifest urls are library-root-relative (R2 layout,
				// `clips/<name>.json`); the staged files themselves sit flat in the
				// stage dir — same resolution mixamo-all.mjs's upload phase uses.
				clipPath: join(LIBRARY_CLIPS_DIR, `${entry.name}.json`),
				outPath: join(LIBRARY_OUT, `${entry.name}.webp`),
			});
		}
	} else {
		console.warn('⚠️  No staged library manifest — only curated clips will render.');
	}
	return jobs;
}

(async () => {
	const { chromium } = await import('playwright');

	let jobs = loadJobs();
	if (ONLY) jobs = jobs.filter((j) => j.name === ONLY);
	const total = jobs.length;
	if (!FORCE) jobs = jobs.filter((j) => !existsSync(j.outPath));
	if (jobs.length > LIMIT) jobs = jobs.slice(0, LIMIT);
	console.log(`${total} clips in manifests, ${jobs.length} to render.`);
	if (!jobs.length) return;

	mkdirSync(CURATED_OUT, { recursive: true });
	mkdirSync(LIBRARY_OUT, { recursive: true });

	const server = await ensureDevServer();
	const browser = await chromium.launch({
		args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
	});
	try {
		const page = await browser.newPage({ viewport: { width: 520, height: 700 } });
		page.on('pageerror', (err) => console.warn('  [page]', err.message));
		await page.goto(`http://localhost:${PORT}/scripts/thumbnail-harness.html`, {
			waitUntil: 'domcontentloaded',
		});
		const boot = await page.evaluate(() => window.__thumb.ready);
		console.log(`Harness ready — ${boot.bones} bones, ${boot.canonical} canonical mappings.`);

		let done = 0;
		let failed = 0;
		const t0 = Date.now();
		for (const job of jobs) {
			if (!existsSync(job.clipPath)) {
				failed++;
				console.warn(`  ❌ ${job.name}: clip file missing (${job.clipPath})`);
				continue;
			}
			try {
				const clipJson = JSON.parse(readFileSync(job.clipPath, 'utf8'));
				const { dataUrl } = await page.evaluate(
					({ clipJson, name, at }) => window.__thumb.renderClip(clipJson, name, { at }),
					{ clipJson, name: job.name, at: job.loop ? 0.5 : 0.4 },
				);
				const b64 = dataUrl.replace(/^data:image\/webp;base64,/, '');
				writeFileSync(job.outPath, Buffer.from(b64, 'base64'));
				done++;
			} catch (err) {
				failed++;
				console.warn(`  ❌ ${job.name}: ${err.message.split('\n')[0]}`);
			}
			if (done % 50 === 0 && done > 0) {
				const rate = done / ((Date.now() - t0) / 1000);
				const eta = Math.round((jobs.length - done - failed) / rate);
				process.stdout.write(`\r  ${done}/${jobs.length} rendered (${rate.toFixed(1)}/s, ~${eta}s left)…`);
			}
		}
		console.log(`\n✅ ${done} rendered, ${failed} failed, ${total - done - failed} already existed.`);
		if (failed > 0) process.exitCode = 1;
	} finally {
		await browser.close();
		if (server) server.kill();
	}
	// The spawned dev server's stdio pipes would otherwise keep the event loop
	// alive after the work is done.
	process.exit(process.exitCode ?? 0);
})();
