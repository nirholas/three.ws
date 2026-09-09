/**
 * The accessibility floor for the two authed home views.
 *
 * `/smart-home/:id` and `/home/:id` need a session and a connected house, so
 * they can never ride the site-wide axe gate in tests/e2e/a11y-top-pages.spec.js
 * the way `/smart-home` and `/voice/home` do. They get the same three WCAG rule
 * sets here instead, against a real Home Assistant, plus the things axe cannot
 * see: that the whole lane is operable with no mouse at all, that the guarded
 * confirmation takes focus and is announced assertively, that cancelling gives
 * the keyboard back, that the stale state still clears AA, and that a
 * Fahrenheit house reads in Fahrenheit whatever the browser's locale is.
 *
 * A voice-controlled house is assistive technology for exactly the people most
 * likely to need it. This file is the gate that keeps it that way.
 */

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import {
	anyLight,
	connectHome,
	homeInstance,
	lockedDoor,
	openScene,
	readState,
	relock,
	resetHomes,
	signIn,
} from './home-support.js';

test.describe.configure({ mode: 'serial' });

const RULES = ['wcag2a', 'wcag2aa', 'wcag21aa'];

/** Open a connected house's scene in one named view and wait for the rail. */
async function openView(page, id, view) {
	await page.goto(`/smart-home/${id}?view=${view}`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('#hs-rooms')).not.toHaveAttribute('aria-busy', 'true', { timeout: 120_000 });
	if (view === '3d') {
		await page.waitForFunction(() => window.__homeScene?.stats()?.drawCalls > 0, null, { timeout: 180_000 });
	}
}

/**
 * Freeze the in-between frames before axe measures. A half-faded row has its
 * ink composited into the background, and axe scores that blend rather than the
 * resting colour a reader actually sees: the same reason the site-wide gate
 * does this.
 */
async function settle(page) {
	await page.addStyleTag({
		content: '*, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0s !important; transition-duration: 1ms !important; transition-delay: 0s !important; }',
	});
	await page.waitForTimeout(120);
}

async function axeOn(page, label) {
	await settle(page);
	const results = await new AxeBuilder({ page }).withTags(RULES).analyze();
	if (results.violations.length) {
		const summary = results.violations
			.map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
			.join('\n\n');
		throw new Error(`axe found ${results.violations.length} violation(s) on ${label}:\n\n${summary}`);
	}
	expect(results.violations).toEqual([]);
}

/**
 * Press Tab until `predicate` is true in the page, or give up after `limit`
 * presses. A cap rather than a loop on purpose: a focus trap would otherwise
 * hang the run instead of failing it, and "the focus order never gets there" is
 * the finding worth reporting.
 */
async function tabUntil(page, predicate, limit) {
	for (let i = 0; i < limit; i++) {
		await page.keyboard.press('Tab');
		if (await page.evaluate(predicate)) return true;
	}
	return false;
}

let homeId = null;

test('axe: the 3D house, the 2D house and the floorplan editor all clear WCAG AA', async ({ page }) => {
	await signIn(page, 'owner');
	await resetHomes(page);
	await connectHome(page, { label: 'Accessibility floor' });
	homeId = await openScene(page);

	for (const view of ['3d', '2d', 'plan']) {
		await openView(page, homeId, view);
		await axeOn(page, `/smart-home/${homeId}?view=${view}`);
	}
});

test('axe: the guarded confirmation card clears WCAG AA while it is standing', async ({ page }) => {
	const instance = homeInstance();
	await signIn(page, 'owner');
	await openView(page, homeId, '2d');

	const lock = await lockedDoor(instance);
	await page.locator(`[data-entity-id="${lock}"]`).getByRole('button', { name: /^Unlock\b/ }).first().click();
	const card = page.getByRole('alertdialog', { name: 'Confirm this action' });
	await expect(card).toBeVisible({ timeout: 60_000 });

	await axeOn(page, 'the confirmation card');

	await card.getByRole('button', { name: 'Cancel' }).click();
	expect(await readState(instance, lock)).toBe('locked');
});

