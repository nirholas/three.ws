#!/usr/bin/env node
// Walk the "Make a hero clip" panel (src/hero-clip-panel.js) through its real
// states in Chromium and save a screenshot of each to docs/img/hero-clips/:
//
//   ui-signed-out.png      model page, nobody signed in
//   ui-idle.png            model page, signed in (no xAI key: the honest note)
//   ui-turntable-loading   after "Show the turntable": the APNG still rendering
//   ui-turntable.png       the turntable rendered from the model, plus the angles
//   ui-forge.png           the forge result card with the panel open
//
// Every request is real. The page talks to whatever /api the dev server
// forwards to, so to exercise an undeployed endpoint run the API locally:
//
//   PORT=3279 node server/index.mjs                         (with DATABASE_URL)
//   DEV_API_PROXY=http://127.0.0.1:3279 npx vite --port 3275 --strictPort
//   node scripts/hero-clip-ui-shots.mjs --base http://localhost:3275
//
// Signing in uses the QA account in .env (AUDIT_EMAIL / AUDIT_PASSWORD) through
// the real POST /api/auth/login. Console errors and failed requests from the
// page are printed at the end; the script exits 1 when there are any.

import { mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values: a } = parseArgs({
	options: {
		base: { type: 'string', default: 'http://localhost:3275' },
		model: { type: 'string', default: '3abac32f-ced2-4189-b822-d30c96dbc87e' },
		out: { type: 'string', default: 'docs/img/hero-clips' },
	},
});
const BASE = a.base.replace(/\/$/, '');
const OUT = resolve(a.out);

function auditLogin() {
	const vars = { AUDIT_EMAIL: process.env.AUDIT_EMAIL, AUDIT_PASSWORD: process.env.AUDIT_PASSWORD };
	if ((!vars.AUDIT_EMAIL || !vars.AUDIT_PASSWORD) && existsSync('.env')) {
		for (const line of readFileSync('.env', 'utf8').split('\n')) {
			const m = /^(AUDIT_EMAIL|AUDIT_PASSWORD)=(.*)$/.exec(line.trim());
			if (m && !vars[m[1]]) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
	if (!vars.AUDIT_EMAIL || !vars.AUDIT_PASSWORD) throw new Error('AUDIT_EMAIL / AUDIT_PASSWORD are not set (see the self-unblock playbook)');
	return { email: vars.AUDIT_EMAIL, password: vars.AUDIT_PASSWORD };
}

const problems = [];
function watch(page, label) {
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(`[${label}] console: ${m.text()}`);
	});
	page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
	page.on('response', (r) => {
		if (r.url().includes('/api/v1/models/hero-clip') || r.url().includes('/api/render/')) {
			console.log(`  ${r.request().method()} ${r.url().replace(BASE, '').slice(0, 90)} -> ${r.status()}`);
		}
	});
}

// A page screenshot clipped to the element: element screenshots wait for two
// identical animation frames first, which a busy WebGL page never produces.
async function shot(locator, name) {
	await locator.evaluate((el) => el.scrollIntoView({ block: 'start' }));
	const page = locator.page();
	const box = await locator.boundingBox();
	if (!box) throw new Error(`${name}: the element is not on screen`);
	const pad = 12;
	const vp = page.viewportSize();
	const x = Math.max(0, box.x - pad);
	const y = Math.max(0, box.y - pad);
	const clip = { x, y, width: Math.min(vp.width - x, box.width + pad * 2), height: Math.min(vp.height - y, box.height + pad * 2) };
	await page.screenshot({ path: resolve(OUT, name), clip, animations: 'disabled', timeout: 120000 });
	console.log(`wrote ${a.out}/${name}`);
}

async function openModelPanel(page) {
	await page.goto(`${BASE}/m/${a.model}#hero-clip`, { waitUntil: 'domcontentloaded', timeout: 120000 });
	const tools = page.locator('#mp-heroclip-tools');
	await tools.waitFor({ state: 'visible', timeout: 90000 });
	if (!(await tools.evaluate((el) => el.open))) await page.click('#mp-heroclip');
	return tools;
}

