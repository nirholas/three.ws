// Drives /video-to-motion in a real browser with a real 2:1 clip: proves 360 mode,
// the click marker and the request body. Usage:
//   node scripts/m360-browser-proof.mjs <clip.mp4> [--wait-job] [--page=/video-to-motion] [--width=400]
//     [--pick=x,y] [--fake-worker=pre341|341]   (fake-worker needs M360_CLIP_JSON and M360_REFRAME_MP4)
//     [--base=http://localhost:3342] [--key-file=<api key file>]
// Signs in with .auth/audit-state.json (npm run audit:web:login), or with a Bearer
// API key from --key-file (scripts/capture-upload-live-server.mjs writes one).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const opt = (name, fallback) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${fallback}`).slice(name.length + 3);

const clip = process.argv[2];
const waitJob = process.argv.includes('--wait-job');
const fakeWorker = (process.argv.find((a) => a.startsWith('--fake-worker=')) || '').slice(14);
const pickAt = (process.argv.find((a) => a.startsWith('--pick=')) || '--pick=0.52,0.55').slice(7).split(',').map(Number);
const pagePath = (process.argv.find((a) => a.startsWith('--page=')) || '--page=/video-to-motion').slice(7);
const base = opt('base', 'http://localhost:3342');
const keyFile = opt('key-file', '');
// Inputs for --fake-worker and where screenshots land (all set by the caller).
const CLIP_JSON = process.env.M360_CLIP_JSON;
const REFRAME_MP4 = process.env.M360_REFRAME_MP4;
const OUT_DIR = process.env.M360_OUT_DIR || '.';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=1280').slice(8)), height: 900 } });
// Against the Vite dev server, any file another agent saves triggers a full page
// reload over the HMR socket, which wiped the 360 stage mid-run. The HMR socket
// is answered here and never forwarded, so the page under test only changes
// when the visitor acts.
await ctx.routeWebSocket(/\/(\?token=[^/]*)?$/, () => {});
const auth = keyFile
	? { authorization: `Bearer ${readFileSync(keyFile, 'utf8').trim()}` }
	: { cookie: JSON.parse(readFileSync('.auth/audit-state.json', 'utf8')).cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
await ctx.route(`${base}/api/**`, async (route) => {
	const response = await route.fetch({ headers: { ...route.request().headers(), ...auth } }).catch(() => null);
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
if (fakeWorker) {
	// Production R2 rejects every presigned PUT right now (401 from curl too), so the
	// job lifecycle is answered here at the network layer. The request bodies the page
	// sends are the evidence; the clip is a real mocap clip from public/animations.
	await ctx.route(/\/api\/motion-swap/, async (route) => {
		const req = route.request();
		if (req.method() === 'POST') {
			const body = JSON.parse(req.postData() || '{}');
			if (body.action === 'upload') return route.fulfill({ json: { upload_url: 'https://upload.invalid/slot', public_url: 'https://assets.invalid/clip.mp4', method: 'PUT', headers: { 'content-type': 'video/mp4' }, expires_in: 300 } });
			return route.fulfill({ json: { job_id: 'proof-job', status: 'queued', eta_seconds: 5 } });
		}
		const done = { status: 'done', clip_url: '/__clip.json' };
		if (fakeWorker === '341') done.reframe_url = '/__reframe.mp4';
		return route.fulfill({ json: done });
	});
	await ctx.route('**/__clip.json', (route) => route.fulfill({ contentType: 'application/json', body: readFileSync(CLIP_JSON) }));
	await ctx.route('**/__reframe.mp4', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: readFileSync(REFRAME_MP4) }));
	await ctx.route(/upload\.invalid/, (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' }));
}
await page.goto(base + pagePath, { waitUntil: 'domcontentloaded', timeout: 180000 });
const input = pagePath.includes('swap') ? '#ms-file' : '#vtm-file';
await page.setInputFiles(input, clip);
await page.waitForSelector('.m360-badge', { timeout: 240000 });
console.log('badge:', (await page.textContent('.m360-badge')).trim());
await page.waitForFunction(() => !document.querySelector('.m360-skeleton'), null, { timeout: 240000 }).catch(() => {});
await page.screenshot({ path: `${OUT_DIR}/shot-pick.png` });
const view = await page.waitForSelector('.m360-view', { timeout: 240000 });
const box = await view.boundingBox();
await page.mouse.click(box.x + box.width * pickAt[0], box.y + box.height * pickAt[1]);
await page.waitForSelector('.m360-marker', { timeout: 10000 });
console.log('readout:', (await page.textContent('.m360-readout')).trim());
await page.screenshot({ path: `${OUT_DIR}/shot-marker.png` });
await page.click('text=Track the person I picked');
await page.waitForTimeout(15000);
console.log('request bodies:', bodies);
await page.screenshot({ path: `${OUT_DIR}/shot-submitted.png` });
if (waitJob) {
	// Only terminal stages count, and each must be shown, not just present: the pick-stage
	// alert stays in the DOM after the pick, and the player controls are always on screen,
	// so matching either ended the wait while the job was still tracking.
	const terminal = ['#vtm-stage-ready', '#vtm-stage-failed', '#vtm-stage-limit', '#vtm-stage-pick .m360-message', '#ms-result'];
	const shown = (sels) => sels.filter((sel) => {
		const el = document.querySelector(sel);
		return Boolean(el && !el.closest('[hidden]') && el.offsetParent);
	});
	const anyShown = (sels) => sels.some((sel) => {
		const el = document.querySelector(sel);
		return Boolean(el && !el.closest('[hidden]') && el.offsetParent);
	});
	await page.waitForFunction(anyShown, terminal, { timeout: 1200000, polling: 1000 }).catch((e) => console.log('wait ended:', e.message));
	console.log('final state:', (await page.evaluate(shown, terminal)).join(', ') || 'none shown');
	console.log('reframe panel visible:', await page.isVisible('#vtm-reframe:not([hidden])'));
	// The reframed MP4 streams from the bucket after the ready stage shows, so the
	// screenshot waits for its first decoded frame instead of catching an empty box.
	await page.waitForFunction(() => (document.querySelector('#vtm-reframe video')?.readyState || 0) >= 2, null, { timeout: 120000, polling: 500 })
		.catch((e) => console.log('reframe wait ended:', e.message));
	console.log('reframe video:', await page.evaluate(() => {
		const v = document.querySelector('#vtm-reframe video');
		return v ? { readyState: v.readyState, width: v.videoWidth, height: v.videoHeight, duration: v.duration, src: v.currentSrc.split('?')[0] } : null;
	}));
	await page.locator('#vtm-reframe').scrollIntoViewIfNeeded().catch(() => {});
	await page.screenshot({ path: `${OUT_DIR}/shot-result.png` });
}
console.log('console problems:', problems);
await browser.close();