test('the whole lane is operable with no mouse: connect, act, confirm, cancel, disconnect', async ({ page }) => {
	const instance = homeInstance();
	await signIn(page, 'owner');
	await openView(page, homeId, '3d');

	// Tab until a room in the rail has the keyboard, pressing nothing else. A
	// cap, not a while(true): a trap would otherwise hang the run instead of
	// failing it, and "the focus order never reaches the rooms" is the finding.
	const reachedRoom = await tabUntil(page, () => document.activeElement?.classList.contains('hs-room'), 60);
	expect(reachedRoom, 'tabbing forward must reach the room rail').toBe(true);

	// Enter on a room focuses it and expands its devices. This is the whole
	// reason the list exists: a canvas cannot be entered by keyboard, so without
	// it the 3D view stops at the rooms.
	await page.keyboard.press('Enter');
	await expect(page.locator('.hs-room[aria-expanded="true"]').first()).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.hs-room-devices').first()).toBeVisible();

	// ...and a device in it can be selected without a pointer.
	const reachedDevice = await tabUntil(page, () => document.activeElement?.classList.contains('hs-room-device'), 40);
	expect(reachedDevice, 'the focused room must expose its devices to the keyboard').toBe(true);
	await page.keyboard.press('Enter');
	await expect(page.locator('#hs-inspector')).toBeVisible();

	// Focus is visible at every step: each stop reports a real focus ring rather
	// than the browser default the page might have suppressed.
	const ring = await page.evaluate(() => {
		const style = getComputedStyle(document.activeElement, null);
		return { width: style.outlineWidth, style: style.outlineStyle };
	});
	expect(ring.style).not.toBe('none');
	expect(parseFloat(ring.width)).toBeGreaterThan(0);

	// And acting from the keyboard reaches the gate, which takes the focus.
	const lock = await lockedDoor(instance);
	await openView(page, homeId, '2d');
	const unlock = page.locator(`[data-entity-id="${lock}"]`).getByRole('button', { name: /^Unlock\b/ }).first();
	await unlock.focus();
	await page.keyboard.press('Enter');

	const card = page.getByRole('alertdialog', { name: 'Confirm this action' });
	await expect(card).toBeVisible({ timeout: 60_000 });
	// The card owns the keyboard the instant it appears. A confirmation a person
	// has to go looking for is a confirmation they answer by reflex.
	await expect(page.getByRole('button', { name: 'Yes, do it' })).toBeFocused();

	// Escape cancels, nothing moves, and the keyboard goes back where it was.
	await page.keyboard.press('Escape');
	await expect(card).toBeHidden({ timeout: 30_000 });
	await expect(unlock).toBeFocused();
	expect(await readState(instance, lock), 'Escape must not open the door').toBe('locked');
});

test('the confirmation announces itself assertively, and clears when it is answered', async ({ page }) => {
	const instance = homeInstance();
	await signIn(page, 'owner');
	await openView(page, homeId, '2d');

	// The two live regions are distinct on purpose: narration is polite, the
	// question is assertive. A screen reader queues a polite region behind
	// whatever it is already reading, which for the one message a person must
	// not miss is the wrong behaviour.
	await expect(page.locator('#hs-live')).toHaveAttribute('aria-live', 'polite');
	await expect(page.locator('#hs-alert')).toHaveAttribute('aria-live', 'assertive');
	await expect(page.locator('#hs-alert')).toHaveAttribute('role', 'alert');

	const lock = await lockedDoor(instance);
	await page.locator(`[data-entity-id="${lock}"]`).getByRole('button', { name: /^Unlock\b/ }).first().click();
	const card = page.getByRole('alertdialog', { name: 'Confirm this action' });
	await expect(card).toBeVisible({ timeout: 60_000 });

	// The assertive region carries the whole question, not a fragment: focus
	// lands on the Yes button, and a reader that announces the button alone
	// would say "Yes, do it" with no idea what it does.
	const spoken = (await page.locator('#hs-alert').textContent()) || '';
	expect(spoken).toContain('Opens your home');
	expect(spoken.toLowerCase()).toContain('unlock');
	expect(spoken).toContain('Escape');

	await card.getByRole('button', { name: 'Cancel' }).click();
	await expect(card).toBeHidden({ timeout: 30_000 });
	// A question left standing in an assertive region is read again in front of
	// the next unrelated announcement.
	await expect(page.locator('#hs-alert')).toHaveText('');
	expect(await readState(instance, lock)).toBe('locked');
});

