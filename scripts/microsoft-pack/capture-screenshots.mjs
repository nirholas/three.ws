#!/usr/bin/env node
/**
 * Capture the live three.ws screenshots used by the Microsoft deck and
 * one-pager (docs/partners/microsoft/screenshots/).
 *
 * Every image is a real capture of production at https://three.ws, taken at
 * 1600x900 so it drops into a 16:9 slide without cropping. Rerun before each
 * new deck so the screenshots match what a viewer will see when they visit.
 *
 * Usage: node scripts/microsoft-pack/capture-screenshots.mjs [--base https://three.ws]
 */
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'docs/partners/microsoft/screenshots');
const baseArg = process.argv.indexOf('--base');
const BASE = baseArg > -1 ? process.argv[baseArg + 1] : 'https://three.ws';

// name: file stem; path: production route; settle: ms to let WebGL and
// late-loading data paint after network idle; clip: optional region in CSS
// pixels when only part of the page belongs in the deck; orbit: model-viewer
// camera-orbit to frame a model from its front three-quarter view.

// The home page, /partners and the /forge editor are deliberately absent: the
// home page's launch tiles and token ticker, other companies' tier badges on
// /partners, and the forge's holder and wallet rows are not Microsoft-facing
// material. The Teams tab is clipped to the agent viewer
// so the community agent list beside it (user-named, unmoderated) stays out.
// model-view is a real TRELLIS forge creation (forge_creations
// 0990014b-358e-41cb-a208-a0ec1b58e7d4, prompt "a wooden acoustic violin with
// an ebony fingerboard and a shaped bridge") in the public /viewer page. The MCP
// docs page is clipped to its Connect table; the hero above it describes a
// separate paid surface that does not belong in Microsoft material.
export const SHOTS = [
	{
		name: 'model-view',
		path: `/viewer?src=${encodeURIComponent('https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/ac889936294e/0990014b-358e-41cb-a208-a0ec1b58e7d4.glb')}&title=${encodeURIComponent('Wooden acoustic violin')}`,
		settle: 8000,
		orbit: '70deg 75deg auto',
	},
	{ name: 'teams-tab', path: '/microsoft/teams-tab', settle: 5000, clip: { x: 370, y: 15, width: 525, height: 610 } },
	{ name: 'docs-microsoft', path: '/docs/microsoft', settle: 2500 },
	{ name: 'docs-mcp-studio', path: '/docs/mcp-studio', settle: 2500, clip: { x: 560, y: 565, width: 750, height: 280 } },
];

// The walking companion, its corner tips, the search hint and the
// post-generation celebration float over every page for a signed-out visitor.
// They are per-visitor UI, not the surface the slide is about, so every fixed
// element below the header band is hidden right before the capture.
function hideFloatingOverlays() {
	for (const el of document.querySelectorAll('body *')) {
		const cs = getComputedStyle(el);
		if (cs.position === 'fixed' && el.getBoundingClientRect().top > 80) el.style.setProperty('display', 'none', 'important');
	}
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
try {
	const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
	for (const shot of SHOTS) {
		const page = await context.newPage();
		const url = new URL(shot.path, BASE).toString();
		try {
			const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			if (!res || res.status() >= 400) throw new Error(`HTTP ${res ? res.status() : 'no response'}`);
			await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
			await page.waitForTimeout(shot.settle);
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.evaluate(hideFloatingOverlays);
			if (shot.orbit) {
				await page.evaluate((orbit) => {
					const mv = document.querySelector('model-viewer');
					mv.removeAttribute('auto-rotate');
					mv.setAttribute('interaction-prompt', 'none');
					mv.setAttribute('camera-orbit', orbit);
					mv.jumpCameraToGoal();
				}, shot.orbit);
				await page.waitForTimeout(1500);
			}
			const file = join(outDir, `${shot.name}.png`);
			await page.screenshot({ path: file, type: 'png', ...(shot.clip ? { clip: shot.clip } : {}) });
			console.log(`${shot.name}: ${url} -> ${(statSync(file).size / 1024).toFixed(0)} KB`);
		} catch (err) {
			failures.push(`${shot.name} (${url}): ${err.message}`);
		} finally {
			await page.close();
		}
	}
} finally {
	await browser.close();
}
if (failures.length) {
	console.error(`failed captures:\n${failures.join('\n')}`);
	process.exit(1);
}
