#!/usr/bin/env node
// Two-or-more-client consistency and scale audit for the /play multiplayer layer.
//
// Boots (or attaches to) the real multiplayer server and a Vite dev server, then
// drives N headless Chromium contexts through the real CommunityNet client in the
// canonical $THREE community world. Same technique as the other /play browser
// checks: the 3D world is not rendered (headless swiftshader stalls on it), but
// the net layer, the wire, the server and the browser APIs are all real.
//
// Scenarios (exit non-zero on any failure):
//   join        every client reaches `online` and sees every peer
//   movement    a walk by one client is seen by the others
//   chat        relay, markup payload passes as inert text, length cap, spam throttle
//   emote       an emote by one client is seen by the others
//   disconnect  offline for 10 s: peers drop the leaver, it reconnects by itself,
//               no ghost or duplicated self, and a still-standing player is not
//               teleported to the origin on resync
//   background  page frozen (iOS-style) for --background-ms (default 120000),
//               resume() recovers the connection
//   handshake   an unreachable server surfaces status `failed` with an error, and
//               retry() joins once the server is reachable
//   scale       --clients N: join N clients, record server CPU, per-tick time and
//               fan-out latency
//
// Usage:
//   node scripts/play-net-audit.mjs                       # 2-client audit
//   node scripts/play-net-audit.mjs --clients 25          # also run the scale pass
//   node scripts/play-net-audit.mjs --quick               # background 15 s, not 120 s
//   node scripts/play-net-audit.mjs --seed-fault          # must FAIL (proves the gate)
//   MP_URL=ws://127.0.0.1:2567 APP_URL=http://localhost:3000 node scripts/play-net-audit.mjs
//
// Flags: --clients N, --background-ms MS, --quick, --seed-fault, --only a,b,c,
//        --json (machine-readable summary on the last line).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const CLIENTS = Math.max(2, Number(opt('clients', 2)) | 0);
const SCALE = argv.includes('--clients') && CLIENTS > 2;
const BACKGROUND_MS = flag('quick') ? 15_000 : Number(opt('background-ms', 120_000));
const SEED_FAULT = flag('seed-fault');
const ONLY = new Set(String(opt('only', '')).split(',').filter(Boolean));
const want = (n) => ONLY.size === 0 || ONLY.has(n);

// The canonical $THREE community world (docs/event-readiness/README.md).
const COIN = {
	mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
	name: 'three.ws',
	symbol: 'three',
	image: '',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const children = [];
const t0 = Date.now();
const log = (...a) => console.log(`[net-audit +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

function record(name, ok, detail = '') {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

async function check(name, fn) {
	try {
		const detail = await fn();
		record(name, true, detail || '');
	} catch (err) {
		record(name, false, err?.message || String(err));
	}
}

async function until(fn, timeoutMs, what) {
	const start = Date.now();
	for (;;) {
		const v = await fn();
		if (v) return Date.now() - start;
		if (Date.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
		await sleep(100);
	}
}

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.once('error', reject);
		s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
	});
}

async function waitHttp(url, timeoutMs = 90_000) {
	await until(async () => { try { return (await fetch(url)).status < 500; } catch { return false; } }, timeoutMs, url);
}

function start(cmd, args, env) {
	const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
	child.out = '';
	child.stdout.on('data', (d) => { child.out = (child.out + d).slice(-4000); });
	child.stderr.on('data', (d) => { child.out = (child.out + d).slice(-4000); });
	children.push(child);
	return child;
}

function stopAll() {
	// Signal the whole process group: `npx vite` forks the real server as a grandchild.
	for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* already gone */ } }
}
process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(130); });

// Sample a child process's CPU (percent of one core) over a window, from /proc.
function cpuTicks(pid) {
	try {
		const f = require_fs().readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
		return Number(f[13]) + Number(f[14]);
	} catch { return null; }
}
let _fs;
function require_fs() { return (_fs ||= createRequire(import.meta.url)('node:fs')); }

// ---------------------------------------------------------------------------
// Browser side
// ---------------------------------------------------------------------------

// Runs inside each page: builds the real CommunityNet and records everything a
// peer could observe into window.__A so the harness can poll it.
const PAGE_BOOT = (mpUrl, coin, name) => `
import { CommunityNet } from '/src/game/community-net.js';
const A = window.__A = { peers: {}, chats: [], statuses: [], selfId: null, reconnects: 0, readyCount: 0 };
const net = window.__net = new CommunityNet({ name: ${JSON.stringify(name)}, coin: ${JSON.stringify(coin)}, url: ${JSON.stringify(mpUrl)} });
const snap = (p, id) => ({ name: p.name, x: p.x, z: p.z, emote: p.emote, emoteTs: p.emoteTs });
net.on('add', (p, id) => { A.peers[id] = snap(p, id); });
net.on('change', (p, id) => { A.peers[id] = snap(p, id); });
net.on('remove', (id) => { delete A.peers[id]; });
net.on('chat', (m) => { A.chats.push({ id: m.id, name: m.name, text: m.text, at: performance.now() }); });
net.on('status', (s) => { A.statuses.push({ status: s.status, error: s.error, at: performance.now() }); });
net.on('ready', () => { A.readyCount++; A.selfId = net.sessionId; });
window.__standing = null;
setInterval(() => { if (window.__standing) net.sendMove(window.__standing); }, 100);
window.__booted = true;
`;

// Vite's first request for a dependency can trigger an "optimized dependencies
// changed, reloading" page refresh that wipes the injected script, so boot is
// retried on a fresh load until the net module is actually running.
async function bootPage(page, appUrl, mpUrl, name) {
	let last;
	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			await page.goto(`${appUrl}/404.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			await page.evaluate(() => { document.body.innerHTML = ''; });
			await page.addScriptTag({ type: 'module', content: PAGE_BOOT(mpUrl, COIN, name) });
			await page.waitForFunction(() => window.__booted === true, null, { timeout: 30_000 });
			return;
		} catch (err) { last = err; await sleep(3000); }
	}
	throw last;
}

