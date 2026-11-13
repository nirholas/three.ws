// The Getting started pill must not appear before its stylesheet has loaded.
//
// Measured on a Pixel 5 (slow 4G, 4x CPU) on 2026-11-13: public/getting-started.js
// injected /getting-started.css and mounted the pill in the same tick. On a slow
// link the pill painted for about 400 ms as an unstyled, full-width button
// (345 px on a 393 px phone), then snapped to its 171 px pill once the CSS
// arrived. Its left edge moved 174 px: a 0.0127 layout shift on every page that
// carries the widget, on top of whatever else the page spent.
//
// The widget now waits for its stylesheet before joining the page. This serves
// the real widget, stylesheet and corner stack from memory and holds the CSS
// back, so it needs nothing from the dev server.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ORIGIN = 'http://guide.test';
const CSS_DELAY_MS = 1500;

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:14px system-ui}main{height:200vh;background:#111}</style>
<script>
window.__cls = 0; window.__shifts = [];
new PerformanceObserver((list) => {
	for (const e of list.getEntries()) {
		if (e.hadRecentInput) continue;
		window.__cls += e.value;
		window.__shifts.push({ value: e.value, nodes: e.sources.map((s) => s.node && (s.node.id || s.node.className)) });
	}
}).observe({ type: 'layout-shift', buffered: true });
</script>
<script src="/corner-stack.js"></script>
<script src="/getting-started.js" defer></script>
</head><body><main><h1>Page</h1></main></body></html>`;

test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });

test('the pill waits for its stylesheet and never shifts the page', async ({ page }) => {
	let cssServedAt = 0;
	await page.route(`${ORIGIN}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/page') return route.fulfill({ contentType: 'text/html', body: PAGE });
		if (path === '/corner-stack.js') return route.fulfill({ contentType: 'text/javascript', body: read('public/corner-stack.js') });
		if (path === '/getting-started.js') return route.fulfill({ contentType: 'text/javascript', body: read('public/getting-started.js') });
		if (path === '/getting-started.css') {
			await new Promise((r) => setTimeout(r, CSS_DELAY_MS));
			cssServedAt = Date.now();
			return route.fulfill({ contentType: 'text/css', body: read('public/getting-started.css') });
		}
		return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});

	await page.goto(`${ORIGIN}/page`, { waitUntil: 'domcontentloaded' });
	// While the stylesheet is still on the wire, no pill is on the page.
	await page.waitForTimeout(CSS_DELAY_MS / 3);
	expect(cssServedAt, 'the stylesheet must still be in flight').toBe(0);
	expect(await page.locator('.twg-pill').count()).toBe(0);

	// Once it lands, the pill appears already styled, in the corner.
	await page.waitForSelector('.twg-pill', { timeout: 10_000 });
	await page.waitForTimeout(400);
	const box = await page.locator('.twg-pill').boundingBox();
	expect(box.width).toBeLessThan(240);
	expect(Math.round(box.x + box.width)).toBe(393 - 12);
	const shifts = await page.evaluate(() => window.__shifts);
	expect(await page.evaluate(() => window.__cls), JSON.stringify(shifts)).toBe(0);
});

test('a stylesheet that fails to load still mounts the pill', async ({ page }) => {
	await page.route(`${ORIGIN}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/page') return route.fulfill({ contentType: 'text/html', body: PAGE });
		if (path === '/corner-stack.js') return route.fulfill({ contentType: 'text/javascript', body: read('public/corner-stack.js') });
		if (path === '/getting-started.js') return route.fulfill({ contentType: 'text/javascript', body: read('public/getting-started.js') });
		return route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' });
	});
	await page.goto(`${ORIGIN}/page`);
	await page.waitForSelector('.twg-pill', { timeout: 10_000 });
});
