// Proof reels: a post's video is a filmed, passing end-to-end run of the
// feature it announces.
//
// A fact check proves a page says something. It cannot prove the feature does
// it, and every post the owner has pulled was pulled for that gap: the copy
// matched the page, and the product did not live up to the copy. A scenario
// closes it. One list of steps is, at once:
//
//   the probe     every step must pass against the live product, or there is no
//                 reel and therefore no post
//   the video     the run is filmed, so the media cannot show anything the
//                 product did not do
//   the captions  each step may carry the sentence that explains it
//   the evidence  what the run read off the screen (`read`), what it waited
//                 for (`expect`), and what the server answered (`awaits`) are
//                 the facts a claim may cite
//
// Filming in real time does not work here. A headless browser renders WebGL in
// software at one to three frames a second, and a recorder pads that to 25 by
// repeating frames, which is what made the first Portal clip read as a slide
// show. So the page's clock is taken over instead: it is advanced one frame at
// a time and a screenshot is taken after each advance. Every frame of the reel
// is a real, distinct frame at exactly 1/fps of page time, and the render speed
// of the machine only decides how long the job takes.
//
// Waiting is not filmed. While a step waits on the network the clock runs in
// real time, and the reel shows a badge saying how long was cut, so a reel
// never implies a result was instant when it was not.
//
// Nothing is drawn over the product. Captions, the cut badge, and the stamp
// that says which production commit was filmed and when all live in a bar
// under the page, so no caption can hide a control and no viewer has to wonder
// what was behind it. Only the pointer is drawn on the page, because a viewer
// has to see what was clicked.
//
// A browser and ffmpeg are needed, so reels are made where posts are reviewed
// and never in production. Production checks the record (proofProblems).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SITE_CHROME, chromeStylesheet } from './site-chrome.js';
import { parseFfmpegProbe } from './media.js';

export const PROOF_DIR = 'data/x-content/proofs';
export const proofPath = (id) => `${PROOF_DIR}/${id}.json`;
export const reelPath = (id) => `public/x-media/${id}/reel.mp4`;

// Logical frame, device scale, and the height of the bar under the page. A
// small logical viewport is deliberate: the page lays out for a small screen,
// so its text and controls come out large in the final frame and stay readable
// in a phone timeline. The page is filmed at width by (height - bar); the
// output is width * scale by height * scale, always even.
export const FORMATS = {
	landscape: { width: 1024, height: 576, bar: 80, scale: 1.25 },
	square: { width: 720, height: 720, bar: 104, scale: 1.5 },
	portrait: { width: 540, height: 675, bar: 108, scale: 2 },
};
export const DEFAULT_FPS = 30;
export const PROOF_MAX_AGE_DAYS = 14;
// Under this share of changing frames a reel is a still with a progress bar.
export const MIN_MOTION = 0.15;

const LIMITS = {
	settleMs: [0, 60_000],
	holdMs: [100, 15_000],
	waitMs: [0, 180_000],
	withinMs: [1000, 300_000],
	filmedWaitFrames: 20 * DEFAULT_FPS,
};
const CUT_BADGE_AFTER_SEC = 2;
const CUT_BADGE_FRAMES = 45;
const MOVE_FRAMES = 12;
const LOCATE_FRAMES = 60;
const PAUSE_MARGIN_MS = 750;
const PAUSE_ATTEMPTS = 4;
const RIPPLE_FRAMES = 9;
const TYPE_FRAMES_PER_CHAR = 2;

// `caption` is last on purpose: any step may carry a caption as well as its
// action, and a step is only a caption step when it does nothing else.
export const STEP_KINDS = ['goto', 'hold', 'click', 'hover', 'type', 'press', 'expect', 'read', 'drag', 'scroll', 'wait', 'caption'];

// The steps that can cause a request, and so may carry `awaits`.
const ACTIONS = ['click', 'press', 'type'];

export const stepKind = (step) => STEP_KINDS.find((kind) => step && Object.hasOwn(step, kind)) || null;

const between = (value, [low, high]) => Number.isFinite(Number(value)) && Number(value) >= low && Number(value) <= high;
const targetOf = (value) => (typeof value === 'string' ? value : value?.selector || value?.text || '');