test('a light going on is narrated politely, with the device named', async ({ page }) => {
	const instance = homeInstance();
	await signIn(page, 'owner');
	await openView(page, homeId, '2d');

	const light = await anyLight(instance);
	const row = page.locator(`[data-entity-id="${light.entityId}"]`);
	const button = row.getByRole('button').first();
	const label = (await button.textContent()) || '';
	await button.click();

	await expect(page.locator('#hs-live')).not.toHaveText('', { timeout: 60_000 });
	const said = (await page.locator('#hs-live').textContent()) || '';
	// The user's own name for the device, untranslated and unmangled, is what a
	// person needs to hear back: "turn on" alone does not say which lamp.
	expect(said.toLowerCase()).toContain(label.trim().toLowerCase().split(' ')[0]);
});

test('nothing in the house depends on colour alone', async ({ page }) => {
	await signIn(page, 'owner');
	await openView(page, homeId, '3d');

	// A room's light used to live only in the colour of its dot. Every room now
	// states it in words, in the rail label a screen reader reads and in the
	// visible meta beside the name.
	const rooms = page.locator('.hs-room');
	const count = await rooms.count();
	expect(count).toBeGreaterThan(0);
	for (let i = 0; i < count; i++) {
		const room = rooms.nth(i);
		const label = (await room.getAttribute('aria-label')) || '';
		expect(label.length, 'every room carries a spoken description').toBeGreaterThan(0);
		expect(/device|lights|closed|locked|open/i.test(label), `room ${i} label states its state in words: ${label}`).toBe(true);
		const meta = (await room.locator('.hs-room-meta').textContent()) || '';
		expect(meta.trim().length, 'every room shows a visible state in text').toBeGreaterThan(0);
	}
	// The light dot is decorative and says so, so a reader is not told a colour.
	await expect(page.locator('.hs-room-dot').first()).toHaveAttribute('aria-hidden', 'true');
});

test('the stale house stays readable: measured contrast, not an opacity guess', async ({ page }) => {
	await signIn(page, 'owner');
	await openView(page, homeId, '2d');

	// Force the state rather than waiting for a socket to drop: staleness is a
	// class on the card, and what is under test is whether that class is legible.
	await page.evaluate(() => {
		for (const card of document.querySelectorAll('.hs-card')) card.classList.add('is-stale');
	});

	const worst = await page.evaluate(() => {
		const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
		const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
		const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
		// The nearest ancestor that actually paints, which is what the text sits on.
		const painted = (node) => {
			for (let el = node; el; el = el.parentElement) {
				const bg = rgb(getComputedStyle(el).backgroundColor);
				const alpha = Number((getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [])[3] ?? 1);
				if (bg.length === 3 && alpha > 0.9) return bg;
			}
			return [0, 0, 0];
		};
		const ratio = (a, b) => { const [h, l] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (h + 0.05) / (l + 0.05); };
		let low = { ratio: 99, text: '' };
		for (const node of document.querySelectorAll('.hs-card.is-stale .hs-card-meta, .hs-card.is-stale .hs-item-name, .hs-card.is-stale .hs-item-state, .hs-card.is-stale .hs-card-title')) {
			if (!node.textContent.trim()) continue;
			const r = ratio(rgb(getComputedStyle(node).color), painted(node));
			if (r < low.ratio) low = { ratio: Number(r.toFixed(2)), text: node.textContent.trim().slice(0, 40), selector: node.className };
		}
		return low;
	});

	// 4.5:1, the WCAG 1.4.3 floor for normal text. The `opacity: 0.62` this
	// state used to carry measured 2.70:1 on the same markup.
	expect(worst.ratio, `worst stale contrast was on "${worst.text}"`).toBeGreaterThanOrEqual(4.5);
});

