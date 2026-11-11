// Drive the PowerPoint export buttons in a real browser against a dev server:
// the Forge export menu row (success and a real 404 error state) and the model
// page's PowerPoint button. Saves each downloaded deck and prints its parts.
//
//   DEV_API_PROXY=http://localhost:<api> npx vite --port 3102 --strictPort
//   node scripts/verify-pptx-export-ui.mjs <creation-id> [base=http://localhost:3102] [outDir]

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unzipSync } from 'fflate';
import { chromium } from 'playwright';

const [id, base = 'http://localhost:3102', outDir = 'tmp/pptx-ui'] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/i.test(id || '')) {
	console.error('usage: node scripts/verify-pptx-export-ui.mjs <creation-id> [base] [outDir]');
	process.exit(2);
}
mkdirSync(outDir, { recursive: true });

function describeDeck(path) {
	const parts = Object.keys(unzipSync(readFileSync(path)));
	return {
		parts: parts.length,
		model: parts.includes('ppt/media/model3d1.glb'),
		poster: parts.includes('ppt/media/image1.png'),
		slide: parts.includes('ppt/slides/slide1.xml'),
	};
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 900 } });
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const pptxCalls = [];
page.on('response', (r) => {
	if (r.url().includes('/api/forge/export-pptx')) pptxCalls.push(`${r.status()} ${new URL(r.url()).search}`);
});

const result = {};

// Headless swiftshader keeps the main thread busy rendering the viewer, which
// can starve Playwright's synthetic input; a DOM click runs the same handlers.
const domClick = (selector) => page.evaluate((sel) => document.querySelector(sel).click(), selector);

// 1. Forge: open the stored creation, open the export menu, click PowerPoint.
await page.goto(`${base}/forge?share=${id}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
const row = page.locator('.export-item[data-format="pptx"]');
await row.waitFor({ state: 'attached', timeout: 90_000 });
await page.waitForFunction(() => !document.querySelector('.export-item[data-format="pptx"]').hidden, null, {
	timeout: 120_000,
});
await domClick('.export-caret');
await row.waitFor({ state: 'visible' });
await page.screenshot({ path: join(outDir, 'forge-menu.png') });
const downloads = [];
page.on('download', (d) => downloads.push(d));
const rowStatus = '.export-item[data-format="pptx"] .status';
await domClick('.export-item[data-format="pptx"]');
result.forgeBusyLabel = await page.locator(rowStatus).textContent();
await page.waitForFunction(
	(sel) => {
		const el = document.querySelector(sel);
		return el.textContent.includes('saved') || el.classList.contains('is-error');
	},
	rowStatus,
	{ timeout: 240_000 },
);
const forgeStatus = await page.locator(rowStatus).textContent();
if (!forgeStatus.includes('saved')) throw new Error(`Forge export failed: ${forgeStatus} (${pptxCalls.join(', ')})`);
for (let i = 0; i < 50 && !downloads.length; i++) await page.waitForTimeout(100);
const forgeDl = downloads.shift();
const forgePath = join(outDir, forgeDl.suggestedFilename());
await forgeDl.saveAs(forgePath);
result.forge = { file: forgePath, status: await row.locator('.status').textContent(), ...describeDeck(forgePath) };
await page.screenshot({ path: join(outDir, 'forge-saved.png') });

// 2. Forge error state: a creation id the server does not have answers a real 404.
await page.evaluate(() =>
	document.dispatchEvent(
		new CustomEvent('forge:model-ready', {
			detail: { glbUrl: '', creationId: '00000000-0000-4000-8000-000000000000' },
		}),
	),
);
await domClick('.export-item[data-format="pptx"]');
await page.waitForFunction(() =>
	document.querySelector('.export-item[data-format="pptx"] .status').classList.contains('is-error'),
);
result.forgeError = await row.locator('.status').textContent();
await page.screenshot({ path: join(outDir, 'forge-error.png') });

// 3. Model page: the PowerPoint button next to Download GLB.
await page.goto(`${base}/m/${id}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
const btn = page.locator('#mp-pptx');
await btn.waitFor({ state: 'visible', timeout: 90_000 });
await btn.focus();
await page.screenshot({ path: join(outDir, 'model-page-focus.png') });
await domClick('#mp-pptx');
result.modelPageBusyLabel = await btn.textContent();
await page.waitForFunction(() => /^(Saved|This|Too|three|Could)/.test(document.getElementById('mp-toast')?.textContent || '') && !document.getElementById('mp-pptx').disabled, null, { timeout: 240_000 });
for (let i = 0; i < 50 && !downloads.length; i++) await page.waitForTimeout(100);
const pageDl = downloads.shift();
if (!pageDl) throw new Error(`Model page export failed: ${await page.locator('#mp-toast').textContent()}`);
const pagePath = join(outDir, `model-page-${pageDl.suggestedFilename()}`);
await pageDl.saveAs(pagePath);
result.modelPage = {
	file: pagePath,
	toast: await page.locator('#mp-toast').textContent(),
	buttonAfter: await btn.textContent(),
	disabledAfter: await btn.isDisabled(),
	...describeDeck(pagePath),
};
await page.screenshot({ path: join(outDir, 'model-page-saved.png') });

result.pptxCalls = pptxCalls;
result.consoleProblems = problems;
console.log(JSON.stringify(result, null, 2));
await browser.close();
