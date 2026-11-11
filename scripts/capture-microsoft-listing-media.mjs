#!/usr/bin/env node
/**
 * npm run media:microsoft
 *
 * Builds the media kit for every Microsoft listing from the live product:
 * screenshots at each store's exact size, logos and promotional tiles, a
 * captioned demo video, the manifest that records all of it, and the blocks in
 * each submission file that point at the exact assets.
 *
 * Playwright drives the real site (forge on the free lane, the viewer with that
 * result, an agent page, the Teams tab and the agent's Adaptive Card). Each scene
 * is captured once as a 2x master and downscaled to every slot it fills, so every
 * store image is retina quality. Any image whose size, format, alpha or byte
 * count misses its slot fails the run, and so does any listing image that shows
 * crypto vocabulary or transient UI.
 *
 * Flags:
 *   --base <url>      site to capture (default https://three.ws)
 *   --prompt <text>   the forge prompt (default below)
 *   --reuse           reuse the masters and video frames from the last run in
 *                     dist/microsoft-media instead of driving the site again
 *   --skip-video      images only; keep the video entry from the current manifest
 *   --skip-upload     build the video but do not upload it (the manifest keeps
 *                     the previous upload)
 *
 * Requirements and their sources: scripts/lib/microsoft-listing-media.mjs.
 * Rerun guide: marketing/microsoft/media/README.md.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import {
	findBinary,
	ASSETS,
	MASTER,
	REFERENCED,
	REQUIREMENTS_READ,
	SCENES,
	STORES,
	SUBMISSION_FILES,
	bannedTextIn,
	cuesFor,
	dimensionProblems,
	listingSafeAgent,
	pickShowcaseAgent,
	sizeLabel,
	submissionBlock,
	toNarration,
	toSrt,
	toVtt,
	upsertBlock,
} from './lib/microsoft-listing-media.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'marketing/microsoft/media');
const WORK = join(ROOT, 'dist/microsoft-media');
const MASTERS = join(WORK, 'masters');
const FORGE_RECORD = join(MASTERS, 'forge.json');
const FRAMES = join(WORK, 'frames');
const MANIFEST = join(OUT, 'manifest.json');
const BUCKET = 'three-ws-desktop-releases';
const FPS = 30;
const VIDEO = { width: 1920, height: 1080 };
const DEFAULT_PROMPT = 'a brass ship compass on a walnut stand';
const BROWSER_ARGS = ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SHOT = { timeout: 180_000, animations: 'disabled', caret: 'hide' };
const BRAND_BG = '#0b0c10';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = option('base', 'https://three.ws').replace(/\/$/, '');
const PROMPT = option('prompt', DEFAULT_PROMPT);
const REUSE = flag('reuse');
const SKIP_VIDEO = flag('skip-video');
const SKIP_UPLOAD = flag('skip-upload');

const problems = [];
const log = (...a) => console.log('[media:microsoft]', ...a);

// ── Tools ────────────────────────────────────────────────────────────────────

const FFMPEG_HINT = 'Install a static build (https://johnvansickle.com/ffmpeg/) into ~/.local/bin.';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

async function fetchJson(url) {
	const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	return res.json();
}

async function fetchText(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	return res.text();
}

async function dataUri(file, mime) {
	return `data:${mime};base64,${(await readFile(join(ROOT, file))).toString('base64')}`;
}

// ── Page helpers ─────────────────────────────────────────────────────────────

/**
 * Hide everything that floats over the product and is not part of it: the walk
 * companion, onboarding chips, toasts, sign-in prompts. Kept: full-width top
 * bars (the site nav) and full-viewport background layers. `extra` hides
 * scene-specific elements by selector.
 */
/**
 * Hide floating UI that is not part of the screen being shown. `extra` entries
 * are hidden in place; `remove` entries are taken out of the layout.
 */
async function hideOverlays(page, extra = [], remove = []) {
	await page.evaluate(([selectors, removed]) => {
		const hide = (el) => el.style.setProperty('visibility', 'hidden', 'important');
		for (const sel of selectors) for (const el of document.querySelectorAll(sel)) hide(el);
		for (const sel of removed) for (const el of document.querySelectorAll(sel)) el.style.setProperty('display', 'none', 'important');
		for (const el of document.querySelectorAll('body *')) {
			if (getComputedStyle(el).position !== 'fixed') continue;
			const r = el.getBoundingClientRect();
			if (!r.width || !r.height) continue;
			const topBar = r.top <= 1 && r.width >= innerWidth * 0.9 && r.height <= 140;
			const backdrop = r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
			if (!topBar && !backdrop) hide(el);
		}
	}, [extra, remove]);
}

/** The text a viewer can actually see in the viewport, including form values. */
async function visibleText(page) {
	return page.evaluate(() => {
		const out = [];
		const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const text = n.textContent.trim();
			const el = n.parentElement;
			if (!text || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
			if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
			const range = document.createRange();
			range.selectNodeContents(n);
			if ([...range.getClientRects()].some(inView)) out.push(text);
		}
		for (const el of document.querySelectorAll('input, textarea')) {
			if (el.value && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && inView(el.getBoundingClientRect())) out.push(el.value);
		}
		return out.join('\n');
	});
}

/** Fail the run when a listing frame shows something the listing rules keep out. */
async function gateText(page, label) {
	const found = bannedTextIn(await visibleText(page));
	if (found.length) problems.push(`${label} shows banned text: ${[...new Set(found)].join(', ')}`);
}

