/**
 * The web desktop at / (pages/desktop.html, src/desktop/), driven in a real browser.
 *
 * The unit suites (tests/desktop-*.test.js) pin the logic: layout maths, the
 * file system, the calculator engine, boot sequencing. None of them can see the
 * shell as a visitor does, so this file covers what only exists once it is laid
 * out and running:
 *
 *   - Boot runs its real checks, lands on the lock screen, and Continue reveals
 *     a populated desktop (wallpaper, icons, dock) with no page errors.
 *   - Every native app (File Explorer, Notepad, Photos, Calculator, Clock,
 *     Weather, Camera, Paint, Terminal, Task Manager, Media Player) opens from
 *     Start search and mounts its own UI rather than the "could not start" card.
 *   - Window chrome works: minimize hides, the taskbar restores, maximize fills
 *     the work area, close removes the window.
 *   - The apps do real work: the calculator evaluates, the terminal runs a
 *     command against the file system, Notepad saves a file that File Explorer
 *     then lists, and both survive a reload (IndexedDB, not memory).
 *   - Settings changes the wallpaper and the choice persists.
 *   - The resting desktop clears WCAG 2.1 AA (axe) in both dark and light mode.
 *
 * Nothing is stubbed. Boot's market and account probes hit the real endpoints
 * through the dev server; when one is offline the lock screen says so, which is
 * the designed behaviour, so those requests are not asserted on.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SLOW = 60_000;

const OS_APPS = [
	['files', 'File Explorer'],
	['notepad', 'Notepad'],
	['photos', 'Photos'],
	['calculator', 'Calculator'],
	['clock', 'Clock'],
	['weather', 'Weather'],
	['camera', 'Camera'],
	['paint', 'Paint'],
	['terminal', 'Terminal'],
	['taskmgr', 'Task Manager'],
	['media', 'Media Player'],
];

/**
 * Start every test from a clean browser profile: Welcome already seen (so no
 * window opens on its own) and the desktop chosen over the campus. Seeded once
 * per tab, so a reload inside the test keeps whatever the test saved.
 */
async function seed(page) {
	await page.addInitScript(() => {
		if (sessionStorage.getItem('e2e-seeded')) return;
		localStorage.clear();
		localStorage.setItem('tws:welcomed', '1');
		localStorage.setItem('tws:prefs', JSON.stringify({ startIn: 'desktop' }));
		sessionStorage.setItem('e2e-seeded', '1');
	});
}

