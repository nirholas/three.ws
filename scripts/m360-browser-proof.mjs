// Drives /video-to-motion in a real browser with a real 2:1 clip: proves 360 mode,
// the click marker and the request body. Usage:
//   node scripts/m360-browser-proof.mjs <clip.mp4> [--wait-job] [--page=/video-to-motion]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const clip = process.argv[2];
const waitJob = process.argv.includes('--wait-job');
const injectReframe = (process.argv.find((a) => a.startsWith('--inject-reframe=')) || '').slice(17);
const pickAt = (process.argv.find((a) => a.startsWith('--pick=')) || '--pick=0.52,0.55').slice(7).split(',').map(Number);
const pagePath = (process.argv.find((a) => a.startsWith('--page=')) || '--page=/video-to-motion').slice(7);
const base = 'http://localhost:3342';
const state = JSON.parse(readFileSync('.auth/audit-state.json', 'utf8'));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
await ctx.route('**/localhost:3342/api/**', async (route) => {
	const response = await route.fetch({ headers: { ...route.request().headers(), cookie } }).catch(() => null);
	if (!response) return route.abort();
	await route.fulfill({ response });
});
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const bodies = [];
page.on('request', (r) => {
	if (r.url().includes('/api/motion-swap') && r.method() === 'POST') bodies.push(r.postData());
});
// R2 only allows the production origin for CORS, so this harness performs the
// presigned PUT from node (a real upload to the real bucket) and answers the page.
await ctx.route(/r2\.cloudflarestorage\.com/, async (route) => {
	const req = route.request();
	if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'PUT' } });
	const put = await fetch(req.url(), { method: 'PUT', headers: { 'content-type': req.headers()['content-type'] || 'video/mp4' }, body: req.postDataBuffer() });
	console.log('R2 PUT status:', put.status);
	return route.fulfill({ status: put.status, headers: { 'access-control-allow-origin': '*' }, body: '' });
});
if (injectReframe) {
	await ctx.route('**/__reframe.mp4', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: readFileSync(injectReframe) }));
	await ctx.route(/\/api\/motion-swap\?job=/, async (route) => {
		const response = await route.fetch({ headers: { ...route.request().headers(), cookie } });
		const json = await response.json().catch(() => null);
		if (json && json.status === 'done') json.reframe_url = '/__reframe.mp4';
		await route.fulfill({ response, json });
	});
}
await page.goto(base + pagePath, { waitUntil: 'domcontentloaded', timeout: 180000 });
const input = pagePath.includes('swap') ? '#ms-file' : '#vtm-file';
await page.setInputFiles(input, clip);
await page.waitForSelector('.m360-badge', { timeout: 240000 });
console.log('badge:', (await page.textContent('.m360-badge')).trim());
await page.waitForFunction(() => !document.querySelector('.m360-skeleton'), null, { timeout: 240000 }).catch(() => {});
await page.screenshot({ path: '/home/user/.cache/m360/shot-pick.png' });
const view = await page.waitForSelector('.m360-view', { timeout: 240000 });
const box = await view.boundingBox();
await page.mouse.click(box.x + box.width * pickAt[0], box.y + box.height * pickAt[1]);
await page.waitForSelector('.m360-marker', { timeout: 10000 });
console.log('readout:', (await page.textContent('.m360-readout')).trim());
await page.screenshot({ path: '/home/user/.cache/m360/shot-marker.png' });
await page.click('text=Track the person I picked');
await page.waitForTimeout(15000);
console.log('request bodies:', bodies);
await page.screenshot({ path: '/home/user/.cache/m360/shot-submitted.png' });
if (waitJob) {
	await page.waitForFunction(() => document.querySelector('#vtm-stage-failed:not([hidden])') || document.querySelector('#vtm-stage-pick .m360-message') || document.querySelector('#vtm-controls:not([hidden])') || document.querySelector('.m360-reframe:not([hidden])') || document.querySelector('#ms-result:not([hidden])'), null, { timeout: 600000 }).catch((e) => console.log('wait ended:', e.message));
	await page.screenshot({ path: '/home/user/.cache/m360/shot-result.png' });
	console.log('reframe panel visible:', await page.isVisible('.m360-reframe:not([hidden])'));
}
console.log('console problems:', problems);
await browser.close();
