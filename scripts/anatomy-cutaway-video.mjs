#!/usr/bin/env node
// Record an Anatomy cutaway as a frame-accurate MP4 for social posts: spin it,
// explode it, slice it, then walk part of the guided tour.
//
//   node scripts/anatomy-cutaway-video.mjs \
//     --id 85160213-4c15-4b00-ba96-5990b9385249 \
//     --out public/x-media/grok-startups-announce/ffsc-engine.mp4 \
//     [--base https://three.ws] [--fps 30] [--preview] [--keep-frames]
//
// Why frame stepping instead of a screen recording: this host has no GPU, so
// WebGL runs in SwiftShader at a few frames a second and a real-time capture
// stutters. The page's clocks are virtualized instead. performance.now,
// Date.now and requestAnimationFrame are replaced before any page script runs;
// once the cutaway has loaded, each video frame advances the clock by exactly
// 1/fps, runs the queued animation callbacks (the viewer's render loop, the
// explode tween, the camera tour tween, OrbitControls damping), and takes a
// screenshot. Every motion in the explorer is time based, so the result plays
// back smoothly at full rate no matter how long each frame took to render.
//
// --preview writes one PNG per scene to the output's folder instead of a video.

import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, basename } from 'node:path';
import { chromium } from 'playwright';

const arg = (name, def = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const id = arg('id');
if (!id) throw new Error('--id <anatomy design id> is required');
const base = arg('base', 'https://three.ws');
const out = resolve(arg('out', `public/x-media/anatomy-${id}.mp4`));
const fps = Number(arg('fps', 30)) || 30;
const preview = flag('preview');
const keepFrames = flag('keep-frames');
const W = 1280;
const H = 720;
const SCALE = 1.5; // 1920x1080 output

const framesDir = join(dirname(out), `.${basename(out, '.mp4')}-frames`);
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

// Installed before any page script. Real time runs until __vclock.start(), so
// the page loads, fetches and compiles shaders normally.
const clockScript = `(() => {
	const realNow = performance.now.bind(performance);
	const realDateNow = Date.now;
	const realRaf = window.requestAnimationFrame.bind(window);
	const realCancel = window.cancelAnimationFrame.bind(window);
	let virtual = null;
	let dateOffset = 0;
	let nextId = 1e6;
	const queue = new Map();
	performance.now = () => (virtual === null ? realNow() : virtual);
	Date.now = () => (virtual === null ? realDateNow() : Math.round(virtual + dateOffset));
	window.requestAnimationFrame = (cb) => {
		if (virtual === null) return realRaf(cb);
		const handle = nextId++;
		queue.set(handle, cb);
		return handle;
	};
	window.cancelAnimationFrame = (handle) => {
		if (!queue.delete(handle)) realCancel(handle);
	};
	window.__vclock = {
		start() {
			virtual = realNow();
			dateOffset = realDateNow() - virtual;
		},
		step(ms) {
			virtual += ms;
			const due = [...queue.values()];
			queue.clear();
			for (const cb of due) cb(virtual);
			return queue.size;
		},
	};
})();`;

// Full-bleed stage: hide the page chrome and the explorer's side panels and
// toolbar, keep the tour card, and add a caption and brand mark of our own.
const STAGE_CSS = `
	body > *:not(main):not(#vidOverlay), .site-header, .anp-bar, .anp-asked, .anp-notice, .anx-side, .anx-toolbar, .anx-hint, .anx-header, .anx-legend, .anp-toast { display: none !important; }
	html, body { overflow: hidden !important; background: #07080b !important; }
	#anpStage { position: fixed !important; inset: 0 !important; height: 100vh !important; width: 100vw !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; z-index: 10; }
	.anx { display: block !important; outline: none !important; box-shadow: none !important; }
	.anx, .anx-stage { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; }
	.anx-tour { left: auto !important; right: 28px !important; bottom: 28px !important; width: 380px !important; animation: none !important; }
	.anx-tour-foot, .anx-tour-tools { display: none !important; }
	#vidOverlay { position: fixed; inset: 0; z-index: 20; pointer-events: none; color: #f4f6fa; font-family: 'Geist', 'Inter', system-ui, sans-serif; }
	#vidOverlay::before { content: ''; position: absolute; left: 0; top: 0; width: 760px; height: 150px; background: radial-gradient(ellipse 760px 150px at 0 0, rgba(7,8,11,0.92) 40%, rgba(7,8,11,0) 100%); }
	#vidOverlay .brand { position: absolute; left: 36px; top: 30px; font-size: 26px; font-weight: 800; letter-spacing: -0.01em; }
	#vidOverlay .brand span { margin-left: 12px; font: 600 15px/1 ui-monospace, 'Geist Mono', monospace; letter-spacing: 0.2em; color: #8fa3c7; }
	#vidOverlay .title { position: absolute; left: 36px; top: 68px; font-size: 17px; color: #b9c4d8; max-width: 560px; }
	#vidOverlay .caption { position: absolute; left: 36px; bottom: 34px; font-size: 44px; font-weight: 800; letter-spacing: -0.02em; transition: none; }
	#vidOverlay .caption small { display: block; margin-top: 8px; font: 600 15px/1 ui-monospace, 'Geist Mono', monospace; letter-spacing: 0.18em; text-transform: uppercase; color: #4fd1ff; }
`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: 'dark' });
await context.addInitScript(clockScript);
const page = await context.newPage();
page.setDefaultTimeout(300_000);
const problems = [];
page.on('pageerror', (err) => problems.push(err.message));
page.on('console', (msg) => {
	if (msg.type() === 'error' && !/GPU stall|ReadPixels|WebGL-|swiftshader|favicon/i.test(msg.text())) problems.push(msg.text());
});