/** Collect uncaught page errors; the desktop must not throw while it works. */
function watchErrors(page) {
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

/** The desktop is ready when the shell flagged itself and painted its icons. */
async function ready(page) {
	await page.waitForFunction(() => document.documentElement.classList.contains('os-ready'), null, { timeout: SLOW });
	await expect(page.locator('.os-icons .os-icon').first()).toBeVisible({ timeout: SLOW });
}

async function openDesktop(page) {
	await page.goto('/?view=desktop&boot=0');
	await ready(page);
}

/**
 * Reload into the desktop. The shell strips `boot=0` from the address once it
 * has read it, so a bare reload would land on the lock screen again; opening
 * the same URL is the reload a returning visitor gets, minus the boot.
 */
async function reopenDesktop(page) {
	await openDesktop(page);
}

/** Open an app the way a visitor does: Start, type its name, pick the match. */
async function launchFromStart(page, title) {
	await page.locator('button[aria-label="Start"]').first().click();
	const menu = page.getByRole('dialog', { name: 'Start' });
	await expect(menu).toBeVisible();
	const search = menu.getByRole('searchbox', { name: 'Search apps, pages and files' });
	await expect(search).toBeFocused();
	await search.fill(title);
	const hit = menu.locator('.sm-row').filter({ has: page.locator('b').getByText(title, { exact: true }) }).first();
	await expect(hit).toBeVisible();
	await hit.click();
	await expect(menu).toHaveCount(0);
}

function win(page, id) {
	return page.locator(`.win[data-app="${id}"]`);
}

test.describe('web desktop', () => {
	test.beforeEach(async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await seed(page);
	});

	test('boots through its checks to the lock screen, and Continue opens a populated desktop', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/?view=desktop');

		const boot = page.locator('.os-boot');
		await expect(boot).toBeVisible({ timeout: SLOW });
		const enter = page.locator('.os-lock-enter');
		await expect(enter).toBeVisible({ timeout: SLOW });
		await expect(enter).toHaveText('Continue');
		// The lock screen reports what boot found, in a sentence.
		await expect(page.locator('.os-lock-status')).not.toBeEmpty();
		await expect(page.locator('.os-lock-clock')).not.toBeEmpty();

		await enter.click();
		await expect(boot).toHaveCount(0, { timeout: SLOW });
		await ready(page);

		expect(await page.locator('.os-icons .os-icon').count()).toBeGreaterThan(10);
		await expect(page.locator('.os-wall')).toBeVisible();
		const style = await page.locator('.os').getAttribute('data-style');
		expect(style).toBe('aqua');
		expect(await page.locator('.os').getAttribute('data-wall')).toBeTruthy();
		await expect(page.locator('button[aria-label="Start"]').first()).toBeVisible();
		// Welcome was already seen, so nothing opened on its own.
		await expect(page.locator('.win')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('every native app opens from Start and mounts its own UI', async ({ page }) => {
		test.setTimeout(240_000);
		const errors = watchErrors(page);
		await openDesktop(page);

		for (const [id, title] of OS_APPS) {
			await launchFromStart(page, title);
			const w = win(page, id);
			await expect(w, `${title} window`).toBeVisible({ timeout: SLOW });
			// Apps title their window like a document ("Untitled.txt - Notepad",
			// "Calculator - Standard"); File Explorer names it after the folder.
			await expect(w.locator('.win-name')).toContainText(id === 'files' ? 'Home' : title);
			const host = w.locator(`.napp-${id}`);
			await expect(host, `${title} mounted`).toBeVisible({ timeout: SLOW });
			await expect.poll(() => host.evaluate((el) => el.childElementCount), { timeout: SLOW }).toBeGreaterThan(0);
			await expect(w.locator('.napp-error'), `${title} must not show the could-not-start card`).toHaveCount(0);
			await w.getByRole('button', { name: 'Close window' }).click();
			await expect(w).toHaveCount(0);
		}
		expect(errors).toEqual([]);
	});

	test('with reduced motion a window opens at its full size, with no zoom-in frame', async ({ page }) => {
		await openDesktop(page);
		// Record each window's classes the moment it enters the layer. Under
		// reduced motion it must not carry the zoom-in, which otherwise paints a
		// first frame at 94% scale, 10px low.
		await page.evaluate(() => {
			window.__winClasses = [];
			new MutationObserver((muts) => {
				for (const m of muts) for (const n of m.addedNodes) if (n.classList?.contains('win')) window.__winClasses.push(n.className);
			}).observe(document.body, { childList: true, subtree: true });
		});
		await launchFromStart(page, 'Calculator');
		const w = win(page, 'calculator');
		await expect(w).toBeVisible({ timeout: SLOW });
		const classes = await page.evaluate(() => window.__winClasses);
		expect(classes).toHaveLength(1);
		expect(classes[0]).not.toMatch(/\bis-opening\b/);
		// The registry size is the size on screen from the first measurement.
		expect(Math.round((await w.boundingBox()).width)).toBe(360);
	});

	test('window chrome: minimize, restore from the taskbar, maximize and close', async ({ page }) => {
		await openDesktop(page);
		await launchFromStart(page, 'Calculator');
		const w = win(page, 'calculator');
		await expect(w).toBeVisible({ timeout: SLOW });

		const before = await w.boundingBox();
		await w.getByRole('button', { name: 'Maximize window' }).click();
		await expect.poll(async () => (await w.boundingBox()).width, { timeout: 10_000 }).toBeGreaterThan(before.width + 200);
		const vp = page.viewportSize();
		expect((await w.boundingBox()).width).toBeGreaterThan(vp.width * 0.9);

		await w.getByRole('button', { name: /Restore window|Maximize window/ }).click();
		await expect.poll(async () => Math.round((await w.boundingBox()).width), { timeout: 10_000 }).toBe(Math.round(before.width));

		await w.getByRole('button', { name: 'Minimize window' }).click();
		await expect(w).toBeHidden();
		// The running app's taskbar button brings it back.
		await page.locator('.os-tb[data-app="calculator"]').first().click();
		await expect(w).toBeVisible();

		await w.getByRole('button', { name: 'Close window' }).click();
		await expect(w).toHaveCount(0);
	});

	test('calculator evaluates and the terminal runs commands against the file system', async ({ page }) => {
		await openDesktop(page);

		await launchFromStart(page, 'Calculator');
		const calc = win(page, 'calculator');
		await expect(calc.locator('.calc-res')).toBeVisible({ timeout: SLOW });
		await calc.locator('.calc').click({ position: { x: 4, y: 4 } });
		await page.keyboard.type('12*3+6');
		await page.keyboard.press('Enter');
		await expect(calc.locator('.calc-res')).toHaveText('42');
		await calc.getByRole('button', { name: 'Close window' }).click();

		await launchFromStart(page, 'Terminal');
		const term = win(page, 'terminal');
		const line = term.getByRole('textbox', { name: 'Terminal command line' });
		await expect(line).toBeVisible({ timeout: SLOW });
		await line.fill('mkdir e2e-term-dir');
		await line.press('Enter');
		await line.fill('ls');
		await line.press('Enter');
		await expect(term.locator('.tm-row', { hasText: 'e2e-term-dir' }).last()).toBeVisible();
	});

	test('Notepad saves a file that File Explorer lists, and both survive a reload', async ({ page }) => {
		await openDesktop(page);
		const name = `e2e-note-${Date.now()}`;

		await launchFromStart(page, 'Notepad');
		const np = win(page, 'notepad');
		const ta = np.locator('textarea').first();
		await expect(ta).toBeVisible({ timeout: SLOW });
		await ta.fill('Written by the desktop e2e suite.');
		await np.locator('[data-act="saveas"]').click();
		const dlg = page.getByRole('dialog', { name: 'Save as' });
		await expect(dlg).toBeVisible();
		// The dialog opens in Documents, the default home for text files.
		await expect(dlg.locator('.np-fd-path')).toContainText('Documents');
		await dlg.getByRole('textbox', { name: 'File name' }).fill(`${name}.txt`);
		await dlg.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(dlg).toHaveCount(0);
		await np.getByRole('button', { name: 'Close window' }).click();

		const findInFiles = async () => {
			await launchFromStart(page, 'File Explorer');
			const fx = win(page, 'files');
			await expect(fx.locator('.fx-scroll')).toBeVisible({ timeout: SLOW });
			await fx.getByRole('navigation', { name: 'Navigation' }).getByText('Documents', { exact: true }).first().click();
			await expect(fx.locator('.fx-item', { hasText: `${name}.txt` }).first()).toBeVisible({ timeout: 10_000 });
			return { fx };
		};
		const { fx } = await findInFiles();
		await fx.getByRole('button', { name: 'Close window' }).click();

		await reopenDesktop(page);
		await findInFiles();
	});

	test('Settings changes the wallpaper and the choice survives a reload', async ({ page }) => {
		await openDesktop(page);
		const os = page.locator('.os');
		const start = await os.getAttribute('data-wall');
		const target = start === 'graphite' ? 'Midnight' : 'Graphite';
		const targetId = target.toLowerCase();

		await launchFromStart(page, 'Settings');
		const s = win(page, 'settings');
		await expect(s).toBeVisible({ timeout: SLOW });
		await s.locator('[data-section="personalize"]').click();
		await s.locator('.wall-opt', { hasText: target }).first().click();
		await expect(os).toHaveAttribute('data-wall', targetId);

		await reopenDesktop(page);
		await expect(page.locator('.os')).toHaveAttribute('data-wall', targetId);
	});
	for (const mode of ['dark', 'light']) {
		test(`the resting desktop has no WCAG 2.1 AA violations in ${mode} mode`, async ({ page }) => {
			// The seasonal look swaps the wallpaper for a themed one; scan the
			// everyday desktop a visitor gets the rest of the year.
			await page.addInitScript((m) => {
				localStorage.setItem('tws:prefs', JSON.stringify({ startIn: 'desktop', mode: m }));
				localStorage.setItem('twx_season_off:halloween-2026', '1');
			}, mode);
			await openDesktop(page);
			// Freeze in-between frames so axe scores resting colours, not a fade.
			await page.addStyleTag({
				content: '*, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0s !important; transition-duration: 1ms !important; transition-delay: 0s !important; }',
			});
			await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
			const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
			const report = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(', ')}`);
			expect(report).toEqual([]);
		});
	}
});
