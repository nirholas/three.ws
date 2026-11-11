// Drive the PowerPoint add-in task pane (/office/powerpoint) in a real browser
// against a dev server, outside PowerPoint (Office.js resolves with no host, so
// the pane downloads decks instead of inserting them):
//
//   1. signed-out state, environment note, no console errors
//   2. a deck for a just-generated model (src mode) downloads from Just generated
//   3. the real OAuth sign-in: QA login, consent, code exchange, /api/me
//   4. Your models lists the QA account's own models from /api/forge/mine
//   5. sign-out returns the pane to the signed-out state
//
//   DEV_API_PROXY=http://localhost:<api> npx vite --port 3102 --strictPort
//   node --env-file=.env scripts/verify-office-powerpoint-pane.mjs <glb-url> [base=http://localhost:3102] [outDir]
//
// The QA account comes from AUDIT_EMAIL / AUDIT_PASSWORD (see the
// self-unblock-playbook skill). Steps 3 to 5 are skipped when they are unset.

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unzipSync } from 'fflate';
import { chromium } from 'playwright';

const [glbUrl, base = 'http://localhost:3102', outDir = 'tmp/office-pane'] = process.argv.slice(2);
if (!/^https?:\/\/.+\.glb$/i.test(glbUrl || '')) {
	console.error('usage: node --env-file=.env scripts/verify-office-powerpoint-pane.mjs <glb-url> [base] [outDir]');
	process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 380, height: 820 } });
const page = await context.newPage();
const problems = [];
// Office.js itself warns that it is running outside an Office client; only
// messages from three.ws code count.
const OFFICE_JS = /appsforoffice\.microsoft\.com|firstpartyapps\.oaspapps\.com/;
page.on('console', (m) => {
	if (m.type() !== 'error' && m.type() !== 'warning') return;
	if (OFFICE_JS.test(m.location()?.url || '')) return;
	problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const calls = [];
page.on('response', (r) => {
	const u = new URL(r.url());
	if (/^\/(api|\.well-known)\//.test(u.pathname)) calls.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
});

const pane = `${base}/office/powerpoint`;

// 1. signed out
await page.goto(pane, { waitUntil: 'networkidle' });
await page.waitForSelector('#op-mine-state:not([hidden])');
check('signed-out state asks the user to sign in', /Sign in to see your models/.test(await page.textContent('#op-mine-state')));
check('browser environment note is shown', /viewing the add-in in a browser/.test(await page.textContent('#op-env')));

// 2. src-mode download from Just generated
await page.evaluate(
	([src]) => localStorage.setItem('tws_office_recent', JSON.stringify([{ glbUrl: src, prompt: 'a low poly brass lantern', title: 'A low poly brass lantern', at: Date.now() }])),
	[glbUrl],
);
await page.reload({ waitUntil: 'networkidle' });
const [download] = await Promise.all([
	page.waitForEvent('download', { timeout: 120_000 }),
	page.evaluate(() => document.querySelector('#op-recent-list button').click()),
]);
const deckPath = join(outDir, download.suggestedFilename());
await download.saveAs(deckPath);
const parts = Object.keys(unzipSync(readFileSync(deckPath)));
check('Just generated downloads a deck with the 3D model', parts.includes('ppt/media/model3d1.glb') && parts.includes('ppt/slides/slide1.xml'), deckPath);
await page.waitForFunction(() => /Downloaded/.test(document.getElementById('op-live').textContent));

// 3 to 5. real sign-in
const email = process.env.AUDIT_EMAIL;
const password = process.env.AUDIT_PASSWORD;
if (!email || !password) {
	console.log('SKIP  sign-in steps: AUDIT_EMAIL / AUDIT_PASSWORD not set');
} else {
	const login = await page.request.post(`${base}/api/auth/login`, { data: { email, password } });
	check('QA login', login.ok(), String(login.status()));
	await page.goto(pane, { waitUntil: 'networkidle' });
	await page.evaluate(() => document.getElementById('op-signin').click());
	await page.waitForSelector('button.allow', { timeout: 30_000 });
	check('sign-in reaches the three.ws consent screen', /three\.ws for PowerPoint/.test(await page.textContent('h1')));
	await page.evaluate(() => document.querySelector('button.allow').click());
	await page.waitForURL(/\/office\/powerpoint\/?$/, { timeout: 30_000 });
	await page.waitForSelector('.op-chip', { timeout: 30_000 });
	check('signed in: account chip shows the user', (await page.textContent('.op-chip-name')).trim().length > 0, (await page.textContent('.op-chip-name')).trim());
	await page.waitForFunction(() => document.getElementById('op-mine').getAttribute('aria-busy') !== 'true', null, { timeout: 30_000 });
	const cards = await page.$$eval('#op-mine .op-card', (els) => els.length);
	const state = await page.$eval('#op-mine-state', (n) => (n.hidden ? '' : n.textContent));
	check('Your models loaded from /api/forge/mine', cards > 0 || /No models yet/.test(state), cards ? `${cards} models` : state.trim());
	await page.screenshot({ path: join(outDir, 'pane-signed-in.png'), fullPage: true });
	await page.evaluate(() => document.querySelector('.op-chip .op-link').click());
	await page.waitForSelector('#op-signin:not([hidden])');
	check('sign-out returns to the signed-out state', /Sign in to see your models/.test(await page.textContent('#op-mine-state')));
}

check('no console errors or warnings', problems.length === 0, problems.join(' | '));
console.log('\nnetwork:\n' + [...new Set(calls)].join('\n'));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
