// Drives the homepage arrival in a real browser: boot log, lock screen, walking
// in as the avatar, meeting the agents who live on the campus and talking to
// one through its real brain, sitting down at the desk, coming back out,
// teleporting to the exchange, picking up the phone, and the phone-sized
// layout. Reports console errors and failed requests.
// Usage: node scripts/desktop-world-smoke.mjs [baseUrl] [screenshotDir]
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:3000';
const shots = process.argv[3] || '';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => !/ERR_ABORTED/.test(r.failure()?.errorText || '') && problems.push(`failed: ${r.url()}`));
page.on('response', (r) => r.status() >= 500 && problems.push(`http ${r.status()}: ${r.url()}`));
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });
const text = (sel) => page.locator(sel).first().textContent().then((t) => (t || '').trim());

// `?world=1` asks for the campus arrival whichever entry answers at `/`.
await page.goto(`${base}/?world=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.os-boot');
await page.waitForSelector('.os-lock:not([hidden])', { timeout: 60_000 });
const lines = await page.$$eval('.os-boot-log li', (els) => els.map((li) => `${li.dataset.state.padEnd(5)} ${li.querySelector('.os-boot-label').textContent} : ${li.querySelector('.os-boot-detail').textContent} ${li.querySelector('.os-boot-ms').textContent}`));
console.log('boot log\n  ' + lines.join('\n  '));
console.log('lock greeting:', await text('.os-lock-greet'), '|', await text('.os-lock-status'));
console.log('lock chips:', await page.$$eval('.os-lock-chip', (els) => els.map((e) => e.textContent.trim()).join(' / ')));
console.log('primary button:', await text('.os-lock-enter'));
await shot('1-lock');

// Walk in.
await page.click('.os-lock-enter');
await page.waitForSelector('.wd:not([hidden])', { timeout: 30_000 });
await page.waitForSelector('html.in-world');
await page.waitForFunction(() => !document.querySelector('.os-boot'), null, { timeout: 15_000 });
await page.waitForTimeout(3000);
console.log('world HUD where:', await text('.wd-where'), '| camera:', await text('.wd-cam-label'));
console.log('places in strip:', await page.locator('.wd-place').count(), '| VR button hidden:', await page.locator('.wd-vr[hidden]').count());
await shot('2-world-spawn');

// The agents come out: real registered agents wearing their own bodies.
await page.waitForSelector('.wd-tag', { timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(1500);
const tags = await page.$$eval('.wd-tag', (els) => els.map((e) => e.querySelector('b').textContent.trim()));
console.log('agents on campus:', tags.length, '|', tags.join(', '));
if (tags.length) {
	// Walk over to the first agent by tapping its name tag, then press E to talk.
	await page.locator('.wd-tag').first().click({ force: true });
	await page.waitForFunction(() => /talk to/i.test(document.querySelector('.wd-prompt')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
	console.log('prompt at agent:', await text('.wd-prompt'));
	await page.waitForFunction(() => document.querySelector('.wd-bubble:not([hidden])'), null, { timeout: 25_000 }).catch(() => {});
	console.log('greeting bubble:', (await page.locator('.wd-bubble:not([hidden])').first().textContent().catch(() => '')).trim().slice(0, 160) || '(none yet)');
	await shot('2b-meet-agent');
	await page.keyboard.press('e');
	await page.waitForSelector('.wd-talk:not([hidden])', { timeout: 5000 });
	console.log('talk panel:', await text('.wd-talk-name'), '|', await text('.wd-talk-meta'), '|', (await text('.wd-talk-about')).slice(0, 80));
	await page.fill('.wd-talk-input', 'In one sentence, what do you do?');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => { const li = document.querySelector('.wd-talk-them'); return li && !li.classList.contains('is-thinking') && li.textContent.trim().length > 0; }, null, { timeout: 45_000 }).catch(() => {});
	console.log('agent reply:', (await page.locator('.wd-talk-them, .wd-talk-note').last().textContent()).trim().slice(0, 200));
	await page.click('.wd-talk-embed');
	console.log('embed snippet:', (await text('.wd-talk-snippet pre')).split('\n')[1]?.slice(0, 80));
	await shot('2c-talk');
	await page.keyboard.press('Escape');
	await page.waitForSelector('.wd-talk', { state: 'hidden', timeout: 3000 });
	await page.click('.wd-place:has-text("workstation")');
	await page.waitForTimeout(500);
}

// Run to the desk (22 m at run speed) and watch the prompt arm.
await page.mouse.click(720, 450);
await page.keyboard.down('Shift');
await page.keyboard.down('w');
await page.waitForFunction(() => /sit down/i.test(document.querySelector('.wd-prompt')?.textContent || ''), null, { timeout: 15_000 }).catch(() => {});
await page.keyboard.up('w');
await page.keyboard.up('Shift');
await page.waitForTimeout(400);
console.log('prompt at desk:', await text('.wd-prompt'));
await shot('3-at-desk');

// Sit down: camera dolly into the monitor, then the desktop.
await page.keyboard.press('e');
// 60 s: under SwiftShader the cast drops the loop to ~3 fps and the 1.15 s dolly takes ~20 s.
	await page.waitForSelector('html:not(.in-world)', { timeout: 60_000 });
await page.waitForSelector('.os-task');
await page.waitForTimeout(800);
console.log('desktop wallpaper:', await page.getAttribute('.os', 'data-wall'), '| welcome window:', await page.locator('.win[data-app=welcome]').count(), '| world button:', await page.locator('.os-tray .os-tb[title="Walk the campus"]:not([hidden])').count());
await shot('4-desktop');

// Back out to the campus from the taskbar, straight to the exchange.
await page.click('.os-tray .os-tb[title="Walk the campus"]');
await page.waitForSelector('html.in-world');
await page.waitForTimeout(1200);
await page.click('.wd-place:has-text("Exchange")');
await page.waitForFunction(() => /exchange/i.test(document.querySelector('.wd-prompt')?.textContent || ''), null, { timeout: 10_000 }).catch(() => {});
console.log('prompt at exchange:', await text('.wd-prompt'), '| ticker boards drawn:', await page.evaluate(() => !!document.querySelector('.wd-canvas')));
await shot('5-exchange');
await page.keyboard.press('e');
// 60 s: under SwiftShader the cast drops the loop to ~3 fps and the 1.15 s dolly takes ~20 s.
	await page.waitForSelector('html:not(.in-world)', { timeout: 60_000 });
await page.waitForSelector('.win[data-app=trenches]', { timeout: 20_000 });
console.log('trenches window open:', await page.locator('.win[data-app=trenches]').count());
await shot('6-trenches');

// Back to the world: the player stands outside the exchange. Teleport home and pick up the phone.
await page.click('.os-tray .os-tb[title="Walk the campus"]');
await page.waitForSelector('html.in-world');
await page.waitForTimeout(800);
console.log('returned near:', await text('.wd-where'));
await page.click('.wd-place:has-text("workstation")').catch(() => {});
await page.waitForTimeout(600);
await page.keyboard.down('w');
await page.waitForFunction(() => /sit down/i.test(document.querySelector('.wd-prompt')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
console.log('prompt back at desk:', await text('.wd-prompt'));
// Slide round the desk's keep-out disc to the phone side.
await page.keyboard.down('d');
await page.waitForFunction(() => /phone/i.test(document.querySelector('.wd-prompt')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
await page.keyboard.up('d');
await page.keyboard.up('w');
console.log('prompt near phone:', await text('.wd-prompt'));
if (/phone/i.test(await text('.wd-prompt'))) {
	await page.keyboard.press('e');
	await page.waitForSelector('.wd-phone.is-open, .wd-phone:not([hidden])', { timeout: 8000 });
	await page.waitForTimeout(2500);
	console.log('phone iframe:', await page.locator('.wd-phone iframe').getAttribute('src'));
	await shot('7-phone');
	await page.keyboard.press('Escape');
	await page.waitForTimeout(500);
}

// Gem HUD and camera cycle.
await page.click('.wd-gems');
await page.waitForTimeout(400);
console.log('gem panel:', (await text('.wd-gempanel')).slice(0, 160));
await shot('8-gems');
await page.keyboard.press('Escape');
await page.keyboard.press('c');
await page.waitForTimeout(300);
console.log('camera after C:', await text('.wd-cam-label'));

// Phone-sized layout.
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(600);
console.log('touch stick visible:', await page.locator('.wd-stick').isVisible(), '| dig button present:', await page.locator('.wd-digbtn').count());
await shot('9-mobile');

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();
