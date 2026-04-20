import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = 'http://127.0.0.1:4173';

// Pages to probe — mix of HTML files at root and vercel-route paths served by preview.
// Vite preview will 404 on paths not in dist/, so we focus on direct HTML entries.
const paths = [
	'/',
	'/index.html',
	'/app.html',
	'/home.html',
	'/features.html',
	'/create.html',
	'/agent-home.html',
	'/agent-edit.html',
	'/agent-embed.html',
	'/embed.html',
	'/a-embed.html',
	'/public/login.html',
	'/public/register.html',
	'/public/agent/index.html',
	'/public/dashboard/index.html',
	'/public/dashboard/storage.html',
	'/public/dashboard/usage.html',
	'/public/dashboard/wallets.html',
	'/public/dashboard/sessions.html',
	'/public/dashboard/embed-policy.html',
	'/public/hydrate/index.html',
	'/public/studio/index.html',
	'/public/explore/index.html',
	'/public/artifact/index.html',
	'/public/widgets-gallery/index.html',
	'/public/docs-widgets.html',
	'/public/reputation/index.html',
	'/public/discover/index.html',
];

const browser = await chromium.launch();
const report = [];

for (const p of paths) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const consoleErrors = [];
	const pageErrors = [];
	const failed = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
	});
	page.on('pageerror', (err) => {
		pageErrors.push((err.message || String(err)).slice(0, 300));
	});
	page.on('requestfailed', (req) => {
		failed.push(`${req.failure()?.errorText || '?'} ${req.url()}`);
	});
	page.on('response', (resp) => {
		const s = resp.status();
		if (s >= 400) failed.push(`${s} ${resp.url()}`);
	});

	let loadErr = null;
	try {
		const resp = await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 15000 });
		if (!resp || !resp.ok()) loadErr = `status=${resp?.status() ?? 'none'}`;
	} catch (e) {
		loadErr = e.message.slice(0, 200);
	}
	await ctx.close();

	const entry = {
		path: p,
		loadErr,
		consoleErrors,
		pageErrors,
		failed: failed.filter((x) => !/\/@vite\/|vite\/client|hot-update/.test(x)),
	};
	report.push(entry);
	const problems =
		(entry.loadErr ? 1 : 0) +
		entry.consoleErrors.length +
		entry.pageErrors.length +
		entry.failed.length;
	console.log(
		`[${problems === 0 ? 'OK' : 'WARN'}] ${p}  (${problems} issue${problems === 1 ? '' : 's'})`,
	);
}

await browser.close();

// Print details
console.log('\n\n==== DETAILS ====');
for (const r of report) {
	const issues =
		(r.loadErr ? 1 : 0) + r.consoleErrors.length + r.pageErrors.length + r.failed.length;
	if (issues === 0) continue;
	console.log(`\n--- ${r.path} ---`);
	if (r.loadErr) console.log('  LOAD:', r.loadErr);
	for (const e of r.pageErrors) console.log('  PAGE-ERR:', e);
	for (const e of r.consoleErrors) console.log('  CONSOLE:', e);
	for (const e of r.failed.slice(0, 10)) console.log('  REQ:', e);
	if (r.failed.length > 10) console.log(`  (+${r.failed.length - 10} more req failures)`);
}
