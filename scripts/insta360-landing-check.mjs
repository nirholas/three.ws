// Drives /insta360 in a real browser: collects console errors and failed
// requests, checks every link on the page, exercises "Check your file" with
// real files, and measures horizontal overflow at a 400px viewport.
// Usage: node scripts/insta360-landing-check.mjs [baseUrl] [fixtureDir]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3346';
const FIXTURES = process.argv[3];

const browser = await chromium.launch();
const out = { consoleErrors: [], consoleWarnings: [], failedRequests: [], links: [], checker: [], overflow400: null };

const page = await browser.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') out.consoleErrors.push(m.text());
	if (m.type() === 'warning') out.consoleWarnings.push(m.text());
});
page.on('pageerror', (e) => out.consoleErrors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => out.failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
	if (r.status() >= 400) out.failedRequests.push(`${r.status()} ${r.url()}`);
});

await page.goto(`${BASE}/insta360`, { waitUntil: 'networkidle' });

const hrefs = await page.$$eval('main a[href]', (as) => [...new Set(as.map((a) => a.href))]);
for (const href of hrefs) {
	if (!/^https?:/.test(href)) continue;
	const local = href.startsWith(BASE);
	let status;
	try {
		const res = await fetch(local ? href : href, { redirect: 'follow', method: 'GET' });
		status = res.status;
		if (local && status === 200) {
			const body = await res.text();
			if (/<title>[^<]*(404|Not Found)/i.test(body)) status = '200 (404 page)';
		}
	} catch (e) {
		status = `error ${e.message}`;
	}
	out.links.push({ href: href.replace(BASE, ''), status });
}

if (FIXTURES) {
	for (const name of readFileSync(`${FIXTURES}/list.txt`, 'utf8').split('\n').filter(Boolean)) {
		await page.setInputFiles('#i360-check-input', `${FIXTURES}/${name}`);
		await page.waitForSelector('#i360-check-result:not([hidden])', { timeout: 15000 });
		const res = await page.evaluate(() => ({
			title: document.querySelector('.i360-result-title')?.textContent,
			notes: [...document.querySelectorAll('.i360-result-notes li')].map((li) => li.textContent),
			lanes: [...document.querySelectorAll('.i360-result-lane')].map((a) => a.getAttribute('href')),
			status: document.getElementById('i360-check-status').textContent,
		}));
		out.checker.push({ file: name, ...res });
		await page.click('#i360-check-again');
	}
}

await page.setViewportSize({ width: 400, height: 860 });
await page.waitForTimeout(300);
out.overflow400 = await page.evaluate(() => ({
	scrollWidth: document.documentElement.scrollWidth,
	clientWidth: document.documentElement.clientWidth,
	wide: [...document.querySelectorAll('main *')]
		.filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && !el.closest('.i360-table-wrap'))
		.slice(0, 5)
		.map((el) => `${el.tagName}.${el.className}`),
}));
await page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/insta360-400.png`, fullPage: true });

await browser.close();
console.log(JSON.stringify(out, null, 2));
