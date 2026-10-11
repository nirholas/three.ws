#!/usr/bin/env node
/**
 * Renders the film by asking the composition for one frame at a time.
 *
 *   node marketing/motion-studio/src/render.mjs                        # both formats, with audio if out/audio.wav exists
 *   node marketing/motion-studio/src/render.mjs --format=portrait
 *   node marketing/motion-studio/src/render.mjs --stills=0.8,3.5,7 --format=landscape --dir=reviews/stills
 *   node marketing/motion-studio/src/render.mjs --determinism           # frame 240 rendered twice, hashes compared
 *
 * Every frame is window.__seek(t) followed by a screenshot. No recording, no
 * wall clock, so frame N never depends on frames before it.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FPS, DURATION } from './timeline.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const STUDIO = path.join(ROOT, 'marketing/motion-studio');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
	const m = a.match(/^--([^=]+)(?:=(.*))?$/);
	return m ? [m[1], m[2] ?? true] : [a, true];
}));
const formats = args.format && args.format !== 'both' ? [String(args.format)] : ['landscape', 'portrait'];
const OUT = path.resolve(STUDIO, 'out');
mkdirSync(OUT, { recursive: true });
const BROWSER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-compositing', '--disable-gpu-rasterization'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

function serve() {
	const server = http.createServer((req, res) => {
		const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		for (const base of [path.join(ROOT, 'public'), ROOT]) {
			const file = path.join(base, rel);
			if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) continue;
			res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
			return res.end(readFileSync(file));
		}
		res.writeHead(404).end('not found');
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function ffmpegBin() {
	const bundled = path.join(ROOT, 'node_modules/ffmpeg-static/ffmpeg');
	return existsSync(bundled) ? bundled : 'ffmpeg';
}

async function openFormat(browser, origin, format) {
	const portrait = format === 'portrait';
	const ctx = await browser.newContext({ viewport: { width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080 }, deviceScaleFactor: 1 });
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	await page.goto(`${origin}/marketing/motion-studio/src/composition.html?format=${format}`, { waitUntil: 'load' });
	await page.evaluate(() => window.__ready);
	if (errors.length) throw new Error(`composition errors: ${errors.join(' | ')}`);
	return { ctx, page };
}

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: BROWSER_ARGS });
try {
	if (args.determinism) {
		const { ctx, page } = await openFormat(browser, origin, formats[0]);
		const hashes = [];
		for (const t of [8, 3, 8]) {
			await page.evaluate((x) => window.__seek(x), t);
			hashes.push(createHash('sha256').update(await page.screenshot()).digest('hex').slice(0, 16));
		}
		console.log('t=8 first :', hashes[0]);
		console.log('t=3 between:', hashes[1]);
		console.log('t=8 again :', hashes[2]);
		console.log(hashes[0] === hashes[2] ? 'DETERMINISTIC: frame 8s is byte-identical after seeking elsewhere' : 'NOT DETERMINISTIC');
		await ctx.close();
		process.exitCode = hashes[0] === hashes[2] ? 0 : 1;
	} else if (args.stills) {
		const dir = path.resolve(STUDIO, String(args.dir || 'reviews/stills'));
		mkdirSync(dir, { recursive: true });
		for (const format of formats) {
			const { ctx, page } = await openFormat(browser, origin, format);
			for (const t of String(args.stills).split(',').map(Number)) {
				await page.evaluate((x) => window.__seek(x), t);
				const file = path.join(dir, `${format}-${t.toFixed(2).padStart(5, '0')}.png`);
				writeFileSync(file, await page.screenshot());
				console.log('still', path.relative(ROOT, file));
			}
			console.log('avatar clip', JSON.stringify(await page.evaluate(() => window.__avatarClip)));
			await ctx.close();
		}
	} else {
		const audio = path.join(OUT, 'audio.wav');
		const total = Math.round(DURATION * FPS);
		for (const format of formats) {
			const { ctx, page } = await openFormat(browser, origin, format);
			const file = path.join(OUT, `give-your-ai-a-body-${format === 'portrait' ? '9x16' : '16x9'}.mp4`);
			const ff = spawn(ffmpegBin(), [
				'-y', '-hide_banner', '-loglevel', 'error',
				'-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
				...(existsSync(audio) ? ['-i', audio] : []),
				'-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart',
				...(existsSync(audio) ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']),
				file,
			], { stdio: ['pipe', 'inherit', 'inherit'] });
			const done = new Promise((resolve, reject) => { ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`)))); ff.on('error', reject); });
			const started = Date.now();
			for (let f = 0; f < total; f++) {
				await page.evaluate((x) => window.__seek(x), f / FPS);
				const png = await page.screenshot({ type: 'png' });
				if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
				if (f % 60 === 0) console.log(`[${format}] frame ${f}/${total} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
			}
			ff.stdin.end();
			await done;
			await page.evaluate(() => window.__seek(16.9));
			writeFileSync(path.join(OUT, `give-your-ai-a-body-${format === 'portrait' ? '9x16' : '16x9'}-poster.png`), await page.screenshot());
			console.log(`[${format}] wrote ${path.relative(ROOT, file)} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
			await ctx.close();
		}
	}
} finally {
	await browser.close();
	server.close();
}
