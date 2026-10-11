// Drives the desktop's real-computer behaviour: marquee selection, icon drag,
// settings, and session persistence across a reload.
// Usage: node scripts/desktop-interact.mjs [baseUrl] [screenshotDir]
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:3000';
const shots = process.argv[3] || '';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const problems = [];
const fails = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });
const check = (name, ok, extra = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
	if (!ok) fails.push(name);
};
const selected = () => page.locator('.os-icon.is-sel').count();

await page.goto(`${base}/?view=desktop`, { waitUntil: 'networkidle' });
await page.waitForSelector('.os-icon');
await page.evaluate(() => localStorage.setItem('tws:welcomed', '1'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.os-icon');
const total = await page.locator('.os-icon').count();
check('every app on the desktop', total >= 14, `(${total})`);

// context menu on the empty desktop, then clear the board
await page.mouse.click(1300, 780, { button: 'right' });
await page.waitForSelector('.ctx');
check('desktop context menu has view options', (await page.locator('.ctx button').count()) >= 8);
await page.click('.ctx button:has-text("Close all windows")');
await page.waitForTimeout(500);
check('windows closed', (await page.locator('.win').count()) === 0);

// marquee
await page.mouse.move(700, 500);
await page.mouse.down();
await page.mouse.move(500, 300, { steps: 4 });
await page.mouse.move(8, 8, { steps: 6 });
await shot('i1-marquee');
check('marquee visible while dragging', await page.locator('.os-marquee:not([hidden])').count() === 1);
await page.mouse.up();
const sel = await selected();
check('marquee selected icons', sel > 0, `(${sel})`);
await page.mouse.click(1000, 600);
check('click empty desktop clears selection', (await selected()) === 0);

// drag one icon
const first = page.locator('.os-icon').first();
const before = await first.boundingBox();
await page.mouse.move(before.x + 30, before.y + 30);
await page.mouse.down();
await page.mouse.move(before.x + 300, before.y + 200, { steps: 8 });
await page.mouse.up();
const after = await first.boundingBox();
check('icon dragged to a new cell', Math.abs(after.x - before.x) > 150, `(${Math.round(after.x - before.x)}px)`);
const saved = await page.evaluate(() => localStorage.getItem('tws:icons'));
check('icon layout persisted', !!saved && saved.includes('"col"'));

// settings
await page.click('.os-tb.start');
await page.click('.sm-user');
await page.waitForSelector('.win[data-app=settings] .set-pane');
await page.fill('.win[data-app=settings] input.os-field', 'Ada Lovelace');
await page.click('.win[data-app=settings] .set-nav [data-section=personalize]');
await page.click('.win[data-app=settings] .swatch:nth-child(3)');
await page.click('.win[data-app=settings] [data-wall=ember]');
await page.click('.win[data-app=settings] .set-nav [data-section=desktop]');
await page.click('.win[data-app=settings] .seg button:has-text("Large")');
await shot('i2-settings');
const p = await page.evaluate(() => JSON.parse(localStorage.getItem('tws:prefs')));
check('prefs saved', p.name === 'Ada Lovelace' && p.wall === 'ember' && p.iconSize === 'large' && p.accent === '#e5484d', JSON.stringify(p));

// reload restores the whole session
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.os-icon');
check('settings window restored', await page.locator('.win[data-app=settings]').count() === 1);
check('wallpaper restored', (await page.getAttribute('.os', 'data-wall')) === 'ember');
check('accent restored', (await page.evaluate(() => document.querySelector('.os').style.getPropertyValue('--accent'))) === '#e5484d');
const again = await page.locator('.os-icon').first().boundingBox();
check('large icons restored', again.width > 100, `(${Math.round(again.width)}px)`);
await page.click('.os-tb.start');
check('profile name on Start', (await page.textContent('.sm-user span')) === 'Ada Lovelace');
await shot('i3-restored');

// export
await page.keyboard.press('Escape');
await page.click('.win[data-app=settings] .set-nav [data-section=session]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.win[data-app=settings] button:has-text("Export")')]);
check('session export downloads', /three-ws-desktop-.*\.json$/.test(dl.suggestedFilename()));

// All Apps pin/unpin
await page.click('.os-tb.start');
await page.fill('.start-menu input', 'All Apps');
await page.click('.start-menu .sm-row:has-text("All Apps")');
await page.waitForSelector('.win[data-app=apps] .app-row');
check('all apps lists catalog', (await page.locator('.win[data-app=apps] .app-row').count()) > 14);

console.log('problems', problems.length ? problems : 'none');
await browser.close();
process.exit(fails.length || problems.length ? 1 : 0);