async function main() {
	await mkdir(OUT, { recursive: true });
	// Real WebGL through SwiftShader: the model viewer renders, and the panel
	// waits below are long because a loaded machine starves the main thread.
	const browser = await chromium.launch({
		args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
	});
	// Reduced motion keeps the model viewer from spinning, so a loaded machine
	// still gets a quiet frame to capture. The panel looks the same either way.
	const viewport = { width: 1280, height: 900 };
	const contextOptions = { viewport, reducedMotion: 'reduce' };

	// 1. Signed out.
	{
		const ctx = await browser.newContext(contextOptions);
		const page = await ctx.newPage();
		watch(page, 'signed-out');
		const tools = await openModelPanel(page);
		await page.locator('.hc[data-state="signed-out"]').waitFor({ timeout: 90000 });
		await shot(tools, 'ui-signed-out.png');
		await ctx.close();
	}

	// 2. Signed in.
	const ctx = await browser.newContext(contextOptions);
	const { email, password } = auditLogin();
	const login = await ctx.request.post(`${BASE}/api/auth/login`, {
		data: { email, password },
		headers: { 'content-type': 'application/json' },
	});
	if (!login.ok()) throw new Error(`QA login failed: HTTP ${login.status()}`);
	const page = await ctx.newPage();
	watch(page, 'signed-in');
	const tools = await openModelPanel(page);
	await page.locator('.hc[data-state="idle"]').waitFor({ timeout: 90000 });
	await shot(tools, 'ui-idle.png');

	const available = await page.locator('.hc [data-act="make"]').count();
	if (available) {
		console.log('the service has an xAI key: walking a real clip');
		await page.click('.hc [data-act="make"]');
		await page.locator('.hc[data-state="generating"], .hc[data-state="error"]').waitFor({ timeout: 120000 });
		await shot(tools, 'ui-generating.png');
		await page.locator('.hc[data-state="done"], .hc[data-state="error"]').waitFor({ timeout: 15 * 60 * 1000 });
		await shot(tools, 'ui-result.png');
	} else {
		await page.click('.hc [data-act="turntable"]');
		await page.locator('.hc[data-state="unavailable"]').waitFor({ timeout: 90000 }).catch(async (err) => {
			const now = await page.locator('.hc').first().evaluate((el) => `${el.dataset.state}: ${el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
			throw new Error(`${err.message.split('\n')[0]} (panel is ${now})`);
		});
		const frame = page.locator('.hc [data-el="tt"]');
		if (await frame.evaluate((el) => el.classList.contains('hc-frame--loading'))) {
			await shot(tools, 'ui-turntable-loading.png');
		} else {
			console.log('the turntable was already cached: no loading frame to capture');
		}
		await page.waitForFunction(
			() => {
				const el = document.querySelector('.hc [data-el="tt"]');
				return el && !el.classList.contains('hc-frame--loading');
			},
			null,
			{ timeout: 90000 },
		);
		await page.waitForFunction(() => [...document.querySelectorAll('.hc-strip img')].every((i) => i.complete), null, { timeout: 60000 });
		await shot(tools, 'ui-turntable.png');
	}

	// 3. The forge result card, through the share-link path that opens a creation.
	const forge = await ctx.newPage();
	watch(forge, 'forge');
	await forge.goto(`${BASE}/forge?share=${a.model}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
	const btn = forge.locator('#forge-heroclip-btn');
	await btn.waitFor({ state: 'visible', timeout: 60000 });
	// The forge viewer keeps headless Chromium's software GL busy, so a mouse
	// click waits forever for the button to look "stable". Keyboard activation
	// is the same user path without that check.
	await btn.focus();
	await forge.keyboard.press('Enter');
	const panel = forge.locator('#forge-heroclip-panel');
	await forge.locator('#forge-heroclip-panel .hc[data-state="idle"]').waitFor({ timeout: 90000 });
	await shot(panel, 'ui-forge.png');

	await browser.close();
	if (problems.length) {
		console.log(`\n${problems.length} console problem(s):`);
		for (const p of problems) console.log(`  ${p}`);
		process.exit(1);
	}
	console.log('\nno console errors');
}

main().catch((err) => {
	console.error(`hero-clip-ui-shots failed: ${err?.message || err}`);
	if (problems.length) for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
});
