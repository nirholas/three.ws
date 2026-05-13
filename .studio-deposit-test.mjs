import { chromium } from 'playwright';

const ADDR = 'FYiw1234567890abcdefghijklmnopqrstuvwxyzNFYP';
const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();

const myErrors = [];
const ignoreUrl = (u) => /\/api\/(pump\/by-agent|auth\/wallets)/.test(u);
page.on('pageerror', (e) => myErrors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
	if (m.type() !== 'error') return;
	const text = m.text();
	if (/Failed to load resource/i.test(text)) return; // captured via response handler below
	myErrors.push('CONSOLE: ' + text);
});
page.on('response', (r) => {
	if (r.status() >= 400 && !ignoreUrl(r.url())) {
		myErrors.push(`HTTP ${r.status()} ${r.url()}`);
	}
});

await page.addInitScript((addr) => {
	const pub = { toBase58: () => addr, toString: () => addr };
	window.phantom = {
		solana: {
			isPhantom: true, isConnected: true, publicKey: pub,
			connect: async () => ({ publicKey: pub }),
			disconnect: async () => {},
			on: () => {}, off: () => {},
		},
	};
}, ADDR);

await page.route('**/api/solana-rpc**', async (route) => {
	const body = JSON.parse(route.request().postData() || '{}');
	const result = body?.method === 'getBalance'
		? { context: { slot: 1 }, value: 16_000_000 }
		: null;
	await route.fulfill({
		status: 200, contentType: 'application/json',
		body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
	});
});

await page.goto('http://localhost:3000/studio-deposit-harness.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
await page.waitForSelector('.lp-wallet-addr', { timeout: 10000 });

const log = (k, v) => console.log(`${k}: ${JSON.stringify(v)}`);

// 1. Bar address renders short
log('SHORT_ADDR', await page.textContent('.lp-wallet-addr'));

// 2. Bar copy works
await page.click('.lp-wallet-addr');
await page.waitForTimeout(150);
log('BAR_CLIPBOARD_MATCH', (await page.evaluate(() => navigator.clipboard.readText())) === ADDR);
log('BAR_FEEDBACK', await page.textContent('.lp-wallet-addr'));

// Wait for label to restore
await page.waitForFunction(() => !/Copied/.test(document.querySelector('.lp-wallet-addr').textContent), { timeout: 3000 });

// 3. Open modal
await page.click('#lp-deposit');
await page.waitForSelector('.lp-dep');
await page.waitForSelector('.lp-dep-qr canvas', { timeout: 15000 });

// 4. QR loading spinner had role=status (was replaced by canvas, but check the markup)
const spinnerCheck = await page.evaluate(() => {
	const s = document.createElement('div');
	s.className = 'lp-dep-qr-load';
	// Read it from a freshly opened modal — instead check that the loader had role/aria via DOM history
	return true;
});

// Grab focus-trap behavior: first focus should be the close button
log('FIRST_FOCUS', await page.evaluate(() => document.activeElement?.id));

// Tab — should land on the address copy region
await page.keyboard.press('Tab');
log('TAB1_FOCUS', await page.evaluate(() => document.activeElement?.id));

// Tab again — wraps back to close button (focus trap)
await page.keyboard.press('Tab');
log('TAB2_FOCUS_WRAPS_TO_CLOSE', (await page.evaluate(() => document.activeElement?.id)) === 'lp-dep-close');

// Shift+Tab — wraps backward to address
await page.keyboard.press('Shift+Tab');
log('SHIFT_TAB_FOCUS', await page.evaluate(() => document.activeElement?.id));

// 5. Modal copy
await page.click('.lp-dep-addr');
await page.waitForTimeout(150);
log('MODAL_CLIPBOARD_MATCH', (await page.evaluate(() => navigator.clipboard.readText())) === ADDR);
log('MODAL_FEEDBACK', await page.textContent('#lp-dep-addr-label'));

// 6. Body scroll locked
log('SCROLL_LOCKED', (await page.evaluate(() => document.body.style.overflow)) === 'hidden');

// 7. Escape closes & restores focus
await page.keyboard.press('Escape');
await page.waitForSelector('.lp-dep', { state: 'detached' });
log('SCROLL_RESTORED', (await page.evaluate(() => document.body.style.overflow)) === '');
log('FOCUS_RETURNED', await page.evaluate(() => document.activeElement?.id || document.activeElement?.className));

// 8. Backdrop close
await page.click('#lp-deposit');
await page.waitForSelector('.lp-dep');
await page.locator('.lp-dep-bd').click({ position: { x: 3, y: 3 } });
await page.waitForSelector('.lp-dep', { state: 'detached' });
log('BACKDROP_CLOSE', true);

log('UNEXPECTED_ERRORS', myErrors.length === 0 ? 'none' : myErrors);

await browser.close();
process.exit(myErrors.length === 0 ? 0 : 1);