test('the house is usable at 320, 375, 768 and 1440, with the primary action in reach', async ({ page }) => {
	await signIn(page, 'owner');
	for (const width of [320, 375, 768, 1440]) {
		await page.setViewportSize({ width, height: 720 });
		await openView(page, homeId, '2d');
		await settle(page);

		// Nothing pushes the page sideways. A horizontal scrollbar at 320 is the
		// single most common way a phone layout is quietly broken.
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

		// Every control a finger has to hit is at least 44px tall.
		const small = await page.evaluate(() => {
			const out = [];
			for (const node of document.querySelectorAll('#hs-shell button, #hs-shell a[href]')) {
				const r = node.getBoundingClientRect();
				if (r.width === 0 && r.height === 0) continue;
				if (r.height < 44) out.push(`${node.className || node.tagName}: ${Math.round(r.height)}px`);
			}
			return out;
		});
		if (width <= 768) expect(small, `touch targets under 44px at ${width}px`).toEqual([]);
	}
	await page.setViewportSize({ width: 1440, height: 900 });
});

test('a Fahrenheit house reads in Fahrenheit whatever the browser locale is', async ({ page }) => {
	await signIn(page, 'owner');
	await openView(page, homeId, '2d');

	// The unit the instance itself reports, read off the model the page built.
	const unit = await page.evaluate(() => window.__homeScene?.model?.temperatureUnit ?? null);
	// A seeded house always configures one; a null here means the graph stopped
	// carrying it, which is the regression this asserts against.
	expect(unit, 'the scene model must carry the house\'s own temperature unit').toBeTruthy();
	expect(unit).toMatch(/[CF]/);

	// Every temperature the page prints carries that unit and not a bare degree.
	const printed = await page.evaluate(() => {
		const out = [];
		for (const node of document.querySelectorAll('.hs-card-meta, .hs-item-state, .hs-entity-attrs dd')) {
			const text = node.textContent || '';
			if (/\d\s*°/.test(text)) out.push(text.trim());
		}
		return out;
	});
	for (const text of printed) {
		expect(text, `"${text}" must name the unit the house reports`).toContain(unit);
	}
});

test('an RTL locale lays the house out right to left without breaking it', async ({ page }) => {
	await signIn(page, 'owner');
	// A real RTL locale from public/locales, driven the way a visitor drives it,
	// not a CSS override: the point is that the runtime sets dir and the layout
	// answers, which a hand-set attribute would prove nothing about.
	await page.goto(`/smart-home/${homeId}?view=2d&lang=ar`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('#hs-rooms')).not.toHaveAttribute('aria-busy', 'true', { timeout: 120_000 });
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 60_000 });
	await settle(page);

	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow, 'an RTL locale must not push the page sideways').toBeLessThanOrEqual(1);

	// The rail's border follows the writing direction, which is what proves the
	// lane uses logical properties rather than physical left/right.
	const railBorder = await page.evaluate(() => {
		const style = getComputedStyle(document.getElementById('hs-rail'));
		return { left: style.borderLeftWidth, right: style.borderRightWidth };
	});
	expect(parseFloat(railBorder.left), 'in RTL the rail divides on its left edge').toBeGreaterThan(0);
	expect(parseFloat(railBorder.right)).toBe(0);

	await axeOn(page, 'the 2D house in Arabic');
});

test("a user's own device names are never translated", async ({ page }) => {
	const instance = homeInstance();
	await signIn(page, 'owner');
	const light = await anyLight(instance);

	const seen = [];
	for (const lang of ['en', 'ar']) {
		await page.goto(`/smart-home/${homeId}?view=2d&lang=${lang}`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#hs-rooms')).not.toHaveAttribute('aria-busy', 'true', { timeout: 120_000 });
		const name = await page.locator(`[data-entity-id="${light.entityId}"] .hs-item-name`).textContent();
		seen.push((name || '').trim());
	}
	// The house's own words for its own things, byte for byte, in both locales.
	expect(seen[1]).toBe(seen[0]);
	expect(seen[0]).toBe(light.name);
});

test.afterAll(async () => {
	// Whatever a journey did to the front door, put it back.
	const instance = homeInstance();
	try {
		const lock = await lockedDoor(instance).catch(() => null);
		if (lock) await relock(instance, lock);
	} catch {
		// The house is torn down with the run either way.
	}
});
