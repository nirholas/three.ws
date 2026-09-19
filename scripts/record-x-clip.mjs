#!/usr/bin/env node
// Record a real screen capture of a live three.ws page for an X post: the page
// loaded in a real browser, driven by a short script of steps (scroll, click,
// type a prompt, drag to orbit a 3D model), encoded to the h264 MP4 X accepts.
//
// Why this exists: every post that went out on 2026-09-18 and 2026-09-19 used
// the same templated card (logo, headline, the page shrunk into a small browser
// frame), so the timeline saw one image five times. What moves people is the
// product itself doing something, full screen, readable. This records exactly
// that and nothing staged: the frames are the live site painting in Chromium.
//
//   node scripts/record-x-clip.mjs --spec data/x-content/clips/<id>.json
//   node scripts/record-x-clip.mjs --spec data/x-content/clips/<id>.json --item <id>
//   node scripts/record-x-clip.mjs --url https://three.ws/forge --out public/x-media/forge/clip.mp4
//   node scripts/record-x-clip.mjs --backfill    every unsent page item still leading with a still
//
// Spec:
//   { "out": "public/x-media/<id>/clip.mp4",
//     "url": "https://three.ws/<page>",
//     "viewport": "desktop" | "phone",      default desktop: a 720p clip and a 1080p poster
//     "hide": [".selector"],                 extra overlays to drop
//     "steps": [ ...see STEPS below... ] }   omitted: a plain tour of the page
//
// Steps (each is one object; `ms` paces the motion so a viewer can follow it):
//   { "wait": 2000 }                              hold on the current frame
//   { "waitFor": "canvas", "timeout": 30000 }     until a selector is visible
//   { "scroll": 600, "ms": 1800 }                 smooth scroll by pixels (negative is up)
//   { "scrollTo": "#pricing", "ms": 1800 }        smooth scroll an element into view
//   { "move": "button.go", "ms": 700 }            glide the visible cursor to an element or [x, y]
//   { "click": "text=Generate" }                  glide there, then click
//   { "type": "a worn leather armchair", "into": "textarea", "delay": 55 }
//   { "press": "Enter" }
//   { "drag": { "from": [640, 380], "to": [900, 380] }, "ms": 2200 }   orbit a canvas
//   { "drag": { "on": "#viewer", "by": [320, 0] }, "ms": 2200 }          the same, from an element's center
//   { "poster": true }                            save this moment as <out dir>/poster.png
//   { "caption": "Type a sentence." }             a caption in the page's own type; null clears it
//   { "cut": { "waitFor": "canvas", "timeout": 240000 }, "caption": "{seconds} seconds later" }
//                                                 stop recording, wait for the selector, resume;
//                                                 {seconds} is the wait that was really measured
//
// Most of the feed autoplays muted, so captions carry the story. They are drawn
// inside the page, over the live product, never as a separate slide.
// Output: the MP4, probed by `x-content prepare-video` (so the queue's video
// checks see its real duration and encoding), and a full-resolution poster PNG
// for posts where a still is the better fit. `--item <id>` attaches the clip to
// that queue item's head post. A recording whose frames are blank fails.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (name) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 ? argv[index + 1] : null;
};

function fail(message) {
	console.error(`[x-clip] ${message}`);
	process.exit(1);
}

// --backfill: give every unsent queue item that has a live page but still leads
// with a still its own recording. One clip at a time: each recording is a whole
// software-rendered browser, and prepare-video rewrites the queue file.
if (argv.includes('--backfill')) {
	const queuePath = resolve(root, 'data/x-content/queue.json');
	const targets = JSON.parse(readFileSync(queuePath, 'utf8')).items.filter((item) => {
		const url = item.source?.url;
		const lead = item.posts?.[0]?.media?.[0]?.path || '';
		return item.kind === 'post' && ['draft', 'review'].includes(item.status) && /^https:\/\/three\.ws\//.test(url || '') && !lead.endsWith('.mp4');
	});
	console.log(`[x-clip] ${targets.length} item(s) to record`);
	let failed = 0;
	for (const item of targets) {
		const specPath = `data/x-content/clips/${item.id}.json`;
		if (!existsSync(resolve(root, specPath))) {
			mkdirSync(resolve(root, 'data/x-content/clips'), { recursive: true });
			writeFileSync(resolve(root, specPath), `${JSON.stringify({ out: `public/x-media/${item.id}/clip.mp4`, url: item.source.url, viewport: 'desktop' }, null, '\t')}\n`);
		}
		const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--spec', specPath, '--item', item.id], { cwd: root, encoding: 'utf8' });
		if (run.status === 0) console.log(`[x-clip] ${item.id}: recorded`);
		else {
			failed++;
			console.log(`[x-clip] ${item.id}: failed: ${(run.stderr || run.stdout).trim().split('\n').filter((line) => line.includes('[x-clip]')).at(-1) || 'no output'}`);
		}
	}
	process.exit(failed ? 1 : 0);
}

