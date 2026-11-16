// scripts/microsoft-365-tab-hosts-check.mjs
// Load the Agents tab (/microsoft/teams-tab) the way each host does and check it
// renders with no console errors:
//   standalone  the page in a plain browser tab (TeamsJS never loads)
//   outlook     framed by https://outlook.office.com, answering TeamsJS as
//               Outlook does: host Outlook, dark theme, mail supported, no sharing
//   teams       framed by https://teams.microsoft.com: host Teams, high
//               contrast, sharing supported
// Each host frames the tab with ?theme=default, so a dark or contrast result
// can only come from the host context TeamsJS reads.
// The host pages are served by Playwright's router on the real Microsoft
// origins, so TeamsJS's own origin check runs unchanged. The simulated host
// speaks the TeamsJS postMessage protocol (initialize, getContext, then any
// other call answered empty), which is what a Microsoft 365 host does on the
// wire; a live sideload in a tenant is still the final check (docs/microsoft-teams-forge.md).
//
//   node scripts/microsoft-365-tab-hosts-check.mjs [--base http://localhost:3132] [--out dir]
//
// Exits 1 on any console error, failed check or page error.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('--base', 'http://localhost:3132').replace(/\/$/, '');
const OUT = arg('--out', join(process.cwd(), 'dist', 'microsoft', 'tab-hosts'));
mkdirSync(OUT, { recursive: true });

const TAB = `${BASE}/microsoft/teams-tab`;

/** A host page that frames the tab and answers TeamsJS like the named host. */
function hostPage({ hostName, theme, supports }) {
	const runtime = JSON.stringify({ apiVersion: 4, supports });
	const context = JSON.stringify({
		hostName,
		hostClientType: 'web',
		frameContext: 'content',
		theme,
		locale: 'en-us',
		entityId: 'threews-agents',
		userObjectId: '00000000-0000-4000-8000-0000000000a1',
		tid: '00000000-0000-4000-8000-0000000000f1',
		appSessionId: '00000000-0000-4000-8000-0000000000c1',
	});
	return `<!doctype html><html><head><meta charset="utf-8"><title>${hostName} host</title>
<style>html,body{margin:0;height:100%;background:#111}iframe{border:0;width:100%;height:100%}</style></head>
<body><iframe id="app" src="${TAB}?theme=default" allow="clipboard-write"></iframe>
<script>
const frame = document.getElementById('app');
window.__calls = [];
window.addEventListener('message', (e) => {
	if (e.source !== frame.contentWindow) return;
	const m = e.data || {};
	if (typeof m.func !== 'string') return;
	window.__calls.push(m.func);
	let args = [];
	if (m.func === 'initialize') args = ['content', 'web', ${JSON.stringify(runtime)}, '2.59.0'];
	else if (m.func === 'getContext') args = [${context}];
	const reply = { id: m.id, args };
	if (m.uuid !== undefined) reply.uuid = m.uuid;
	if (m.uuidAsString !== undefined) reply.uuidAsString = m.uuidAsString;
	e.source.postMessage(reply, e.origin);
});
</script></body></html>`;
}

const HOSTS = [
	{ name: 'standalone' },
	{
		name: 'outlook',
		origin: 'https://outlook.office.com',
		page: hostPage({ hostName: 'Outlook', theme: 'dark', supports: { mail: {}, app: {}, pages: {} } }),
		expect: { host: 'outlook', theme: 'dark', contrast: false, share: 'Email this agent' },
	},
	{
		name: 'teams-contrast',
		origin: 'https://teams.microsoft.com',
		page: hostPage({ hostName: 'Teams', theme: 'contrast', supports: { sharing: {}, app: {}, pages: {} } }),
		expect: { host: 'teams', theme: 'dark', contrast: true, share: 'Share in Teams' },
	},
];

// The simulated host is a public origin framing a localhost dev server; Chrome's
// local network access check would block that frame (a real host frames the
// public https://three.ws), so the check is off for this run only.
const browser = await chromium.launch({
	args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
});
let failed = false;
const fail = (msg) => {
	failed = true;
	console.log(`  FAIL ${msg}`);
};

for (const host of HOSTS) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
	const problems = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()} (${msg.location()?.url || ''})`);
	});
	page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
	console.log(`${host.name}`);

	let frame;
	if (host.origin) {
		await page.route(`${host.origin}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: host.page }));
		await page.goto(`${host.origin}/mail/apps/threews`, { waitUntil: 'load' });
		frame = await (await page.waitForSelector('#app')).contentFrame();
	} else {
		await page.goto(TAB, { waitUntil: 'load' });
		frame = page.mainFrame();
	}

	await frame.waitForSelector('.tt-item', { timeout: 30_000 }).catch(() => fail('the agent list did not render'));
	await frame.waitForSelector('.tt-card-actions', { timeout: 30_000 }).catch(() => fail('the agent card did not render'));
	if (host.expect) {
		await frame.waitForFunction((h) => document.documentElement.dataset.host === h, host.expect.host, { timeout: 15_000 }).catch(() => {});
	} else {
		await frame.waitForFunction(() => document.documentElement.dataset.host === 'standalone', null, { timeout: 15_000 }).catch(() => {});
	}
	await frame.waitForSelector('[data-share]', { timeout: 15_000 }).catch(() => {});
	await page.waitForTimeout(1500);

	const seen = await frame.evaluate(() => ({
		host: document.documentElement.dataset.host || null,
		theme: document.documentElement.getAttribute('data-theme'),
		contrast: document.documentElement.hasAttribute('data-contrast'),
		share: document.querySelector('[data-share]')?.textContent || null,
		agents: document.querySelectorAll('.tt-item').length,
		title: document.querySelector('#tt-card h1')?.textContent || null,
	}));
	console.log(`  ${JSON.stringify(seen)}`);
	if (host.expect) {
		for (const key of Object.keys(host.expect)) if (seen[key] !== host.expect[key]) fail(`${key} is ${seen[key]}, expected ${host.expect[key]}`);
		const calls = await page.evaluate(() => window.__calls);
		console.log(`  TeamsJS calls: ${[...new Set(calls)].join(', ')}`);
		if (!calls.includes('initialize') || !calls.includes('getContext')) fail('TeamsJS never initialized against the host');
	} else if (seen.host !== 'standalone') fail(`host is ${seen.host}, expected standalone`);
	if (!seen.agents) fail('no agents listed');

	const shot = join(OUT, `${host.name}.png`);
	await page.screenshot({ path: shot });
	console.log(`  screenshot ${shot}`);
	for (const p of problems) fail(p);
	if (!problems.length) console.log('  console: no errors or warnings');
	await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
