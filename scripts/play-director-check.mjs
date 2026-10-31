// Live check of the venue projector view (/play?director=1).
//
// Opens two real players and one director in isolated browser contexts and asserts
// the contract the event depends on: the director is invisible to both players and
// is not counted, its camera rotates across occupied areas, the overlay reads right
// in the upcoming / live / no-event states, the group-photo cut holds the totem, and
// a dropped network heals under a quiet pill. Screenshots land in OUT.
//
//   BASE=http://127.0.0.1:3203 WS=ws://127.0.0.1:2603 node scripts/play-director-check.mjs
//
// Exit code is 0 only when every check passes.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const WS = process.env.WS || 'ws://localhost:2567';
const OUT = process.env.OUT || '/tmp/director-check';
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const WORLD = `${BASE}/play?coin=${MINT}&name=three.ws&symbol=three`;
mkdirSync(OUT, { recursive: true });

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
	results.push(ok);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `, ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, url, label) {
	const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
	await ctx.addInitScript((ws) => { window.GAME_SERVER_URL = ws; }, WS);
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
	return { ctx, page };
}

async function until(page, fn, { timeout = 240000, arg } = {}) {
	const end = Date.now() + timeout;
	let last;
	while (Date.now() < end) {
		try { last = await page.evaluate(fn, arg); } catch { last = null; }
		if (last) return last;
		await sleep(500);
	}
	return last;
}

const inWorld = () => window.__CC__?.phase === 'world' && window.__CC__?.net?.status === 'online';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
	// Two players.
	const a = await open(browser, WORLD, 'playerA');
	const b = await open(browser, WORLD, 'playerB');
	check('player A joined', !!(await until(a.page, inWorld)));
	check('player B joined', !!(await until(b.page, inWorld)));

	// Spread them so the crowd logic has two distinct places to prefer.
	await a.page.evaluate(() => { const c = window.__CC__; c.localPos.set(25, c.localPos.y, 10); });
	await b.page.evaluate(() => { const c = window.__CC__; c.localPos.set(24, c.localPos.y, 11); });

	// The director, previewing an event that is live.
	const live = new Date(Date.now() - 7 * 60_000).toISOString();
	const d = await open(browser, `${BASE}/play?director=1&meetup=${encodeURIComponent(live)}`, 'director');
	check('director reached the world', !!(await until(d.page, inWorld)));
	await sleep(4000);

	const peers = (page) => page.evaluate(() => window.__CC__.remotes.size);
	check('players see each other and not the director', (await peers(a.page)) === 1 && (await peers(b.page)) === 1,
		`A sees ${await peers(a.page)}, B sees ${await peers(b.page)}`);
	check('director sees both players', (await peers(d.page)) === 2, `sees ${await peers(d.page)}`);

	const pop = await (await fetch(WS.replace('ws://', 'http://') + '/population')).json();
	check('lobby population ignores the director', pop.players === 2, JSON.stringify(pop));

	const dirState = await d.page.evaluate(() => ({
		hud: [...document.body.children].filter((n) => getComputedStyle(n).display !== 'none' && n.id !== 'kx-canvas' && n.id !== 'cc-director' && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName)).map((n) => n.id || n.className || n.tagName),
		rig: window.__CC__.localRig?.visible,
		pill: !document.querySelector('.dir-pill').hidden,
	}));
	check('no player HUD on the director page', dirState.hud.length === 0, dirState.hud.join(','));
	check('director avatar hidden', dirState.rig === false);

	// Shots rotate.
	const seen = new Set();
	const poses = [];
	for (let i = 0; i < 8; i++) {
		const s = await d.page.evaluate(() => { const p = window.__CC__._director.plan; const c = window.__CC__.camera.position; return { id: p?.id, x: c.x, z: c.z }; });
		seen.add(s.id);
		poses.push(s);
		if (i === 2) await d.page.screenshot({ path: `${OUT}/live-1.png` });
		await sleep(1500);
	}
	console.log('shots seen early:', [...seen].join(','));
	// Force fast cuts to prove rotation without waiting minutes.
	const rotated = await d.page.evaluate(async () => {
		const dm = window.__CC__._director;
		const ids = new Set();
		for (let i = 0; i < 14; i++) { dm.plan = null; dm._ensureShot(performance.now()); ids.add(dm.plan.id); }
		return [...ids];
	});
	check('director cuts across several places', rotated.length >= 3, rotated.join(','));
	const crowdBias = await d.page.evaluate(() => {
		const dm = window.__CC__._director;
		let near = 0;
		for (let i = 0; i < 40; i++) {
			dm.plan = null; dm.history = []; dm._ensureShot(performance.now());
			const t = dm.plan.target; if (Math.hypot(t.x - 24.5, t.z - 10.5) < 16) near++;
		}
		return near;
	});
	check('density pulls the camera to where the players are', crowdBias >= 18, `${crowdBias}/40 cuts framed the players`);
	await d.page.screenshot({ path: `${OUT}/live-2.png` });

	const liveText = await d.page.evaluate(() => document.getElementById('cc-director').innerText);
	check('overlay shows LIVE, event name and online count', /LIVE/.test(liveText) && /Meetup #3/.test(liveText) && /2 online/.test(liveText), liveText.replace(/\s+/g, ' ').slice(0, 120));
	check('overlay shows an invite QR', await d.page.evaluate(() => !document.querySelector('.dir-qr-img').hidden && document.querySelector('.dir-qr-img').src.startsWith('data:image')));

	// Upcoming state.
	const up = await open(browser, `${BASE}/play?director=1&meetup=${encodeURIComponent(new Date(Date.now() + 2 * 3600_000 + 14 * 60_000).toISOString())}`, 'director-upcoming');
	await until(up.page, inWorld);
	await sleep(2000);
	const upText = await up.page.evaluate(() => document.getElementById('cc-director').innerText);
	check('upcoming overlay shows a countdown', /STARTS IN/.test(upText) && /2h 1[34]m/.test(upText), upText.replace(/\s+/g, ' ').slice(0, 100));
	await up.page.screenshot({ path: `${OUT}/upcoming.png` });
	await up.ctx.close();

	// No-event state (the shipped file: id null). Intercept the config.
	const none = await open(browser, `${BASE}/play?director=1`, 'director-none');
	await none.page.route('**/event.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: null }) }));
	await none.page.reload({ waitUntil: 'domcontentloaded' });
	await until(none.page, inWorld);
	await sleep(2000);
	const noneText = await none.page.evaluate(() => document.getElementById('cc-director').innerText);
	check('no-event overlay shows world and count only', !/LIVE|STARTS IN/.test(noneText) && /three\.ws/.test(noneText) && /online/.test(noneText), noneText.replace(/\s+/g, ' ').slice(0, 100));
	await none.page.screenshot({ path: `${OUT}/no-event.png` });
	await none.ctx.close();

	// Group photo: 25s before the shutter -> gather, locked on the totem.
	const photoStart = new Date(Date.now() - (58 * 60_000 - 20_000)).toISOString();
	const ph = await open(browser, `${BASE}/play?director=1&meetup=${encodeURIComponent(photoStart)}`, 'director-photo');
	await until(ph.page, inWorld);
	await sleep(3000);
	const photo = await ph.page.evaluate(() => ({ id: window.__CC__._director.plan?.id, locked: window.__CC__._director.plan?.locked }));
	check('group photo cut holds the totem, locked', photo.id === 'photo' && photo.locked === true, JSON.stringify(photo));
	await ph.page.screenshot({ path: `${OUT}/photo-countdown.png` });
	await sleep(16000);
	await ph.page.screenshot({ path: `${OUT}/photo-late.png` });
	await ph.ctx.close();

	// Network drop on the director: quiet pill, no error card, recovers.
	await d.ctx.setOffline(true);
	await d.page.evaluate(() => { try { window.__CC__.net.room.connection.transport.ws.close(); } catch {} });
	await sleep(6000);
	const dropped = await d.page.evaluate(() => ({ pill: !document.querySelector('.dir-pill').hidden, text: document.querySelector('.dir-pill').textContent, phase: window.__CC__.phase, remotes: window.__CC__.remotes.size }));
	check('drop shows a quiet pill over the last frame', dropped.pill && /Reconnecting/.test(dropped.text) && dropped.phase === 'world' && dropped.remotes === 2, JSON.stringify(dropped));
	await d.page.screenshot({ path: `${OUT}/offline.png` });
	await sleep(24000);
	await d.ctx.setOffline(false);
	const back = await until(d.page, () => window.__CC__.net.status === 'online' && document.querySelector('.dir-pill').hidden, { timeout: 90000 });
	check('director reconnects on its own after 30s offline', !!back);
	check('still not counted after reconnecting', (await (await fetch(WS.replace('ws://', 'http://') + '/population')).json()).players === 2);

	// WebGL context loss self-recovery.
	await d.page.evaluate(() => {
		const gl = document.getElementById('kx-canvas').getContext('webgl2') || document.getElementById('kx-canvas').getContext('webgl');
		window.__ctxProbe = Date.now();
		gl.getExtension('WEBGL_lose_context').loseContext();
	});
	const reloaded = await d.page.waitForEvent('load', { timeout: 30000 }).then(() => true).catch(() => false);
	check('lost WebGL context reloads the screen', reloaded);
	check('director is back in the world after the reload', !!(await until(d.page, inWorld)));

	check('no console or page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} finally {
	await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