const nextFrames = (page, n = 3) => page.evaluate((count) => new Promise((done) => {
	let left = count;
	const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick));
	requestAnimationFrame(tick);
}), n);

/**
 * Wait for a <model-viewer> to finish loading, then stop it moving: no
 * auto-rotate, animation paused, camera jumped to a fixed orbit, full render
 * scale (software GL otherwise renders at a reduced scale). Returns the orbit
 * radius so motion shots can keep the framing.
 */
async function settleModelViewer(page, selector, orbit) {
	await page.waitForFunction((sel) => {
		const mv = document.querySelector(sel);
		return mv && mv.loaded && !mv.classList.contains('veiled');
	}, selector, { timeout: 180_000 });
	const radius = await page.evaluate(([sel, cameraOrbit]) => {
		const MV = customElements.get('model-viewer');
		if (MV) MV.minimumRenderScale = 1;
		const mv = document.querySelector(sel);
		mv.removeAttribute('auto-rotate');
		mv.autoRotate = false;
		mv.setAttribute('interaction-prompt', 'none');
		mv.pause?.();
		if (cameraOrbit) mv.cameraOrbit = cameraOrbit;
		mv.jumpCameraToGoal();
		return mv.getCameraOrbit().radius;
	}, [selector, orbit]);
	await nextFrames(page, 4);
	return radius;
}

async function orbitTo(page, selector, theta, phi, radius, time) {
	await page.evaluate(([sel, t, p, r, at]) => {
		const mv = document.querySelector(sel);
		mv.cameraOrbit = `${t}deg ${p}deg ${r}m`;
		if (at != null) mv.currentTime = at;
		mv.jumpCameraToGoal();
	}, [selector, theta, phi, radius, time ?? null]);
	await nextFrames(page, 2);
}

async function newPage(browser, { width, height, scale }) {
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: scale,
		colorScheme: 'dark',
		locale: 'en-US',
		timezoneId: 'America/Los_Angeles',
	});
	const page = await context.newPage();
	page.on('pageerror', (err) => log(`page error on ${page.url()}: ${err.message.slice(0, 160)}`));
	return page;
}

// ── Scenes ───────────────────────────────────────────────────────────────────

const FORGE_HIDE = ['#fq-holder-note', '#tier .tier-lock'];
const AGENT_HIDE = ['#av-wallet-row', 'avatar-actions'];
// Below the fold at 1080p: the agent's wallet presence card and coin earnings.
const AGENT_REMOVE = ['#av-panel-overview .nwp', '#av-earned'];

