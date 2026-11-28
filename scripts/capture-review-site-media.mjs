#!/usr/bin/env node
/**
 * capture-review-site-media.mjs: the screenshots three.ws uploads to software
 * review sites (G2, Capterra, GetApp, Software Advice, Trustpilot, SourceForge),
 * captured from the live product.
 *
 * Review-site galleries want PNG or JPEG at a 16:9 size, not the WebP figures the
 * docs pipeline writes, so this is its own small entry point. Each shot is one
 * real route in a real Chromium at a 1440x810 viewport rendered at 4/3 device
 * scale, which yields exactly 1920x1080 with text at a readable size.
 *
 * It writes, under marketing/review-sites/screenshots/:
 *   <id>-1920x1080.png   the frame, ready to upload
 *   manifest.json        route, capture time, commit, bytes, sha256, and defects
 *
 * Defects are recorded instead of photographed: an HTTP error, an error page, an
 * empty body, or a WebGL canvas that never painted. A frame whose visible text
 * names a coin or token other than $THREE (beyond the USDC and SOL payment rails
 * the owner approved for proof media on 2026-09-18) is flagged `gated`, and that
 * file must stay out of commits until the owner approves it.
 *
 * Usage:
 *   node scripts/capture-review-site-media.mjs
 *   node scripts/capture-review-site-media.mjs --only forge,avatar-studio
 *   node scripts/capture-review-site-media.mjs --base http://localhost:3000
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'marketing/review-sites/screenshots');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = opt('base', 'https://three.ws').replace(/\/$/, '');
const ONLY = opt('only', '').split(',').map((s) => s.trim()).filter(Boolean);

const VIEWPORT = { width: 1440, height: 810 };
const SCALE = 4 / 3;
const OUT = { width: 1920, height: 1080 };

/**
 * Gallery order is upload order: the first frame is the one review sites show on
 * category pages, so it is the frame that explains the product at a glance (the
 * prompt box beside a live 3D agent), followed by each working surface.
 */
const SHOTS = [
	{ id: 'home', url: '/classic', canvas: false, settle: 6000, caption: 'three.ws: open-source, browser-native 3D AI agents you can embed anywhere.' },
	{ id: 'forge', url: '/forge', canvas: false, settle: 6000, caption: 'Forge: type a prompt or drop an image and get a textured, downloadable 3D model (GLB).' },
	{ id: 'avatar-studio', url: '/avatar-studio', canvas: true, settle: 12000, caption: 'Avatar Studio: design a rigged, animation-ready 3D avatar in the browser.' },
	{ id: 'discover', url: '/discover', canvas: false, settle: 8000, scrollTo: 'main input[type="search"], main input', caption: 'Discover: search and load published 3D agents in the browser.' },
	{ id: 'ar', url: '/ar', canvas: false, settle: 6000, caption: 'AR: place any generated model in the room with one tap on a phone.' },
	{ id: 'enterprise', url: '/enterprise', canvas: false, settle: 5000, caption: 'Enterprise: SSO, audit logs, procurement packet, and marketplace purchasing.' },
];

// Site chrome that follows the visitor across every route (same list as
// scripts/capture-doc-media.mjs). It is real UI but never the subject of a
// listing screenshot, and it parks over the lower-right of every frame.
const SITE_CHROME = [
	'#tws-corner-stack',
	'.tws-disc-card',
	'.tws-atlas-hint',
	'.twx-i18n-fab',
	'.walk-companion',
	'.walk-trail-layer',
	'.walk-c2w-fx',
	'#cookie-banner',
	'.cookie-banner',
	'[data-consent-banner]',
	// The PostHog consent dialog (src/shared/cookie-consent.js). Hiding it rather
	// than answering it keeps the capture from opting in or out of analytics.
	'.tw-consent',
];

const OTHER_TOKEN = /\$(?!THREE\b)[A-Z][A-Z0-9]{1,9}\b|\b(?:USDC|USDT|SOL|ETH|WETH|BTC|BONK|WIF|JUP|PYUSD|EURC|Bitcoin|Ethereum)\b/g;
const APPROVED_TOKEN_TERMS = new Set(['USDC', 'SOL']);

function currentCommit() {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
	} catch {
		return null;
	}
}

async function hideChrome(page) {
	await page.addStyleTag({ content: `${SITE_CHROME.join(',')}{display:none!important}` }).catch(() => {});
	await page
		.evaluate((chrome) => {
			for (const selector of chrome) for (const node of document.querySelectorAll(selector)) node.remove();
		}, SITE_CHROME)
		.catch(() => {});
}

async function visibleText(page) {
	return page.evaluate(() => {
		const out = [];
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const el = n.parentElement;
			if (!el || !n.textContent.trim()) continue;
			const style = getComputedStyle(el);
			if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
			const r = el.getBoundingClientRect();
			if (r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && r.width > 0) out.push(n.textContent.trim());
		}
		const alts = [...document.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ');
		return { text: out.join(' '), alts, title: document.title, bodyLength: document.body.innerText.length };
	});
}

