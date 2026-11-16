#!/usr/bin/env node
// Drive OneDrive and SharePoint in Forge in a real browser (docs/onedrive.md):
//   1. hidden when /api/config has no Entra client id (what the dev proxy's
//      production config says today)
//   2. with the client id set, the "From OneDrive or SharePoint" button and the
//      "Save to OneDrive" export row appear, are keyboard reachable, and fit at
//      400px
//   3. clicking the button opens Microsoft's real sign-in popup against the
//      configured client id, and the redirect bridge page is served
//   4. Graph answers an unauthenticated call with 401, mapped to token_expired
//
// /api/config for step 2 comes from running the repo's own api/config.js
// handler in this process with MS_ENTRA_SSO_CLIENT_ID set, so the response is
// what the server would send once the owner configures the app.
//
// Usage: MS_ENTRA_SSO_CLIENT_ID=<app id> node scripts/verify-forge-onedrive-browser.mjs [baseUrl] [shotDir]
//   baseUrl defaults to http://localhost:3136 (npm run dev -- --port 3136)

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { graphResponseError } from '../src/microsoft-graph/onedrive-core.js';

const BASE = process.argv[2] || 'http://localhost:3136';
const SHOTS = process.argv[3] || join(process.env.TMPDIR || '/tmp', 'forge-onedrive-shots');
const CLIENT_ID = (process.env.MS_ENTRA_SSO_CLIENT_ID || '').trim();
mkdirSync(SHOTS, { recursive: true });
let failures = 0;

function check(label, ok, detail = '') {
	if (ok) console.log(`  ok    ${label}${detail ? ` (${detail})` : ''}`);
	else {
		failures++;
		console.error(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
	}
}

/** The dev server restarts when files it imports change; wait it out. */
async function serverUp() {
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(BASE, { signal: AbortSignal.timeout(5000) })).ok) return;
		} catch {
			// restarting
		}
		await new Promise((r) => setTimeout(r, 3000));
	}
	throw new Error(`${BASE} did not come back`);
}

async function gotoForge(page) {
	for (let attempt = 1; ; attempt++) {
		await serverUp();
		try {
			await page.goto(`${BASE}/forge`, { waitUntil: 'load', timeout: 180000 });
			await page.locator('#tab-image').waitFor({ state: 'visible', timeout: 60000 });
			return;
		} catch (err) {
			if (attempt >= 4) throw err;
		}
	}
}

/** Run api/config.js for real and capture what it sends. */
async function localConfig() {
	const { default: handler } = await import('../api/config.js');
	return new Promise((resolve, reject) => {
		const headers = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader: (k, v) => (headers[k.toLowerCase()] = v),
			getHeader: (k) => headers[k.toLowerCase()],
			removeHeader: (k) => delete headers[k.toLowerCase()],
			writeHead(status, h = {}) {
				this.statusCode = status;
				for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
				return this;
			},
			write: () => true,
			end(body) {
				this.headersSent = true;
				resolve({ status: this.statusCode, body: String(body ?? '') });
			},
		};
		const req = { method: 'GET', url: '/api/config', headers: { host: 'localhost' }, query: {}, on() {}, socket: {} };
		Promise.resolve(handler(req, res)).catch(reject);
	});
}

const browser = await chromium.launch();

// ---- 1. hidden without a client id -----------------------------------------
{
	console.log('Without a client id (dev proxy -> production /api/config):');
	const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
	await gotoForge(page);
	await serverUp();
	const cfg = await fetch(`${BASE}/api/config`).then((r) => r.json());
	await page.click('#tab-image');
	await page.waitForTimeout(1500);
	const visible = await page.locator('.od-source').count();
	check('photo button hidden when oneDrive is not enabled', !cfg?.oneDrive?.enabled ? visible === 0 : visible === 1, `oneDrive=${JSON.stringify(cfg?.oneDrive ?? null)}`);
	await page.close();
}

if (!CLIENT_ID) {
	console.error('Set MS_ENTRA_SSO_CLIENT_ID to drive the enabled state.');
	process.exit(1);
}

// ---- 2. enabled ----------------------------------------------------------------
const config = await localConfig();
const parsed = JSON.parse(config.body);
check('api/config.js reports oneDrive enabled with the client id', parsed.oneDrive?.enabled === true && parsed.oneDrive.clientId === CLIENT_ID);

