// Drive the two X share actions ("Share on X", "Ask @grok about it") on a real
// model page, avatar page and anatomy design in a browser, and record the exact
// X intent each one opens. See docs/share-to-x.md.
//
//   node scripts/verify-share-to-x-browser.mjs [--base http://localhost:3284] [--out <dir, default: OS temp>]
//        [--model <uuid>] [--avatar <uuid>] [--anatomy <uuid>] [--no-webgl]
//
// --no-webgl launches Chromium with --disable-3d-apis. On a loaded machine the
// swiftshader WebGL viewers starve the compositor and screenshots time out;
// without WebGL each page shows its no-WebGL fallback and the share UI, which
// is plain DOM, is exercised exactly the same.
//
// Nothing reaches X: window.open is replaced before any page script runs, so a
// click records the intent URL the real code built instead of opening x.com.
// The share funnel beacon is answered locally with 204 and recorded, so a run
// never increments a production counter. Writes one screenshot per page with
// the share UI open, plus results.json, and exits 1 if any check fails.

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', 'http://localhost:3284');
const OUT = resolve(arg('out', join(tmpdir(), 'three-ws-share-to-x')));
const IDS = {
	model: arg('model', '0001e5f4-adff-464d-859e-95867eae2f2c'),
	avatar: arg('avatar', '000027c6-127e-4de8-bea2-a4f44efa7b47'),
	anatomy: arg('anatomy', 'dfebfc22-f9d8-4928-8216-c97d074113ec'),
};

const PAGES = [
	{ kind: 'model', path: `/m/${IDS.model}`, open: '#mp-share', x: '.tws-sp-x', grok: '.tws-sp-grok', link: `/m/${IDS.model}` },
	{ kind: 'avatar', path: `/avatars/${IDS.avatar}`, open: null, x: '#share-twitter', grok: '#share-grok', link: `/avatars/${IDS.avatar}` },
	{ kind: 'anatomy', path: `/anatomy/${IDS.anatomy}`, open: '#anpShare', x: '.tws-sp-x', grok: '.tws-sp-grok', link: `/anatomy/${IDS.anatomy}` },
];

// Runs in the page before its scripts: record popups instead of opening them.
function stubPopups() {
	window.__popups = [];
	window.open = (url, target, features) => {
		window.__popups.push({ url: String(url), target: target || '', features: features || '' });
		return { closed: false, focus() {}, close() {} };
	};
}

function checkIntent(href, { link, campaign, kind }) {
	const problems = [];
	const u = new URL(href);
	if (u.origin + u.pathname !== 'https://x.com/intent/post') problems.push(`intent base is ${u.origin}${u.pathname}`);
	const text = u.searchParams.get('text') || '';
	const shared = u.searchParams.get('url');
	if (!shared) problems.push('no url param');
	else {
		const s = new URL(shared);
		if (s.pathname !== link) problems.push(`url points at ${s.pathname}, expected ${link}`);
		if (s.searchParams.get('utm_source') !== 'x') problems.push('utm_source is not x');
		if (s.searchParams.get('utm_medium') !== 'share') problems.push('utm_medium is not share');
		if (s.searchParams.get('utm_campaign') !== campaign) problems.push(`utm_campaign is ${s.searchParams.get('utm_campaign')}`);
	}
	if (campaign === 'grok-ask' && !/@grok$/.test(text)) problems.push(`${kind} Ask @grok text does not end with @grok`);
	if (!text.trim()) problems.push('empty text');
	return { text, url: shared, problems };
}

mkdirSync(OUT, { recursive: true });
const NO_WEBGL = process.argv.includes('--no-webgl');
const browser = await chromium.launch({
	args: NO_WEBGL ? ['--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const results = [];
let failed = 0;

for (const p of PAGES) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
	const page = await context.newPage();
	const consoleErrors = [];
	const beacons = [];
	page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
	page.on('pageerror', (e) => consoleErrors.push(String(e?.message || e)));
	await page.addInitScript(stubPopups);
	await page.route('**/api/share-funnel', async (route) => {
		beacons.push(route.request().postData() || '');
		await route.fulfill({ status: 204, body: '' });
	});
	// sendBeacon bypasses page.route in Chromium; record it too.
	await page.addInitScript(() => {
		window.__beacons = [];
		const send = navigator.sendBeacon?.bind(navigator);
		navigator.sendBeacon = (url, data) => {
			if (String(url).includes('/api/share-funnel')) {
				Promise.resolve(data instanceof Blob ? data.text() : String(data ?? '')).then((t) => window.__beacons.push(t));
				return true;
			}
			return send ? send(url, data) : false;
		};
	});

	const entry = { kind: p.kind, page: `${BASE}${p.path}`, actions: {}, problems: [] };
	try {
		await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
		if (p.open) {
			await page.locator(p.open).waitFor({ state: 'visible', timeout: 60000 });
			await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-disabled') !== 'true', p.open, { timeout: 60000 });
			await page.locator(p.open).click();
		}
		const grok = page.locator(p.grok).first();
		await grok.waitFor({ state: 'visible', timeout: 60000 });
		await page.waitForFunction((sel) => {
			const el = document.querySelector(sel);
			return el && el.getAttribute('aria-disabled') !== 'true' && el.getAttribute('href');
		}, p.grok, { timeout: 60000 });
		entry.grokLabel = await grok.getAttribute('aria-label');

		// Hover state on the Ask @grok action, then the screenshot with the share UI open.
		await grok.hover();
		await page.screenshot({ path: join(OUT, `${p.kind}.png`) });

		// Share on X by mouse, Ask @grok by keyboard (focus + Enter).
		await page.locator(p.x).first().click();
		await grok.focus();
		entry.grokFocusVisible = await grok.evaluate((el) => el.matches(':focus-visible') || document.activeElement === el);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);

		const popups = await page.evaluate(() => window.__popups);
		const sent = await page.evaluate(() => window.__beacons);
		entry.beacons = [...beacons, ...sent];
		const [xPopup, grokPopup] = popups;
		if (!xPopup) entry.problems.push('Share on X opened no popup');
		else entry.actions.share = { ...checkIntent(xPopup.url, { link: p.link, campaign: 'grok-share', kind: p.kind }), popup: xPopup.url };
		if (!grokPopup) entry.problems.push('Ask @grok opened no popup');
		else entry.actions.grok = { ...checkIntent(grokPopup.url, { link: p.link, campaign: 'grok-ask', kind: p.kind }), popup: grokPopup.url };
		for (const a of Object.values(entry.actions)) entry.problems.push(...a.problems);
		for (const want of [`x_share_${p.kind}`, `grok_ask_${p.kind}`]) {
			if (!entry.beacons.some((b) => b.includes(want))) entry.problems.push(`no ${want} beacon`);
		}
	} catch (err) {
		entry.problems.push(`run failed: ${err?.message || err}`);
		await page.screenshot({ path: join(OUT, `${p.kind}-error.png`) }).catch(() => {});
	}
	entry.consoleErrors = consoleErrors;
	if (entry.problems.length) failed++;
	results.push(entry);
	console.log(`${entry.problems.length ? 'FAIL' : 'ok  '} ${p.kind.padEnd(8)} ${entry.problems.join('; ') || 'both X actions open attributed intents and beacon'}`);
	await context.close();
}

await browser.close();
writeFileSync(join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(`wrote ${OUT}/results.json and one screenshot per page`);
process.exit(failed ? 1 : 0);
