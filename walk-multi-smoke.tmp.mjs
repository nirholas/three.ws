import { chromium } from 'playwright';

const VITE = 'http://localhost:3000';
const TIMEOUT = 25_000;

const browser = await chromium.launch();

async function newClient(name) {
	const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
	await ctx.grantPermissions(['camera']);
	const page = await ctx.newPage();
	const errs = [];
	page.on('pageerror', (err) => errs.push(`[pageerror:${name}] ${err?.stack || err}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errs.push(`[console.error:${name}] ${m.text()}`);
	});
	return { ctx, page, errs };
}

const a = await newClient('A');
const b = await newClient('B');

// Each client connects with a different display name.
await a.page.goto(`${VITE}/walk?name=alice`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
await b.page.goto(`${VITE}/walk?name=bob`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

// Wait for both avatars to load (status text flips to "walk it").
const waitForReady = (p) =>
	p.waitForFunction(
		() => {
			const el = document.getElementById('walk-status');
			return el && /walk it/i.test(el.textContent || '');
		},
		{ timeout: TIMEOUT },
	);
await Promise.all([waitForReady(a.page), waitForReady(b.page)]);

// Wait for the online pill on each client to flip to "online".
const waitForOnline = (p) =>
	p.waitForFunction(
		() => {
			const el = document.getElementById('walk-online');
			return el && el.getAttribute('data-status') === 'online';
		},
		{ timeout: TIMEOUT },
	);
await Promise.all([waitForOnline(a.page), waitForOnline(b.page)]);

// Push A forward (W) for ~1.2s — B should observe A's position changing.
// We detect that by waiting for B's DOM to gain a .walk-remote-label
// (alice's floating name tag).
await a.page.evaluate(async () => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
	fire('keydown', 'KeyW');
	await wait(1200);
	fire('keyup', 'KeyW');
});

// Give B a moment to receive the patches.
await b.page.waitForTimeout(800);

const bSawA = await b.page.evaluate(() => {
	const labels = Array.from(document.querySelectorAll('.walk-remote-label'));
	return {
		count: labels.length,
		names: labels.map((l) => l.textContent),
		countPill: document.getElementById('walk-online-count')?.textContent,
	};
});
const aSawB = await a.page.evaluate(() => {
	const labels = Array.from(document.querySelectorAll('.walk-remote-label'));
	return {
		count: labels.length,
		names: labels.map((l) => l.textContent),
		countPill: document.getElementById('walk-online-count')?.textContent,
	};
});

// Screenshots for visual confirmation.
await a.page.screenshot({ path: 'walk-multi-A.png' });
await b.page.screenshot({ path: 'walk-multi-B.png' });

await browser.close();

const errs = [...a.errs, ...b.errs];
const ok =
	bSawA.count >= 1 &&
	bSawA.names.includes('alice') &&
	aSawB.count >= 1 &&
	aSawB.names.includes('bob') &&
	errs.length === 0;
console.log(JSON.stringify({ ok, bSawA, aSawB, errs }, null, 2));
process.exit(ok ? 0 : 1);