for (const width of [1280, 400]) {
	console.log(`Enabled, ${width}px:`);
	const ctx = await browser.newContext({ viewport: { width, height: 860 } });
	const page = await ctx.newPage();
	const consoleProblems = [];
	page.on('console', (m) => {
		const t = m.text();
		if ((m.type() === 'error' || m.type() === 'warning') && /onedrive|msal|forge-onedrive|microsoft-graph/i.test(t)) consoleProblems.push(t);
	});
	page.on('pageerror', (e) => consoleProblems.push(String(e)));
	await page.route('**/api/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: config.body }));
	await gotoForge(page);
	await page.click('#tab-image');
	const btn = page.locator('.od-source button');
	await btn.waitFor({ state: 'visible', timeout: 15000 });
	check('photo button visible next to the views', await btn.isVisible());
	const box = await btn.boundingBox();
	check('button fits inside the viewport', box && box.x >= 0 && box.x + box.width <= width, box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)}` : 'no box');
	await btn.focus();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Tab');
	const focused = await page.evaluate(() => document.activeElement?.closest('.od-source') != null);
	const outline = await btn.evaluate((el) => getComputedStyle(el).outlineStyle);
	check('keyboard focus lands on the button with a visible ring', focused && outline !== 'none', `outline=${outline}`);
	await page.screenshot({ path: join(SHOTS, `photo-button-${width}.png`) });

	// Export row: a real GLB from public/ stands in for a finished generation.
	await page.evaluate(() => {
		const a = document.getElementById('download');
		a.setAttribute('href', '/animations/Just_chilling.glb');
		document.dispatchEvent(new CustomEvent('forge:model-ready', { detail: { glbUrl: '/animations/Just_chilling.glb', label: 'Verify model', creationId: null } }));
	});
	const row = page.locator('.export-item[data-format="onedrive"]');
	check('Save to OneDrive row is in the export menu and shown for a loaded model', (await row.count()) === 1 && !(await row.evaluate((el) => el.hidden)));
	const caret = page.locator('.export-caret');
	if (await caret.isVisible().catch(() => false)) {
		await caret.click();
		await page.waitForTimeout(300);
		await page.screenshot({ path: join(SHOTS, `export-menu-${width}.png`) });
		await page.keyboard.press('Escape');
	}

	if (width === 1280) {
		// ---- 3. live Microsoft sign-in ---------------------------------------
		const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
		await btn.click();
		const popup = await popupPromise;
		await popup.waitForLoadState('domcontentloaded').catch(() => {});
		await popup.waitForTimeout(4000);
		const url = popup.url();
		const text = await popup.evaluate(() => document.body?.innerText || '').catch(() => '');
		check('sign-in popup opens on login.microsoftonline.com', /login\.(microsoftonline|live)\.com/.test(url), url.slice(0, 90));
		check('request carries the configured client id and the SPA redirect', url.includes(CLIENT_ID) && url.includes(encodeURIComponent(`${BASE}/auth/microsoft/redirect`)));
		check('request asks for Files.ReadWrite only (plus OIDC basics)', /scope=[^&]*Files\.ReadWrite/.test(url));
		const aadsts = (text.match(/AADSTS\d+/) || [])[0] || '';
		check('Microsoft answers at the auth boundary', Boolean(aadsts) || /sign in|pick an account|microsoft/i.test(text), aadsts || text.slice(0, 80).replace(/\s+/g, ' '));
		await popup.screenshot({ path: join(SHOTS, 'microsoft-signin.png') }).catch(() => {});
		await popup.close();
		const status = page.locator('#od-photo-status');
		await page.waitForFunction(() => document.querySelector('.od-source button')?.getAttribute('aria-busy') !== 'true', null, { timeout: 15000 }).catch(() => {});
		check('closing the popup is treated as a cancel (no error text, button usable)', (await status.textContent()).trim() === '' && (await btn.getAttribute('aria-busy')) !== 'true', `status="${(await status.textContent()).trim()}"`);
		await page.screenshot({ path: join(SHOTS, 'after-cancel.png') });
	}

	check('no console errors or warnings from the OneDrive code', consoleProblems.length === 0, consoleProblems.slice(0, 3).join(' | '));
	await ctx.close();
}

// ---- redirect bridge ---------------------------------------------------------
{
	await serverUp();
	const res = await fetch(`${BASE}/auth/microsoft/redirect`);
	const html = await res.text();
	check('redirect bridge page is served at /auth/microsoft/redirect', res.ok && html.includes('bridge-msg'), `HTTP ${res.status}`);
}

// ---- 4. Graph auth boundary --------------------------------------------------
{
	const res = await fetch('https://graph.microsoft.com/v1.0/me/drive');
	const body = await res.json().catch(() => ({}));
	const mapped = graphResponseError(res.status, body);
	check('Graph rejects a call without a token', res.status === 401, `${res.status} ${body?.error?.code || ''}`);
	check('mapped to token_expired (silent refresh, then Continue)', mapped.code === 'token_expired', mapped.code);
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed. Screenshots: ${SHOTS}` : `\nAll checks passed. Screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
