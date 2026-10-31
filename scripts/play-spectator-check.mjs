// Net-level live check of the spectator seat, with no WebGL (works on a loaded
// machine where the full /play page cannot render). Opens two players and one
// spectator through the real CommunityNet client against a running multiplayer
// server and asserts: players never see the spectator, the spectator sees both
// players, /population ignores it, and its sends are dropped.
//
//   BASE=http://127.0.0.1:3203 WS=ws://127.0.0.1:2603 node scripts/play-spectator-check.mjs
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const WS = process.env.WS || 'ws://localhost:2567';
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const results = [];
const check = (name, ok, detail = '') => {
	results.push(ok);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `, ${detail}` : ''}`);
};

const SCRIPT = `
import { CommunityNet } from '/src/game/community-net.js';
const q = new URLSearchParams(location.search);
const net = new CommunityNet({ name: q.get('name'), spectator: q.get('spectator') === '1', url: ${JSON.stringify(WS)},
	coin: { mint: ${JSON.stringify(MINT)}, name: 'three.ws', symbol: 'three', image: '' } });
window.__peers = new Set();
net.on('add', (p, id) => { if (id !== net.sessionId) window.__peers.add(id); });
net.on('remove', (id) => window.__peers.delete(id));
window.__net = net;
net.connect();
`;

const browser = await chromium.launch();
try {
	const open = async (name, spectator) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		const errs = [];
		page.on('pageerror', (e) => errs.push(e.message));
		await page.goto(`${BASE}/404.html?name=${name}${spectator ? '&spectator=1' : ''}`, { waitUntil: 'domcontentloaded' });
		await page.addScriptTag({ type: 'module', content: SCRIPT });
		await page.waitForFunction(() => window.__net?.status === 'online', null, { timeout: 120000 });
		return { ctx, page, errs };
	};
	const a = await open('Ann', false);
	const b = await open('Bo', false);
	const s = await open('Screen', true);
	await s.page.waitForTimeout(3000);
	const peers = (x) => x.page.evaluate(() => window.__peers.size);
	check('players see each other and not the spectator', (await peers(a)) === 1 && (await peers(b)) === 1, `A ${await peers(a)}, B ${await peers(b)}`);
	check('spectator sees both players', (await peers(s)) === 2, `sees ${await peers(s)}`);
	const pop = await (await fetch(WS.replace('ws://', 'http://') + '/population')).json();
	check('population ignores the spectator', pop.players === 2, JSON.stringify(pop));
	const sent = await s.page.evaluate(() => window.__net._send?.('chat', { text: 'x' }));
	check('spectator sends are dropped client side', sent === false, String(sent));
	await s.ctx.close();
	await a.page.waitForTimeout(1500);
	check('spectator leaving changes nothing for players', (await peers(a)) === 1);
	check('no page errors', [...a.errs, ...b.errs, ...s.errs].length === 0, [...a.errs, ...b.errs, ...s.errs].join(' | '));
} finally {
	await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