async function openForge(page) {
	// A returning visitor: the one-time first-creation confetti and card
	// (public/forge-celebrate.js) would otherwise cover the result.
	await page.addInitScript(() => {
		try { localStorage.setItem('tws:first-forge-celebrated', '1'); } catch { /* storage blocked */ }
	});
	await page.goto(`${BASE}/forge`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
	await page.waitForSelector('#engine button[data-engine="nvidia"]:not([disabled])', { timeout: 120_000 });
	await page.click('#engine button[data-engine="nvidia"]');
	await page.fill('#prompt', '');
}

/** Click generate and wait for the real result, however long the free lane takes. */
async function generate(page) {
	const started = Date.now();
	await page.click('#generate');
	await page.waitForSelector('#state-result:not(.is-hidden)', { timeout: 20 * 60_000 });
	const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
	const glb = await page.$eval('#download', (a) => a.href).catch(() => null);
	if (!glb || !/\.glb(\?|$)/.test(glb)) throw new Error(`forge finished without a GLB download link (got ${glb})`);
	return { seconds, glb };
}

async function scrollForgeResult(page) {
	await page.evaluate(() => {
		const v = document.querySelector('#viewer');
		window.scrollBy(0, v.getBoundingClientRect().top - 88);
	});
	await nextFrames(page, 2);
}

async function openTeamsTab(page, agent) {
	await page.route('**/api/agents/public?**', async (route) => {
		const response = await route.fetch();
		const body = await response.json();
		body.agents = (body.agents || []).filter(listingSafeAgent);
		await route.fulfill({ response, json: body });
	});
	await page.goto(`${BASE}/microsoft/teams-tab?theme=dark&agent=${agent.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
	await page.waitForSelector('#tt-stage agent-3d.is-ready', { timeout: 180_000 });
	await page.waitForSelector('#tt-card:not([aria-busy]) h1', { timeout: 60_000 });
	await page.waitForSelector('#tt-list .tt-item', { timeout: 60_000 });
	await page.waitForFunction(() => [...document.querySelectorAll('#tt-list img')].every((i) => i.complete), null, { timeout: 60_000 });
	await nextFrames(page, 10);
}

const INTER = '<link rel="preconnect" href="https://fonts.gstatic.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
const SLIDE_CSS = `
	*{box-sizing:border-box;margin:0}
	html,body{width:100%;height:100%;background:${BRAND_BG};color:#f4f5f7;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
	body{background:radial-gradient(120% 90% at 85% 10%,#1b2433 0%,${BRAND_BG} 55%)}
	.brand{display:flex;align-items:center;gap:.5em;font-weight:700;letter-spacing:-.01em}
	.brand img{width:1.6em;height:1.6em}
	.muted{color:#a3a9b6}
`;

/** Render a slide's fonts and images before it is captured. */
async function setSlide(page, html) {
	await page.setContent(html, { waitUntil: 'networkidle', timeout: 120_000 });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60_000 });
}

/**
 * The agent's real Adaptive Card (/api/glance/card?format=adaptive), rendered by
 * the Adaptive Cards SDK with the Microsoft Teams dark host config, beside a
 * line of three.ws copy. No Teams chrome is drawn: it is the card, not a mock of
 * the Teams client.
 */
async function adaptiveCardSlide(page, agent, card, hostConfig, logo) {
	await setSlide(page, `<!doctype html><html><head>${INTER}<style>${SLIDE_CSS}
		.wrap{display:grid;grid-template-columns:1fr 470px;gap:64px;align-items:center;height:100%;padding:0 84px}
		.brand{font-size:22px;margin-bottom:36px}
		h1{font-size:44px;line-height:1.12;letter-spacing:-.02em;font-weight:700;margin-bottom:20px}
		p{font-size:19px;line-height:1.5;max-width:30em}
		.card{background:#292929;border-radius:10px;padding:4px;box-shadow:0 24px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06)}
		.label{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7f8796;margin-bottom:14px}
		.card .ac-pushButton{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:4px;padding:5px 14px;font-family:inherit;font-size:14px;font-weight:600;line-height:20px;cursor:pointer}
	</style></head><body><div class="wrap">
		<div><div class="brand"><img src="${logo}" alt="">three.ws</div>
		<h1>Share an agent into any chat.</h1>
		<p class="muted">The three.ws agent card for Microsoft Teams: what the agent did today, this week and all time, one click from its page.</p></div>
		<div><div class="label">Adaptive Card, Teams dark host config</div><div class="card" id="card"></div></div>
	</div></body></html>`);
	await page.addScriptTag({ url: 'https://unpkg.com/adaptivecards@3.0.4/dist/adaptivecards.min.js' });
	await page.evaluate(([json, config]) => {
		const ac = new AdaptiveCards.AdaptiveCard();
		// Teams renders in Segoe UI, which this machine lacks; Inter is the closest metric match.
		ac.hostConfig = new AdaptiveCards.HostConfig({ ...config, fontFamily: `"Segoe UI", Inter, system-ui, sans-serif` });
		ac.parse(json);
		document.getElementById('card').appendChild(ac.render());
	}, [card, hostConfig]);
	await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60_000 });
	await nextFrames(page, 2);
	if (!(await page.$('#card .ac-adaptiveCard'))) throw new Error(`the Adaptive Card for ${agent.name} did not render`);
}

/**
 * Run one scene in a fresh page, retrying on a renderer crash or timeout. Software
 * WebGL on a busy machine can lose a renderer; a new page recovers it, and forge
 * returns the same prompt's finished result on a retry instead of a new job.
 */
async function withRetry(browser, viewport, label, run, attempts = 3) {
	for (let attempt = 1; ; attempt++) {
		const page = await newPage(browser, viewport);
		try {
			return await run(page);
		} catch (err) {
			if (attempt >= attempts) throw err;
			log(`${label} attempt ${attempt} failed (${err.message.split('\n')[0]}); retrying in a fresh page`);
		} finally {
			await page.context().close().catch(() => {});
		}
	}
}

async function captureMasters(browser, agent, card, hostConfig, logo) {
	await mkdir(MASTERS, { recursive: true });
	const shot = async (page, name, hide = [], remove = []) => {
		await hideOverlays(page, hide, remove);
		await gateText(page, `scene ${name}`);
		await page.screenshot({ path: join(MASTERS, `${name}.png`), ...SHOT });
		log(`captured ${name}`);
	};
	const scene = (name, run) => withRetry(browser, MASTER, `scene ${name}`, run);

	await scene('forge-composer', async (page) => {
		await openForge(page);
		await page.fill('#prompt', PROMPT);
		await page.locator('#prompt').blur();
		await shot(page, 'forge-composer', FORGE_HIDE);
	});

	const forge = await scene('forge-result', async (page) => {
		await openForge(page);
		await page.fill('#prompt', PROMPT);
		const result = await generate(page);
		log(`forge finished in ${result.seconds} s: ${result.glb}`);
		await settleModelViewer(page, '#viewer', '35deg 72deg auto');
		await scrollForgeResult(page);
		await shot(page, 'forge-result', FORGE_HIDE);
		return result;
	});

	await scene('viewer', async (page) => {
		await page.goto(`${BASE}/viewer?src=${encodeURIComponent(forge.glb)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
		await settleModelViewer(page, '#mv', '-25deg 70deg auto');
		await shot(page, 'viewer');
	});

	await scene('agent', async (page) => {
		await page.goto(`${BASE}/agents/${agent.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
		await settleModelViewer(page, '#av-viewer', '0deg 82deg auto');
		await shot(page, 'agent', AGENT_HIDE, AGENT_REMOVE);
	});

	await scene('teams-tab', async (page) => {
		await openTeamsTab(page, agent);
		await shot(page, 'teams-tab');
	});

	await scene('adaptive-card', async (page) => {
		await adaptiveCardSlide(page, agent, card, hostConfig, logo);
		await shot(page, 'adaptive-card');
	});
	// The generation belongs to these masters, so --reuse reads it from here.
	await writeFile(FORGE_RECORD, JSON.stringify({ prompt: PROMPT, ...forge }, null, 2));
	return forge;
}

// ── Artwork (logos, tiles, thumbnails) ───────────────────────────────────────

async function renderLogo(file, size) {
	const inner = Math.round(size * 0.8);
	const icon = await sharp(join(ROOT, file), { density: 300 }).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
	return sharp({ create: { width: size, height: size, channels: 3, background: BRAND_BG } })
		.composite([{ input: icon, gravity: 'centre' }])
		.png()
		.toBuffer();
}

async function renderHtml(browser, html, width, height) {
	const page = await newPage(browser, { width, height, scale: 2 });
	await setSlide(page, html);
	const buf = await page.screenshot({ ...SHOT });
	await page.context().close();
	return buf;
}

async function renderArtwork(browser, logo) {
	const art = {};
	art.logo = await renderLogo('public/pwa-512x512.png', 600);
	art['edge-logo'] = await renderLogo('public/pwa-icon.svg', 600);

	const shot = await dataUri('extensions/walk-avatar/store-assets/screenshot-1.png', 'image/png');
	art['tile-small'] = await renderHtml(browser, `<!doctype html><html><head>${INTER}<style>${SLIDE_CSS}
		body{display:flex;flex-direction:column;justify-content:center;padding:0 36px}
		.brand{font-size:15px;color:#a3a9b6;font-weight:600;margin-bottom:14px}
		h1{font-size:40px;font-weight:800;letter-spacing:-.025em;line-height:1.05}
		p{font-size:16px;margin-top:12px;line-height:1.4}
	</style></head><body><div class="brand"><img src="${logo}" alt="">three.ws</div><h1>Walk Avatar</h1><p class="muted">A 3D companion that walks<br>and reads on any page.</p></body></html>`, 440, 280);

	art['tile-large'] = await renderHtml(browser, `<!doctype html><html><head>${INTER}<style>${SLIDE_CSS}
		.wrap{display:grid;grid-template-columns:560px 1fr;height:100%;align-items:center}
		.copy{padding-left:84px}
		.brand{font-size:24px;color:#a3a9b6;font-weight:600;margin-bottom:22px}
		h1{font-size:76px;font-weight:800;letter-spacing:-.03em;line-height:1}
		p{font-size:24px;margin-top:22px;line-height:1.4}
		.shot{height:100%;position:relative;overflow:hidden}
		.shot img{position:absolute;right:-60px;top:40px;width:1040px;border-radius:14px 0 0 14px;box-shadow:0 30px 90px rgba(0,0,0,.6)}
	</style></head><body><div class="wrap"><div class="copy"><div class="brand"><img src="${logo}" alt="">three.ws</div><h1>Walk Avatar</h1><p class="muted">Your 3D avatar walks the page<br>and reads it aloud.</p></div><div class="shot"><img src="${shot}" alt=""></div></div></body></html>`, 1400, 560);
	return art;
}

async function renderThumbnail(browser, logo, agentMaster, forgeMaster) {
	const agentImg = `data:image/png;base64,${(await readFile(agentMaster)).toString('base64')}`;
	const forgeImg = `data:image/png;base64,${(await readFile(forgeMaster)).toString('base64')}`;
	return renderHtml(browser, `<!doctype html><html><head>${INTER}<style>${SLIDE_CSS}
		.wrap{display:grid;grid-template-columns:820px 1fr;height:100%;align-items:center}
		.copy{padding-left:110px}
		.brand{font-size:34px;margin-bottom:40px}
		h1{font-size:92px;font-weight:800;letter-spacing:-.035em;line-height:1.02}
		p{font-size:32px;margin-top:30px;line-height:1.35}
		.stack{position:relative;height:100%}
		.stack img{position:absolute;border-radius:16px;box-shadow:0 30px 100px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.07)}
		.a{width:900px;right:-120px;top:150px}
		.b{width:620px;right:330px;top:520px}
	</style></head><body><div class="wrap"><div class="copy"><div class="brand"><img src="${logo}" alt="">three.ws</div><h1>Give your AI a body.</h1><p class="muted">Text to 3D, agents with a face,<br>in the browser and in Teams.</p></div>
	<div class="stack"><img class="a" src="${agentImg}" alt=""><img class="b" src="${forgeImg}" alt=""></div></div></body></html>`, VIDEO.width, VIDEO.height);
}

// ── Writing and checking images ──────────────────────────────────────────────

/**
 * Resize a source to the slot and write the smallest PNG that keeps it sharp:
 * lossless at maximum compression, or a 256-colour dithered palette when that
 * still misses a byte cap.
 */
async function writeSlot(slot, source) {
	const resized = sharp(source).resize(slot.width, slot.height, { fit: 'cover', position: 'north', kernel: 'lanczos3' }).flatten({ background: BRAND_BG }).removeAlpha();
	let buf = await resized.clone().png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toBuffer();
	if (slot.maxBytes && buf.length > slot.maxBytes) {
		buf = await resized.clone().png({ palette: true, quality: 100, colours: 256, dither: 1, compressionLevel: 9, effort: 10 }).toBuffer();
	}
	const path = join(OUT, slot.store, slot.file);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, buf);
	return path;
}

async function checkFile(slot, path) {
	const buf = await readFile(path);
	const meta = await sharp(buf).metadata();
	const found = dimensionProblems(slot, meta, buf.length);
	problems.push(...found);
	return { path: rel(path), width: meta.width, height: meta.height, bytes: buf.length, sha256: sha256(buf) };
}

async function checkReferenced() {
	const out = [];
	for (const spec of REFERENCED) {
		const dir = join(ROOT, spec.dir);
		const files = existsSync(dir) ? (await readdir(dir)).filter((f) => spec.match.test(f)).sort() : [];
		if (!files.length) problems.push(`${spec.dir} has no file matching ${spec.match}; produce it with ${spec.origin}`);
		for (const file of files) {
			const entry = await checkFile({ ...spec, file }, join(dir, file));
			out.push({ store: spec.store, ...entry, origin: spec.origin });
		}
	}
	return out;
}

// ── Video ────────────────────────────────────────────────────────────────────

/**
 * The demo is stepped frame by frame, not screen-recorded: each motion frame is
 * a screenshot taken after the camera, animation clock or typed text has been
 * advanced by exactly 1/30 s, so the result is smooth and identical on any
 * machine, GPU or not. Holds are one frame shown for their duration.
 */
class Timeline {
	constructor(dir) {
		this.dir = dir;
		this.items = [];
		this.segments = [];
		this.n = 0;
	}
	async frame(page, seconds = 1 / FPS) {
		const file = join(this.dir, `f${String(this.n++).padStart(5, '0')}.jpg`);
		await page.screenshot({ path: file, type: 'jpeg', quality: 94, ...SHOT });
		this.items.push({ file, seconds });
		return file;
	}
	async still(buffer, seconds) {
		const file = join(this.dir, `f${String(this.n++).padStart(5, '0')}.jpg`);
		await sharp(buffer).resize(VIDEO.width, VIDEO.height, { fit: 'cover' }).flatten({ background: BRAND_BG }).jpeg({ quality: 94 }).toFile(file);
		this.items.push({ file, seconds });
	}
	get length() {
		return this.items.reduce((s, i) => s + i.seconds, 0);
	}
	begin(id, lines) {
		this.segments.push({ id, lines, start: this.length });
	}
	end() {
		const seg = this.segments.at(-1);
		seg.duration = this.length - seg.start;
	}
	/** Cross-fade the last frame into the next over `seconds`, taking that time from the current segment. */
	async crossfadeTo(nextBuffer, seconds = 0.4) {
		let trim = seconds;
		while (trim > 1e-6 && this.items.length) {
			const last = this.items.at(-1);
			if (last.seconds > trim + 1e-6) { last.seconds -= trim; trim = 0; } else { trim -= last.seconds; this.items.pop(); }
		}
		const from = await readFile(this.items.at(-1).file);
		const to = await sharp(nextBuffer).resize(VIDEO.width, VIDEO.height, { fit: 'cover' }).flatten({ background: BRAND_BG }).jpeg({ quality: 94 }).toBuffer();
		const steps = Math.round(seconds * FPS);
		for (let i = 1; i <= steps; i++) {
			const overlay = await sharp(to).ensureAlpha(i / (steps + 1)).png().toBuffer();
			await this.still(await sharp(from).composite([{ input: overlay }]).jpeg({ quality: 94 }).toBuffer(), 1 / FPS);
		}
	}
}

async function buildFrames(browser, ctx) {
	await rm(FRAMES, { recursive: true, force: true });
	await mkdir(FRAMES, { recursive: true });
	const t = new Timeline(FRAMES);
	const slide = (html) => renderHtml(browser, html, VIDEO.width, VIDEO.height);
	const titleCard = (headline, sub) => slide(`<!doctype html><html><head>${INTER}<style>${SLIDE_CSS}
		body{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
		.brand{font-size:40px;margin-bottom:44px}
		h1{font-size:96px;font-weight:800;letter-spacing:-.035em;line-height:1.04}
		p{font-size:34px;margin-top:30px}
	</style></head><body><div class="brand"><img src="${ctx.logo}" alt="">three.ws</div><h1>${headline}</h1><p class="muted">${sub}</p></body></html>`);
	const peek = (page) => page.screenshot({ type: 'jpeg', quality: 94, ...SHOT });
	let forgeSeconds = null;

	/**
	 * One segment in its own page. `setup` brings the page to the segment's first
	 * frame; the previous segment cross-fades into it; `frames` records the
	 * segment. A crashed renderer rolls the timeline back and retries.
	 */
	const segment = (id, lines, setup, frames) => withRetry(browser, { ...VIDEO, scale: 1 }, `video ${id}`, async (page) => {
		const snapshot = { items: t.items.map((i) => ({ ...i })), segments: t.segments.map((x) => ({ ...x })), n: t.n };
		try {
			await setup(page);
			if (t.segments.length) {
				await t.crossfadeTo(await peek(page));
				t.end();
			}
			t.begin(id, lines);
			await frames(page);
			// Content can load while a segment records; the last frame must pass too.
			await gateText(page, `video ${id} (last frame)`);
		} catch (err) {
			Object.assign(t, snapshot);
			throw err;
		}
	});
	const stillSegment = async (id, lines, buffer, seconds) => {
		if (t.segments.length) {
			await t.crossfadeTo(buffer);
			t.end();
		}
		t.begin(id, lines);
		await t.still(buffer, seconds);
	};

	await stillSegment('title', ['three.ws gives your AI a body: a 3D avatar, a voice and a persona.'],
		await titleCard('Give your AI a body.', 'Make 3D models and agents, then take them everywhere you work.'), 4);

	let radius;
	await segment('forge-type', ['Describe an object in one sentence.'], async (page) => {
		await openForge(page);
		await hideOverlays(page, FORGE_HIDE);
	}, async (page) => {
		const start = t.length;
		for (let i = 1; i <= PROMPT.length; i++) {
			await page.fill('#prompt', PROMPT.slice(0, i));
			await hideOverlays(page, FORGE_HIDE);
			await t.frame(page);
			await t.frame(page);
		}
		await page.locator('#prompt').blur();
		await gateText(page, 'video forge composer');
		await t.frame(page, Math.max(1, 5 - (t.length - start)));

		t.end();
		t.begin('forge-generate', ['Forge builds it on the free lane. No account needed.']);
		const started = Date.now();
		await page.click('#generate');
		await nextFrames(page, 6);
		await hideOverlays(page, FORGE_HIDE);
		await t.frame(page, 3);
		await page.waitForSelector('#state-result:not(.is-hidden)', { timeout: 20 * 60_000 });
		forgeSeconds = Math.max(1, Math.round((Date.now() - started) / 1000));
		radius = await settleModelViewer(page, '#viewer', '-20deg 72deg auto');
		await scrollForgeResult(page);
		await hideOverlays(page, FORGE_HIDE);
		await gateText(page, 'video forge result');
		await t.crossfadeTo(await peek(page));

		t.end();
		t.begin('forge-orbit', ['A textured 3D model from that one prompt.', 'Orbit it, download it as GLB, or place it in a scene.']);
		for (let f = 0; f < 10 * FPS; f++) {
			await orbitTo(page, '#viewer', -20 + (f / (10 * FPS)) * 110, 72, radius);
			await t.frame(page);
		}
	});

	let viewerRadius;
	await segment('viewer', ['Open any GLB or glTF in the three.ws viewer, right in the browser.'], async (page) => {
		await page.goto(`${BASE}/viewer?src=${encodeURIComponent(ctx.forge.glb)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
		viewerRadius = await settleModelViewer(page, '#mv', '-40deg 70deg auto');
		await hideOverlays(page);
		await gateText(page, 'video viewer');
	}, async (page) => {
		for (let f = 0; f < 7 * FPS; f++) {
			await orbitTo(page, '#mv', -40 + (f / (7 * FPS)) * 80, 70 - (f / (7 * FPS)) * 8, viewerRadius);
			await hideOverlays(page);
			await t.frame(page);
		}
	});

	let agentRadius;
	await segment('agent', ['Give an avatar a persona and skills, and it becomes an agent.', 'Every agent has a public page anyone can visit and chat with.'], async (page) => {
		await page.goto(`${BASE}/agents/${ctx.agent.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
		agentRadius = await settleModelViewer(page, '#av-viewer', '-12deg 82deg auto');
		await hideOverlays(page, AGENT_HIDE, AGENT_REMOVE);
		await gateText(page, 'video agent');
	}, async (page) => {
		for (let f = 0; f < 9 * FPS; f++) {
			await orbitTo(page, '#av-viewer', -12 + (f / (9 * FPS)) * 24, 82, agentRadius, f / FPS);
			// The walk companion and late panels mount after load; keep them out of every frame.
			await hideOverlays(page, AGENT_HIDE, AGENT_REMOVE);
			await t.frame(page);
		}
	});

	await segment('teams-tab', ['In Microsoft Teams, the three.ws tab lists agents and what each one did today.'], async (page) => {
		await openTeamsTab(page, ctx.agent);
		await hideOverlays(page);
		await gateText(page, 'video teams tab');
	}, (page) => t.frame(page, 7));

	await segment('adaptive-card', ['Share an agent into a chat as an Adaptive Card with its live numbers.'], async (page) => {
		await adaptiveCardSlide(page, ctx.agent, ctx.card, ctx.hostConfig, ctx.logo);
		await gateText(page, 'video adaptive card');
	}, (page) => t.frame(page, 7));

	const vscode = await slide(`<!doctype html><html><head>${INTER}<style>${SLIDE_CSS}
		body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px}
		h2{font-size:40px;font-weight:700;letter-spacing:-.02em}
		img{width:1440px;border-radius:12px;box-shadow:0 30px 100px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.07)}
	</style></head><body><h2>three.ws in Visual Studio Code</h2><img src="${await dataUri('packages/vscode-3d/images/copilot-chat-commands.png', 'image/png')}" alt=""></body></html>`);
	await stillSegment('vscode', ['In Visual Studio Code, ask GitHub Copilot to make and preview 3D models with three.ws.'], vscode, 6);
	await stillSegment('end', ['three.ws is live on Microsoft Marketplace. Start free at three.ws.'],
		await titleCard('three.ws is live on<br>Microsoft Marketplace.', 'Start free at three.ws'), 6);
	t.end();

	await writeFile(join(WORK, 'timeline.json'), JSON.stringify({ items: t.items.map((i) => ({ file: rel(i.file), seconds: i.seconds })), segments: t.segments, forgeSeconds }, null, 2));
	return { items: t.items, segments: t.segments, forgeSeconds };
}

function ffprobe(ffprobeBin, target) {
	const out = execFileSync(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,profile,pix_fmt,sample_rate', '-of', 'json', target], { encoding: 'utf8' });
	return JSON.parse(out);
}

async function encodeVideo(ffmpegBin, timeline, files) {
	const list = timeline.items.map((i) => `file '${i.file}'\nduration ${i.seconds.toFixed(6)}`).join('\n') + `\nfile '${timeline.items.at(-1).file}'\n`;
	const listPath = join(WORK, 'frames.txt');
	await writeFile(listPath, list);
	const total = timeline.items.reduce((s, i) => s + i.seconds, 0);
	const videoOut = ['-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
	const tail = ['-movflags', '+faststart', '-t', total.toFixed(3)];
	execFileSync(ffmpegBin, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf', `fps=${FPS},scale=${VIDEO.width}:${VIDEO.height},format=yuv420p`, ...videoOut, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', ...tail, files.clean], { stdio: 'inherit' });
	const style = 'FontName=DejaVu Sans,FontSize=15,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=34';
	const srtArg = files.srt.replace(/([\\:'])/g, '\\$1');
	execFileSync(ffmpegBin, ['-y', '-v', 'error', '-i', files.clean, '-vf', `subtitles='${srtArg}':force_style='${style}'`, ...videoOut, '-c:a', 'copy', ...tail, files.captioned], { stdio: 'inherit' });
	return total;
}

function upload(file, object) {
	const gcloud = findBinary('gcloud', { hint: 'Install the Google Cloud CLI (https://cloud.google.com/sdk/docs/install).' });
	execFileSync(gcloud, ['storage', 'cp', file, `gs://${BUCKET}/${object}`, '--content-type=video/mp4', '--cache-control=public, max-age=31536000, immutable'], { stdio: 'inherit' });
	return `https://storage.googleapis.com/${BUCKET}/${object}`;
}

/** Download the public URL and confirm it is the same bytes and a playable stream. */
async function verifyPublic(ffprobeBin, url, expectedSha) {
	const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	const type = res.headers.get('content-type');
	const buf = Buffer.from(await res.arrayBuffer());
	if (type !== 'video/mp4') problems.push(`${url} is served as ${type}, not video/mp4`);
	if (sha256(buf) !== expectedSha) problems.push(`${url} does not match the local file's sha256`);
	// Probe the downloaded bytes, not the URL: a static ffprobe cannot resolve
	// hostnames (no NSS in a static glibc build) and crashes on https input.
	const copy = join(WORK, `public-${expectedSha.slice(0, 12)}.mp4`);
	await writeFile(copy, buf);
	try {
		const probe = ffprobe(ffprobeBin, copy);
		if (!probe.streams.some((s) => s.codec_type === 'video' && s.codec_name === 'h264')) problems.push(`${url} has no H.264 stream`);
	} finally {
		await rm(copy, { force: true });
	}
	log(`verified ${url}: ${type}, ${sizeLabel(buf.length)}, sha256 matches`);
}

async function makeVideo(browser, ctx, previous) {
	const ffmpegBin = findBinary('ffmpeg', { extra: [join(homedir(), '.local/bin/ffmpeg')], probe: ['-version'], hint: FFMPEG_HINT });
	const ffprobeBin = findBinary('ffprobe', { extra: [join(homedir(), '.local/bin/ffprobe')], probe: ['-version'], hint: FFMPEG_HINT });
	const videoDir = join(OUT, 'video');
	await mkdir(videoDir, { recursive: true });
	const timeline = REUSE && existsSync(join(WORK, 'timeline.json'))
		? await readFile(join(WORK, 'timeline.json'), 'utf8').then((s) => {
			const j = JSON.parse(s);
			return { items: j.items.map((i) => ({ file: join(ROOT, i.file), seconds: i.seconds })), segments: j.segments, forgeSeconds: j.forgeSeconds };
		})
		: await buildFrames(browser, ctx);

	const cues = cuesFor(timeline.segments);
	const files = {
		srt: join(videoDir, 'three-ws-demo.en.srt'),
		vtt: join(videoDir, 'three-ws-demo.en.vtt'),
		narration: join(videoDir, 'narration.txt'),
		clean: join(WORK, 'three-ws-demo.mp4'),
		captioned: join(WORK, 'three-ws-demo-captioned.mp4'),
	};
	await writeFile(files.srt, toSrt(cues));
	await writeFile(files.vtt, toVtt(cues));
	await writeFile(files.narration, toNarration(cues, 'three.ws demo: narration script (60 to 70 seconds, English)'));
	const total = await encodeVideo(ffmpegBin, timeline, files);

	const probe = ffprobe(ffprobeBin, files.clean);
	const v = probe.streams.find((s) => s.codec_type === 'video');
	const a = probe.streams.find((s) => s.codec_type === 'audio');
	const duration = Number(probe.format.duration);
	if (v.width !== VIDEO.width || v.height !== VIDEO.height) problems.push(`video is ${v.width}x${v.height}, not ${VIDEO.width}x${VIDEO.height}`);
	if (v.codec_name !== 'h264' || !a || a.codec_name !== 'aac') problems.push(`video codecs are ${v.codec_name}/${a?.codec_name}, the Store needs H.264 with AAC`);
	if (duration < 60 || duration > 90) problems.push(`video runs ${duration.toFixed(1)} s, outside 60 to 90 s`);
	log(`encoded ${duration.toFixed(2)} s (timeline ${total.toFixed(2)} s)`);

	const describe = async (file) => {
		const buf = await readFile(file);
		return { bytes: buf.length, sha256: sha256(buf) };
	};
	const clean = await describe(files.clean);
	const captioned = await describe(files.captioned);
	const date = new Date().toISOString().slice(0, 10);
	let urls;
	if (SKIP_UPLOAD) {
		if (!previous?.url) problems.push('--skip-upload with no earlier upload in the manifest: the video has no public URL');
		urls = { clean: previous?.url, captioned: previous?.captioned?.url };
		if (previous?.sha256 !== clean.sha256) problems.push('--skip-upload: the new video differs from the uploaded one; rerun without --skip-upload');
	} else {
		urls = {
			clean: upload(files.clean, `marketing/microsoft/${date}/three-ws-demo-${clean.sha256.slice(0, 12)}.mp4`),
			captioned: upload(files.captioned, `marketing/microsoft/${date}/three-ws-demo-captioned-${captioned.sha256.slice(0, 12)}.mp4`),
		};
	}
	if (urls.clean) await verifyPublic(ffprobeBin, urls.clean, clean.sha256);
	if (urls.captioned) await verifyPublic(ffprobeBin, urls.captioned, captioned.sha256);
	return {
		url: urls.clean,
		...clean,
		width: v.width,
		height: v.height,
		fps: FPS,
		durationSeconds: Math.round(duration * 10) / 10,
		codecs: `${v.codec_name} ${v.profile}, ${a.codec_name} ${a.sample_rate} Hz`,
		captioned: { url: urls.captioned, ...captioned, note: 'Captions burned in, for hosts that ignore caption files.' },
		srt: rel(files.srt),
		vtt: rel(files.vtt),
		narration: rel(files.narration),
		voice: 'None recorded. narration.txt is the script, timed to the captions.',
		forgeSeconds: timeline.forgeSeconds ?? null,
	};
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	log(`capturing ${BASE}`);
	const previous = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : null;
	const directory = await fetchJson(`${BASE}/api/agents/public?avatar=1&sort=popular&limit=100`);
	const agent = pickShowcaseAgent(directory.agents);
	if (!agent) throw new Error('no public agent passes the listing filter (a 3D body, a real name, no crypto vocabulary)');
	log(`showcase agent: ${agent.name} (${agent.id})`);
	const card = await fetchJson(`${BASE}/api/glance/card?agent=${agent.id}&format=adaptive`);
	const hostConfig = JSON.parse(await fetchText('https://unpkg.com/adaptivecards-designer@2.4.4/lib/hostConfigs/microsoft-teams-dark.json'));
	const logo = await dataUri('public/pwa-icon.svg', 'image/svg+xml');

	const browser = await chromium.launch({ args: BROWSER_ARGS });
	try {
		let forge;
		if (REUSE && existsSync(FORGE_RECORD) && existsSync(join(MASTERS, 'forge-result.png'))) {
			forge = JSON.parse(await readFile(FORGE_RECORD, 'utf8'));
			log(`reusing masters from the last run (forge ${forge.seconds} s: ${forge.glb})`);
		} else {
			forge = await captureMasters(browser, agent, card, hostConfig, logo);
		}

		const art = await renderArtwork(browser, logo);
		art['video-thumbnail'] = await renderThumbnail(browser, logo, join(MASTERS, 'agent.png'), join(MASTERS, 'forge-result.png'));

		const assets = [];
		for (const slot of ASSETS) {
			const source = SCENES[slot.from] ? join(MASTERS, `${slot.from}.png`) : art[slot.from];
			const path = await writeSlot(slot, source);
			const entry = await checkFile(slot, path);
			assets.push({ store: slot.store, from: slot.from, ...entry, ...(SCENES[slot.from] ? { caption: SCENES[slot.from] } : {}) });
		}
		const referenced = await checkReferenced();

		let video = previous?.video ?? null;
		if (!SKIP_VIDEO) video = await makeVideo(browser, { agent, card, hostConfig, logo, forge }, previous?.video);
		else if (!video) problems.push('--skip-video with no earlier video in the manifest');

		const manifest = {
			capturedAt: new Date().toISOString(),
			base: BASE,
			requirementsRead: REQUIREMENTS_READ,
			generator: 'scripts/capture-microsoft-listing-media.mjs',
			showcaseAgent: { id: agent.id, name: agent.name, page: `${BASE}/agents/${agent.id}` },
			forge: { prompt: forge.prompt ?? PROMPT, lane: 'nvidia (free)', seconds: forge.seconds, glb: forge.glb },
			stores: Object.fromEntries(Object.entries(STORES).map(([k, s]) => [k, { title: s.title, source: s.source, verified: s.verified, rules: s.rules }])),
			assets,
			referenced,
			video,
		};
		await writeFile(MANIFEST, `${JSON.stringify(manifest, null, '\t')}\n`);

		for (const [file, stores] of Object.entries(SUBMISSION_FILES)) {
			const path = join(ROOT, file);
			const relRoot = `${relative(dirname(path), ROOT).split('\\').join('/')}/`;
			const current = existsSync(path)
				? await readFile(path, 'utf8')
				: '# Microsoft listing media: every asset, per store\n\nThe media kit for every Microsoft listing, generated from the live product. Each store section names the exact files to upload and the requirement page they were checked against.\n';
			await writeFile(path, upsertBlock(current, submissionBlock({ ...manifest, assets: [...assets, ...referenced] }, stores, relRoot)));
		}

		const total = assets.reduce((s, a) => s + a.bytes, 0);
		log(`wrote ${assets.length} images (${sizeLabel(total)}), checked ${referenced.length} referenced images`);
		for (const a of assets) log(`  ${a.path} ${a.width}x${a.height} ${sizeLabel(a.bytes)}`);
		if (video) log(`video ${video.url} ${video.durationSeconds} s ${sizeLabel(video.bytes)} sha256 ${video.sha256}`);
	} finally {
		await browser.close();
	}

	if (problems.length) {
		console.error(`\n[media:microsoft] ${problems.length} problem(s):`);
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
	log('every asset matches its slot');
}

main().catch((err) => {
	console.error('[media:microsoft] failed:', err);
	process.exit(1);
});