// Problems with a scenario as written, before a browser is ever started.
export function scenarioProblems(scenario) {
	if (!scenario || typeof scenario !== 'object') return ['scenario must be an object with a steps list'];
	const problems = [];
	if (scenario.format !== undefined && !FORMATS[scenario.format]) problems.push(`format must be one of ${Object.keys(FORMATS).join(', ')}`);
	if (scenario.fps !== undefined && !between(scenario.fps, [12, 60])) problems.push('fps must be between 12 and 60');
	for (const key of ['hide', 'show']) {
		if (scenario[key] !== undefined && !(Array.isArray(scenario[key]) && scenario[key].every((selector) => typeof selector === 'string' && selector))) problems.push(`${key} must be a list of selectors`);
	}
	for (const selector of Array.isArray(scenario.show) ? scenario.show : []) {
		if (!SITE_CHROME.includes(selector)) problems.push(`show "${selector}" is not site chrome; show only names chrome the camera would otherwise hide (${SITE_CHROME.join(', ')})`);
	}
	const steps = scenario.steps;
	if (!Array.isArray(steps) || !steps.length) return [...problems, 'scenario has no steps'];
	if (stepKind(steps[0]) !== 'goto') problems.push('the first step must be a goto, so the reel starts on a real page');
	if (!steps.some((step) => ['expect', 'read'].includes(stepKind(step)) || step?.awaits)) {
		problems.push('a scenario must expect, read, or await something, or it proves nothing about the feature');
	}
	const names = new Set();
	steps.forEach((step, index) => {
		const kind = stepKind(step);
		const at = `step ${index + 1}`;
		if (!kind) return problems.push(`${at}: needs one of ${STEP_KINDS.join(', ')}`);
		if (step.caption !== undefined && typeof step.caption !== 'string') problems.push(`${at}: caption must be text`);
		if (String(step.caption || '').length > 90) problems.push(`${at}: caption is ${step.caption.length} characters; a viewer reads about 90 in the time a step takes`);
		if (step.awaits !== undefined) {
			if (!ACTIONS.includes(kind)) problems.push(`${at}: awaits belongs on the action that causes the request (${ACTIONS.join(', ')})`);
			if (typeof step.awaits !== 'string' || !step.awaits.startsWith('/')) problems.push(`${at}: awaits needs the path of the request the action causes, such as "/api/galaxy"`);
		}
		switch (kind) {
			case 'goto':
				if (!/^https:\/\//.test(String(step.goto))) problems.push(`${at}: goto needs an https url`);
				if (step.settle !== undefined && !between(step.settle, LIMITS.settleMs)) problems.push(`${at}: settle is 0 to ${LIMITS.settleMs[1]} ms`);
				break;
			case 'hold':
				if (!between(step.hold, LIMITS.holdMs)) problems.push(`${at}: hold is ${LIMITS.holdMs[0]} to ${LIMITS.holdMs[1]} ms of film`);
				break;
			case 'wait':
				if (!between(step.wait, LIMITS.waitMs)) problems.push(`${at}: wait is up to ${LIMITS.waitMs[1]} ms`);
				break;
			case 'click':
			case 'hover':
				if (!targetOf(step[kind])) problems.push(`${at}: ${kind} needs the visible text of the control, or { "selector": "..." }`);
				break;
			case 'type':
				if (typeof step.type !== 'string' || !step.type) problems.push(`${at}: type needs the text to type`);
				if (!step.into) problems.push(`${at}: type needs "into": the placeholder, label, or selector of the field`);
				break;
			case 'press':
				if (typeof step.press !== 'string' || !step.press) problems.push(`${at}: press needs a key name such as Enter`);
				if (step.hold !== undefined && !between(step.hold, LIMITS.holdMs)) problems.push(`${at}: hold is ${LIMITS.holdMs[0]} to ${LIMITS.holdMs[1]} ms of the key held down`);
				break;
			case 'expect':
				if (typeof step.expect !== 'string' || !step.expect.trim()) problems.push(`${at}: expect needs the text that only appears once the feature worked`);
				if (step.within !== undefined && !between(step.within, LIMITS.withinMs)) problems.push(`${at}: within is ${LIMITS.withinMs[0]} to ${LIMITS.withinMs[1]} ms`);
				break;
			case 'read':
				if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(String(step.read))) problems.push(`${at}: read needs a fact name such as "entries"`);
				else if (names.has(step.read)) problems.push(`${at}: fact "${step.read}" is read twice`);
				else names.add(step.read);
				try {
					new RegExp(step.match, 'i');
					if (!step.match) problems.push(`${at}: read needs "match": a pattern whose first group is the fact`);
				} catch (err) {
					problems.push(`${at}: match is not a valid pattern (${err.message})`);
				}
				break;
			case 'drag': {
				const points = step.drag;
				const valid = Array.isArray(points) && points.length === 2 && points.every((point) => Array.isArray(point) && point.length === 2 && point.every((n) => between(n, [0, 1])));
				if (!valid) problems.push(`${at}: drag needs [[x, y], [x, y]] as fractions of the viewport, 0 to 1`);
				break;
			}
			case 'scroll':
				if (typeof step.scroll !== 'number' && !targetOf(step.scroll)) problems.push(`${at}: scroll needs a pixel distance or the text to scroll to`);
				break;
			default:
				break;
		}
	});
	return problems;
}

export const scenarioHash = (scenario) => createHash('sha256').update(JSON.stringify(scenario || null)).digest('hex');

