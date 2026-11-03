// Diagnostic harness for the "/play kicks mobile users out right after joining"
// report. Loads the live world in an emulated phone, drops into the $THREE home
// town the way a first-time visitor does, and records every console message,
// page error, websocket lifecycle event, failed request, transferred-bytes total
// and JS heap sample until the run window closes.
//
//   ENGINE=chromium node scripts/play-mobile-repro.mjs https://three.ws/play 120000
//   ENGINE=webkit   node scripts/play-mobile-repro.mjs https://three.ws/play 120000
//
// Chromium reports heap + transfer sizes; WebKit reproduces iOS Safari behaviour
// (memory kills, WebSocket lifecycle) but exposes no heap counters.
//
// SUMMARY_JSON=<path> also writes a machine-readable summary of the run (page
// errors, crashes, socket closes, duplicate asset downloads, transfer, heap,
// time to a visible world, worst frame while walking). scripts/audit-event-client.mjs
// judges that file against scripts/audit-event-client.baseline.json, so the
// pre-event check is one command with a real exit code.
import { writeFileSync } from 'node:fs';
import { webkit, chromium, devices } from 'playwright';
import { countsAsTransfer, duplicateDownloads } from './lib/event-client-verdict.mjs';

const ENGINE = process.env.ENGINE === 'chromium' ? chromium : webkit;
const ENGINE_NAME = ENGINE === chromium ? 'chromium' : 'webkit';
const DEVICE = process.env.DEVICE || 'iPhone 14';
const TARGET = process.argv[2] || 'https://three.ws/play';
const RUN_MS = Number(process.argv[3] || 120000);
const SUMMARY_JSON = process.env.SUMMARY_JSON || '';
// Seconds of scripted walking (W/A/D held in turn) at the end of the run, with a
// requestAnimationFrame sampler recording every frame delta while it lasts.
const WALK_MS = Number(process.env.WALK_MS || 30000);
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 90000);

const summary = {
	engine: ENGINE_NAME,
	device: DEVICE,
	target: TARGET,
	runMs: RUN_MS,
	startedAt: new Date().toISOString(),
	navigation: { ok: false, error: null },
	worldVisibleMs: null,
	bootError: null,
	crashed: false,
	pageErrors: [],
	consoleErrors: [],
	consoleWarnings: [],
	networkChanged: 0,
	wsOpens: 0,
	wsCloses: [],
	transferMB: 0,
	heap: { firstMB: null, peakMB: null, lastMB: null, growthMB: null, samples: 0 },
	frames: { worstMs: null, p95Ms: null, samples: 0 },
	duplicateFetches: [],
};
let closing = false;

function writeSummary() {
	if (!SUMMARY_JSON) return;
	writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2));
}

