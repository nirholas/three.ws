// One-off browser verification of /admin/microsoft/leads against the local
// stack (vite on 3122 proxying /api to server/index.mjs). Grants the QA account
// is_admin for the duration of the run and always reverts it.
import { chromium } from 'playwright';
import { sql } from '../api/_lib/db.js';

const BASE = 'http://localhost:3122';
const OUT = process.argv[2];
const LEAD = '929ad426-351c-4505-a17a-b179f5809dfd';
const REDRAFT = 'd2c27310-718b-4a6b-8bd3-86523b0f4ccf';
const email = process.env.AUDIT_EMAIL;
const [qa] = await sql`select id, is_admin from users where lower(email) = lower(${email})`;
const issues = [];
const log = (...a) => console.log(...a);

await sql`update users set is_admin = true where id = ${qa.id}`;
const browser = await chromium.launch();
try {
	const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
	const page = await ctx.newPage();
	page.on('console', (m) => {
		if (['error', 'warning'].includes(m.type())) issues.push(`console.${m.type()}: ${m.text()}`);
	});
	page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
	page.on('response', (r) => {
		if (r.url().includes('/api/') && r.status() >= 400) issues.push(`http ${r.status()} ${r.url()}`);
	});

	// Signed out first: the page must explain the gate, not break.
	await page.goto(`${BASE}/admin/microsoft/leads`, { waitUntil: 'networkidle' });
	log('signed out note:', await page.locator('#ml-list .ml-note h2').textContent());
	issues.length = 0;

	const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: process.env.AUDIT_PASSWORD } });
	log('login', login.status());

	await page.goto(`${BASE}/admin/microsoft/leads`, { waitUntil: 'networkidle' });
	await page.waitForSelector('.ml-row');
	log('rows', await page.locator('.ml-row').count(), '| tabs:', (await page.locator('#ml-tabs').innerText()).replace(/\s+/g, ' '));
	await page.screenshot({ path: `${OUT}/leads-list.png`, fullPage: true });

	await page.click(`.ml-row[data-id="${LEAD}"]`);
	await page.waitForSelector('#ml-draft-body');
	log('detail:', await page.locator('#ml-detail h2').textContent(), '| url', new URL(page.url()).search);
	await page.click('button[data-op="copy"]');
	await page.waitForFunction(() => document.querySelector('button[data-op="copy"]')?.textContent === 'Copied');
	const clip = await page.evaluate(() => navigator.clipboard.readText());
	log('clipboard starts:', JSON.stringify(clip.slice(0, 40)));
	await page.screenshot({ path: `${OUT}/leads-detail.png`, fullPage: true });

	await page.click('button[data-op="contacted"]');
	await page.waitForFunction(() => document.querySelector('#ml-detail .ml-pill')?.textContent === 'Contacted');
	await page.fill('#ml-notes', 'Browser verification: replied from the owner mailbox.');
	await page.click('button[data-op="save"]');
	await page.waitForSelector('.ml-toast');
	log('after save toast:', await page.locator('.ml-toast').textContent(), '| tabs:', (await page.locator('#ml-tabs').innerText()).replace(/\s+/g, ' '));

	await page.selectOption('#ml-action', 'Create');
	await page.waitForFunction(() => document.querySelectorAll('.ml-row').length === 1);
	log('filter action=Create rows', await page.locator('.ml-row').count());
	await page.selectOption('#ml-action', '');
	await page.fill('#ml-q', 'nobody-matches-this');
	await page.waitForSelector('#ml-list .ml-note');
	log('empty search note:', await page.locator('#ml-list .ml-note h2').textContent());
	await page.fill('#ml-q', '');
	await page.waitForSelector('.ml-row');

	await page.goto(`${BASE}/admin/microsoft/leads?id=${REDRAFT}`, { waitUntil: 'networkidle' });
	await page.waitForSelector('#ml-detail h2');
	log('deep link detail:', await page.locator('#ml-detail h2').textContent());
	const t = Date.now();
	await page.click('button[data-op="draft"]');
	await page.waitForSelector('.ml-toast', { timeout: 40_000 });
	log('redraft toast:', await page.locator('.ml-toast').textContent(), `${Date.now() - t}ms`);

	await page.setViewportSize({ width: 400, height: 860 });
	await page.screenshot({ path: `${OUT}/leads-mobile.png`, fullPage: true });
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
	log('horizontal overflow at 400px:', overflow);

	await page.keyboard.press('Tab');
	log('first tab focus:', await page.evaluate(() => document.activeElement?.tagName));
} finally {
	if (issues.length) log(`ISSUES so far:\n${issues.join('\n')}`);
	await browser.close();
	await sql`update users set is_admin = ${qa.is_admin} where id = ${qa.id}`;
	const [after] = await sql`select is_admin from users where id = ${qa.id}`;
	log('qa is_admin restored to', after.is_admin);
}
log(issues.length ? `ISSUES:\n${issues.join('\n')}` : 'no console errors, warnings or failed API calls');