export function loadProof(root, id) {
	const path = resolve(root, proofPath(id));
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// Why the proof on record does not cover this item as it is now, or [] when it
// does. Runs everywhere, production included: it reads files, never a browser.
export function proofProblems(item, root, now = Date.now()) {
	if (!item.scenario) return [];
	const proof = loadProof(root, item.id);
	if (!proof) return [`no proof on record; run \`npm run x:content -- prove ${item.id}\``];
	const problems = [];
	if (!proof.passed) {
		const failed = (proof.steps || []).find((step) => !step.ok);
		problems.push(`the last run failed${failed ? ` at step ${failed.index} (${failed.kind} ${failed.target}): ${failed.detail}` : ''}`);
		return problems;
	}
	if (proof.scenarioHash !== scenarioHash(item.scenario)) problems.push('the scenario changed after it was filmed; prove it again');
	const age = (now - Date.parse(proof.ranAt)) / 86_400_000;
	if (age > PROOF_MAX_AGE_DAYS) problems.push(`the reel was filmed ${Math.floor(age)} days ago; the product moves, so film it again`);
	const reel = (item.posts || []).flatMap((post) => post.media || []).find((media) => media.path === proof.video?.path);
	if (!reel) problems.push(`the head post does not carry the reel ${proof.video?.path || ''}`);
	else {
		const file = resolve(root, reel.path);
		if (existsSync(file) && sha256File(file) !== proof.video.sha256) problems.push(`${reel.path} is not the file the proof filmed`);
	}
	if (proof.video && proof.video.motion < MIN_MOTION) {
		problems.push(`only ${Math.round(proof.video.motion * 100)}% of the reel's frames change; film an action, or post a still instead`);
	}
	return problems;
}

// A fact as a number: "2,549 agents" and "2549" both read as 2549.
export function factNumber(value) {
	const match = /-?\d[\d,]*(?:\.\d+)?/.exec(String(value ?? ''));
	return match ? Number(match[0].replace(/,/g, '')) : NaN;
}

// How each fact the run reads is held when the product is checked again. A
// fact the copy states exactly (`equals`, `contains`, or a bare citation) must
// still read the same, or the reel and the post are out of date. A fact the
// copy states as a floor (`min`) only has to stay at or above it, so a count
// that grows does not send a true post back to be filmed again. A fact no
// claim cites may move freely: the reel is stamped with the day it was filmed.
export function factRules(item) {
	const rules = {};
	for (const claim of item?.claims || []) {
		for (const evidence of claim.evidence || []) {
			if (evidence.type !== 'proof' || evidence.fact === undefined) continue;
			const rule = (rules[evidence.fact] ||= { exact: false, min: -Infinity });
			if (evidence.min !== undefined) rule.min = Math.max(rule.min, Number(evidence.min));
			else rule.exact = true;
		}
	}
	return rules;
}

// A claim may cite the run: a fact it read off the screen, or a text it waited
// for. `equals` and `contains` compare against the fact as it was read, and
// `min` holds it to a floor.
export function factCheck(evidence, proof) {
	if (!proof) return { ok: false, detail: 'no proof on record' };
	if (!proof.passed) return { ok: false, detail: 'the last run of the scenario failed' };
	if (evidence.responded !== undefined) {
		const hit = (proof.responses || []).find((row) => row.path.includes(String(evidence.responded)));
		return { ok: Boolean(hit), detail: hit ? `${hit.method} ${hit.path} answered ${hit.status} in ${hit.seconds} s` : `no step of the run awaited "${evidence.responded}"` };
	}
	if (evidence.saw !== undefined) {
		const wanted = String(evidence.saw).toLowerCase();
		const seen = (proof.saw || []).some((text) => String(text).toLowerCase().includes(wanted));
		return { ok: seen, detail: seen ? `the run waited for and saw "${evidence.saw}"` : `no step of the run expected "${evidence.saw}"` };
	}
	const value = proof.facts?.[evidence.fact];
	if (value === undefined) return { ok: false, detail: `the run read no fact named "${evidence.fact}"` };
	if (evidence.equals !== undefined) {
		const ok = String(value) === String(evidence.equals);
		return { ok, detail: `the run read ${evidence.fact} = "${value}"${ok ? '' : `; the claim needs "${evidence.equals}"`}` };
	}
	if (evidence.min !== undefined) {
		const number = factNumber(value);
		const ok = Number.isFinite(number) && number >= Number(evidence.min);
		return { ok, detail: `the run read ${evidence.fact} = "${value}"${ok ? `, at least ${evidence.min}` : `; the claim needs at least ${evidence.min}`}` };
	}
	if (evidence.contains !== undefined) {
		const ok = String(value).toLowerCase().includes(String(evidence.contains).toLowerCase());
		return { ok, detail: `the run read ${evidence.fact} = "${value}"${ok ? '' : `; the claim needs it to contain "${evidence.contains}"`}` };
	}
	return { ok: true, detail: `the run read ${evidence.fact} = "${value}"` };
}

export function formatCut(seconds) {
	const total = Math.round(seconds);
	if (total < 60) return `${total} s`;
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// ── In the page ─────────────────────────────────────────────────────────────
// The pointer lives in a closed shadow root hung off <html>, not <body>: the
// page's own text queries never see it and a framework that replaces the body
// does not remove it.
function installPointer({ stylesheet }) {
	// Embedded frames get no pointer and no stylesheet of ours.
	if (window.__reel || window.top !== window) return;
	const host = document.createElement('div');
	host.setAttribute('data-reel-overlay', '');
	host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
	const shadow = host.attachShadow({ mode: 'closed' });
	shadow.innerHTML = `
		<style>
			.cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
				background: rgba(255, 255, 255, .55); border: 2px solid rgba(8, 9, 12, .85); box-shadow: 0 2px 10px rgba(0, 0, 0, .5); display: none; }
			.ripple { position: absolute; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
				border: 3px solid rgba(255, 255, 255, .9); display: none; }
		</style>
		<div class="ripple"></div><div class="cursor"></div>`;
	const part = (name) => shadow.querySelector(`.${name}`);
	const chrome = document.createElement('style');
	chrome.setAttribute('data-reel-chrome', '');
	chrome.textContent = stylesheet;
	// An init script can run before <html> exists, so the first observer waits
	// for the root element and the second keeps the overlay attached to it.
	let watching = null;
	const mount = () => {
		const rootNode = document.documentElement;
		if (!rootNode) return;
		if (!host.isConnected) rootNode.appendChild(host);
		if (!chrome.isConnected) rootNode.appendChild(chrome);
		if (watching !== rootNode) {
			watching = rootNode;
			new MutationObserver(mount).observe(rootNode, { childList: true });
		}
	};
	mount();
	new MutationObserver(mount).observe(document, { childList: true });
	window.__reel = {
		cursor(x, y) {
			const node = part('cursor');
			node.style.display = 'block';
			node.style.transform = `translate(${x}px, ${y}px)`;
		},
		rest() {
			part('cursor').style.display = 'none';
		},
		// The ring is sized from the page clock, so it grows one step per filmed
		// frame instead of at whatever rate the compositor is running.
		ripple(x, y, ms) {
			const node = part('ripple');
			const start = performance.now();
			node.style.display = 'block';
			const tick = () => {
				const t = Math.min(1, (performance.now() - start) / ms);
				node.style.transform = `translate(${x}px, ${y}px) scale(${1 + t * 2.2})`;
				node.style.opacity = String(1 - t);
				if (t < 1) requestAnimationFrame(tick);
				else node.style.display = 'none';
			};
			tick();
		},
	};
}

// ── The bar ─────────────────────────────────────────────────────────────────
// A page of its own, in the same browser, rendered at the same device scale and
// stacked under every frame. It is only photographed again when what it says
// changes.
const FONT_FILE = fileURLToPath(new URL('../../../public/fonts/inter-latin.woff2', import.meta.url));

function barDocument() {
	const font = existsSync(FONT_FILE) ? `@font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${readFileSync(FONT_FILE).toString('base64')}) format('woff2'); }` : '';
	return `<!doctype html><meta charset="utf-8"><style>
		${font}
		* { box-sizing: border-box; margin: 0; }
		html, body { height: 100%; background: #07080b; color: #fff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
		body { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0 4vw; padding: 0 4vw; border-top: 1px solid rgba(255, 255, 255, .1); }
		#caption { font-size: min(34vh, 4.1vw); font-weight: 600; line-height: 1.22; letter-spacing: -.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
		aside { display: grid; justify-items: end; gap: .5vh; text-align: right; white-space: nowrap; }
		#badge { font-size: min(19vh, 2.2vw); font-weight: 600; color: #ffd479; min-height: 1.2em; }
		#stamp { font-size: min(16vh, 1.85vw); font-weight: 500; color: rgba(255, 255, 255, .62); font-variant-numeric: tabular-nums; }
	</style><div id="caption"></div><aside><div id="badge"></div><div id="stamp"></div></aside>`;
}

class Bar {
	constructor(page) {
		this.page = page;
		this.state = { caption: '', badge: '', stamp: '' };
		this.shot = null;
	}

	static async open(context, format, stamp) {
		const page = await context.newPage();
		await page.setViewportSize({ width: format.width, height: format.bar });
		await page.setContent(barDocument(), { waitUntil: 'load' });
		await page.evaluate(() => document.fonts.ready);
		const bar = new Bar(page);
		await bar.set({ stamp });
		return bar;
	}

	async set(change) {
		const next = { ...this.state, ...change };
		if (JSON.stringify(next) === JSON.stringify(this.state) && this.shot) return;
		this.state = next;
		await this.page.evaluate((state) => {
			for (const [id, text] of Object.entries(state)) document.getElementById(id).textContent = text;
		}, next);
		this.shot = await this.page.screenshot({ type: 'png', scale: 'device' });
	}
}

const visibleText = () => (document.querySelector('main')?.innerText || document.body?.innerText || '').replace(/[ \t ]+/g, ' ');

// ── The take ────────────────────────────────────────────────────────────────
class Take {
	constructor(page, { fps, film, framesDir, bar, size, compose }) {
		this.page = page;
		this.bar = bar;
		this.size = size;
		this.compose = compose;
		this.fps = fps;
		this.film = film;
		this.framesDir = framesDir;
		this.frameMs = 1000 / fps;
		this.count = 0;
		this.changes = 0;
		this.lastHash = null;
		this.paused = false;
		this.badgeFrames = 0;
		this.cursor = null;
		this.cuts = [];
	}

	// The pause lands a little ahead of the page's clock. A page with a live
	// render loop can run past a narrow margin between the read and the pause
	// ("Cannot fast-forward to the past"), so the margin is generous and a miss
	// is read again and retried.
	async pause() {
		if (this.paused) return;
		for (let attempt = 1; attempt <= PAUSE_ATTEMPTS; attempt++) {
			const pageNow = await this.page.evaluate(() => Date.now());
			try {
				await this.page.clock.pauseAt(pageNow + PAUSE_MARGIN_MS * attempt);
				this.paused = true;
				return;
			} catch (err) {
				if (attempt === PAUSE_ATTEMPTS || !/past/i.test(String(err.message))) throw err;
			}
		}
	}

	async resume() {
		if (!this.paused) return;
		await this.page.clock.resume();
		this.paused = false;
	}

	async frame() {
		await this.pause();
		await this.page.clock.runFor(this.frameMs);
		if (this.badgeFrames > 0 && --this.badgeFrames === 0) await this.bar.set({ badge: '' });
		if (!this.film) return;
		const shot = await this.page.screenshot({ type: 'png', scale: 'device', timeout: 60_000 });
		// Motion is measured on the product alone, so a caption changing never
		// counts as the feature doing something.
		const hash = createHash('sha1').update(shot).digest('hex');
		if (this.lastHash && hash !== this.lastHash) this.changes++;
		this.lastHash = hash;
		const frame = await this.compose(shot, this.bar.shot, this.size);
		writeFileSync(join(this.framesDir, `f${String(++this.count).padStart(6, '0')}.jpg`), frame);
	}

	async frames(count) {
		for (let index = 0; index < count; index++) await this.frame();
	}

	pointer(method, ...args) {
		return this.page.evaluate(([name, values]) => window.__reel?.[name]?.(...values), [method, args]);
	}

	// Anything that waits on the world runs on the real clock and is not filmed.
	// A cut long enough to notice is labelled on the frames that follow it.
	async unfilmed(index, work) {
		const started = Date.now();
		await this.resume();
		try {
			return await work();
		} finally {
			const seconds = (Date.now() - started) / 1000;
			await this.pause();
			if (seconds >= CUT_BADGE_AFTER_SEC && this.count > 0) {
				this.cuts.push({ afterStep: index, seconds: Math.round(seconds * 10) / 10 });
				await this.bar.set({ badge: `cut ${formatCut(seconds)}` });
				this.badgeFrames = CUT_BADGE_FRAMES;
			}
		}
	}

	async moveTo(x, y) {
		const viewport = this.page.viewportSize();
		const from = this.cursor || { x: viewport.width * 0.5, y: viewport.height * 0.62 };
		for (let step = 1; step <= MOVE_FRAMES; step++) {
			const t = step / MOVE_FRAMES;
			const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
			const at = { x: from.x + (x - from.x) * eased, y: from.y + (y - from.y) * eased };
			await this.page.mouse.move(at.x, at.y);
			await this.pointer('cursor', at.x, at.y);
			await this.frame();
		}
		this.cursor = { x, y };
	}
}

// Exact names are tried before partial ones. A partial match is how "Search"
// once resolved to a "Clear search" button that sat earlier in the page, and
// the reel filmed the query being wiped instead of run.
// `field` is true for something to type into, false for something to click,
// and 'any' for a place to scroll to, which may be either.
function candidatesFor(page, text, field) {
	const fields = (exact) => [page.getByPlaceholder(text, { exact }), page.getByLabel(text, { exact }), page.getByRole('textbox', { name: text, exact }), page.getByRole('searchbox', { name: text, exact }), page.getByRole('combobox', { name: text, exact })];
	const controls = (exact) => [page.getByRole('button', { name: text, exact }), page.getByRole('link', { name: text, exact }), page.getByRole('tab', { name: text, exact }), page.getByRole('menuitem', { name: text, exact }), page.getByText(text, { exact })];
	const named = (exact) => (field === 'any' ? [...controls(exact), ...fields(exact)] : field ? fields(exact) : controls(exact));
	return [...named(true), ...named(false)];
}

async function locateNow(page, target, field) {
	if (typeof target === 'object' && target?.selector) {
		const chosen = page.locator(target.selector).filter({ visible: true });
		return (await chosen.count().catch(() => 0)) > 0 ? chosen.first() : null;
	}
	for (const candidate of candidatesFor(page, targetOf(target), field)) {
		const visible = candidate.filter({ visible: true });
		if ((await visible.count().catch(() => 0)) > 0) return visible.first();
	}
	return null;
}

// A control that is about to appear is waited for on the page's clock, which
// is filmed: the viewer sees the same second pass that the run did.
async function locate(take, target, { field = false } = {}) {
	for (let waited = 0; waited <= LOCATE_FRAMES; waited++) {
		const found = await locateNow(take.page, target, field);
		if (found) return found;
		await take.frame();
	}
	throw new Error(`nothing visible matches "${targetOf(target)}"`);
}

async function centreOf(locator) {
	await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
	const box = await locator.boundingBox();
	if (!box) throw new Error('the control has no box on screen');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function waitForText(page, text, timeout) {
	await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
}

// The request an action must cause. The listener is armed before the action
// and awaited after it, off the film, on the real clock.
function armResponse(take, step) {
	if (!step.awaits) return null;
	const started = Date.now();
	const pending = take.page
		.waitForResponse((response) => new URL(response.url()).pathname.startsWith(step.awaits), { timeout: step.within ?? 60_000 })
		.then((response) => ({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status(), seconds: Math.round((Date.now() - started) / 100) / 10 }));
	// The action may throw first; this promise must not become an unhandled
	// rejection while nothing is awaiting it yet.
	pending.catch(() => {});
	return pending;
}

async function settleResponse(take, step, index, run, pending) {
	if (!pending) return '';
	const hit = await take.unfilmed(index, () => pending).catch(() => {
		throw new Error(`no request to ${step.awaits} answered within ${(step.within ?? 60_000) / 1000} s`);
	});
	if (hit.status >= 400) throw new Error(`${hit.method} ${hit.path} answered HTTP ${hit.status}`);
	run.responses.push(hit);
	return `; ${hit.method} ${hit.path} answered ${hit.status} in ${hit.seconds} s`;
}

const STEPS = {
	async goto(take, step, index) {
		await take.unfilmed(index, async () => {
			const response = await take.page.goto(step.goto, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
			await take.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
			await take.page.waitForTimeout(step.settle ?? 6000);
		});
		take.cursor = null;
		return `loaded ${step.goto}`;
	},
	async hold(take, step) {
		await take.frames(Math.round((step.hold / 1000) * take.fps));
		return `${step.hold} ms`;
	},
	async caption() {
		return 'caption set';
	},
	async wait(take, step, index) {
		await take.unfilmed(index, () => take.page.waitForTimeout(step.wait));
		return `${step.wait} ms, not filmed`;
	},
	async click(take, step, index, run) {
		const at = await centreOf(await locate(take, step.click));
		await take.moveTo(at.x, at.y);
		const pending = armResponse(take, step);
		await take.pointer('ripple', at.x, at.y, RIPPLE_FRAMES * take.frameMs);
		await take.page.mouse.click(at.x, at.y);
		await take.frames(RIPPLE_FRAMES);
		// The pointer has said what was clicked. Left in place it covers the
		// control's own label for the rest of the reel.
		await take.pointer('rest');
		return `clicked${await settleResponse(take, step, index, run, pending)}`;
	},
	async hover(take, step) {
		const at = await centreOf(await locate(take, step.hover));
		await take.moveTo(at.x, at.y);
		await take.frames(6);
		return 'hovered';
	},
	async type(take, step, index, run) {
		const field = await locate(take, step.into, { field: true });
		const at = await centreOf(field);
		await take.moveTo(at.x, at.y);
		await take.page.mouse.click(at.x, at.y);
		await take.frames(4);
		const pending = armResponse(take, step);
		for (const char of step.type) {
			await take.page.keyboard.type(char);
			await take.frames(TYPE_FRAMES_PER_CHAR);
		}
		return `typed ${step.type.length} characters${await settleResponse(take, step, index, run, pending)}`;
	},
	// A tap by default. With `hold`, the key stays down for that much page
	// time, filmed, which is how a character is walked with W or an arrow key.
	async press(take, step, index, run) {
		const pending = armResponse(take, step);
		if (step.hold) {
			await take.page.keyboard.down(step.press);
			await take.frames(Math.round((step.hold / 1000) * take.fps));
			await take.page.keyboard.up(step.press);
		} else {
			await take.page.keyboard.press(step.press);
		}
		await take.frames(6);
		return `${step.hold ? `held ${step.press} for ${step.hold} ms` : `pressed ${step.press}`}${await settleResponse(take, step, index, run, pending)}`;
	},
	async expect(take, step, index) {
		const within = step.within ?? 45_000;
		if (step.film) {
			const deadline = Date.now() + within;
			const target = take.page.getByText(step.expect, { exact: false }).filter({ visible: true });
			for (let filmed = 0; filmed < LIMITS.filmedWaitFrames; filmed++) {
				if ((await target.count()) > 0) return `appeared after ${filmed} filmed frames`;
				if (Date.now() > deadline) break;
				await take.frame();
			}
			throw new Error(`"${step.expect}" did not appear within ${within} ms`);
		}
		const started = Date.now();
		await take.unfilmed(index, () => waitForText(take.page, step.expect, within));
		return `appeared after ${((Date.now() - started) / 1000).toFixed(1)} s`;
	},
	async read(take, step, _index, run) {
		const scope = step.selector ? await take.page.locator(step.selector).first().innerText({ timeout: 10_000 }) : await take.page.evaluate(visibleText);
		const match = new RegExp(step.match, 'i').exec(scope);
		if (!match) throw new Error(`the page shows nothing matching /${step.match}/`);
		run.facts[step.read] = String(match[1] ?? match[0]).trim();
		return `${step.read} = "${run.facts[step.read]}"`;
	},
	async drag(take, step) {
		const viewport = take.page.viewportSize();
		const [[x1, y1], [x2, y2]] = step.drag.map(([x, y]) => [x * viewport.width, y * viewport.height]);
		await take.moveTo(x1, y1);
		await take.page.mouse.down();
		const count = Math.max(6, Math.round(((step.ms ?? 1500) / 1000) * take.fps));
		for (let index = 1; index <= count; index++) {
			const t = index / count;
			const at = { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
			await take.page.mouse.move(at.x, at.y);
			await take.pointer('cursor', at.x, at.y);
			await take.frame();
		}
		await take.page.mouse.up();
		take.cursor = { x: x2, y: y2 };
		await take.frames(6);
		await take.pointer('rest');
		return `dragged over ${count} frames`;
	},
	async scroll(take, step) {
		const count = Math.max(6, Math.round(((step.ms ?? 1000) / 1000) * take.fps));
		let distance = step.scroll;
		if (typeof distance !== 'number') {
			const box = await (await locate(take, step.scroll, { field: 'any' })).boundingBox();
			if (!box) throw new Error('the scroll target has no box on screen');
			distance = box.y - take.page.viewportSize().height * 0.3;
		}
		for (let index = 0; index < count; index++) {
			await take.page.mouse.wheel(0, distance / count);
			await take.frame();
		}
		return `scrolled ${Math.round(distance)} px`;
	},
};

// One frame of the reel: the page on top, the bar under it.
async function composer() {
	const { default: sharp } = await import('sharp');
	return (shot, bar, size) =>
		sharp({ create: { width: size.width, height: size.height, channels: 3, background: '#07080b' } })
			.composite([
				{ input: shot, top: 0, left: 0 },
				{ input: bar, top: size.page, left: 0 },
			])
			.jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
			.toBuffer();
}

// WebGL is rendered in software, because the machines that make reels have no
// GPU. The last two flags are what make filming practical: without them the
// page itself is composited through the same software Vulkan device as the
// scene, and one frame of a plain list page measured 3.5 to 15 seconds. With
// the page composited on the CPU the same frame takes about 250 ms, and WebGL
// still runs on SwiftShader exactly as before.
const BROWSER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-compositing', '--disable-gpu-rasterization'];

// Runs the scenario against the live product. With `film` false no frame is
// captured, which is the fast path a review uses to confirm the feature still
// works and still shows the facts the reel shows.
export async function runScenario(scenario, { film = true, stamp = '', framesDir = null, failureShot = null } = {}) {
	const { chromium } = await import('playwright');
	const format = FORMATS[scenario.format || 'landscape'];
	const fps = scenario.fps || DEFAULT_FPS;
	const size = { width: Math.round(format.width * format.scale), height: Math.round(format.height * format.scale), page: Math.round((format.height - format.bar) * format.scale) };
	const browser = await chromium.launch({ args: BROWSER_ARGS });
	const run = { passed: true, steps: [], facts: {}, saw: [], responses: [], cuts: [], frames: 0, changes: 0, fps, width: size.width, height: size.height };
	try {
		const context = await browser.newContext({ viewport: { width: format.width, height: format.height - format.bar }, deviceScaleFactor: format.scale, reducedMotion: 'no-preference' });
		const bar = await Bar.open(context, format, stamp);
		const page = await context.newPage();
		await page.clock.install();
		await page.addInitScript(installPointer, { stylesheet: chromeStylesheet(scenario.hide, scenario.show) });
		const take = new Take(page, { fps, film, framesDir, bar, size, compose: film ? await composer() : null });

		for (const [offset, step] of scenario.steps.entries()) {
			const index = offset + 1;
			const kind = stepKind(step);
			const started = Date.now();
			const framesBefore = take.count;
			const row = { index, kind, target: targetOf(step[kind]) || String(step[kind]) };
			try {
				if (step.caption !== undefined) await bar.set({ caption: step.caption });
				row.detail = await STEPS[kind](take, step, index, run);
				if (kind === 'expect') run.saw.push(step.expect);
				row.ok = true;
			} catch (err) {
				row.ok = false;
				row.detail = String(err.message || err).split('\n')[0];
				run.passed = false;
				if (failureShot) await page.screenshot({ path: failureShot, timeout: 30_000 }).catch(() => {});
			}
			row.ms = Date.now() - started;
			row.frames = take.count - framesBefore;
			run.steps.push(row);
			if (!row.ok) break;
		}
		run.frames = take.count;
		run.changes = take.changes;
		run.cuts = take.cuts;
	} finally {
		await browser.close();
	}
	return run;
}

export function ffmpegPath(root) {
	const bundled = resolve(root, 'node_modules/ffmpeg-static/ffmpeg');
	return existsSync(bundled) ? bundled : 'ffmpeg';
}

// Frames in, an X-ready clip out: H.264 high, yuv420p, constant frame rate,
// moov atom first so it plays before it has finished downloading.
export function encodeReel({ root, framesDir, out, fps }) {
	mkdirSync(dirname(out), { recursive: true });
	const ffmpeg = ffmpegPath(root);
	const encode = spawnSync(
		ffmpeg,
		['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', join(framesDir, 'f%06d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', '-an', out],
		{ encoding: 'utf8' },
	);
	if (encode.status !== 0) throw new Error(`ffmpeg failed: ${String(encode.stderr || encode.error?.message || '').trim().split('\n').slice(-2).join(' | ')}`);
	const probe = parseFfmpegProbe(spawnSync(ffmpeg, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr || '');
	if (!probe) throw new Error(`could not read the encoded reel ${out}`);
	return probe;
}

// Still frames out of a finished reel, for the editor, which cannot watch video.
export function reelFrames({ root, path, count = 4 }) {
	const ffmpeg = ffmpegPath(root);
	const file = resolve(root, path);
	const probe = parseFfmpegProbe(spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr || '');
	if (!probe) return [];
	const dir = mkdtempSync(join(tmpdir(), 'reel-frames-'));
	try {
		const frames = [];
		for (let index = 0; index < count; index++) {
			const at = probe.durationSec * ((index + 0.6) / count);
			const out = join(dir, `k${index}.jpg`);
			const cut = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(2), '-i', file, '-frames:v', '1', '-q:v', '3', out], { encoding: 'utf8' });
			if (cut.status === 0 && existsSync(out)) frames.push({ atSec: Math.round(at * 10) / 10, buffer: readFileSync(out) });
		}
		return frames;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function productionVersion(scenario) {
	try {
		const origin = new URL(scenario.steps[0].goto).origin;
		const response = await fetch(`${origin}/api/version`, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) return null;
		const body = await response.json();
		return { commit: body.commitShort || String(body.commit || '').slice(0, 9) || null, revision: body.runtime?.revision || null };
	} catch {
		return null;
	}
}

// Films the item's scenario and writes the proof. Returns { proof, media },
// where media is the attachment for the head post, or null when the run failed.
export async function proveItem(item, { root, film = true, now = Date.now(), failureShot = null }) {
	const problems = scenarioProblems(item.scenario);
	if (problems.length) throw new Error(`scenario is not runnable: ${problems.join('; ')}`);
	const version = await productionVersion(item.scenario);
	const day = new Date(now).toISOString().slice(0, 10);
	const host = new URL(item.scenario.steps[0].goto).host;
	const stamp = item.scenario.stamp === false ? '' : `live on ${host}${version?.commit ? ` @ ${version.commit}` : ''}, ${day}`;
	const framesDir = film ? mkdtempSync(join(tmpdir(), `reel-${item.id}-`)) : null;
	try {
		const run = await runScenario(item.scenario, { film, stamp, framesDir, failureShot });
		const proof = {
			id: item.id,
			scenarioHash: scenarioHash(item.scenario),
			ranAt: new Date(now).toISOString(),
			target: version,
			passed: run.passed,
			steps: run.steps,
			facts: run.facts,
			saw: run.saw,
			responses: run.responses,
			cuts: run.cuts,
			video: null,
		};
		let media = null;
		if (run.passed && film) {
			if (run.frames < run.fps) throw new Error(`the scenario filmed ${run.frames} frame(s); add hold steps so there is something to watch`);
			const path = reelPath(item.id);
			const probe = encodeReel({ root, framesDir, out: resolve(root, path), fps: run.fps });
			const motion = run.frames > 1 ? Math.round((run.changes / (run.frames - 1)) * 1000) / 1000 : 0;
			proof.video = { path, sha256: sha256File(resolve(root, path)), frames: run.frames, motion, ...probe };
			media = { path, probe, reel: true };
		}
		if (film || !run.passed) {
			const target = resolve(root, proofPath(item.id));
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, `${JSON.stringify(proof, null, '\t')}\n`);
		}
		return { proof, media };
	} finally {
		if (framesDir) rmSync(framesDir, { recursive: true, force: true });
	}
}

// What a person would look for before writing a scenario: the controls, the
// fields, the headings, and the lines of the page that carry a number.
export async function scoutPage(url, { format = 'landscape', settle = 7000, shot = null, hide = [], show = [] } = {}) {
	const { chromium } = await import('playwright');
	const size = FORMATS[format];
	const browser = await chromium.launch({ args: BROWSER_ARGS });
	try {
		const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale });
		await page.addInitScript(installPointer, { stylesheet: chromeStylesheet(hide, show) });
		const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
		await page.waitForTimeout(settle);
		if (shot) await page.screenshot({ path: shot });
		const outline = await page.evaluate(() => {
			const seen = (node) => {
				const box = node.getBoundingClientRect();
				const style = getComputedStyle(node);
				return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
			};
			const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
			const unique = (list) => [...new Set(list.filter(Boolean))];
			const inMain = (node) => !node.closest('nav, header, footer, [data-reel-overlay]');
			const pick = (selector, read, limit) => unique([...document.querySelectorAll(selector)].filter((node) => seen(node) && inMain(node)).map(read)).slice(0, limit);
			const text = (document.querySelector('main')?.innerText || document.body.innerText || '').split('\n').map(clean).filter(Boolean);
			return {
				title: document.title,
				headings: pick('h1, h2, h3', (node) => clean(node.innerText).slice(0, 120), 20),
				buttons: pick('button, [role="button"], [role="tab"], summary', (node) => clean(node.innerText || node.getAttribute('aria-label')).slice(0, 60), 40),
				links: pick('main a[href], [role="main"] a[href]', (node) => `${clean(node.innerText).slice(0, 50)} -> ${node.getAttribute('href')}`, 25),
				fields: pick('input, textarea, select', (node) => clean(`${node.tagName.toLowerCase()}[${node.type || ''}] placeholder="${node.placeholder || ''}" label="${node.getAttribute('aria-label') || ''}" name="${node.name || ''}"`), 20),
				canvases: [...document.querySelectorAll('canvas')].filter(seen).map((node) => `${Math.round(node.getBoundingClientRect().width)}x${Math.round(node.getBoundingClientRect().height)}`),
				numbers: unique(text.filter((line) => /\d/.test(line) && line.length < 140)).slice(0, 40),
				text: text.slice(0, 60),
			};
		});
		return { url, status: response?.status() ?? 0, format, ...outline };
	} finally {
		await browser.close();
	}
}