/** Playwright waits for a stable frame, which a SwiftShader render loop may never give; fall back to raw CDP. */
async function shoot(page) {
	try {
		return await page.screenshot({ type: 'png', timeout: 30000 });
	} catch (err) {
		if (!/timeout/i.test(String(err?.message))) throw err;
		const session = await page.context().newCDPSession(page);
		try {
			const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
			return Buffer.from(data, 'base64');
		} finally {
			await session.detach().catch(() => {});
		}
	}
}

/** True when the canvas region is a flat fill, i.e. WebGL never painted. */
async function canvasIsBlank(png, box) {
	if (!box) return true;
	const meta = await sharp(png).metadata();
	const left = Math.max(0, Math.round(box.x * SCALE));
	const top = Math.max(0, Math.round(box.y * SCALE));
	const width = Math.min(meta.width - left, Math.round(box.width * SCALE));
	const height = Math.min(meta.height - top, Math.round(box.height * SCALE));
	if (width < 10 || height < 10) return true;
	const stats = await sharp(png).extract({ left, top, width, height }).stats();
	return stats.channels.slice(0, 3).every((c) => c.stdev < 3);
}

async function capture(browser, shot) {
	const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: 'dark' });
	const page = await context.newPage();
	const consoleErrors = [];
	page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
	page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 200)));
	const defects = [];
	try {
		const url = BASE + shot.url;
		const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
		const status = response?.status() ?? 0;
		await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
		await page.evaluate(() => document.fonts?.ready).catch(() => {});
		await hideChrome(page);
		await page.waitForTimeout(shot.settle);
		if (shot.scrollTo) {
			// Bring the working part of the page to the top of the frame (the agent
			// grid, not the marketing header above it).
			await page
				.evaluate((selector) => {
					const el = document.querySelector(selector);
					if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96);
				}, shot.scrollTo)
				.catch(() => {});
			await page.waitForTimeout(2500);
		}
		await hideChrome(page);

		const seen = await visibleText(page);
		if (status >= 400) defects.push(`HTTP ${status}`);
		if (/\b404\b|page not found|something went wrong|application error/i.test(`${seen.title} ${seen.text.slice(0, 600)}`)) {
			defects.push('the page renders an error or not-found state');
		}
		if (seen.bodyLength < 40) defects.push('the page body is effectively empty');

		const raw = await shoot(page);
		if (shot.canvas) {
			const box = await page.locator('canvas').first().boundingBox().catch(() => null);
			if (await canvasIsBlank(raw, box)) defects.push('the WebGL canvas never painted');
		}

		const terms = [...new Set([...`${seen.text} ${seen.alts}`.matchAll(OTHER_TOKEN)].map((m) => m[0]))];
		const gated = terms.some((t) => !APPROVED_TOKEN_TERMS.has(t));

		const file = `${shot.id}-${OUT.width}x${OUT.height}.png`;
		const png = await sharp(raw).resize(OUT.width, OUT.height, { fit: 'cover', position: 'top' }).png({ compressionLevel: 9 }).toBuffer();
		writeFileSync(path.join(OUT_DIR, file), png);
		return {
			id: shot.id,
			file,
			route: shot.url,
			url,
			caption: shot.caption,
			width: OUT.width,
			height: OUT.height,
			bytes: png.length,
			sha256: createHash('sha256').update(png).digest('hex'),
			tokenTerms: terms,
			gated,
			defects,
			consoleErrors: consoleErrors.slice(0, 5),
		};
	} finally {
		await context.close();
	}
}

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	const shots = ONLY.length ? SHOTS.filter((s) => ONLY.includes(s.id)) : SHOTS;
	if (!shots.length) throw new Error(`no shot matches --only ${ONLY.join(',')}; ids: ${SHOTS.map((s) => s.id).join(', ')}`);

	const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { shots: [] };
	const byId = new Map(previous.shots.map((s) => [s.id, s]));
	const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
	const capturedAt = new Date().toISOString();
	const commit = currentCommit();
	let failures = 0;
	try {
		for (const shot of shots) {
			try {
				const result = await capture(browser, shot);
				byId.set(shot.id, { ...result, capturedAt, commit, base: BASE });
				const flags = [result.gated ? `GATED (${result.tokenTerms.join(', ')})` : '', ...result.defects].filter(Boolean);
				console.log(`${flags.length ? 'warn' : 'ok  '} ${shot.id.padEnd(14)} ${result.file}${flags.length ? `  ${flags.join('; ')}` : ''}`);
				if (result.defects.length) failures++;
			} catch (err) {
				failures++;
				console.error(`fail ${shot.id}: ${err.message}`);
			}
		}
	} finally {
		await browser.close();
	}
	const ordered = SHOTS.map((s) => byId.get(s.id)).filter(Boolean);
	writeFileSync(MANIFEST, `${JSON.stringify({ generatedBy: 'scripts/capture-review-site-media.mjs', shots: ordered }, null, '\t')}\n`);
	console.log(`\nwrote ${path.relative(ROOT, MANIFEST)}`);
	if (failures) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
