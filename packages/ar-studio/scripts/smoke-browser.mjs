// End-to-end check in a real browser.
//
// The unit suite covers the pure logic; this covers the half that only a browser
// can answer: does the bundle boot, does a WebGL context come up, does the tray
// load a live catalogue, and does a real GLB actually make it into the scene.
// It is deliberately not part of `npm test`, because it needs Playwright and a
// downloaded browser, which no consumer of this package should have to install.
//
//   npm i -D playwright && npx playwright install chromium
//   node scripts/smoke-browser.mjs
//
// Exits non-zero on any console error, any page error, or any failed step.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4173);

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	console.error('This check needs Playwright:\n  npm i -D playwright && npx playwright install chromium\n');
	process.exit(2);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json' };
const server = createServer(async (req, res) => {
	const path = String(req.url).split('?')[0];
	const file = resolve(ROOT, 'docs', `.${path === '/' ? '/index.html' : path}`);
	try {
		res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
		res.end(await readFile(file));
	} catch {
		res.writeHead(404).end('not found');
	}
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const steps = [];
const step = (name, ok, detail = '') => {
	steps.push({ name, ok, detail });
	console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
};

try {
	await page.goto(`http://localhost:${PORT}/studio.html`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);

	const boot = await page.evaluate(() => {
		const canvas = document.querySelector('.ars-canvas');
		return {
			mounted: !!document.querySelector('.ars-root'),
			pixels: canvas ? canvas.width * canvas.height : 0,
			tabs: [...document.querySelectorAll('.ars-tab')].map((b) => b.textContent),
			empty: !document.querySelector('.ars-empty')?.hidden,
			webgl: !!document.querySelector('ar-studio')?.studio?.renderer?.getContext(),
		};
	});
	step('the studio mounts', boot.mounted);
	step('a WebGL context is live', boot.webgl);
	step('the canvas has real pixels', boot.pixels > 100000, `${boot.pixels} px`);
	step('the empty state is shown before anything is placed', boot.empty);
	step('source tabs render', boot.tabs.length >= 2, boot.tabs.join(', '));

	await page.click('button[aria-label="Add a model to the scene"]');
	await page.click('.ars-tab[data-tab="objects"]');
	await page.waitForSelector('.ars-item-add', { timeout: 30000 });
	const items = await page.evaluate(() => document.querySelectorAll('.ars-item-add').length);
	step('the live catalogue loads', items > 0, `${items} models listed`);

	await page.click('.ars-item-add');
	await page.waitForFunction(() => document.querySelector('ar-studio').studio.placements.length > 0, { timeout: 45000 });
	const placed = await page.evaluate(() => {
		const s = document.querySelector('ar-studio').studio;
		return { count: s.placements.length, share: s.shareUrl(), title: s.placements[0].title };
	});
	step('a real GLB loads into the scene', placed.count === 1, placed.title);
	step('the scene has a shareable link', placed.share.includes('#s='));

	const restored = await page.evaluate(async () => {
		const s = document.querySelector('ar-studio').studio;
		const before = s.getScene();
		await s.setScene(before);
		return JSON.stringify(s.getScene()) === JSON.stringify(before);
	});
	step('the arrangement round-trips through setScene', restored);

	await page.evaluate(() => document.querySelector('ar-studio').studio.clear());
	const cleared = await page.evaluate(() => document.querySelector('ar-studio').studio.placements.length);
	step('clearing empties the scene', cleared === 0);

	// The iOS path converts the GLB to USDZ on the device. Headless Chromium is
	// not iOS, but the conversion is the hard part and it runs identically here,
	// so this proves the bytes Quick Look would receive are real.
	const usdz = await page.evaluate(async () => {
		const mod = await import('./ar-studio.min.js');
		const t0 = performance.now();
		const blob = await mod.glbUrlToUsdzBlob('https://three.ws/cdn/objects/polyhaven/glb/adjustable_wrench.glb');
		const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
		const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
		return {
			bytes: blob.size,
			type: blob.type,
			zip: head[0] === 0x50 && head[1] === 0x4b,
			// three's exporter writes the scene as model.usda (older builds emitted
			// .usdc); Quick Look reads either, so accept both rather than pinning
			// this check to one version of the exporter.
			hasUsd: /\.usd[ac]\b/.test(text),
			entries: (text.match(/\.(usd[ac]|png|jpg)/g) || []).slice(0, 4).join(' '),
			// Entries are stored uncompressed (Quick Look requires it), so the USD
			// scene description is readable straight out of the archive.
			anchored: /preliminary:anchoring:type = "plane"/.test(text)
				&& /preliminary:planeAnchoring:alignment = "horizontal"/.test(text),
			metres: /metersPerUnit = 1/.test(text) && /upAxis = "Y"/.test(text),
			staged: /def Xform "Model"/.test(text),
			ms: Math.round(performance.now() - t0),
		};
	});
	step('a GLB converts to real USDZ bytes on the device', usdz.zip && usdz.hasUsd && usdz.bytes > 10000,
		`${(usdz.bytes / 1024).toFixed(0)} kB, ${usdz.type}, ${usdz.ms} ms, contains ${usdz.entries}`);
	// Without these three the model opens in Quick Look and then hangs in the air
	// instead of resting on the floor, which reads as broken tracking.
	step('the USDZ asks ARKit for horizontal plane anchoring', usdz.anchored === true);
	step('the USDZ declares metres and Y-up, the units Quick Look places by', usdz.metres === true);
	step('the model rides on a stage node, so its placement survives the exporter',
		usdz.staged === true);

	const caps = await page.evaluate(async () => {
		const mod = await import('./ar-studio.min.js');
		return {
			capability: await mod.arCapability(),
			banner: mod.withQuickLookBanner('blob:abc', { title: 'Crate', callToAction: 'Buy' }),
			filename: mod.usdzFilename('Adjustable Wrench'),
		};
	});
	step('AR capability resolves without throwing', typeof caps.capability === 'string', caps.capability);
	step('the Quick Look banner is attached as fragment params', caps.banner === 'blob:abc#checkoutTitle=Crate&callToAction=Buy');
	step('a model title becomes a .usdz filename', caps.filename === 'adjustable-wrench.usdz', caps.filename);

	await page.screenshot({ path: resolve(ROOT, 'smoke.png') });

	// Device routing: an iPhone must land on Quick Look and an Android phone on
	// Scene Viewer, because neither exposes WebXR and the camera-passthrough
	// approximation is not what either of those users should get.
	for (const [device, ua, want] of [
		['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'quicklook'],
		['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'sceneviewer'],
	]) {
		const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const p2 = await ctx.newPage();
		await p2.goto(`http://localhost:${PORT}/studio.html`, { waitUntil: 'networkidle' });
		await p2.waitForTimeout(1200);
		const got = await p2.evaluate(async () => {
			const mod = await import('./ar-studio.min.js');
			const studio = document.querySelector('ar-studio').studio;
			return {
				capability: await mod.arCapability(),
				mode: studio.arMode,
				buttonShown: !document.querySelector('.ars-ar-label')?.closest('button')?.hidden,
				label: document.querySelector('.ars-ar-label')?.textContent,
			};
		});
		step(`${device} routes to its native AR viewer`, got.capability === want, `${got.capability}, button "${got.label}"`);
		step(`${device} is offered the AR button`, got.buttonShown === true);

		// The whole feature, end to end: put a real model in the scene, open the
		// hand-off sheet the AR button opens, and prove the button in it is armed
		// with something the device's AR viewer can actually open.
		await p2.evaluate(() => document.querySelector('ar-studio').studio.addModel({
			src: 'https://three.ws/cdn/objects/polyhaven/glb/adjustable_wrench.glb', title: 'Wrench',
		}));
		await p2.waitForFunction(() => document.querySelector('ar-studio').studio.placements.length > 0, { timeout: 45000 });
		// Quick Look must never be handed a blob URL from a stale gesture, so the
		// anchor click is intercepted rather than followed: Chromium would try to
		// download the USDZ and tear the page down mid-check.
		await p2.evaluate(() => {
			window.__arClicks = [];
			const real = window.HTMLAnchorElement.prototype.click;
			window.HTMLAnchorElement.prototype.click = function patched() {
				if (this.rel === 'ar') { window.__arClicks.push(this.href); return; }
				return real.call(this);
			};
		});
		await p2.click('.ars-ar-label');
		await p2.waitForSelector('.ars-ar-go:not([disabled])', { timeout: 60000 });
		const sheet = await p2.evaluate(() => {
			const studio = document.querySelector('ar-studio').studio;
			return {
				open: !document.querySelector('.ars-modal[aria-label="Place a model in your space"]').hidden,
				name: document.querySelector('.ars-ar-name')?.textContent,
				goLabel: document.querySelector('.ars-ar-go-label')?.textContent,
				status: document.querySelector('.ars-ar-status')?.textContent,
				viewer: studio._arHandoff?.viewer,
				href: studio._arHandoff?.href,
				focused: document.activeElement?.className || '',
			};
		});
		step(`${device} opens the AR hand-off sheet`, sheet.open && sheet.name === 'Wrench', `"${sheet.goLabel}", ${sheet.status}`);
		step(`${device} arms the sheet with a real ${want} hand-off`, sheet.viewer === want,
			`${sheet.viewer}: ${String(sheet.href).slice(0, 46)}`);
		step(`${device} keeps focus inside the dialog`, sheet.focused.includes('ars-ar-'), sheet.focused);

		if (want === 'quicklook') {
			step('the prepared asset is a USDZ blob', /^blob:/.test(sheet.href), sheet.href.slice(0, 70));
			await p2.click('.ars-ar-go');
			const clicks = await p2.evaluate(() => window.__arClicks);
			step('tapping Place activates an <a rel="ar"> straight away', clicks.length === 1, clicks[0]?.slice(0, 46));
			// Safari sniffs the file type from the name. Without one it opens Quick
			// Look in Object mode with AR unavailable, which looks like working
			// software right up to the moment someone tries to use it.
			const dl = await p2.evaluate(() => document.querySelector('a[rel="ar"]')?.getAttribute('download'));
			step('the anchor names the blob, so Safari opens AR and not Object mode',
				dl === 'wrench.usdz', String(dl));
			const closed = await p2.evaluate(() => document.querySelector('.ars-modal[aria-label="Place a model in your space"]').hidden);
			step('the sheet closes once the AR viewer has been handed the model', closed === true);
			// The camera is one client at a time on a phone. Hold the page's stream
			// open and ARKit never gets clean plane detection, so the model drifts
			// with the device instead of anchoring. Headless Chromium has no camera,
			// so the passthrough state is staged directly.
			const yielded = await p2.evaluate(async () => {
				const studio = document.querySelector('ar-studio').studio;
				let stopped = false;
				studio.arActive = true;
				studio.mediaStream = { getTracks: () => [{ stop() { stopped = true; } }], getVideoTracks: () => [] };
				studio._cameraYielded = false;
				await studio.placeInYourSpace();
				return { stopped, active: studio.arActive, yielded: studio._cameraYielded };
			});
			step('the page releases the camera before the AR viewer opens',
				yielded.stopped === true && yielded.active === false && yielded.yielded === true);
			// Second tap: the conversion is cached, so the sheet must arm without
			// ever disabling the button. A stall here is the dead-button bug.
			const t0 = Date.now();
			await p2.click('.ars-ar-label');
			await p2.waitForFunction(() => {
				const studio = document.querySelector('ar-studio').studio;
				return studio._arHandoff && !document.querySelector('.ars-ar-go').disabled;
			}, { timeout: 10000 });
			step('a second open is instant, from the cached USDZ', Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
		} else {
			step('Scene Viewer needs no conversion, so the button is armed on open',
				sheet.href === 'https://three.ws/cdn/objects/polyhaven/glb/adjustable_wrench.glb');
		}
		await ctx.close();
	}
} catch (err) {
	step('run completed', false, err.message);
}

step('no console or page errors', problems.length === 0, problems.join(' | '));

await browser.close();
server.close();

const failed = steps.filter((s) => !s.ok);
console.log(`\n${steps.length - failed.length}/${steps.length} checks passed`);
process.exit(failed.length ? 1 : 0);
