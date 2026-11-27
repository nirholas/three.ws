#!/usr/bin/env node
// One graphic per post of the Grok for Startups announcement thread, in the
// head card's look: near-black ground, Inter, thin white line art, our lockup.
// Post 1 uses head.png (scripts/grok-startups-announce-card.mjs) and post 4 the
// cutaway video (scripts/anatomy-cutaway-video.mjs); this script draws the rest.
//
//   node scripts/grok-startups-post-models.mjs   # once: real models via /api/mcp-grok
//   node scripts/grok-startups-post-cards.mjs    # post-2.png ... post-9.png
//
// The card layouts live in scripts/lib/grok-startups-cards.mjs (shared with the
// 2026-11-27 repost); the models and frames come from src/models.json, so run
// the models script first.
//
// Output: public/x-media/grok-startups-announce/post-N.png, 1200x675 at 2x.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchBrowser, openRenderer, shootCards } from './lib/x-card-kit.mjs';
import { announceCards, hasAnnounceModels, renderAnnounceModels } from './lib/grok-startups-cards.mjs';

const outDir = resolve('public/x-media/grok-startups-announce');
const srcDir = join(outDir, 'src');
const manifestPath = join(srcDir, 'models.json');
const models = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
// Posts 2 and 3 need the real models; without them those two cards are skipped.
const haveModels = hasAnnounceModels(models);
if (!haveModels) console.warn('src/models.json is incomplete: skipping posts 2 and 3 (run node scripts/grok-startups-post-models.mjs).');

const browser = await launchBrowser();
try {
	let renders = null;
	if (haveModels) {
		const renderer = await openRenderer(browser);
		renders = await renderAnnounceModels(renderer.shot, models);
		await renderer.close();
	}
	// The 2026-11-25 smoke run passed all six examples, so this thread keeps the line.
	const byNumber = announceCards({ renders, models, srcDir, total: 9, smokePassed: true });
	const cards = Object.fromEntries(Object.entries(byNumber).map(([n, html]) => [`post-${n}.png`, html]));
	const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
	await shootCards(browser, outDir, cards, only);
} finally {
	await browser.close();
}