const spec = option('spec')
	? JSON.parse(readFileSync(resolve(root, option('spec')), 'utf8'))
	: { url: option('url'), out: option('out'), viewport: option('viewport') || 'desktop' };
if (!spec.url || !/^https?:\/\//.test(spec.url)) fail('the spec needs a live "url"');
if (!spec.out || !spec.out.startsWith('public/x-media/') || !spec.out.endsWith('.mp4')) fail('"out" must be an .mp4 under public/x-media/');

const VIEWPORTS = {
	desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 },
	phone: { viewport: { width: 390, height: 780 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
};
const device = VIEWPORTS[spec.viewport || 'desktop'];
if (!device) fail(`viewport must be one of ${Object.keys(VIEWPORTS).join(', ')}`);

// The same floating chrome make-x-post-card.mjs drops: it belongs to a visit,
// not to the feature being shown.
const OVERLAYS = ['#tws-corner-stack', '.twx-i18n-fab', '.walk-companion', '.walk-c2w-fx', '.walk-trail-layer', '#market-sidebar-toggle'];

// A plain tour for a page with no scripted steps: land on the hero, read down
// the page, come back up.
const TOUR = [
	{ wait: 2500 },
	{ poster: true },
	{ scroll: 520, ms: 2200 },
	{ wait: 1400 },
	{ scroll: 520, ms: 2200 },
	{ wait: 1400 },
	{ scroll: -1040, ms: 2400 },
	{ wait: 1200 },
];

// Headless screen captures show no pointer, so a viewer cannot tell what was
// clicked. This draws one, and pulses it on press.
const CURSOR = `(() => {
	const install = () => {
		if (document.getElementById('__x_clip_cursor')) return;
		const dot = document.createElement('div');
		dot.id = '__x_clip_cursor';
		dot.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 0 0 2px rgba(20,24,40,.85),0 4px 14px rgba(0,0,0,.5);pointer-events:none;z-index:2147483647;transition:transform .12s ease;transform:translate(-100px,-100px)';
		document.documentElement.appendChild(dot);
		let x = -100, y = -100, scale = 1;
		const paint = () => { dot.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')'; };
		addEventListener('mousemove', (event) => { x = event.clientX; y = event.clientY; paint(); }, true);
		addEventListener('mousedown', () => { scale = 0.7; paint(); }, true);
		addEventListener('mouseup', () => { scale = 1; paint(); }, true);
	};
	if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install); else install();
	window.__xClipCaption = (text) => {
		let bar = document.getElementById('__x_clip_caption');
		if (!bar) {
			bar = document.createElement('div');
			bar.id = '__x_clip_caption';
			bar.style.cssText = 'position:fixed;left:50%;bottom:44px;max-width:82vw;padding:14px 26px;border-radius:14px;background:rgba(8,10,20,.84);color:#fff;font:600 30px/1.25 Inter,system-ui,sans-serif;letter-spacing:-.01em;text-align:center;box-shadow:0 0 0 1px rgba(255,255,255,.12) inset,0 18px 40px rgba(0,0,0,.45);pointer-events:none;z-index:2147483646;opacity:0;transform:translate(-50%,10px);transition:opacity .28s ease,transform .28s ease';
			document.documentElement.appendChild(bar);
		}
		if (text) bar.textContent = text;
		requestAnimationFrame(() => { bar.style.opacity = text ? '1' : '0'; bar.style.transform = text ? 'translate(-50%,0)' : 'translate(-50%,10px)'; });
	};
})();`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ ...device, colorScheme: 'dark', reducedMotion: 'no-preference' });
await context.addInitScript(CURSOR);
const page = await context.newPage();
const work = mkdtempSync(join(tmpdir(), 'x-clip-'));

