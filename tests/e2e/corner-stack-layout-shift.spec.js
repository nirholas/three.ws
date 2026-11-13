// The corner stack must never report a layout shift when its membership changes.
//
// Measured on a Pixel 5 against production on 2026-11-13: when the feature
// discovery card joined the stack on an agent profile, the stack box grew from
// 171x44 to 340x214, and its top-left corner moved, because the box was
// anchored at the bottom-right and sized to its content. The layout-instability
// API scored that 0.0595. When the card was dismissed the box shrank back,
// scoring another 0.0595. Two helper chips cost the page 0.119 CLS, more than
// the whole 0.1 budget. /forge and /marketplace paid the same toll.
//
// JSDOM has no layout, so this runs the module in a real Chromium and reads the
// browser's own layout-shift entries. The page is served from memory, so the
// spec needs nothing from the dev server.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const SOURCE = readFileSync(resolve(process.cwd(), 'public/corner-stack.js'), 'utf8');
const ORIGIN = 'http://corner-stack.test/';

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:14px system-ui}main{height:200vh;background:#eee}</style></head>
<body><main><h1>Page</h1></main>
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
<script>${SOURCE.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;

async function open(page, viewport) {
	await page.setViewportSize(viewport);
	await page.route(ORIGIN, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
	await page.goto(ORIGIN);
	await page.waitForFunction(() => !!window.twsCornerStack);
}

/** Two animation frames, so the browser has laid out and reported any shift. */
function settle(page) {
	return page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 350)))),
	);
}

function mountBox(page, { id, priority, width, height }) {
	return page.evaluate(
		({ id, priority, width, height }) => {
			const el = document.createElement('div');
			el.id = id;
			el.style.cssText = `width:${width}px;height:${height}px;background:#234;border-radius:12px`;
			window.twsCornerStack.mount(el, { priority });
		},
		{ id, priority, width, height },
	);
}

const VIEWPORTS = {
	phone: { width: 393, height: 851 },
	desktop: { width: 1280, height: 800 },
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
	test(`a member joining and leaving the stack is not a layout shift (${name})`, async ({ page }) => {
		await open(page, viewport);
		// The Getting started pill owns the corner (priority 30).
		await mountBox(page, { id: 'pill', priority: 30, width: 171, height: 44 });
		await settle(page);
		const before = await page.evaluate(() => window.__cls);

		// Feature discovery arrives late with a wide card (priority 10, above the pill)...
		await mountBox(page, { id: 'disc', priority: 10, width: 340, height: 160 });
		await settle(page);
		// ...and is dismissed a few seconds later.
		await page.evaluate(() => window.twsCornerStack.unmount(document.getElementById('disc')));
		await settle(page);

		const shifts = await page.evaluate(() => window.__shifts);
		const after = await page.evaluate(() => window.__cls);
		expect(after - before, JSON.stringify(shifts)).toBe(0);
	});

	test(`members still hug the bottom-right corner (${name})`, async ({ page }) => {
		await open(page, viewport);
		await mountBox(page, { id: 'pill', priority: 30, width: 171, height: 44 });
		await mountBox(page, { id: 'disc', priority: 10, width: 340, height: 160 });
		await settle(page);
		const inset = viewport.width <= 640 ? 12 : 18;
		const pill = await page.locator('#pill').boundingBox();
		const disc = await page.locator('#disc').boundingBox();
		expect(Math.round(pill.x + pill.width)).toBe(viewport.width - inset);
		expect(Math.round(pill.y + pill.height)).toBe(viewport.height - inset);
		// Lower priority sits above, right-aligned with the corner member.
		expect(Math.round(disc.x + disc.width)).toBe(viewport.width - inset);
		expect(disc.y + disc.height).toBeLessThanOrEqual(pill.y);
	});
}

test('a late arrival of equal rank never displaces an established member', async ({ page }) => {
	await open(page, VIEWPORTS.phone);
	await mountBox(page, { id: 'lang', priority: 10, width: 60, height: 44 });
	await settle(page);
	const before = await page.evaluate(() => window.__cls);
	await mountBox(page, { id: 'disc', priority: 10, width: 300, height: 140 });
	await settle(page);
	const order = await page.evaluate(() =>
		[...document.getElementById('tws-corner-stack').children].map((el) => el.id),
	);
	expect(order).toEqual(['disc', 'lang']);
	expect(await page.evaluate(() => window.__cls)).toBe(before);
});

test('rect() reports the members, not the full-height box', async ({ page }) => {
	await open(page, VIEWPORTS.phone);
	await mountBox(page, { id: 'pill', priority: 30, width: 171, height: 44 });
	await mountBox(page, { id: 'disc', priority: 10, width: 340, height: 160 });
	await settle(page);
	const r = await page.evaluate(() => window.twsCornerStack.rect());
	expect(Math.round(r.width)).toBe(340);
	expect(Math.round(r.height)).toBe(160 + 10 + 44);
	expect(Math.round(r.bottom)).toBe(VIEWPORTS.phone.height - 12);
});

test('page chrome beside the members, not under them, does not lift the stack', async ({ page }) => {
	await open(page, VIEWPORTS.phone);
	// A bottom-left fixed button: inside the stack's possible column on a phone,
	// but nowhere near the 60px member hugging the right edge.
	await page.evaluate(() => {
		const b = document.createElement('button');
		b.textContent = 'Back';
		b.style.cssText = 'position:fixed;left:12px;bottom:12px;width:120px;height:48px';
		document.body.appendChild(b);
	});
	await mountBox(page, { id: 'lang', priority: 10, width: 60, height: 44 });
	await page.waitForTimeout(600);
	const dock = await page.evaluate(() =>
		document.documentElement.style.getPropertyValue('--tws-corner-dock'),
	);
	expect(dock).toBe('');
});

test('page chrome under the members still lifts the stack clear of it', async ({ page }) => {
	await open(page, VIEWPORTS.phone);
	await page.evaluate(() => {
		const bar = document.createElement('div');
		bar.id = 'composer';
		bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:72px;background:#fff';
		document.body.appendChild(bar);
	});
	await mountBox(page, { id: 'lang', priority: 10, width: 60, height: 44 });
	await page.waitForTimeout(900);
	const lang = await page.locator('#lang').boundingBox();
	const bar = await page.locator('#composer').boundingBox();
	expect(lang.y + lang.height).toBeLessThanOrEqual(bar.y);
});
