// Teams Store validation, behavioural half: the checks a Microsoft reviewer runs by
// hand on the tabs, run in a real browser against the dev server or production.
// Rule ids live in integrations/microsoft/copilot-teams/validation/rules.json; the
// static half is `npm run package:microsoft-app -- --check --store`.
//
//   E2E_PORT=3133 npx playwright test tests/e2e/microsoft-teams-store.spec.js
//   TEAMS_STORE_BASE=https://three.ws E2E_PORT=3133 npx playwright test tests/e2e/microsoft-teams-store.spec.js
//
// "In an iframe without TeamsJS" is served the way Teams frames a tab: a host page on
// https://teams.microsoft.com (answered by Playwright's router, never fetched from
// Microsoft) that frames the real tab URL and never answers TeamsJS, so the page's own
// frame-ancestors policy and its no-host fallback both run unchanged.
// Screenshots land in integrations/microsoft/copilot-teams/validation/screenshots/<target>/.

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.env.TEAMS_STORE_BASE || process.env.E2E_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const TARGET = /^https:\/\/three\.ws$/.test(BASE) ? 'production' : 'dev';
const SHOTS = path.join(process.cwd(), 'integrations', 'microsoft', 'copilot-teams', 'validation', 'screenshots', TARGET);
mkdirSync(SHOTS, { recursive: true });

const HOST_ORIGIN = 'https://teams.microsoft.com';
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 400, height: 860 };

/** The surfaces the manifest frames, at the URLs Teams opens them with. */
const SURFACES = [
	{ key: 'agents-tab', path: '/microsoft/teams-tab?theme={theme}&sub=', ready: (f) => f.locator('#tt-list .tt-item').first() },
	{ key: 'stage-config', path: '/microsoft/teams-stage?view=config&theme={theme}', ready: (f) => f.locator('#rs-config') },
	{ key: 'side-panel', path: '/microsoft/teams-stage?view=panel&theme={theme}', ready: (f) => f.locator('#rs-panel [data-signin], #rs-panel .rs-session').first() },
];
const urlFor = (surface, theme = 'default') => `${BASE}${surface.path.replace('{theme}', theme)}`;

test.describe.configure({ mode: 'serial', timeout: 180_000 });

// The teams.microsoft.com host page framing http://localhost trips Chrome's local
// network access checks, which never apply to the real host framing https://three.ws.
test.use({
	launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] },
});

function loadDotEnv() {
	for (const file of ['.env.local', '.env']) {
		const full = path.join(process.cwd(), file);
		if (!existsSync(full)) continue;
		for (const line of readFileSync(full, 'utf8').split('\n')) {
			const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
			if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
}
loadDotEnv();

/** Console errors and page errors from the page and every frame in it. */
function watchErrors(page) {
	const errors = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`${m.location()?.url || ''} ${m.text()}`);
	});
	return errors;
}

/** Open a surface the way Teams does: framed by a teams.microsoft.com page that never speaks TeamsJS. */
async function openFramed(page, surface, theme = 'default') {
	await page.route(`${HOST_ORIGIN}/store-host`, (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: `<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<style>html,body{margin:0;height:100%;background:#1f1f1f}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe id="app" title="three.ws" src="${urlFor(surface, theme)}"></iframe></body></html>`,
		}),
	);
	await page.goto(`${HOST_ORIGIN}/store-host`);
	const frame = page.frameLocator('#app');
	await expect(surface.ready(frame)).toBeVisible({ timeout: 90_000 });
	return frame;
}

/**
 * A Teams meeting host: frames the stage at the contentUrl its config view saves and
 * answers TeamsJS initialize and getContext as Teams does for that frame context.
 * The ids are the fixed synthetic ones scripts/microsoft-365-tab-hosts-check.mjs uses.
 */