const frames = [];
// Time cut out of the clip by `cut` steps, and whether frames are being kept.
let cutSeconds = 0;
let recording = true;
// The pointer stays off the page until a step moves it, so a plain tour never
// hovers something by accident; the first glide starts from the center.
let pointer = { x: device.viewport.width / 2, y: device.viewport.height / 2 };
let posterBuffer = null;

async function glide(target, ms = 700) {
	const steps = Math.max(8, Math.round(ms / 16));
	const from = { ...pointer };
	for (let index = 1; index <= steps; index++) {
		const t = ease(index / steps);
		await page.mouse.move(from.x + (target.x - from.x) * t, from.y + (target.y - from.y) * t);
		await sleep(ms / steps);
	}
	pointer = target;
}

async function centerOf(target) {
	if (Array.isArray(target)) return { x: target[0], y: target[1] };
	const locator = page.locator(target).first();
	await locator.scrollIntoViewIfNeeded({ timeout: 15_000 });
	const box = await locator.boundingBox();
	if (!box) throw new Error(`${target} has no box on the page`);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function smoothScroll(delta, ms) {
	await page.evaluate(({ delta, ms }) => new Promise((done) => {
		const start = scrollY;
		const began = performance.now();
		const tick = (now) => {
			const t = Math.min(1, (now - began) / ms);
			const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
			scrollTo(0, start + delta * eased);
			if (t < 1) requestAnimationFrame(tick); else done();
		};
		requestAnimationFrame(tick);
	}), { delta, ms });
}

async function runStep(step) {
	if ('wait' in step) return sleep(step.wait);
	if ('waitFor' in step) return page.locator(step.waitFor).first().waitFor({ state: 'visible', timeout: step.timeout ?? 30_000 });
	if ('scroll' in step) return smoothScroll(step.scroll, step.ms ?? 1800);
	if ('scrollTo' in step) {
		const delta = await page.locator(step.scrollTo).first().evaluate((node) => node.getBoundingClientRect().top - 96);
		return smoothScroll(delta, step.ms ?? 1800);
	}
	if ('move' in step) return glide(await centerOf(step.move), step.ms ?? 700);
	if ('hover' in step) return glide(await centerOf(step.hover), step.ms ?? 700);
	if ('click' in step) {
		await glide(await centerOf(step.click), step.ms ?? 700);
		await sleep(180);
		return page.mouse.click(pointer.x, pointer.y);
	}
	if ('type' in step) {
		if (step.into) {
			await glide(await centerOf(step.into), step.ms ?? 600);
			await page.mouse.click(pointer.x, pointer.y);
		}
		return page.keyboard.type(String(step.type), { delay: step.delay ?? 55 });
	}
	if ('press' in step) return page.keyboard.press(step.press);
	if ('drag' in step) {
		const from = step.drag.on ? await centerOf(step.drag.on) : { x: step.drag.from[0], y: step.drag.from[1] };
		const to = step.drag.by ? { x: from.x + step.drag.by[0], y: from.y + step.drag.by[1] } : { x: step.drag.to[0], y: step.drag.to[1] };
		await glide(from, 500);
		await page.mouse.down();
		await glide(to, step.ms ?? 2200);
		return page.mouse.up();
	}
	if ('cut' in step) {
		recording = false;
		const began = Date.now();
		await page.locator(step.cut.waitFor).first().waitFor({ state: 'visible', timeout: step.cut.timeout ?? 240_000 });
		await sleep(step.cut.settle ?? 1200);
		const waited = (Date.now() - began) / 1000;
		cutSeconds += waited;
		recording = true;
		if (step.caption) await page.evaluate((text) => window.__xClipCaption(text), step.caption.replace('{seconds}', String(Math.round(waited))));
		return null;
	}
	if ('caption' in step) return page.evaluate((text) => window.__xClipCaption(text), step.caption);
	if ('poster' in step) {
		posterBuffer = await page.screenshot({ type: 'png' });
		return null;
	}
	throw new Error(`unknown step ${JSON.stringify(step)}`);
}

// Frames come from the compositor as it paints (CDP screencast), each stamped
// with its paint time, so the encoded clip plays at the speed the page really
// ran, including the moments nothing moved.
async function record(steps) {
	const cdp = await context.newCDPSession(page);
	cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
		if (recording) {
			const file = join(work, `f${String(frames.length).padStart(6, '0')}.jpg`);
			writeFileSync(file, Buffer.from(data, 'base64'));
			frames.push({ file, at: metadata.timestamp - cutSeconds });
		}
		await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
	});
	// Screencast frames are painted at CSS-pixel size whatever the scale factor,
	// so the clip is 720p; the poster, a real screenshot, keeps the full 1.5x.
	await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
	for (const [index, step] of steps.entries()) {
		try {
			await runStep(step);
		} catch (error) {
			// Show what the page looked like when the step gave up, not just the error.
			const debug = resolve(root, dirname(spec.out), `failed-step-${index}.png`);
			mkdirSync(dirname(debug), { recursive: true });
			await page.screenshot({ path: debug }).catch(() => {});
			fail(`step ${index} ${JSON.stringify(step)} failed: ${error.message.split('\n')[0]}\n  the page at that moment: ${debug}`);
		}
	}
	await sleep(400);
	const stoppedAt = Date.now() / 1000 - cutSeconds;
	await cdp.send('Page.stopScreencast');
	return stoppedAt;
}