async function openClient(browser, appUrl, mpUrl, name, { connect = true } = {}) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const errors = [];
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	await bootPage(page, appUrl, mpUrl, name);
	if (connect) await page.evaluate(() => window.__net.connect());
	return { name, context, page, errors };
}

const peersOf = (c) => c.page.evaluate(() => window.__A.peers);
const selfOf = (c) => c.page.evaluate(() => window.__net.sessionId);
const statusOf = (c) => c.page.evaluate(() => window.__net.status);

async function othersSeen(c) {
	const [peers, self] = await Promise.all([peersOf(c), selfOf(c)]);
	return Object.entries(peers).filter(([id]) => id !== self);
}

// ---------------------------------------------------------------------------

async function main() {
	let mpUrl = process.env.MP_URL || '';
	let appUrl = process.env.APP_URL || '';
	let mpProc = null;
	let mpPort = 0;

	if (!appUrl) {
		const port = await freePort();
		log(`starting vite on :${port}`);
		start('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {});
		appUrl = `http://127.0.0.1:${port}`;
		await waitHttp(`${appUrl}/404.html`);
	}
	if (!mpUrl) {
		mpPort = await freePort();
		log(`starting multiplayer server on :${mpPort}`);
		mpProc = start('node', ['multiplayer/src/index.js'], {
			PORT: String(mpPort), HOST: '127.0.0.1', ALLOWED_ORIGINS: appUrl,
		});
		mpUrl = `ws://127.0.0.1:${mpPort}`;
		await waitHttp(`http://127.0.0.1:${mpPort}/health`);
	}
	log(`app ${appUrl}  server ${mpUrl}`);

	const browser = await chromium.launch({ args: ['--no-sandbox'] });
	const clients = [];
	// Cold Vite compiles community-net.js and colyseus.js on first request; warm it
	// so scenario timings measure the net layer, not the dev server.
	await fetch(`${appUrl}/src/game/community-net.js`).then((r) => r.text()).catch(() => {});
	try {
		// ---- join --------------------------------------------------------
		if (want('join') || want('movement') || want('chat') || want('emote') || want('disconnect') || want('background')) {
			await check('join: two clients reach online and see each other', async () => {
				for (const name of ['Alice', 'Bob']) clients.push(await openClient(browser, appUrl, mpUrl, name));
				const ms = await until(async () => {
					for (const c of clients) {
						if ((await statusOf(c)) !== 'online') return false;
						if ((await othersSeen(c)).length !== clients.length - 1) return false;
					}
					return true;
				}, 20_000, 'both clients online and mutually visible');
				return `${ms} ms`;
			});
		}
		const [A, B] = clients;

		if (A && B && want('movement')) {
			await check('movement: a walk is seen by the other client', async () => {
				const me = await selfOf(A);
				// Steps stay under the server's teleport clamp, at roughly the real send rate.
				let x = 0;
				const started = Date.now();
				for (let i = 0; i < 12; i++) {
					x += 0.4;
					await A.page.evaluate((px) => window.__net.sendMove({ x: px, y: 0, z: 0, yaw: 0, motion: 'run' }), x);
					await sleep(80);
				}
				await until(async () => {
					const p = (await peersOf(B))[me];
					return p && Math.abs(p.x - x) < 0.6;
				}, 4000, `Bob to see Alice near x=${x.toFixed(1)}`);
				return `${Date.now() - started} ms for a ${x.toFixed(1)} m walk`;
			});
		}

		if (A && B && want('chat')) {
			await check('chat: relay, markup stays inert text, cap, throttle', async () => {
				const me = await selfOf(A);
				const said = (c) => c.page.evaluate(() => window.__A.chats.map((m) => m.text));
				const start = Date.now();
				await A.page.evaluate(() => window.__net.sendChat('hello from alice'));
				await until(async () => (await said(B)).includes('hello from alice'), 3000, 'chat relay to Bob').catch(async (e) => { throw new Error(`${e.message}; Bob heard ${JSON.stringify(await said(B))}, Alice heard ${JSON.stringify(await said(A))}, Alice status ${await statusOf(A)}`); });
				const relayMs = Date.now() - start;

				await sleep(800);
				const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
				await A.page.evaluate((p) => window.__net.sendChat(p), payload);
				await until(async () => (await said(B)).some((t) => t.includes('<img')), 3000, 'markup payload relay');
				const injected = await B.page.evaluate(() => window.__xss === 1 || document.querySelector('img[src="x"]') !== null);
				if (injected) throw new Error('markup payload executed or inserted into the DOM');

				await sleep(800);
				await A.page.evaluate(() => window.__net.sendChat('x'.repeat(500)));
				await until(async () => (await said(B)).some((t) => t.startsWith('xxxx')), 3000, 'long message relay');
				const long = (await said(B)).find((t) => t.startsWith('xxxx'));
				if (long.length > 200) throw new Error(`long message relayed at ${long.length} chars, cap is 200`);

				await sleep(900);
				const before = (await said(B)).length;
				await A.page.evaluate(() => { for (let i = 0; i < 12; i++) window.__net.sendChat(`spam ${i}`); });
				await sleep(900);
				const relayed = (await said(B)).length - before;
				if (relayed > 3) throw new Error(`${relayed} of 12 burst messages relayed, throttle is not holding`);
				const own = await A.page.evaluate((id) => window.__A.chats.filter((m) => m.id === id).length, me);
				return `relay ${relayMs} ms, burst 12 -> ${relayed} relayed, sender saw ${own} own`;
			});
		}

		if (A && B && want('emote')) {
			await check('emote: an emote is seen by the other client', async () => {
				const me = await selfOf(A);
				const start = Date.now();
				await A.page.evaluate(() => window.__net.sendEmote('wave'));
				await until(async () => (await peersOf(B))[me]?.emote === 'wave', 3000, 'Bob to see the wave emote');
				return `${Date.now() - start} ms`;
			});
		}

		if (A && B && want('disconnect')) {
			await check('disconnect: 10 s offline, auto reconnect, clean resync', async () => {
				// Bob walks to a known spot (the server clamps any single step to 1.2 m, so
				// a teleport would be refused), then stands there re-sending it every
				// 100 ms like the render loop does.
				await B.page.evaluate(async () => {
					let x = 0; let z = 0;
					while (Math.hypot(4 - x, 3 - z) > 0.05) {
						const d = Math.hypot(4 - x, 3 - z); const step = Math.min(0.9, d);
						x += ((4 - x) / d) * step; z += ((3 - z) / d) * step;
						window.__net.sendMove({ x, y: 0, z, yaw: 0, motion: 'run' });
						await new Promise((r) => setTimeout(r, 80));
					}
					window.__standing = { x: 4, y: 0, z: 3, yaw: 0, motion: 'idle' };
				});
				const oldId = await selfOf(B);
				await until(async () => {
					const p = (await peersOf(A))[oldId];
					return p && Math.abs(p.x - 4) < 0.6 && Math.abs(p.z - 3) < 0.6;
				}, 5000, 'Alice to see Bob standing at (4,3)');

				await B.context.setOffline(true);
				await B.page.evaluate((fault) => {
					if (fault) { window.__net.destroy(); return; } // seeded fault: reconnect can never happen
					const ws = window.__net.room?.connection?.transport?.ws;
					try { ws?.close(); } catch { /* already closed */ }
				}, SEED_FAULT);
				await until(async () => !(await peersOf(A))[oldId], 8000, 'Alice to drop the offline Bob');
				await sleep(10_000);
				const downStatus = await statusOf(B);
				await B.context.setOffline(false);

				const ms = await until(async () => {
					if ((await statusOf(B)) !== 'online') return false;
					return (await selfOf(B)) !== oldId;
				}, 60_000, 'Bob to reconnect on his own');

				const newId = await selfOf(B);
				await until(async () => {
					const p = (await peersOf(A))[newId];
					return p && Math.abs(p.x - 4) < 0.6 && Math.abs(p.z - 3) < 0.6;
				}, 6000, 'Alice to see the reconnected Bob at his standing spot (not the origin)');

				const aPeers = await peersOf(A);
				const bobs = Object.values(aPeers).filter((p) => p.name === 'Bob').length;
				if (aPeers[oldId]) throw new Error('ghost: Alice still holds Bob\'s old session');
				if (bobs !== 1) throw new Error(`Alice sees ${bobs} Bobs, expected exactly 1`);
				const bPeers = await othersSeen(B);
				if (bPeers.length !== 1) throw new Error(`Bob sees ${bPeers.length} peers, expected exactly 1`);
				const selfListed = Object.keys(await peersOf(B)).filter((id) => id === oldId).length;
				if (selfListed) throw new Error('Bob still lists his own old session');
				return `went ${downStatus} while down, back online ${Math.round(ms / 100) / 10} s after network return`;
			});
			await B.page.evaluate(() => { window.__standing = null; });
		}

		if (A && B && want('background')) {
			await check(`background: frozen ${Math.round(BACKGROUND_MS / 1000)} s, resume() recovers`, async () => {
				const oldId = await selfOf(B);
				const cdp = await B.context.newCDPSession(B.page);
				await cdp.send('Page.enable');
				await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
				await sleep(BACKGROUND_MS);
				await cdp.send('Page.setWebLifecycleState', { state: 'active' });
				// Same handler coincommunities.js installs on visibilitychange.
				await B.page.evaluate(() => window.__net.resume());
				const ms = await until(async () => {
					if (!(await B.page.evaluate(() => window.__net.isLive()))) return false;
					return (await othersSeen(B)).length === 1;
				}, 45_000, 'Bob live and seeing Alice after resume');
				const newId = await selfOf(B);
				const aPeers = await peersOf(A);
				const bobs = Object.values(aPeers).filter((p) => p.name === 'Bob').length;
				if (bobs !== 1) throw new Error(`Alice sees ${bobs} Bobs after Bob resumed, expected exactly 1`);
				return `recovered ${Math.round(ms / 100) / 10} s after thaw${newId === oldId ? ' (same session kept)' : ' (new session)'}`;
			});
		}

		// ---- handshake failure + manual retry ----------------------------
		if (want('handshake')) {
			await check('handshake: unreachable server -> failed with error, retry() joins', async () => {
				const deadPort = await freePort();
				const c = await openClient(browser, appUrl, `ws://127.0.0.1:${deadPort}`, 'Late', { connect: false });
				clients.push(c);
				await c.page.evaluate(() => { window.__net.connect(); });
				await until(async () => (await statusOf(c)) === 'failed', 20_000, 'status failed');
				const err = await c.page.evaluate(() => window.__net.error);
				if (!err) throw new Error('failed status carries no error text for the UI to show');
				if (!mpProc && !process.env.MP_URL) throw new Error('no local server to retry against');
				// Bring a server up on that exact port, then use the manual retry the UI button calls.
				const late = start('node', ['multiplayer/src/index.js'], {
					PORT: String(deadPort), HOST: '127.0.0.1', ALLOWED_ORIGINS: appUrl,
				});
				await waitHttp(`http://127.0.0.1:${deadPort}/health`);
				await c.page.evaluate(() => window.__net.retry());
				const ms = await until(async () => (await statusOf(c)) === 'online', 30_000, 'retry() to reach online');
				try { process.kill(-late.pid, 'SIGTERM'); } catch { /* already gone */ }
				return `error "${String(err).slice(0, 60)}", online ${ms} ms after retry`;
			});
		}

		// ---- scale -------------------------------------------------------
		if (SCALE && want('scale')) await scalePass(browser, appUrl, mpUrl, mpProc);

		// The handshake client dials a closed port on purpose, so its refused-connection
		// errors are the test, not a defect.
		const errs = clients.filter((c) => c.name !== 'Late').flatMap((c) => c.errors.map((e) => `${c.name}: ${e}`));
		await check('console: zero errors across the run', async () => {
			if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
			return `${clients.length} clients`;
		});
	} finally {
		await browser.close().catch(() => {});
	}
}

// Join N lightweight clients (one shared browser context per 10 pages keeps memory
// sane), then measure fan-out and server cost.
async function scalePass(browser, appUrl, mpUrl, mpProc) {
	const pages = [];
	const ctxs = [];
	let reached = 0;
	await check(`scale: ${CLIENTS} clients join and all see the full room`, async () => {
		const cpu0 = mpProc ? cpuTicks(mpProc.pid) : null;
		const wall0 = Date.now();
		for (let i = 0; i < CLIENTS; i++) {
			if (i % 10 === 0) ctxs.push(await browser.newContext());
			const page = await ctxs[ctxs.length - 1].newPage();
			await bootPage(page, appUrl, mpUrl, `S${i}`);
			await page.evaluate(() => window.__net.connect());
			pages.push(page);
			reached = i + 1;
		}
		const seen = (p) => p.evaluate(() => Object.keys(window.__A.peers).length);
		await until(async () => {
			for (const p of pages) if ((await seen(p)) < CLIENTS) return false;
			return true;
		}, 120_000, `every client to see ${CLIENTS} players`);
		const joinMs = Date.now() - wall0;

		// Steady state: everyone walks for 8 s while we sample the server's CPU.
		const cpuStart = mpProc ? cpuTicks(mpProc.pid) : null;
		const sampleStart = Date.now();
		await Promise.all(pages.map((p, i) => p.evaluate((i) => {
			let x = 0; const t = setInterval(() => { x = (x + 0.3) % 20; window.__net.sendMove({ x, y: 0, z: i % 7, yaw: 0, motion: 'run' }); }, 70);
			setTimeout(() => clearInterval(t), 8000);
		}, i)));
		await sleep(8500);
		const cpuEnd = mpProc ? cpuTicks(mpProc.pid) : null;
		const cpuPct = cpuStart != null && cpuEnd != null
			? ((cpuEnd - cpuStart) / 100 / ((Date.now() - sampleStart) / 1000)) * 100 : null;

		// Fan-out latency: one client emotes, time until the rest observe it.
		const sender = pages[0];
		const senderId = await sender.evaluate(() => window.__net.sessionId);
		const t = Date.now();
		await sender.evaluate(() => window.__net.sendEmote('wave'));
		await until(async () => {
			for (const p of pages.slice(1)) {
				if ((await p.evaluate((id) => window.__A.peers[id]?.emote, senderId)) !== 'wave') return false;
			}
			return true;
		}, 15_000, 'every peer to see the emote');
		const fanout = Date.now() - t;

		const frame = await pages[1].evaluate(() => new Promise((res) => {
			const ts = []; let n = 0;
			const f = (now) => { ts.push(now); if (++n < 60) requestAnimationFrame(f); else res(ts.slice(1).map((v, i) => v - ts[i])); };
			requestAnimationFrame(f);
		}));
		const avg = frame.reduce((a, b) => a + b, 0) / frame.length;
		const tick = mpProc ? await fetch(`http://127.0.0.1:${new URL(mpUrl.replace('ws', 'http')).port}/health`).then((r) => r.text()).catch(() => '') : '';

		console.log(`      scale: joined ${CLIENTS} in ${joinMs} ms; server CPU ${cpuPct == null ? 'n/a (external server)' : cpuPct.toFixed(0) + '% of one core'} while all ${CLIENTS} moved at ~14 Hz; fan-out to ${CLIENTS - 1} peers ${fanout} ms; client frame ${avg.toFixed(1)} ms avg with ${CLIENTS - 1} peers`);
		if (tick) console.log(`      server /health: ${tick.slice(0, 200)}`);
		return `${CLIENTS} clients, cpu ${cpuPct == null ? 'n/a' : cpuPct.toFixed(0) + '%'}, fanout ${fanout} ms`;
	});
	if (reached < CLIENTS) log(`only ${reached}/${CLIENTS} clients reached the room`);
	for (const c of ctxs) await c.close().catch(() => {});
}

try {
	await main();
} catch (err) {
	record('harness', false, err?.stack || String(err));
}
stopAll();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${SEED_FAULT ? ' (seeded fault was injected)' : ''}`);
if (flag('json')) console.log(JSON.stringify({ results, clients: CLIENTS, seedFault: SEED_FAULT }));
process.exit(failed.length ? 1 : 0);
