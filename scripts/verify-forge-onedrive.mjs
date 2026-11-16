#!/usr/bin/env node
// Drive the Forge OneDrive and SharePoint actions in a real browser, up to
// Microsoft's own auth boundary, and fail on any console error from three.ws.
//
//   --expect disabled   the dev server has no MS_ENTRA_SSO_CLIENT_ID: /api/config
//                       reports oneDrive off and neither action is in the page.
//   --expect enabled    the dev server has a client id: the photo button shows,
//                       is keyboard reachable, fits at 400px, and a click opens
//                       the MSAL popup on login.microsoftonline.com/common with
//                       Files.ReadWrite and the /auth/microsoft/redirect bridge.
//                       Whatever Microsoft answers (sign-in page, or AADSTS700016
//                       for an app id not registered in the directory) is printed.
//                       Closing the popup must clear the status without an error.
//
// Both modes also call live Microsoft Graph through the shipped graphRequest
// with an unusable token and print the mapped error (401 InvalidAuthenticationToken
// becomes token_expired after one forced refresh).
//
// Usage:
//   node scripts/verify-forge-onedrive.mjs --base http://localhost:3136 --expect enabled [--out dir]
// Docs: docs/onedrive.md.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { GRAPH_BASE, graphRequest } from '../src/microsoft-graph/onedrive-core.js';

const arg = (name, def = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
};
const base = arg('base', 'http://localhost:3136').replace(/\/+$/, '');
const expect = arg('expect');
const out = arg('out', 'onedrive-shots');
if (expect !== 'enabled' && expect !== 'disabled') {
	console.error('Pass --expect enabled or --expect disabled.');
	process.exit(2);
}
mkdirSync(out, { recursive: true });

const problems = [];
const fail = (msg) => problems.push(msg);

// ---- live Graph, through the shipped request path ---------------------------
{
	let tokenCalls = 0;
	try {
		await graphRequest(`${GRAPH_BASE}/me/drive?$select=webUrl,driveType`, {
			fetch,
			getToken: async (force) => {
				tokenCalls++;
				return force ? 'refreshed-but-still-not-a-token' : 'not-a-token';
			},
		});
		fail('graph: live /me/drive accepted an unusable token');
	} catch (err) {
		console.log(`graph: live GET /me/drive -> ${err.status} ${err.code} after ${tokenCalls} token calls: "${err.message}"`);
		if (err.status !== 401 || err.code !== 'token_expired' || tokenCalls !== 2) fail(`graph: expected 401 token_expired after a forced refresh, got ${err.status} ${err.code} (${tokenCalls} token calls)`);
	}
}

// ---- server config and the redirect bridge ------------------------------------
const config = await (await fetch(`${base}/api/config`)).json();
console.log(`config: oneDrive ${JSON.stringify(config.oneDrive)}`);
if (Boolean(config.oneDrive?.enabled) !== (expect === 'enabled')) fail(`config: oneDrive.enabled is ${config.oneDrive?.enabled}, expected ${expect}`);
{
	const res = await fetch(`${base}/auth/microsoft/redirect`);
	const html = await res.text();
	console.log(`bridge: GET /auth/microsoft/redirect -> ${res.status}`);
	if (!res.ok || !/redirect-bridge/.test(html)) fail(`bridge: /auth/microsoft/redirect did not serve the MSAL bridge (${res.status})`);
}

// ---- the browser ---------------------------------------------------------------
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function newPage(viewport) {
	const page = await browser.newPage({ viewport });
	page.on('console', (msg) => {
		if (msg.type() !== 'error' && msg.type() !== 'warning') return;
		const text = msg.text();
		if (/favicon|GPU stall|ReadPixels|WebGL-|swiftshader|Failed to load resource/i.test(text)) return;
		fail(`[${msg.type()}] ${page.url()} ${text}`);
	});
	page.on('pageerror', (err) => fail(`[pageerror] ${err.message}`));
	page.on('response', (res) => {
		const u = new URL(res.url());
		if (u.origin === base && u.pathname.startsWith('/api/') && res.status() >= 500) fail(`[network] ${res.status()} ${u.pathname}`);
	});
	return page;
}

async function openForge(viewport) {
	const page = await newPage(viewport);
	const configSeen = page.waitForResponse((r) => r.url().startsWith(`${base}/api/config`), { timeout: 240_000 });
	// A cold Vite dev server transforms Forge's module graph on the first visit.
	await page.goto(`${base}/forge`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await page.waitForSelector('#views-counter', { state: 'attached', timeout: 120_000 });
	await configSeen;
	return page;
}

const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });

