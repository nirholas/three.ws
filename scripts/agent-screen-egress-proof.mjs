// Real-browser proof for the agent-screen caster's egress guard.
//
// Launches an actual headless Chromium (the engine the caster pool runs) with the
// worker's own guard installed on its context (workers/agent-screen-pool/
// egress-guard.js, the same createEgressGuard + install the pool calls), then
// attacks it the ways a steering owner could:
//
//   1. A "public" page that 302-redirects to a loopback secret server.
//   2. A "public" page whose subresources and fetch() target the secret server.
//   3. A websocket to a loopback host.
//   4. A 'nav' control event to an IPv4-mapped IPv6 literal of loopback.
//   5. A hostname the guard resolves to a public address while Chromium actually
//      connects to 127.0.0.1 (DNS rebinding): the connected-address check fires.
//
// "public-redirect.test" is mapped to 127.0.0.1 inside Chromium with
// --host-resolver-rules, while the guard's resolver is told it is a public
// address. That reproduces a rebinding resolver locally with no real DNS.
// The secret server counts every hit; the proof requires it to serve nothing.
//
//   node scripts/agent-screen-egress-proof.mjs
//
// Exit 0 = every assertion passed. Exit 1 = a failure (prints which).

import http from 'node:http';
import { chromium } from 'playwright';
import { createEgressGuard } from '../workers/agent-screen-pool/egress-guard.js';
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

let secretHits = 0;
const secretSrv = await listen((req, res) => {
	secretHits++;
	res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' });
	res.end(`<h1 id="s">${SECRET}</h1>`);
});
const SECRET_PORT = secretSrv.address().port;

const redirectSrv = await listen((req, res) => {
	if (req.url === '/redirect') {
		res.writeHead(302, { location: `http://127.0.0.1:${SECRET_PORT}/secret` });
		return res.end();
	}
	res.writeHead(200, { 'content-type': 'text/html' });
	res.end(`<!doctype html><title>attacker</title><body>
		<img id="img" src="http://127.0.0.1:${SECRET_PORT}/pixel.png">
		<iframe src="http://127.0.0.1:${SECRET_PORT}/frame"></iframe>
		<pre id="out">pending</pre>
		<script>
			fetch('http://127.0.0.1:${SECRET_PORT}/xhr').then(r => r.text()).then(t => { out.textContent = t; }, () => { out.textContent = 'fetch-failed'; });
			const ws = new WebSocket('ws://127.0.0.1:${SECRET_PORT}/ws');
			ws.onclose = () => { document.body.dataset.ws = 'closed'; };
		</script></body>`);
});
const ATTACK_PORT = redirectSrv.address().port;

const baseSrv = await listen((req, res) => {
	res.writeHead(200, { 'content-type': 'text/html' });
	res.end('<!doctype html><title>base</title><h1 id="b">three.ws base page</h1>');
});
const BASE_HOST = `127.0.0.1:${baseSrv.address().port}`;

// The guard's resolver: the attacker hostname looks public to the guard.
const lookup = async (host) => {
	if (host === 'public-redirect.test') return [{ address: '93.184.215.14', family: 4 }];
	const err = new Error(`ENOTFOUND ${host}`);
	err.code = 'ENOTFOUND';
	throw err;
};

const violations = [];
const guard = createEgressGuard({ lookup, trustedHosts: [BASE_HOST] });
const browser = await chromium.launch({
	headless: true,
	args: ['--no-sandbox', '--host-resolver-rules=MAP public-redirect.test 127.0.0.1'],
});
const context = await browser.newContext({ serviceWorkers: 'block' });
await guard.install(context, { onViolation: (v) => violations.push(v) });
const page = await context.newPage();
const ATTACK = `http://public-redirect.test:${ATTACK_PORT}`;

try {
	// 0. The trusted base origin still loads normally.
	await page.goto(`http://${BASE_HOST}/`, { waitUntil: 'domcontentloaded' });
	ok('trusted BASE_URL host loads', (await page.locator('#b').textContent()) === 'three.ws base page');

	// 1. Redirect from a "public" host to the loopback secret.
	const err1 = await page.goto(`${ATTACK}/redirect`, { waitUntil: 'domcontentloaded' }).then(() => null, (e) => e);
	ok('302 to 127.0.0.1 is aborted', /ERR_BLOCKED_BY_CLIENT/.test(String(err1?.message)), String(err1?.message).split('\n')[0]);
	ok('redirect hop was routed and refused', violations.some((v) => v.kind === 'request' && v.url === `http://127.0.0.1:${SECRET_PORT}/secret`));
	ok('secret never rendered after redirect', !(await page.content()).includes(SECRET));

	// 2 + 3. Subresources, iframe, fetch and websocket from an attacker page.
	await page.goto(`${ATTACK}/page`, { waitUntil: 'load' });
	await page.waitForFunction(() => document.getElementById('out').textContent !== 'pending' && document.body.dataset.ws === 'closed', null, { timeout: 10_000 });
	ok('fetch() to loopback failed', (await page.locator('#out').textContent()) === 'fetch-failed');
	ok('websocket to loopback closed by guard', violations.some((v) => v.kind === 'websocket'));
	ok('img + iframe requests refused', ['/pixel.png', '/frame'].every((p) => violations.some((v) => v.kind === 'request' && v.url.endsWith(p))));
	ok('secret absent from every frame', (await Promise.all(page.frames().map((f) => f.content().catch(() => '')))).every((c) => !c.includes(SECRET)));

	// 5. Rebinding: Chromium really connected to 127.0.0.1 for a "public" name.
	const rebound = violations.filter((v) => v.kind === 'response' && v.address === '127.0.0.1');
	ok('connected-address check caught the rebound host', rebound.length > 0, rebound[0]?.url);

	// 4. Control-channel nav to an IPv4-mapped loopback literal is refused.
	const before = page.url();
	await applyEvents(page, [{ t: 'nav', url: `http://[::ffff:127.0.0.1]:${SECRET_PORT}/` }], undefined, { guard });
	ok('nav to [::ffff:127.0.0.1] refused', page.url() === before);

	ok('secret server served zero requests', secretHits === 0, `hits=${secretHits}`);
} finally {
	await browser.close();
	for (const s of [secretSrv, redirectSrv, baseSrv]) s.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
