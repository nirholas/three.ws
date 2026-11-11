#!/usr/bin/env node
/**
 * Prints docs/partners/microsoft/one-pager.html to one-pager.pdf (US Letter)
 * with headless Chromium, and fails unless the result is exactly one page.
 *
 * The page loads its fonts from Google Fonts and its images from the repo
 * (public/brand and docs/partners/microsoft/screenshots), so run
 * capture-screenshots.mjs first if the screenshots are missing.
 *
 * Usage: node scripts/microsoft-pack/build-one-pager.mjs
 */
import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = resolve(here, '../../docs/partners/microsoft');
const htmlPath = join(packDir, 'one-pager.html');
const pdfPath = join(packDir, 'one-pager.pdf');

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	const failed = [];
	page.on('requestfailed', (r) => failed.push(`${r.url()} (${r.failure()?.errorText})`));
	page.on('response', (r) => {
		if (r.status() >= 400) failed.push(`${r.url()} (HTTP ${r.status()})`);
	});
	await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
	await page.evaluate(() => document.fonts.ready);
	const broken = await page.evaluate(() =>
		[...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src),
	);
	if (broken.length || failed.length) {
		throw new Error(`one-pager has missing resources:\n${[...broken, ...failed].join('\n')}`);
	}
	// The .page box is fixed at 11in; anything taller would spill to page two.
	const overflow = await page.evaluate(() => {
		const box = document.querySelector('.page');
		return box.scrollHeight - box.clientHeight;
	});
	if (overflow > 0) throw new Error(`content overflows the Letter page by ${overflow}px; tighten the copy`);
	await page.emulateMedia({ media: 'print' });
	await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true, preferCSSPageSize: true });
} finally {
	await browser.close();
}

const pdf = (await readFile(pdfPath)).toString('latin1');
const pages = (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
const { size } = await stat(pdfPath);
console.log(`one-pager.pdf: ${pages} page(s), ${(size / 1024).toFixed(0)} KB -> ${pdfPath}`);
if (pages !== 1) {
	console.error(`expected exactly 1 page, got ${pages}`);
	process.exit(1);
}