if (expect === 'disabled') {
	const page = await openForge({ width: 1360, height: 900 });
	await page.waitForTimeout(500);
	const buttons = await page.locator('.od-source').count();
	const menuRows = await page.locator('[data-format="onedrive"]:not([hidden])').count();
	console.log(`forge: OneDrive photo buttons ${buttons}, visible menu rows ${menuRows}`);
	if (buttons || menuRows) fail('forge: a OneDrive action is visible without a client id');
	await shot(page, 'disabled-forge');
	await page.close();
} else {
	// Desktop: present, keyboard reachable, popup handshake.
	const page = await openForge({ width: 1360, height: 900 });
	const btn = page.locator('.od-source button');
	await btn.waitFor({ state: 'visible', timeout: 30_000 });
	console.log(`forge: photo button "${(await btn.innerText()).trim()}"`);
	await btn.focus();
	const outline = await btn.evaluate((el) => getComputedStyle(el).outlineStyle);
	if (outline === 'none') fail('forge: the photo button has no visible focus outline');
	await btn.scrollIntoViewIfNeeded();
	await shot(page, 'enabled-forge-focus');

	const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
	await btn.click();
	const popup = await popupPromise;
	await popup.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => {});
	await popup.waitForTimeout(3000);
	const authUrl = new URL(popup.url());
	console.log(`popup: ${authUrl.origin}${authUrl.pathname}`);
	// Microsoft may have moved on to its error or login page; the first request is in the history.
	const authorize = await popup.evaluate(() => performance.getEntriesByType('navigation')[0]?.name || location.href).catch(() => popup.url());
	const first = new URL(authUrl.searchParams.get('client_id') ? authUrl.href : authorize);
	const params = first.searchParams;
	console.log(`popup: client_id=${params.get('client_id')} scope="${params.get('scope')}" redirect_uri=${params.get('redirect_uri')} prompt=${params.get('prompt')}`);
	if (first.hostname !== 'login.microsoftonline.com' || !first.pathname.startsWith('/common/')) fail(`popup: expected login.microsoftonline.com/common, got ${first.origin}${first.pathname}`);
	if (params.get('client_id') !== config.oneDrive.clientId) fail('popup: client_id does not match /api/config');
	if (!/Files\.ReadWrite/.test(params.get('scope') || '')) fail('popup: Files.ReadWrite was not requested');
	if (params.get('redirect_uri') !== `${base}/auth/microsoft/redirect`) fail(`popup: redirect_uri is ${params.get('redirect_uri')}`);
	const body = (await popup.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
	const aadsts = /AADSTS\d+[^.]*\./.exec(body)?.[0];
	console.log(`popup: Microsoft answered ${aadsts ? `"${aadsts}"` : `a page titled "${await popup.title().catch(() => '')}"`}`);
	await shot(popup, 'enabled-microsoft-popup');

	const status = page.locator('#od-photo-status');
	console.log(`forge: status while signing in "${await status.innerText()}"`);
	await popup.close();
	await page.bringToFront();
	await page.waitForFunction(() => document.getElementById('od-photo-status')?.textContent === '', null, { timeout: 15_000 }).catch(() => fail('forge: status did not clear after the popup closed'));
	const after = await status.evaluate((el) => ({ text: el.textContent, error: el.classList.contains('is-error') }));
	console.log(`forge: after closing the popup status="${after.text}" error=${after.error}`);
	if (after.error) fail('forge: closing the sign-in window showed an error instead of a quiet cancel');
	await shot(page, 'enabled-forge-after-cancel');
	await page.close();

	// Phone width.
	const phone = await openForge({ width: 400, height: 860 });
	const pbtn = phone.locator('.od-source button');
	await pbtn.waitFor({ state: 'visible', timeout: 30_000 });
	const box = await pbtn.boundingBox();
	const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	console.log(`phone: button ${Math.round(box.width)}x${Math.round(box.height)} at x=${Math.round(box.x)}, horizontal overflow ${overflow}px`);
	if (box.x < 0 || box.x + box.width > 400) fail('phone: the photo button leaves the 400px viewport');
	await pbtn.scrollIntoViewIfNeeded();
	await shot(phone, 'enabled-forge-400');
	await phone.close();
}

await browser.close();
if (problems.length) {
	console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
	process.exit(1);
}
console.log(`\nOK (${expect}). Screenshots in ${out}/`);
