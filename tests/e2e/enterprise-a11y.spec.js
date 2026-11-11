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

test('empty Forge photo slots do not show the on-device check overlay', async ({ page }) => {
	// The overlay's hide rule lived only in the lazily imported review.css, so
	// before the first photo every empty slot painted "Checking photo…" and
	// axe read it into the slot's name (label-content-name-mismatch).
	await page.goto('/image-to-3d', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	const slot = page.locator('.view-slot[data-index="0"]');
	await expect(slot).toHaveAttribute('data-state', 'empty', { timeout: 60_000 });
	await expect(slot.locator('.vs-preparing')).toBeHidden();
	const results = await new AxeBuilder({ page }).include('.view-slot').withRules(['label-content-name-mismatch']).analyze();
	expect(results.violations).toEqual([]);
});

test('Tab skips the links of a collapsed nav menu and reaches them once it is open', async ({ page }) => {
	// A closed .nav-pop was only faded to opacity 0, so Tab from the collapsed
	// "Build" trigger walked focus through its twenty links with nothing on
	// screen showing where focus was (2.4.7), and Orca read the hidden panel.
	await page.goto('/discover', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	const trigger = page.locator('.nav-main .nav-grp .nav-trigger').first();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: 60_000 });
	await trigger.focus();
	await page.keyboard.press('Tab');
	const landedInClosedMenu = await page.evaluate(() => !!document.activeElement?.closest('.nav-grp:not(.open) .nav-pop'));
	expect(landedInClosedMenu, 'focus moved into a collapsed menu').toBe(false);

	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	const focusedInOpenMenu = await page.evaluate(() => {
		const el = document.activeElement;
		return !!el?.closest('.nav-grp.open .nav-pop') && getComputedStyle(el).visibility === 'visible';
	});
	expect(focusedInOpenMenu, 'Enter moves focus to the first link of the open menu').toBe(true);
});

test('sign-in fields have a visible boundary (1.4.11) and a focus ring that survives forced colors', async ({ browser }) => {
	// The email and password inputs drew a 7% white border on a near-black
	// card (1.1:1), and focus cleared the outline, so High Contrast showed no
	// focus at all on the two fields every sign-in starts with.
	const plain = await browser.newPage();
	await plain.goto('/login', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await expect(plain.locator('#email')).toBeVisible({ timeout: 60_000 });
	const ratios = await plain.evaluate(() => {
		const rgba = (s) => {
			const m = s.match(/[\d.]+/g).map(Number);
			return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
		};
		const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
		const lum = ({ r, g, b }) => {
			const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
			return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
		};
		const ratio = (a, b) => {
			const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
			return (x + 0.05) / (y + 0.05);
		};
		const behind = (el) => {
			const layers = [];
			for (let e = el.parentElement; e; e = e.parentElement) {
				const c = rgba(getComputedStyle(e).backgroundColor);
				if (c.a > 0) layers.push(c);
				if (c.a === 1) break;
			}
			let base = layers.length && layers[layers.length - 1].a === 1 ? layers.pop() : { r: 0, g: 0, b: 0, a: 1 };
			for (const c of layers.reverse()) base = over(c, base);
			return base;
		};
		return ['#email', '#password'].map((sel) => {
			const el = document.querySelector(sel);
			const cs = getComputedStyle(el);
			const bg = behind(el);
			return ratio(over(rgba(cs.borderTopColor), over(rgba(cs.backgroundColor), bg)), bg);
		});
	});
	for (const r of ratios) expect(r, 'field border against the card').toBeGreaterThanOrEqual(3);
	await plain.close();

	const hc = await browser.newContext({ forcedColors: 'active' });
	const hcPage = await hc.newPage();
	await hcPage.goto('/login', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await hcPage.locator('#email').focus();
	const outline = await hcPage.locator('#email').evaluate((el) => {
		const cs = getComputedStyle(el);
		return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
	});
	expect(outline.style, 'focused field keeps an outline under forced colors').not.toBe('none');
	expect(outline.width).toBeGreaterThanOrEqual(2);
	await hc.close();
});

test('the sticky prompt-library toolbar never covers the link that has focus (2.4.11)', async ({ browser }) => {
	// Tabbing back up the card grid scrolled each focused link to the top edge
	// of the viewport, straight under the 180px sticky search and filter bar.
	const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
	const page = await context.newPage();
	await page.goto('/prompts', { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await expect(page.locator('.pl-grid a').first()).toBeVisible({ timeout: 60_000 });
	// Walk backwards up the grid from the bottom of the page, as a keyboard user
	// does: the browser scrolls each control just into view at the top edge,
	// which is exactly where the stuck toolbar sits.
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await page.locator('.pl-grid a').last().focus();
	const hidden = [];
	for (let i = 0; i < 40; i++) {
		await page.keyboard.press('Shift+Tab');
		const verdict = await page.evaluate(() => {
			const el = document.activeElement;
			const toolbar = document.querySelector('.pl-toolbar');
			if (!el || toolbar.contains(el)) return 'toolbar';
			if (getComputedStyle(toolbar).position !== 'sticky') return null;
			const r = el.getBoundingClientRect();
			const t = toolbar.getBoundingClientRect();
			return r.bottom <= t.bottom && r.top >= t.top ? `${el.tagName}.${el.className} ${Math.round(r.top)}..${Math.round(r.bottom)}` : null;
		});
		if (verdict === 'toolbar') break;
		if (verdict) hidden.push(verdict);
	}
	expect(hidden, 'controls entirely hidden behind the sticky toolbar').toEqual([]);
	await context.close();
});