function meetingHost(frameContext, theme) {
	const runtime = JSON.stringify({ apiVersion: 4, supports: { app: {}, pages: {}, meeting: {}, sharing: {} } });
	const context = JSON.stringify({
		hostName: 'Teams',
		hostClientType: 'web',
		frameContext,
		theme,
		locale: 'en-us',
		meetingId: 'store-review-meeting',
		userObjectId: '00000000-0000-4000-8000-0000000000a1',
		tid: '00000000-0000-4000-8000-0000000000f1',
		appSessionId: '00000000-0000-4000-8000-0000000000c1',
	});
	return `<!doctype html><html><head><meta charset="utf-8"><title>Teams meeting host</title>
<style>html,body{margin:0;height:100%;background:#1f1f1f}iframe{border:0;width:320px;height:100%;display:block}</style></head>
<body><iframe id="app" title="three.ws" src="${BASE}/microsoft/teams-stage?theme=${theme}"></iframe>
<script>
const frame = document.getElementById('app');
window.addEventListener('message', (e) => {
	if (e.source !== frame.contentWindow) return;
	const m = e.data || {};
	if (typeof m.func !== 'string') return;
	let args = [];
	if (m.func === 'initialize') args = [${JSON.stringify(frameContext)}, 'web', ${JSON.stringify(runtime)}, '2.59.0'];
	else if (m.func === 'getContext') args = [${context}];
	const reply = { id: m.id, args };
	if (m.uuid !== undefined) reply.uuid = m.uuid;
	if (m.uuidAsString !== undefined) reply.uuidAsString = m.uuidAsString;
	e.source.postMessage(reply, e.origin);
});
</script></body></html>`;
}