const browser = await ENGINE.launch({
	args: ENGINE === chromium ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
const ctx = await browser.newContext({ ...devices[DEVICE] });
// Frame-time sampler. Idle until the walk phase flips __frameRec on, so the
// numbers describe walking through the plaza, not the boot.
await ctx.addInitScript(() => {
	window.__frameRec = false;
	window.__frameDeltas = [];
	let last = 0;
	const tick = (t) => {
		if (window.__frameRec && last) window.__frameDeltas.push(t - last);
		last = t;
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
});
// Trace every animation-clip fetch back to its caller so a duplicated download
// can be attributed to the code that asked for it, not just counted.
await ctx.addInitScript(() => {
	window.__clipFetches = [];
	// GLTFLoader loads through XMLHttpRequest, not fetch, so model downloads need
	// their own hook to be attributable.
	window.__glbLoads = [];
	const origOpen = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (method, url, ...rest) {
		if (/\.glb(\?|$)/i.test(String(url))) window.__glbLoads.push({ url: String(url), method, stack: new Error().stack });
		return origOpen.call(this, method, url, ...rest);
	};
	const origFetch = window.fetch;
	window.fetch = function (input, init) {
		const url = typeof input === 'string' ? input : input?.url || '';
		if (/\/animations\/(clips|manifest)/.test(url)) {
			window.__clipFetches.push({ url, stack: new Error().stack });
		}
		const method = init?.method || input?.method || 'GET';
		if (/\.glb(\?|$)/i.test(url)) window.__glbLoads.push({ url, method, stack: new Error().stack });
		return origFetch.call(this, input, init);
	};
});
const page = await ctx.newPage();
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

let bytes = 0;
const byHost = new Map();
const biggest = [];

page.on('console', (m) => {
	const type = m.type();
	const cap = type === 'error' || type === 'warning' ? 400 : 200;
	console.log(at(), `[console.${type}]`, m.text().slice(0, cap));
	if (type === 'error') summary.consoleErrors.push(m.text().slice(0, 400));
	if (type === 'warning') summary.consoleWarnings.push(m.text().slice(0, 400));
});
page.on('pageerror', (e) => {
	console.log(at(), '[pageerror]', String(e?.stack || e).slice(0, 800));
	summary.pageErrors.push(String(e?.message || e).slice(0, 400));
});
page.on('crash', () => {
	console.log(at(), '[PAGE CRASH]');
	summary.crashed = true;
});
page.on('requestfailed', (r) => {
	const why = r.failure()?.errorText || '';
	console.log(at(), '[reqfail]', why, r.url().slice(0, 140));
	// The host's interfaces changed (another tenant's container came up) and
	// Chromium aborted everything in flight. That spoils the run; the verdict
	// reports it as unmeasured rather than blaming /play.
	if (/ERR_NETWORK_CHANGED/.test(why)) summary.networkChanged++;
});
page.on('response', async (r) => {
	if (r.status() >= 400) console.log(at(), '[http]', r.status(), r.url().slice(0, 140));
	if (!countsAsTransfer({ url: r.url(), method: r.request().method() })) return;
	try {
		const len = Number((await r.allHeaders())['content-length'] || 0);
		if (len > 0) {
			bytes += len;
			const host = new URL(r.url()).host;
			byHost.set(host, (byHost.get(host) || 0) + len);
			biggest.push([len, r.url()]);
		}
	} catch { /* response body gone, not worth failing the run over */ }
});
page.on('websocket', (ws) => {
	console.log(at(), '[ws OPEN]', ws.url().slice(0, 160));
	summary.wsOpens++;
	ws.on('close', () => {
		console.log(at(), '[ws CLOSE]', ws.url().slice(0, 100));
		// Sockets closing because the harness is shutting the browser down are the
		// end of the run, not a disconnect.
		if (!closing) summary.wsCloses.push({ url: ws.url(), atMs: Date.now() - t0 });
	});
	ws.on('socketerror', (err) => console.log(at(), '[ws ERROR]', err));
});
page.on('framenavigated', (f) => {
	if (f === page.mainFrame()) console.log(at(), '[navigated]', f.url().slice(0, 160));
});

try {
	await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
	summary.navigation.ok = true;
} catch (err) {
	// On a saturated box the first navigation can miss its window entirely. Record
	// it so the verdict reads "unmeasured" instead of the harness dying uncaught.
	summary.navigation.error = String(err?.message || err).split('\n')[0].slice(0, 200);
	console.log(at(), '[navigation failed]', summary.navigation.error);
	writeSummary();
	await browser.close();
	process.exit(0);
}
console.log(at(), 'domcontentloaded');
// Time to a visible world: the moment the boot loader (#kx-loading) is hidden.
const navT0 = Date.now();
const worldVisible = page
	.waitForFunction(() => {
		const l = document.getElementById('kx-loading');
		return !l || l.classList.contains('kx-hidden');
	}, null, { timeout: RUN_MS + 60000, polling: 250 })
	.then(() => {
		summary.worldVisibleMs = Date.now() - navT0;
		console.log(at(), '[world visible]', summary.worldVisibleMs, 'ms after domcontentloaded');
	})
	.catch(() => {});

// Drive the cold-open intro: drop straight into the $THREE home town, the same
// zero-friction path a first-time mobile visitor takes.
try {
	await page.waitForSelector('.pi-btn-primary', { timeout: 25000 });
	await page.click('.pi-btn-primary');
	console.log(at(), '[action] clicked drop-in');
} catch (err) {
	console.log(at(), '[action] no intro CTA:', String(err).slice(0, 120));
}

// Clear the onboarding cards so the screenshot shows the world itself.
// A page that closes under us (WebKit's renderer dies without always firing
// 'crash') must end the run with a recorded verdict, never an uncaught throw
// that leaves no summary behind.
const pageGone = (err) => /has been closed|Target crashed|Page crashed/i.test(String(err));
const markGone = (err) => {
	if (!pageGone(err)) return false;
	if (!summary.crashed) console.log(at(), '[PAGE GONE]', String(err).split('\n')[0].slice(0, 160));
	summary.crashed = true;
	return true;
};
for (let i = 0; i < 6 && !summary.crashed; i++) {
	try {
		await page.waitForTimeout(2500);
		const clicked = await page.evaluate(() => {
			const btn = [...document.querySelectorAll('button')]
				.find((b) => /^(continue|enter the world|got it|start|close|skip)$/i.test(b.textContent.trim()) && b.offsetParent);
			if (btn) { btn.click(); return btn.textContent.trim(); }
			return null;
		});
		if (clicked) console.log(at(), '[action] dismissed', clicked);
	} catch (err) {
		if (!markGone(err)) console.log(at(), '[dismiss failed]', String(err).slice(0, 160));
	}
}

const deadline = Date.now() + RUN_MS;
let lastDom = '';
while (Date.now() < deadline && !summary.crashed) {
	try {
		await page.waitForTimeout(3000);
		const snap = await page.evaluate(() => {
			const loader = document.getElementById('kx-loading');
			const bootErr = loader && loader.querySelector('.kx-boot-error');
			const mem = performance.memory
				? Math.round(performance.memory.usedJSHeapSize / 1048576)
				: null;
			const cc = window.__CC__;
			return {
				phase: cc?.phase || null,
				crowd: document.querySelectorAll('.cc-label').length,
				loading: !!(loader && !loader.classList.contains('kx-hidden')),
				bootError: bootErr ? bootErr.textContent.slice(0, 200) : null,
				heapMB: mem,
				toasts: [...document.querySelectorAll('[class*="toast"]')].map((n) => n.textContent.trim().slice(0, 100)),
			};
		});
		const key = JSON.stringify({ ...snap, heapMB: undefined });
		if (key !== lastDom) { console.log(at(), '[dom]', JSON.stringify(snap)); lastDom = key; }
		else if (snap.heapMB != null) console.log(at(), '[heap]', snap.heapMB, 'MB · transferred', (bytes / 1048576).toFixed(1), 'MB');
		if (snap.bootError) summary.bootError = snap.bootError;
		// Heap growth is measured from the first sample after the world is up, so
		// the boot's own allocation is not mistaken for a leak.
		if (snap.heapMB != null && summary.worldVisibleMs != null) {
			const h = summary.heap;
			if (h.firstMB == null) h.firstMB = snap.heapMB;
			h.peakMB = Math.max(h.peakMB ?? 0, snap.heapMB);
			h.lastMB = snap.heapMB;
			h.growthMB = h.lastMB - h.firstMB;
			h.samples++;
		}
	} catch (err) {
		if (!markGone(err)) console.log(at(), '[eval failed]', String(err).slice(0, 200));
	}
}

// Walk the plaza with the frame sampler on: forward, strafe, turn, the way a
// visitor explores. Keyboard input works in the emulated phone too, and it is
// the one input path both engines deliver identically.
if (WALK_MS > 0 && summary.worldVisibleMs != null && !summary.crashed) {
	try {
		await page.evaluate(() => { window.__frameDeltas = []; window.__frameRec = true; });
		const pattern = [['KeyW', 3000], ['KeyD', 1200], ['KeyW', 2500], ['KeyA', 1200], ['KeyS', 1500]];
		const walkEnd = Date.now() + WALK_MS;
		for (let i = 0; Date.now() < walkEnd; i++) {
			const [key, ms] = pattern[i % pattern.length];
			await page.keyboard.down(key);
			await page.waitForTimeout(Math.min(ms, Math.max(0, walkEnd - Date.now())));
			await page.keyboard.up(key);
		}
		const deltas = await page.evaluate(() => { window.__frameRec = false; return window.__frameDeltas; });
		if (deltas.length) {
			const sorted = [...deltas].sort((a, b) => a - b);
			summary.frames = {
				worstMs: Math.round(sorted[sorted.length - 1]),
				p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
				samples: deltas.length,
			};
			console.log(at(), '[frames]', JSON.stringify(summary.frames));
		}
	} catch (err) {
		if (!markGone(err)) console.log(at(), '[walk failed]', String(err).slice(0, 200));
	}
}
await worldVisible.catch(() => {});

console.log('\n=== transfer totals ===');
console.log('total', (bytes / 1048576).toFixed(1), 'MB');
for (const [host, n] of [...byHost].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
	console.log(' ', (n / 1048576).toFixed(2).padStart(8), 'MB', host);
}
const counts = new Map();
for (const [, url] of biggest) counts.set(url, (counts.get(url) || 0) + 1);
console.log('\n=== most-repeated responses ===');
for (const [url, c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
	console.log(' ', String(c).padStart(4), 'x', url.slice(0, 130));
}
console.log('\n=== 25 largest responses ===');
for (const [len, url] of biggest.sort((a, b) => b[0] - a[0]).slice(0, 25)) {
	console.log(' ', (len / 1048576).toFixed(2).padStart(8), 'MB', url.slice(0, 150));
}
const byPath = new Map();
for (const [len, url] of biggest) {
	const k = url.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/*');
	byPath.set(k, [(byPath.get(k)?.[0] || 0) + len, (byPath.get(k)?.[1] || 0) + 1]);
}
console.log('\n=== bytes by path group ===');
for (const [k, [n, c]] of [...byPath].sort((a, b) => b[1][0] - a[1][0]).slice(0, 20)) {
	console.log(' ', (n / 1048576).toFixed(2).padStart(8), 'MB', String(c).padStart(4), 'x', k.slice(0, 120));
}

try {
	const glb = await page.evaluate(() => window.__glbLoads || []);
	console.log('\n=== GLB loads (' + glb.length + ') ===');
	const seen = new Set();
	for (const g of glb) {
		const frames = g.stack.split('\n').filter((l) => !/chunk-|node_modules/.test(l)).slice(1, 5).map((l) => l.trim().replace(/^at /, '')).join(' < ');
		const line = '  ' + g.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 70) + '  <-  ' + frames.slice(0, 220);
		if (!seen.has(line)) { seen.add(line); console.log(line); }
	}
	const traces = await page.evaluate(() => window.__clipFetches || []);
	// A duplicate is the same asset URL requested more than once by page code:
	// the second request is the loader failing to reuse what it already has.
	summary.duplicateFetches = duplicateDownloads([...glb, ...traces]);
	const byUrl = new Map();
	for (const t of traces) {
		const k = t.url.replace(/^https?:\/\/[^/]+/, '');
		if (!byUrl.has(k)) byUrl.set(k, []);
		byUrl.get(k).push(t.stack);
	}
	console.log('\n=== in-page fetch() calls for clips ===');
	for (const [k, stacks] of [...byUrl].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
		console.log(' ', String(stacks.length).padStart(3), 'x', k);
		const frames = stacks[0].split('\n').slice(1, 7).map((l) => '        ' + l.trim());
		console.log(frames.join('\n'));
	}
} catch (err) {
	console.log('[trace read failed]', String(err).slice(0, 160));
}

if (process.env.SHOT && !summary.crashed) await page.screenshot({ path: process.env.SHOT }).catch(() => {});
summary.transferMB = Math.round((bytes / 1048576) * 10) / 10;
writeSummary();
closing = true;
await browser.close().catch(() => {});