function encode(stoppedAt) {
	if (frames.length < 2) fail(`only ${frames.length} frame(s) were painted; the page never rendered`);
	const lines = ['ffconcat version 1.0'];
	frames.forEach((frame, index) => {
		const next = frames[index + 1]?.at ?? stoppedAt;
		lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.at).toFixed(4)}`);
	});
	// The concat demuxer drops the last entry's duration unless it is repeated.
	lines.push(`file '${frames.at(-1).file}'`);
	writeFileSync(join(work, 'frames.ffconcat'), `${lines.join('\n')}\n`);

	const ffmpeg = existsSync(join(root, 'node_modules/ffmpeg-static/ffmpeg')) ? join(root, 'node_modules/ffmpeg-static/ffmpeg') : 'ffmpeg';
	const master = join(work, 'master.mp4');
	const run = spawnSync(ffmpeg, [
		'-y', '-hide_banner', '-loglevel', 'error',
		'-f', 'concat', '-safe', '0', '-i', join(work, 'frames.ffconcat'),
		'-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2',
		'-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p',
		master,
	], { encoding: 'utf8' });
	if (run.status !== 0) fail(`ffmpeg could not assemble the frames:\n${run.stderr}`);
	return master;
}

async function assertNotBlank(buffer, what) {
	const { channels } = await sharp(buffer).stats();
	const spread = channels.slice(0, 3).map((channel) => channel.stdev);
	if (spread.every((value) => value < 4)) fail(`${what} is a flat frame; the page did not render anything worth posting`);
}

try {
	try {
		await page.goto(spec.url, { waitUntil: 'networkidle', timeout: 90_000 });
	} catch {
		// A page holding a socket open never reaches network idle; the steps wait for what they need.
	}
	await page.addStyleTag({ content: `${[...OVERLAYS, ...(spec.hide || [])].join(',')}{display:none!important}` });

	const stoppedAt = await record(spec.steps?.length ? spec.steps : TOUR);
	posterBuffer ||= await page.screenshot({ type: 'png' });
	await assertNotBlank(posterBuffer, 'the poster');
	await assertNotBlank(readFileSync(frames[Math.floor(frames.length / 2)].file), 'the middle of the recording');
	const master = encode(stoppedAt);

	const posterPath = join(dirname(spec.out), 'poster.png');
	mkdirSync(resolve(root, dirname(spec.out)), { recursive: true });
	writeFileSync(resolve(root, posterPath), posterBuffer);

	// The same encoder and probe every queued video goes through, so the queue's
	// checks read this clip's real duration, size and codec.
	const prepare = ['scripts/x-content.mjs', 'prepare-video', master, '--out', spec.out];
	if (option('item')) prepare.push('--item', option('item'));
	const prepared = spawnSync(process.execPath, prepare, { cwd: root, stdio: 'inherit' });
	if (prepared.status !== 0) fail('prepare-video rejected the recording');
	console.log(`[x-clip] ${frames.length} painted frames from ${spec.url}`);
	console.log(`[x-clip] poster ${posterPath}`);
} finally {
	await browser.close();
	rmSync(work, { recursive: true, force: true });
}
