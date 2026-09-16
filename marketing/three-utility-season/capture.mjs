#!/usr/bin/env node
/**
 * Captures the media for the "What $THREE does this week" utility season from the
 * live site. Re-run on posting day so the image matches the figures in the post.
 *
 *   node marketing/three-utility-season/capture.mjs              # every edition
 *   node marketing/three-utility-season/capture.mjs --only 01,09 # selected editions
 *   node marketing/three-utility-season/capture.mjs --base http://localhost:3000
 *
 * Each recipe names the live route, an optional element to frame, and the output
 * file. Floating site chrome (the getting-started stack, the walking companion,
 * tip popovers) is hidden so the product surface itself fills the frame; nothing
 * on the surface is edited.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'images');
const args = process.argv.slice(2);
const argValue = (flag) => {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : null;
};
const BASE = argValue('--base') || 'https://three.ws';
const ONLY = (argValue('--only') || '').split(',').filter(Boolean);

const HIDE_CHROME = `
	#tws-corner-stack, .tws-corner-item, .twx-i18n-fab, .tws-atlas-hint,
	.walk-companion, .walk-trail-layer, .walk-c2w-fx, .pricing-avatar-canvas,
	a[href="#main-content"], a[href="#main"], .skip-link { display: none !important; }
`;

// Wallet-free JSON read of the public tier ladder (what an agent sees).
const TIER_API = '/api/three/tier';
const GH = 'https://github.com/nirholas/three.ws/blob/main';

const RECIPES = [
	{ id: '01', file: '01-access-tiers.png', route: '/three', size: [1600, 900] },
	{ id: '02', file: '02-holder-free-quota.png', route: '/forge', size: [1600, 900] },
	{ id: '03', file: '03-gated-embed-mcp-tool.png', route: `${GH}/api/_mcp/tools/embed.js#L227`, scrollText: "name: 'create_gated_embed'", offset: 260, size: [1600, 900] },
	{ id: '04', file: '04-forge-max-holder.png', route: '/forge-max', size: [1600, 900] },
	{ id: '05', file: '05-gated-embed-docs.png', route: '/docs/token-gated-3d-embeds', size: [1600, 900] },
	{ id: '06', file: '06-deploy-fee-waiver.png', route: `${GH}/packages/metaplex-agent-mcp/src/config.js#L87`, scrollText: 'the deploy fee and the holder waiver', offset: 40, size: [1600, 900] },
	{ id: '07', file: '07-holder-scene-unlock.png', route: '/embed/v1/gated.html?asset=avatar%3Abf2d5c4b-2536-4593-bf15-ec934a6c9f48', size: [1600, 900] },
	{ id: '08', file: '08-tier-api.png', route: TIER_API, prettyPrint: true, size: [1600, 900] },
	{ id: '09', file: '09-buyback-ledger.png', route: '/three-token', scrollText: 'in platform revenue earned so far', offset: 420, size: [1600, 900] },
	{ id: '10', file: '10-gameready-holder.png', route: '/three', scrollY: 470, size: [1600, 900] },
	{ id: '11', file: '11-built-in-public.png', route: `${GH}/api/_lib/three-access.js#L30`, scrollText: 'enforced   ', offset: 160, size: [1600, 900] },
	{ id: '12', file: '12-quarter-recap.png', route: '/three', size: [1080, 1350] },
];

async function frame(page, recipe) {
	if (recipe.prettyPrint) {
		// Chromium's JSON viewer: tick its own Pretty-print toggle so the payload reads.
		await page.getByLabel('Pretty-print').check().catch(() => page.locator('input[type=checkbox]').first().check());
		await page.waitForTimeout(800);
	}
	if (recipe.scrollY) {
		await page.evaluate((y) => window.scrollTo(0, y), recipe.scrollY);
		await page.waitForTimeout(1200);
		return page.screenshot();
	}
	if (recipe.scrollText) {
		const loc = page.getByText(recipe.scrollText, { exact: false }).first();
		await loc.scrollIntoViewIfNeeded({ timeout: 15000 });
		await page.evaluate((dy) => window.scrollBy(0, -dy), recipe.offset ?? 140);
		await page.waitForTimeout(1200);
		return page.screenshot();
	}
	if (recipe.element) {
		const el = page.locator(recipe.element).first();
		await el.scrollIntoViewIfNeeded({ timeout: 15000 });
		await page.evaluate(() => window.scrollBy(0, -200));
		await page.waitForTimeout(1200);
		return page.screenshot();
	}
	return page.screenshot();
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
for (const recipe of RECIPES) {
	if (ONLY.length && !ONLY.includes(recipe.id)) continue;
	const [width, height] = recipe.size;
	const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark' });
	const page = await ctx.newPage();
	const url = recipe.route.startsWith('http') ? recipe.route : BASE + recipe.route;
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
		await page.addStyleTag({ content: HIDE_CHROME });
		await page.waitForTimeout(recipe.settle ?? 6000);
		const png = await frame(page, recipe);
		const { writeFileSync } = await import('node:fs');
		writeFileSync(path.join(OUT, recipe.file), png);
		console.log(`captured ${recipe.id} ${url} -> images/${recipe.file} (${width}x${height}) at ${new Date().toISOString()}`);
	} catch (err) {
		failed += 1;
		console.error(`FAILED ${recipe.id} ${url}: ${err.message.split('\n')[0]}`);
	}
	await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
