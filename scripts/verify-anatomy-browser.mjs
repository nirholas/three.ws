#!/usr/bin/env node
// Drive /anatomy in a real browser and fail on any console error.
//
// Opens the gallery, then one saved machine, and exercises the explorer the
// way a visitor does: tour steps, explode, section cut, x-ray, a part click,
// the light theme and a phone-sized viewport. Screenshots land in --out.
//
// Usage:
//   node scripts/verify-anatomy-browser.mjs --base http://localhost:3000 --id <design uuid> [--out dir]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const arg = (name, def = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
};
const base = arg('base', 'http://localhost:3000');
const id = arg('id');
const out = arg('out', 'anatomy-shots');
if (!id) {
	console.error('Pass --id <design uuid> (a saved machine to open).');
	process.exit(2);
}
mkdirSync(out, { recursive: true });

const problems = [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function newPage(viewport) {
	const page = await browser.newPage({ viewport });
	page.on('console', (msg) => {
		if (msg.type() === 'error' || msg.type() === 'warning') {
			const text = msg.text();
			// Third-party noise unrelated to the page under test.
			if (/favicon|Failed to load resource: the server responded with a status of 404 \(Not Found\)$|GPU stall|ReadPixels|WebGL-|swiftshader/i.test(text)) return;
			problems.push(`[${msg.type()}] ${text}`);
		}
	});
	page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
	return page;
}

const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });

// Gallery.
{
	const page = await newPage({ width: 1360, height: 900 });
	await page.goto(`${base}/anatomy`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('.anp-card:not(.anp-card--skeleton), .anp-empty:not([hidden])', { timeout: 30_000 });
	const cards = await page.locator('.anp-card:not(.anp-card--skeleton)').count();
	console.log(`gallery: ${cards} card(s)`);
	await shot(page, '01-home');
	await page.close();
}

// One machine, desktop.
{
	const page = await newPage({ width: 1440, height: 900 });
	await page.goto(`${base}/anatomy/${id}`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('.anx canvas', { timeout: 30_000 });
	await page.waitForFunction(() => document.querySelectorAll('.anx-part, .anx-parts li, [data-part]').length > 0, null, { timeout: 30_000 }).catch(() => {});
	await page.waitForTimeout(2500);
	console.log('title:', await page.textContent('#anpTitle'));
	await shot(page, '02-machine');

	await page.locator('.anx').focus();
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(1500);
	await shot(page, '03-tour-step-1');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(1500);
	await shot(page, '04-tour-step-3');
	await page.keyboard.press('Escape');

	await page.keyboard.press('e');
	await page.waitForTimeout(1600);
	await shot(page, '05-exploded');
	await page.keyboard.press('e');

	const section = page.locator('.anx select[aria-label*="ection" i]').first();
	if (await section.count()) {
		const values = await section.locator('option').evaluateAll((o) => o.map((x) => x.value));
		const axis = values.find((v) => v && v !== 'off' && v !== 'none');
		if (axis) {
			await section.selectOption(axis);
			await page.waitForTimeout(1200);
			await shot(page, '06-section');
			await section.selectOption(values[0]);
		}
	} else problems.push('[check] no section control found');

	await page.keyboard.press('x');
	await page.waitForTimeout(800);
	await shot(page, '07-xray');
	await page.keyboard.press('x');

	const box = await page.locator('.anx canvas').boundingBox();
	await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
	await page.waitForTimeout(800);
	await shot(page, '08-clicked');

	await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
	await page.waitForTimeout(1000);
	await shot(page, '09-light');
	await page.close();
}

// One machine, phone.
{
	const page = await newPage({ width: 390, height: 844 });
	await page.goto(`${base}/anatomy/${id}`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('.anx canvas', { timeout: 30_000 });
	await page.waitForTimeout(2500);
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (overflow > 1) problems.push(`[layout] phone page scrolls horizontally by ${overflow}px`);
	await shot(page, '10-phone');
	await page.close();
}

// A missing machine shows the designed not-found state.
{
	const page = await newPage({ width: 1200, height: 800 });
	await page.goto(`${base}/anatomy/00000000-0000-4000-8000-000000000000`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#anpDesignError:not([hidden])', { timeout: 30_000 });
	await shot(page, '11-not-found');
	await page.close();
}

await browser.close();
const real = problems.filter((p) => !/status of 404/.test(p) || !/00000000-0000-4000-8000-000000000000/.test(p));
if (real.length) {
	console.error(`\n${real.length} problem(s):\n${real.join('\n')}`);
	process.exit(1);
}
console.log(`\nOK: no console errors. Screenshots in ${out}/`);
