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
 *   - Settings changes the wallpaper and the choice persists. The desktop
 *     menu's Display settings and Personalize open their own Settings pages.
 *   - The system shortcuts work from the keyboard alone: Run, Start, Alt+Tab,
 *     Alt+W, show desktop, lock and sign back in.
 *   - Widgets behave: the Weather picker leaves focus alone on boot and keeps
 *     what was typed across a refresh; list widgets fill their cards with
 *     whole rows; in edit mode a widget moves with the arrow keys. Notification
 *     cards keep a small app icon.
 *   - On 360, 390 and 430px phones the taskbar fits and Start stays tappable,
 *     File Explorer keeps its address and every command on screen, Paint's
 *     status bar keeps its zoom controls in reach, and Task Manager's process
 *     table never wraps a value.
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

	test('keyboard: Run, Start, Alt+Tab, Alt+W, show desktop and lock all work without a mouse', async ({ page }) => {
		await openDesktop(page);

		// Ctrl+Alt+R: the Run box opens apps by name.
		await page.keyboard.press('Control+Alt+r');
		const run = page.getByRole('dialog', { name: 'Run' });
		await expect(run).toBeVisible();
		const field = run.getByRole('combobox', { name: 'Open' });
		await expect(field).toBeFocused();
		await field.fill('notepad');
		await field.press('Enter');
		await expect(run).toHaveCount(0);
		await expect(win(page, 'notepad')).toBeVisible({ timeout: SLOW });

		// Ctrl+K: Start opens on its search; Escape closes it.
		await page.keyboard.press('Control+k');
		const start = page.getByRole('dialog', { name: 'Start' });
		await expect(start.getByRole('searchbox')).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(start).toHaveCount(0);

		// Escape after opening Start from its button hands focus back to the button.
		const startBtn = page.locator('button[aria-label="Start"]').first();
		await startBtn.click();
		await expect(start).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(startBtn).toBeFocused();

		// Alt+Tab moves focus to the other window; Alt+W closes the focused one.
		await page.keyboard.press('Control+Alt+e');
		await expect(win(page, 'files')).toHaveClass(/is-focused/, { timeout: SLOW });
		await page.keyboard.press('Alt+Tab');
		await expect(win(page, 'notepad')).toHaveClass(/is-focused/);
		await page.keyboard.press('Alt+w');
		await expect(win(page, 'notepad')).toHaveCount(0);
		await expect(win(page, 'files')).toHaveClass(/is-focused/);

		// Ctrl+Alt+D hides every window, and again brings them back.
		await page.keyboard.press('Control+Alt+d');
		await expect(win(page, 'files')).toBeHidden();
		await page.keyboard.press('Control+Alt+d');
		await expect(win(page, 'files')).toBeVisible();

		// Ctrl+Alt+L locks; any key shows the sign-in, and Sign in returns to the desktop with the window intact.
		await page.keyboard.press('Control+Alt+l');
		const lock = page.getByRole('dialog', { name: 'Locked' });
		await expect(lock).toBeVisible();
		await page.keyboard.press('Space');
		const signIn = lock.getByRole('button', { name: 'Sign in' });
		await expect(signIn).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(lock).toHaveCount(0);
		await expect(win(page, 'files')).toBeVisible();
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

	test('the desktop menu opens Display settings and Personalize on their own Settings pages', async ({ page }) => {
		await openDesktop(page);
		const vp = page.viewportSize();
		for (const [item, heading] of [
			['Display settings', 'Desktop and taskbar'],
			['Personalize', 'Personalization'],
		]) {
			await page.mouse.click(vp.width * 0.45, vp.height * 0.6, { button: 'right' });
			await page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click();
			const settings = win(page, 'settings');
			await expect(settings.getByRole('heading', { level: 2 })).toHaveText(heading);
			await page.keyboard.press('Alt+w');
			await expect(settings).toHaveCount(0);
		}
	});

	test('in widget edit mode a widget moves with the arrow keys and the layout persists', async ({ page }) => {
		await openDesktop(page);
		const vp = page.viewportSize();
		await page.mouse.click(vp.width * 0.45, vp.height * 0.6, { button: 'right' });
		await page.getByRole('menu').getByRole('menuitem', { name: 'Edit widgets', exact: true }).click();
		const desk = page.locator('.wgx-desk');
		await expect(desk).toHaveClass(/editing/);
		const card = desk.locator('> .wgx').first();
		const id = await card.getAttribute('data-id');
		await expect(card).toHaveAttribute('tabindex', '0');
		await card.focus();
		const before = await card.boundingBox();
		await page.keyboard.press('ArrowLeft');
		await expect.poll(async () => (await card.boundingBox()).x).toBeLessThan(before.x - 50);
		await expect(card).toBeFocused();
		const saved = await page.evaluate((wid) => JSON.parse(localStorage.getItem('tws-widgets:desktop')).find((w) => w.id === wid), id);
		expect(saved.col).toBeGreaterThan(0);
		await expect(page.locator('.wgx-live')).toContainText('Moved');
		await page.keyboard.press('Escape');
		await expect(desk).not.toHaveClass(/editing/);
		await expect(card).not.toHaveAttribute('tabindex', /.*/);
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
	test.describe('with no weather city chosen', () => {
		// UTC names no city, so the Weather widget opens on its "Choose a city" picker.
		test.use({ timezoneId: 'UTC' });

		test('the Weather picker neither takes focus on boot nor loses what the visitor typed on a refresh', async ({ page }) => {
			await openDesktop(page);
			const city = page.getByRole('searchbox', { name: 'Search a city' });
			await expect(city).toBeVisible({ timeout: SLOW });
			// Give any deferred focus call time to run before checking where focus sits.
			await page.waitForTimeout(500);
			const focusedInWidget = await page.evaluate(() => !!document.activeElement?.closest('.wgx'));
			expect(focusedInWidget, 'boot leaves keyboard focus out of the widgets').toBe(false);

			await city.fill('Lis');
			// The weather feed refetches on its own cadence; force one through the page's own module.
			await page.evaluate(() => import('/src/desktop/widgets/data.js').then((m) => m.refresh('weather')));
			await page.waitForTimeout(300);
			await expect(page.getByRole('searchbox', { name: 'Search a city' })).toHaveValue('Lis');
		});
	});
	test('the Pulse widget fills its card with whole rows: none cut off, no empty band below', async ({ page }) => {
		await openDesktop(page);
		const card = page.locator('.wgx.t-pulse');
		await expect(card.locator('.wgx-list li').first()).toBeVisible({ timeout: SLOW });
		// How many events the live feed holds, read through the page's own feed module.
		const available = await page.evaluate(() =>
			import('/src/desktop/widgets/data.js').then((m) => new Promise((r) => { const off = m.subscribe('pulse', (s) => { if (s.data) { r(s.data.length); queueMicrotask(() => off()); } }); })),
		);
		const m = await card.evaluate((c) => {
			const body = c.querySelector('.wgx-body');
			const b = body.getBoundingClientRect();
			const inner = b.bottom - parseFloat(getComputedStyle(body).paddingBottom);
			const shown = [...body.querySelectorAll('.wgx-list li')].filter((li) => !li.hidden && li.getBoundingClientRect().height > 0);
			const last = shown.at(-1).getBoundingClientRect();
			return { shown: shown.length, lastBottom: last.bottom, rowH: last.height, inner };
		});
		expect(m.lastBottom, 'the last visible row is whole').toBeLessThanOrEqual(m.inner + 0.5);
		if (m.shown < available) expect(m.inner - m.lastBottom, 'no room left for another row').toBeLessThan(m.rowH);
	});
	test('a notification card shows its app icon as a small square, not stretched across the header', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('twx_season_off:halloween-2026', '1');
			const note = { id: 'e2e-timer', title: 'Timer finished', body: 'Tea', app: 'clock', at: Date.now() };
			localStorage.setItem('tws:notifications', JSON.stringify([note]));
		});
		await openDesktop(page);
		await page.locator('.os-clock').click();
		const card = page.getByRole('dialog', { name: 'Notifications and calendar' }).locator('.nc-card', { hasText: 'Timer finished' });
		await expect(card).toBeVisible();
		const tile = await card.locator('.nt-head .app-tile').boundingBox();
		expect(Math.round(tile.width)).toBe(Math.round(tile.height));
		expect(tile.width).toBeLessThanOrEqual(20);
		await expect(card.locator('.nt-head span:not(.app-tile)').first()).toHaveText('Clock');
	});
	for (const width of [360, 390, 430]) {
		test(`on a ${width}px phone the Start button is visible, tappable and opens Start`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			await openDesktop(page);
			const start = page.locator('button[aria-label="Start"]').first();
			const box = await start.boundingBox();
			expect(box.width, 'Start keeps its full size').toBeGreaterThanOrEqual(36);
			// Nothing in the tray may sit on top of it.
			const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('button[aria-label="Start"]'), {
				x: box.x + box.width / 2,
				y: box.y + box.height / 2,
			});
			expect(onTop, 'Start is the element under its own centre').toBe(true);
			// The tray fits the bar: no item spills past the right edge.
			const overflow = await page.evaluate(() => {
				const bar = document.querySelector('.os-task').getBoundingClientRect();
				return [...document.querySelectorAll('.os-task-right *')].some((el) => {
					const r = el.getBoundingClientRect();
					return r.width > 0 && (r.right > bar.right + 0.5 || r.left < 0);
				});
			});
			expect(overflow, 'tray stays inside the bar').toBe(false);
			// The time reads on one line.
			const t = page.locator('.os-clock .ck-t b');
			const lh = await t.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 16);
			expect((await t.boundingBox()).height).toBeLessThan(lh * 1.5);
			await start.click();
			await expect(page.getByRole('dialog', { name: 'Start' })).toBeVisible();
		});
	}
	test('on a 390px phone File Explorer shows its address and every command without sideways scrolling', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 800 });
		await openDesktop(page);
		await page.keyboard.press('Control+Alt+E');
		const win = page.locator('.win[data-app="files"]');
		await expect(win.locator('.fx-scroll [role="option"]').first()).toBeVisible({ timeout: SLOW });
		const fits = () =>
			win.evaluate((w) => {
				const addr = w.querySelector('.fx-addr').getBoundingClientRect();
				const search = w.querySelector('.fx-search').getBoundingClientRect();
				const crumb = w.querySelector('.fx-crumb[aria-current]');
				const cmd = w.querySelector('.fx-cmd');
				const views = w.querySelector('.fx-views').getBoundingClientRect();
				return {
					addrWider: addr.width >= search.width,
					crumbWhole: crumb.scrollWidth <= crumb.clientWidth && crumb.getBoundingClientRect().right <= addr.right + 0.5,
					cmdNoScroll: cmd.scrollWidth <= cmd.clientWidth + 1,
					viewsInside: views.right <= cmd.getBoundingClientRect().right + 0.5,
				};
			});
		expect(await fits(), 'nothing selected').toEqual({ addrWider: true, crumbWhole: true, cmdNoScroll: true, viewsInside: true });
		// A selection turns on the item commands; they must still fit.
		await win.locator('.fx-scroll [role="option"]').first().click();
		await expect(win.locator('.fx-cb[data-act="copy"]')).toBeEnabled();
		await expect(win.locator('.fx-cb[data-act="copy"]')).toBeVisible();
		expect(await fits(), 'one folder selected').toEqual({ addrWider: true, crumbWhole: true, cmdNoScroll: true, viewsInside: true });
		// Inside a folder the parent crumb gives way so the current folder reads whole.
		await win.locator('.fx-scroll [role="option"]', { hasText: 'Documents' }).dblclick();
		await expect(win.locator('.fx-crumb[aria-current]')).toHaveText('Documents');
		expect(await fits(), 'inside Documents').toEqual({ addrWider: true, crumbWhole: true, cmdNoScroll: true, viewsInside: true });
	});
	test('on a 390px phone Paint keeps its status bar on one line with every zoom control on screen', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 800 });
		await openDesktop(page);
		await launchFromStart(page, 'Paint');
		const w = win(page, 'paint');
		await expect(w.locator('.pt-zoom .z')).toHaveText(/^\d+%$/, { timeout: SLOW });
		const status = await w.evaluate((el) => {
			const bar = el.querySelector('.pt-status');
			const box = bar.getBoundingClientRect();
			const lines = (n) => Math.round(n.getBoundingClientRect().height / (parseFloat(getComputedStyle(n).lineHeight) || 16));
			const off = [...bar.querySelectorAll('button, input, .z, .dim')].filter((n) => {
				const r = n.getBoundingClientRect();
				return r.right > box.right + 0.5 || r.left < box.left - 0.5;
			});
			return { sizeLines: lines(bar.querySelector('.dim')), offscreen: off.map((n) => n.getAttribute('aria-label') || n.className) };
		});
		expect(status).toEqual({ sizeLines: 1, offscreen: [] });
	});
	test('on a 390px phone Task Manager keeps every process cell and header on one line', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 800 });
		await openDesktop(page);
		await launchFromStart(page, 'Task Manager');
		const w = win(page, 'taskmgr');
		await expect(w.locator('.tmg-row').first()).toBeVisible({ timeout: SLOW });
		const wrapped = await w.evaluate((el) =>
			[...el.querySelectorAll('.tmg-tr > *')]
				.filter((c) => c.getBoundingClientRect().height > (parseFloat(getComputedStyle(c).lineHeight) || 18) * 1.5 + 12)
				.map((c) => c.textContent.trim()),
		);
		expect(wrapped).toEqual([]);
	});
});