await page.goto(`${base}/anatomy/${id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.anx canvas');
await page.waitForFunction(() => !document.querySelector('#anpSkeleton') || document.querySelector('#anpSkeleton').hidden);
await page.waitForTimeout(3000);
const meta = await page.evaluate(() => ({
	title: (document.querySelector('.anx-title')?.textContent?.trim() || document.title).replace(/\s*·\s*Anatomy\s*·\s*three\.ws\s*$/i, ''),
	steps: document.querySelectorAll('.anx-steps li, .anx-tour-step, [data-step]').length,
	axes: [...(document.querySelector('.anx select[aria-label="Section cut axis"]')?.options || [])].map((o) => o.value),
	sectionOn: document.querySelector('.anx select[aria-label="Section cut axis"]')?.value || '',
}));
console.log(`loaded: ${meta.title} (section axes ${meta.axes.join(',') || 'none'}, opening section ${meta.sectionOn || 'off'})`);

await page.addStyleTag({ content: STAGE_CSS });
await page.evaluate((title) => {
	const el = (cls, html) => Object.assign(document.createElement('div'), { className: cls, innerHTML: html });
	const overlay = el('', '');
	overlay.id = 'vidOverlay';
	const brand = el('brand', 'three.ws');
	brand.append(Object.assign(document.createElement('span'), { textContent: 'ANATOMY' }));
	const t = el('title', '');
	t.textContent = title;
	overlay.append(brand, t, el('caption', ''));
	document.body.append(overlay);
	window.dispatchEvent(new Event('resize'));
}, meta.title);
await page.waitForFunction((w) => document.querySelector('.anx canvas')?.clientWidth >= w, W - 2);
await page.waitForTimeout(1500);

// Close the opening section so the first shot shows the whole machine.
const setSection = (axis) =>
	page.evaluate((value) => {
		const sel = document.querySelector('.anx select[aria-label="Section cut axis"]');
		if (!sel) return;
		sel.value = value;
		sel.dispatchEvent(new Event('change', { bubbles: true }));
	}, axis);
const setCaption = (text, sub = '') =>
	page.evaluate(
		([t, s]) => {
			const c = document.querySelector('#vidOverlay .caption');
			c.textContent = t;
			if (s) c.append(Object.assign(document.createElement('small'), { textContent: s }));
		},
		[text, sub],
	);
const key = async (k) => {
	await page.evaluate(() => document.querySelector('.anx').focus());
	await page.keyboard.press(k);
};
if (meta.sectionOn) await setSection('');

await page.evaluate(() => window.__vclock.start());
const box = await page.locator('.anx canvas').boundingBox();
const cx = box.x + box.width * 0.5;
const cy = box.y + box.height * 0.5;

let frame = 0;
const stepMs = 1000 / fps;
async function capture(n, { dragPx = 0, wheel = 0, wheelFrames = 0 } = {}) {
	for (let i = 0; i < n; i++) {
		if (dragPx) await page.mouse.move(dragX += dragPx, cy, { steps: 1 });
		if (wheel && i < wheelFrames) await page.mouse.wheel(0, wheel);
		await page.evaluate((ms) => window.__vclock.step(ms), stepMs);
		if (!preview) await page.screenshot({ path: join(framesDir, `${String(frame).padStart(5, '0')}.png`) });
		frame++;
	}
}
async function still(name) {
	if (preview) await page.screenshot({ path: join(dirname(out), `${basename(out, '.mp4')}-${name}.png`) });
}
let dragX = cx;
const startDrag = async () => {
	dragX = cx - 200;
	await page.mouse.move(dragX, cy);
	await page.mouse.down();
};
const endDrag = () => page.mouse.up();
const sec = (s) => Math.round(s * fps);
const scene = async (s, opts) => capture(preview ? Math.min(sec(s), 20) : sec(s), opts);

// 1. Spin it
await setCaption('Spin it');
await startDrag();
await scene(3.2, { dragPx: 3 });
await still('1-spin');

// 2. Explode it (keep turning slowly)
await setCaption('Explode it');
await key('e');
// Pull back while the parts fly apart so the exploded engine stays in frame.
await scene(3.4, { dragPx: 1.2, wheel: 20, wheelFrames: 20 });
await still('2-explode');
await key('e');
await scene(0.9, { dragPx: 1.2, wheel: -20, wheelFrames: 20 });
await endDrag();

// 3. Slice it
const axis = meta.axes.find((v) => v && v !== 'off' && v !== 'none' && v === meta.sectionOn) || meta.axes.find((v) => v && v !== 'off' && v !== 'none');
if (axis) {
	await setCaption('Slice it');
	await setSection(axis);
	await scene(3.2);
	await still('3-slice');
	await setSection('');
}

// 4. The guided tour: three steps, each framed by the explorer's own camera.
await setCaption('Take the tour');
for (let i = 0; i < 3; i++) {
	await key('ArrowRight');
	await scene(i === 2 ? 3 : 2.4);
	await still(`4-tour-${i + 1}`);
}

await browser.close();
if (problems.length) console.warn(`page reported ${problems.length} problem(s):\n${problems.slice(0, 8).join('\n')}`);

if (preview) {
	rmSync(framesDir, { recursive: true, force: true });
	console.log(`preview stills written next to ${out}`);
} else {
	const count = readdirSync(framesDir).length;
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(framesDir, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: 'inherit' });
	if (!keepFrames) rmSync(framesDir, { recursive: true, force: true });
	console.log(`video: ${out} (${count} frames, ${(count / fps).toFixed(1)}s at ${fps} fps)`);
}
