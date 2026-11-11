// Enterprise accessibility gate (docs/accessibility/acr.md).
//
// The Accessibility Conformance Report claims WCAG 2.2 AA conformance for the
// enterprise surfaces: sign-in, Microsoft Marketplace activation, the Teams
// tab, the Forge, the agent page and the <agent-3d> embed. This spec holds
// those claims in place in a real browser, in BOTH themes (the 40-page floor in
// a11y-top-pages.spec.js only sees the dark default, which is how the light
// theme's status colours shipped at 1.5:1). It also pins the behaviours axe
// cannot see: reduced motion stops every turntable, and the 3D canvas has a
// name that says what it shows plus a keyboard orbit path.
//
// The full 18-page, two-width sweep with a written report is
// `npm run audit:a11y` (scripts/audit-a11y.mjs).

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleAndFreeze } from '../../scripts/lib/a11y-settle.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function withTheme(context, theme) {
	await context.addInitScript((t) => {
		try {
			localStorage.setItem('twx_theme', t);
		} catch {
			/* storage blocked; colorScheme emulation still applies */
		}
	}, theme);
}

// Node resolves `localhost` to ::1 first while the Vite dev server listens on
// IPv4, so API calls from the test runner (not the browser) go to 127.0.0.1.
const API_ORIGIN = (process.env.E2E_ORIGIN || 'http://localhost:3000').replace('//localhost', '//127.0.0.1');

async function liveAgentId(request) {
	const res = await request.get(`${API_ORIGIN}/api/marketplace/agents?limit=10`);
	expect(res.ok(), 'live marketplace reachable').toBeTruthy();
	const items = (await res.json())?.data?.items || [];
	const agent = items.find((a) => a.avatar_glb_url) || items[0];
	expect(agent?.id, 'marketplace returned an agent').toBeTruthy();
	return agent;
}

function seriousOrCritical(results) {
	return results.violations
		.filter((v) => v.impact === 'serious' || v.impact === 'critical')
		.map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const STATIC_PAGES = ['/login', '/microsoft/activate', '/microsoft/teams-tab', '/forge'];

for (const theme of ['dark', 'light']) {
	for (const path of STATIC_PAGES) {
		test(`WCAG 2.2 AA, ${theme}: ${path} has no serious or critical violations`, async ({ browser }) => {
			const context = await browser.newContext({ colorScheme: theme, reducedMotion: 'reduce' });
			await withTheme(context, theme);
			const page = await context.newPage();
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 180_000 });
			await page.waitForTimeout(800);
			await settleAndFreeze(page);
			const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect(seriousOrCritical(results)).toEqual([]);
			await context.close();
		});
	}

	test(`WCAG 2.2 AA, ${theme}: agent page and its embed have no serious or critical violations`, async ({ browser, request }) => {
		const agent = await liveAgentId(request);
		const context = await browser.newContext({ colorScheme: theme, reducedMotion: 'reduce' });
		await withTheme(context, theme);
		const page = await context.newPage();
		for (const path of [`/agents/${agent.id}`, `/agent/${agent.id}/embed`]) {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 180_000 });
			await page.waitForTimeout(1500);
			await settleAndFreeze(page);
			const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect(seriousOrCritical(results), path).toEqual([]);
		}
		await context.close();
	});
}

test('the Getting started pill is named by the text it shows', async ({ page }) => {
	await page.goto('/start', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	const pill = page.locator('.twg-pill');
	await expect(pill).toBeVisible({ timeout: 30_000 });
	const results = await new AxeBuilder({ page }).include('.twg-pill').withRules(['label-content-name-mismatch']).analyze();
	expect(results.violations).toEqual([]);
	await expect(pill).toHaveAccessibleName(/^Getting started\s+\d+\/\d+.*steps done/);
});

test('light theme status colours clear 4.5:1 on the light canvas', async ({ browser }) => {
	const context = await browser.newContext({ colorScheme: 'light' });
	await withTheme(context, 'light');
	const page = await context.newPage();
	await page.goto('/forge', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	const ratios = await page.evaluate(() => {
		const lum = (rgb) => {
			const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
				const c = v / 255;
				return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const probe = document.createElement('span');
		document.body.appendChild(probe);
		const out = {};
		for (const token of ['--success', '--danger', '--warn']) {
			probe.style.color = `var(${token})`;
			const L = lum(getComputedStyle(probe).color);
			out[token] = 1.05 / (L + 0.05);
		}
		probe.remove();
		return out;
	});
	for (const [token, ratio] of Object.entries(ratios)) expect(ratio, token).toBeGreaterThanOrEqual(4.5);
	await context.close();
});

test('sign-in: decorative 3D is out of the tab order and the email field autocompletes', async ({ page }) => {
	await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await expect(page.locator('#email')).toHaveAttribute('autocomplete', 'username');
	await expect(page.locator('.h-footer-avatar')).toHaveAttribute('inert', '');
	await expect(page.locator('#onchain-section')).toHaveJSProperty('inert', true);
	await page.locator('#onchain-toggle').click();
	await expect(page.locator('#onchain-section')).toHaveJSProperty('inert', false);
});

test('reduced motion stops model-viewer turntables, including ones added later', async ({ browser }) => {
	const reduced = await browser.newContext({ reducedMotion: 'reduce' });
	const page = await reduced.newPage();
	await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await expect(page.locator('.h-footer-avatar model-viewer')).not.toHaveAttribute('auto-rotate', /.*/);
	await page.evaluate(() => {
		const mv = document.createElement('model-viewer');
		mv.id = 'late-mv';
		mv.setAttribute('auto-rotate', '');
		document.body.appendChild(mv);
	});
	await expect(page.locator('#late-mv')).not.toHaveAttribute('auto-rotate', /.*/);
	await reduced.close();

	const normal = await browser.newContext({ reducedMotion: 'no-preference' });
	const page2 = await normal.newPage();
	await page2.goto('/login', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await expect(page2.locator('.h-footer-avatar model-viewer')).toHaveAttribute('auto-rotate', '');
	await normal.close();
});

test('the embed canvas names the agent and orbits from the keyboard', async ({ page, request }) => {
	const agent = await liveAgentId(request);
	await page.goto(`/agent/${agent.id}/embed`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
	const canvas = page.locator('canvas.tws-viewer-canvas').first();
	await expect(canvas).toBeAttached({ timeout: 120_000 });
	await expect(canvas).toHaveAttribute('role', 'img');
	await expect(canvas).toHaveAttribute('tabindex', '0');
	const label = await canvas.getAttribute('aria-label');
	expect(label).toContain(agent.name);
	expect(label).toMatch(/arrow keys/i);
	await canvas.focus();
	const handled = await canvas.evaluate((el) => {
		const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
		el.dispatchEvent(ev);
		return ev.defaultPrevented;
	});
	expect(handled).toBe(true);
});
