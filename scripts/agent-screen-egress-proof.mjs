// Real-browser proof for the agent-screen caster's egress guard.
//
// Launches an actual headless Chromium (the engine the caster pool runs) the way
// workers/agent-screen-pool/index.js does: behind startEgressProxy, with the
// guard's route hooks installed on the context. Then it attacks it the ways a
// steering owner could:
//
//   1. An allowed page that 302-redirects to a loopback secret server. Playwright
//      never shows that hop to context.route, so this is the proxy's job.
//   2. An allowed page whose <img>, <iframe>, fetch() and WebSocket target the
//      secret server.
//   3. A hostname that resolves to 127.0.0.1 (a rebinding resolver).
//   4. A 'nav' control event to an IPv4-mapped IPv6 literal of loopback.
//
// The "allowed page" is a local server listed in trustedHosts, standing in for a
// public site (nothing on loopback can be public). The guard's resolver is a
// table so case 3 needs no real DNS. The secret server counts every request it
// gets; the proof requires zero.
//
//   node scripts/agent-screen-egress-proof.mjs
//
// Exit 0 = every assertion passed. Exit 1 = a failure (prints which).

import http from 'node:http';
import { chromium } from 'playwright';
import { createEgressGuard, startEgressProxy } from '../workers/agent-screen-pool/egress-guard.js';
import { applyEvents } from '../workers/agent-screen-pool/control.js';

const SECRET = 'TOP-SECRET-METADATA-TOKEN';
const results = [];
const ok = (name, cond, detail = '') => {
	results.push({ name, pass: !!cond });
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const listen = (handler) => new Promise((res) => {
	const srv = http.createServer(handler);
	srv.listen(0, '127.0.0.1', () => res(srv));
});

const secretHits = [];
const secretSrv = await listen((req, res) => {
	secretHits.push(req.url);
	res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' });
	res.end(`<h1 id="s">${SECRET}</h1>`);
});
const SECRET_PORT = secretSrv.address().port;
const SECRET_ORIGIN = `http://127.0.0.1:${SECRET_PORT}`;

const siteSrv = await listen((req, res) => {
	if (req.url === '/redirect') {
		res.writeHead(302, { location: `${SECRET_ORIGIN}/secret` });
		return res.end();
	}
	if (req.url === '/page') {
		res.writeHead(200, { 'content-type': 'text/html' });
		return res.end(`<!doctype html><title>attacker</title><body>
			<h1 id="b">public page</h1>
			<img id="img" src="${SECRET_ORIGIN}/pixel.png">
			<iframe src="${SECRET_ORIGIN}/frame"></iframe>
			<pre id="out">pending</pre>
			<script>
				fetch('${SECRET_ORIGIN}/xhr').then(r => r.text()).then(t => { out.textContent = t; }, () => { out.textContent = 'fetch-failed'; });
				const ws = new WebSocket('ws://127.0.0.1:${SECRET_PORT}/ws');
				ws.onclose = () => { document.body.dataset.ws = 'closed'; };
			</script></body>`);
	}
	res.writeHead(200, { 'content-type': 'text/html' });
	res.end('<!doctype html><title>site</title><h1 id="b">public page</h1>');
});
const SITE = `127.0.0.1:${siteSrv.address().port}`;

const lookup = async (host) => {
	if (host === 'rebind.test') return [{ address: '127.0.0.1', family: 4 }];
	const err = new Error(`ENOTFOUND ${host}`);
	err.code = 'ENOTFOUND';
	throw err;
};

const violations = [];
const onViolation = (v) => violations.push(v);
const guard = createEgressGuard({ lookup, trustedHosts: [SITE] });
const proxy = await startEgressProxy({ guard, onViolation });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], proxy: { server: proxy.url } });
const context = await browser.newContext({ serviceWorkers: 'block' });
await guard.install(context, { onViolation });
const page = await context.newPage();
const leaked = async () => (await Promise.all(page.frames().map((f) => f.content().catch(() => '')))).some((c) => c.includes(SECRET));

try {
	await page.goto(`http://${SITE}/`, { waitUntil: 'domcontentloaded' });
	ok('allowed site loads through the proxy', (await page.locator('#b').textContent()) === 'public page');

	// 1. Redirect hop to loopback.
	const res1 = await page.goto(`http://${SITE}/redirect`, { waitUntil: 'domcontentloaded' }).catch((e) => e);
	ok('302 hop to 127.0.0.1 answered 403 by the proxy', res1?.status?.() === 403, `final=${res1?.url?.() || res1?.message}`);
	ok('proxy logged the refused hop', violations.some((v) => v.kind === 'proxy' && v.url === `${SECRET_ORIGIN}/secret`));
	ok('secret never rendered after the redirect', !(await leaked()));

	// 2. Subresources, iframe, fetch and websocket from an allowed page.
	await page.goto(`http://${SITE}/page`, { waitUntil: 'load' });
	await page.waitForFunction(() => document.getElementById('out').textContent !== 'pending' && document.body.dataset.ws === 'closed', null, { timeout: 10_000 });
	ok('fetch() to loopback failed', (await page.locator('#out').textContent()) === 'fetch-failed');
	ok('websocket to loopback refused', violations.some((v) => v.kind === 'websocket'));
	ok('img + iframe requests refused', ['/pixel.png', '/frame'].every((p) => violations.some((v) => v.url.endsWith(p))));
	ok('secret absent from every frame', !(await leaked()));

	// 3. A name that resolves to loopback.
	const res3 = await page.goto(`http://rebind.test:${SECRET_PORT}/`, { waitUntil: 'domcontentloaded' }).catch((e) => e);
	ok('rebinding name refused', res3?.status?.() === 403 || /ERR_BLOCKED_BY_CLIENT/.test(String(res3?.message)), res3?.status?.() ?? String(res3?.message).split('\n')[0]);
	ok('secret absent after rebinding attempt', !(await leaked()));

	// 4. Control-channel nav to an IPv4-mapped loopback literal.
	const before = page.url();
	await applyEvents(page, [{ t: 'nav', url: `http://[::ffff:127.0.0.1]:${SECRET_PORT}/` }], undefined, { guard });
	ok('nav to [::ffff:127.0.0.1] refused', page.url() === before);

	ok('secret server received zero requests', secretHits.length === 0, `hits=${JSON.stringify(secretHits)}`);
} finally {
	await browser.close();
	await proxy.close();
	for (const s of [secretSrv, siteSrv]) s.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
