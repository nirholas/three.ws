import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const URL = 'http://localhost:3003/walk';
const TIMEOUT = 25_000;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
await context.grantPermissions(['camera']);

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err?.stack || String(err)));
page.on('console', (msg) => {
	if (msg.type() === 'error') pageErrors.push('[console.error] ' + msg.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
await page.waitForFunction(
	() => {
		const el = document.getElementById('walk-status');
		return el && /walk it/i.test(el.textContent || '');
	},
	{ timeout: TIMEOUT },
);
// Allow one extra second so idle clip settles into a deterministic pose.
await page.waitForTimeout(800);

const beforeBuf = await page.screenshot({ path: 'walk-before.png', fullPage: false });

await page.evaluate(async () => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const fireKey = (type, code) => {
		window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
	};
	fireKey('keydown', 'KeyW');
	await wait(1200);
	fireKey('keyup', 'KeyW');
	await wait(400);
});

const afterBuf = await page.screenshot({ path: 'walk-after.png', fullPage: false });

// Quick byte-level diff — if the avatar moved at all, the PNGs will differ.
// PNGs are deterministic for identical pixel input, so equal length+content
// across two distinct frames means literally nothing changed on screen.
const sameBytes = beforeBuf.length === afterBuf.length &&
	beforeBuf.equals(afterBuf);

await browser.close();

const ok = !sameBytes && pageErrors.length === 0;
console.log(JSON.stringify({
	ok,
	sameBytes,
	beforeBytes: beforeBuf.length,
	afterBytes: afterBuf.length,
	pageErrors,
}, null, 2));
process.exit(ok ? 0 : 1);