test.describe('Teams tabs as a Store reviewer sees them', () => {
	test.use({ viewport: DESKTOP });

	test('renders in an iframe without TeamsJS', async ({ page }) => {
		const errors = watchErrors(page);
		for (const surface of SURFACES) {
			await openFramed(page, surface);
			await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
			await page.screenshot({ path: path.join(SHOTS, `${surface.key}-desktop-framed.png`) });
		}
		expect(errors).toEqual([]);
	});

	test('follows the default, dark and high-contrast themes', async ({ page }) => {
		const errors = watchErrors(page);
		const agents = SURFACES[0];
		const seen = {};
		for (const theme of ['default', 'dark', 'contrast']) {
			await page.goto(urlFor(agents, theme));
			await expect(agents.ready(page)).toBeVisible({ timeout: 90_000 });
			const state = await page.evaluate(() => ({
				theme: document.documentElement.dataset.theme,
				contrast: document.documentElement.hasAttribute('data-contrast'),
				bg: getComputedStyle(document.body).backgroundColor,
				ink: getComputedStyle(document.body).color,
			}));
			seen[theme] = state;
			await page.screenshot({ path: path.join(SHOTS, `agents-tab-desktop-${theme}.png`) });
		}
		expect(seen.default).toMatchObject({ theme: 'light', contrast: false });
		expect(seen.dark).toMatchObject({ theme: 'dark', contrast: false });
		expect(seen.contrast).toMatchObject({ theme: 'dark', contrast: true, bg: 'rgb(0, 0, 0)', ink: 'rgb(255, 255, 255)' });
		expect(new Set(Object.values(seen).map((s) => s.bg)).size).toBe(3);

		// In a meeting the side panel is dark whatever the Teams theme is: open it at the
		// contentUrl the config view saves, framed by a host that answers TeamsJS the
		// way a Teams meeting side panel does, with Teams itself in the light theme.
		await page.route(`${HOST_ORIGIN}/meeting-host`, (route) => route.fulfill({ contentType: 'text/html', body: meetingHost('sidePanel', 'default') }));
		await page.goto(`${HOST_ORIGIN}/meeting-host`);
		const panel = page.frameLocator('#app');
		await expect(SURFACES[2].ready(panel)).toBeVisible({ timeout: 90_000 });
		const panelFrame = page.frames().find((f) => f.url().includes('/microsoft/teams-stage'));
		await expect.poll(() => panelFrame.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
		await page.screenshot({ path: path.join(SHOTS, 'side-panel-desktop-meeting.png') });
		expect(errors).toEqual([]);
	});

	test('marks every link that leaves Teams with a pop-out icon', async ({ page }) => {
		for (const surface of [SURFACES[0], SURFACES[2]]) {
			await page.goto(urlFor(surface));
			await expect(surface.ready(page)).toBeVisible({ timeout: 90_000 });
			if (surface.key === 'agents-tab') {
				await page.locator('#tt-list .tt-item').first().click();
				await expect(page.locator('#tt-card .tt-card-actions a').first()).toBeVisible({ timeout: 60_000 });
			}
			const unmarked = await page.evaluate(() =>
				[...document.querySelectorAll('a[target="_blank"]')]
					.filter((a) => a.offsetParent !== null && !a.href.startsWith('mailto:'))
					.filter((a) => {
						const after = getComputedStyle(a, '::after');
						return after.content === 'none' || after.content === 'normal' || (after.maskImage === 'none' && after.webkitMaskImage === 'none' && after.backgroundImage === 'none');
					})
					.map((a) => a.textContent.trim() || a.href),
			);
			expect(unmarked, surface.key).toEqual([]);
		}
	});

	test('lets a person report an agent', async ({ page }) => {
		const agents = SURFACES[0];
		await page.goto(urlFor(agents));
		await expect(agents.ready(page)).toBeVisible({ timeout: 90_000 });
		await page.locator('#tt-list .tt-item').first().click();
		const report = page.locator('#tt-card a', { hasText: 'Report' });
		await expect(report).toBeVisible({ timeout: 60_000 });
		const href = await report.getAttribute('href');
		expect(href).toMatch(/^mailto:abuse@three\.ws\?subject=Report%20agent%20/);
		await page.screenshot({ path: path.join(SHOTS, 'agents-tab-desktop-agent.png') });
	});
});

test.describe('Teams tabs on a phone', () => {
	test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

	test('fits a phone screen with no horizontal scroll', async ({ page }) => {
		const errors = watchErrors(page);
		for (const surface of SURFACES) {
			await page.goto(urlFor(surface, 'dark'));
			await expect(surface.ready(page)).toBeVisible({ timeout: 90_000 });
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
			expect(overflow, surface.key).toBeLessThanOrEqual(0);
			await page.screenshot({ path: path.join(SHOTS, `${surface.key}-mobile.png`), fullPage: true });
		}
		expect(errors).toEqual([]);
	});

	test('shows no pricing on phone width', async ({ page }) => {
		for (const surface of SURFACES) {
			await page.goto(urlFor(surface, 'dark'));
			await expect(surface.ready(page)).toBeVisible({ timeout: 90_000 });
			const offers = await page.evaluate(() => {
				const links = [...document.querySelectorAll('a[href]')].filter((a) => /pricing|checkout|upgrade|billing|subscribe/i.test(a.getAttribute('href')));
				const text = document.body.innerText;
				return { links: links.map((a) => a.getAttribute('href')), prices: text.match(/[$€£]\s?\d+(\.\d+)?\s*(\/|per)\s*(mo|month|year)/gi) || [] };
			});
			expect(offers, surface.key).toEqual({ links: [], prices: [] });
		}
	});
});

test.describe('meeting side panel session', () => {
	test.use({ viewport: { width: 320, height: 760 } });

	test('side panel offers sign-in when signed out and sign-out when signed in', async ({ page, context }) => {
		const panel = SURFACES[2];
		await page.goto(urlFor(panel, 'dark'));
		const signIn = page.locator('#rs-panel [data-signin]');
		await expect(signIn).toBeVisible({ timeout: 90_000 });
		expect(await signIn.getAttribute('href')).toMatch(/^\/login\?return=/);
		await page.screenshot({ path: path.join(SHOTS, 'side-panel-signed-out.png') });

		const email = process.env.AUDIT_EMAIL;
		const password = process.env.AUDIT_PASSWORD;
		test.skip(!email || !password, 'AUDIT_EMAIL and AUDIT_PASSWORD are needed for the signed-in half');

		const login = await context.newPage();
		await login.goto(`${BASE}/login`);
		await login.waitForSelector('#email', { timeout: 60_000 });
		await login.fill('#email', email);
		await login.fill('#password', password);
		await login.click('form button[type="submit"]');
		await login.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 60_000 });
		await login.close();

		await page.goto(urlFor(panel, 'dark'));
		const session = page.locator('#rs-panel .rs-session');
		await expect(session).toBeVisible({ timeout: 90_000 });
		await expect(session).toContainText('Signed in as');
		await page.screenshot({ path: path.join(SHOTS, 'side-panel-signed-in.png') });

		await session.getByRole('button', { name: 'Sign out' }).click();
		await expect(page.locator('#rs-panel [data-signin]')).toBeVisible({ timeout: 60_000 });
		const me = await page.evaluate(async () => {
			const res = await fetch('/api/auth/me', { credentials: 'include' });
			return { status: res.status, user: res.ok ? (await res.json()).user : null };
		});
		expect(me.user).toBeNull();
	});
});
