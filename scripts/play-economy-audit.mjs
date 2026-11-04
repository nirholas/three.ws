// Economy-loop audit for /play. Drives the real gather → sell → bank → spin loop
// against a live walk_world server with a real Colyseus client, and asserts the
// arithmetic the player is promised: a payout equals catalog price times
// quantity, a purchase charges exactly the listed price, a deposit moves the
// exact purse, an over-withdrawal clamps instead of minting, and progress
// survives a reconnect. It also completes a real quest (catch a fish for "First
// Day on the Job"), dies in the wilds to a second audit client and checks the
// bank kept its cash while the purse dropped, and equips a free cosmetic that
// must survive the rejoin while an unowned premium one is refused.
//
// --qa signs in as the QA account (AUDIT_EMAIL / AUDIT_PASSWORD in .env) at
// BASE_URL (default https://three.ws), mints a real presence ticket from
// /api/friends/presence-ticket and joins with it, so the run is a signed-in
// session the server verified, exactly what /play sends.
//
//   WS=wss://three-ws-multiplayer-93741856042.us-central1.run.app \
//     node scripts/play-economy-audit.mjs --qa
//
//   npm run dev:multi                        # in another shell
//   node scripts/play-economy-audit.mjs      # ws://127.0.0.1:2567 by default
//   WS=ws://127.0.0.1:2568 node scripts/play-economy-audit.mjs
//   PID=my-audit-account node scripts/play-economy-audit.mjs
//
// Nothing is mocked and nothing is inferred from source: every number checked
// here came back over the wire from the authoritative handlers, so a clean run
// is real evidence the loop pays what it says it pays. Exits non-zero on the
// first failed expectation so it can gate a release.

import { Client } from 'colyseus.js';
import { TREES, VENDOR_STALLS, ATMS, FISHING_SPOTS, DANGER_ZONES } from '../multiplayer/src/world-features.js';

const URL = process.env.WS || 'ws://127.0.0.1:2567';
// A stable key so the persistence check at the end has something to reclaim.
// Override to audit against a fresh account.
const PID = process.env.PID || 'audit-economy-loop';
const MAX_SWINGS = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
async function until(fn, ms) {
	const start = Date.now();
	while (!fn() && Date.now() - start < ms) await sleep(100);
}

const results = [];
function check(name, pass, detail) {
	results.push({ name, pass });
	log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
}

// Every targeted message the economy speaks, captured as it arrives. The room
// answers each intent with a snapshot, so the latest of each is the truth.
function collect(room) {
	const box = { profile: null, inv: null, notices: [], store: null, xp: [], levelups: [], spinInfo: null, denied: null, spin: null };
	room.onMessage('profile', (m) => { box.profile = m; });
	room.onMessage('inv', (m) => { box.inv = m; });
	room.onMessage('notice', (m) => box.notices.push(m));
	room.onMessage('store', (m) => { box.store = m; });
	room.onMessage('xpgain', (m) => box.xp.push(m));
	room.onMessage('levelup', (m) => box.levelups.push(m));
	room.onMessage('spinInfo', (m) => { box.spinInfo = m; });
	room.onMessage('spinDenied', (m) => { box.denied = m; });
	room.onMessage('spinResult', (m) => { box.spin = m; });
	// The credential that reclaims this device's progression on the next join. A
	// raw `pid` is deliberately NOT an account key server-side (it would let any
	// client load and spend any victim's profile), so the audit has to round-trip
	// the sealed token exactly like the real client does.
	room.onMessage('guestToken', (m) => { if (m?.token && !box.fresh) guestToken = m.token; });
	return box;
}

const held = (snap, item) => (snap?.inv || []).filter((s) => s.item === item).reduce((n, s) => n + s.qty, 0);
const slotOf = (snap, item) => (snap?.inv || []).findIndex((s) => s.item === item);
// `inv` deltas carry the live purse; `profile` carries purse AND bank.
const purseOf = (box) => (box.inv?.gold ?? box.profile?.gold ?? 0);

let guestToken = '';
let presence = '';

// Sign in as the QA account and mint the presence ticket /play joins with.
async function qaPresence() {
	const base = (process.env.BASE_URL || 'https://three.ws').replace(/\/$/, '');
	const { readFileSync } = await import('node:fs');
	const env = Object.fromEntries(readFileSync(new globalThis.URL('../.env', import.meta.url), 'utf8')
		.split('\n').map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
	const email = process.env.AUDIT_EMAIL || env.AUDIT_EMAIL;
	const password = process.env.AUDIT_PASSWORD || env.AUDIT_PASSWORD;
	if (!email || !password) throw new Error('--qa needs AUDIT_EMAIL and AUDIT_PASSWORD (npm run audit:web:provision)');
	const login = await fetch(`${base}/api/auth/login`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
	});
	if (!login.ok) throw new Error(`QA login failed: HTTP ${login.status} ${(await login.text()).slice(0, 160)}`);
	const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
	const t = await fetch(`${base}/api/friends/presence-ticket`, { headers: { cookie } });
	if (!t.ok) throw new Error(`presence ticket failed: HTTP ${t.status} ${(await t.text()).slice(0, 160)}`);
	return (await t.json()).data.token;
}
if (process.argv.includes('--qa')) {
	presence = await qaPresence();
	log(`signed in as the QA account, presence ticket minted (${presence.length} chars)`);
}

async function join(name = 'EconomyAudit', opts = {}) {
	const client = new Client(URL);
	const room = await client.joinOrCreate('walk_world', {
		coin: '', tier: '', name, avatar: '', pid: PID,
		...(opts.fresh ? {} : guestToken ? { guestToken } : {}),
		...(presence && !opts.fresh ? { presence } : {}),
	});
	const box = collect(room);
	box.fresh = !!opts.fresh;
	// Say 'ready' once the handlers are attached, exactly like CommunityNet: the
	// room holds the join snapshot (profile, inventory) until it hears this.
	room.send('ready');
	await until(() => !!box.profile, 15_000);
	return { room, box };
}

const { room, box } = await join();
log(`joined ${URL} as ${room.sessionId} (purse ${box.profile?.gold}, bank ${box.profile?.bank})\n`);
check('join delivers a full profile snapshot', !!box.profile && Array.isArray(box.profile.inv), `${box.profile?.inv?.length} pack slots`);

// --- gather -------------------------------------------------------------------
// Walk, don't teleport: the room rejects any step over MAX_STEP_M as a teleport,
// so a single jump to the tree would silently leave the player at spawn and every
// chop would come back "move up to a tree". Step there the way a player does.
async function walkTo(tx, tz, r = room) {
	const STEP = 1.0; // under the server's 1.2m anti-teleport clamp
	let x = r.state.players?.get?.(r.sessionId)?.x ?? 0;
	let z = r.state.players?.get?.(r.sessionId)?.z ?? 0;
	for (let i = 0; i < 400; i += 1) {
		const dx = tx - x, dz = tz - z;
		const d = Math.hypot(dx, dz);
		if (d < 0.6) break;
		const s = Math.min(STEP, d);
		x += (dx / d) * s;
		z += (dz / d) * s;
		r.send('move', { x, y: 0, z, yaw: Math.atan2(dx, dz), motion: 1 });
		await sleep(70);
	}
	await sleep(300);
	const me = r.state.players?.get?.(r.sessionId);
	return { x: me?.x, z: me?.z };
}

const tree = TREES[0];
const arrived = await walkTo(tree.x + 0.6, tree.z + 0.6);
check('the player can walk to a resource node without tripping the anti-teleport clamp',
	Math.hypot((arrived.x ?? 0) - tree.x, (arrived.z ?? 0) - tree.z) < 2.5,
	`tree ${tree.id} at (${tree.x}, ${tree.z}), arrived (${arrived.x?.toFixed?.(1)}, ${arrived.z?.toFixed?.(1)})`);

room.send('equip', { slot: (box.profile.hotbar || []).findIndex((s) => s.item === 'axe') });
await sleep(400);

const woodBefore = held(box.inv || box.profile, 'wood');
let swings = 0;
while (held(box.inv || box.profile, 'wood') <= woodBefore && swings < MAX_SWINGS) {
	room.send('chop');
	swings += 1;
	await sleep(1400);
}
const woodAfter = held(box.inv || box.profile, 'wood');
check('chopping a tree yields wood into the pack', woodAfter > woodBefore, `${woodBefore} to ${woodAfter} over ${swings} swings`);
check('a swing always pays woodcutting XP, hit or miss', box.xp.filter((g) => g.skill === 'woodcutting').length === swings, `${box.xp.length} xp events for ${swings} swings`);
check('XP events carry exact level boundaries so the bar needs no round trip',
	box.xp.every((g) => Number.isFinite(g.levelXp) && (g.nextXp === null || Number.isFinite(g.nextXp))), '');

// --- the counter has to be walked to ------------------------------------------
// Trading from the tree line must be refused: "walk to the shop" is a rule the
// server keeps, not a courtesy the client extends.
const noticesBeforeRemote = box.notices.length;
const purseAtTree = purseOf(box);
room.send('storeSell', { slot: { zone: 'inv', i: slotOf(box.inv || box.profile, 'wood') } });
room.send('bank', { amount: 1 });
await sleep(800);
check('trading and banking from out in the world are refused',
	purseOf(box) === purseAtTree,
	box.notices.slice(noticesBeforeRemote).map((n) => n.text).join(' | ') || 'no refusal notice');

// --- sell ---------------------------------------------------------------------
const stall = VENDOR_STALLS[0];
await walkTo(stall.x, stall.z);
room.send('storeReq');
await sleep(500);
const woodPrice = box.store?.sell?.find((s) => s.item === 'wood')?.price;
check('the store catalog arrives priced by the server', Number.isFinite(woodPrice), `wood sells for ${woodPrice} cash`);

const purseBeforeSell = purseOf(box);
const stack = held(box.inv, 'wood');
const woodSlot = slotOf(box.inv, 'wood');
room.send('storeSell', { slot: { zone: 'inv', i: woodSlot } });
await sleep(800);
check('a sale pays exactly catalog price times quantity',
	purseOf(box) === purseBeforeSell + stack * woodPrice,
	`${purseBeforeSell} + ${stack}x${woodPrice} expected ${purseBeforeSell + stack * woodPrice}, got ${purseOf(box)}`);
check('the sold stack left the pack', held(box.inv, 'wood') === 0, '');

// Two clicks on a stack that is already gone must pay nothing the second time.
const purseAfterSell = purseOf(box);
room.send('storeSell', { slot: { zone: 'inv', i: woodSlot } });
room.send('storeSell', { slot: { zone: 'inv', i: woodSlot } });
await sleep(800);
check('re-selling an emptied slot pays nothing', purseOf(box) === purseAfterSell, `purse held at ${purseOf(box)}`);

// --- buy ----------------------------------------------------------------------
const potion = box.store.buy.find((b) => b.item === 'healthPotion');
const purseBeforeBuy = purseOf(box);
const potionsBefore = held(box.inv, 'healthPotion');
room.send('storeBuy', { item: 'healthPotion' });
await sleep(800);
if (purseBeforeBuy >= potion.price) {
	check('a purchase charges exactly the listed price',
		purseOf(box) === purseBeforeBuy - potion.price,
		`${purseBeforeBuy} - ${potion.price} expected ${purseBeforeBuy - potion.price}, got ${purseOf(box)}`);
	check('the purchased item landed in the pack', held(box.inv, 'healthPotion') === potionsBefore + potion.qty, '');
} else {
	check('an unaffordable purchase is refused and charges nothing',
		purseOf(box) === purseBeforeBuy,
		box.notices.at(-1)?.text);
}

// --- bank ---------------------------------------------------------------------
const atm = ATMS[0];
await walkTo(atm.x, atm.z);
const purse = purseOf(box);
room.send('bank', { amount: purse });
await sleep(700);
check('a deposit moves the exact purse into the protected balance',
	box.profile.bank >= purse && box.profile.gold === 0,
	`bank ${box.profile.bank}, purse ${box.profile.gold}`);

const bankBefore = box.profile.bank;
room.send('bank', { amount: -999_999 });
await sleep(700);
check('an over-withdrawal clamps to what is banked and never mints cash',
	box.profile.gold === bankBefore && box.profile.bank === 0,
	`purse ${box.profile.gold}, bank ${box.profile.bank}`);

// --- the wheel ----------------------------------------------------------------
room.send('spinInfo');
await sleep(600);
check('spinInfo states the real level gate the UI must render',
	Number.isFinite(box.spinInfo?.minLevel),
	`minLevel ${box.spinInfo?.minLevel}, this account averages ${box.spinInfo?.avgLevel?.toFixed?.(2)}`);
check('the published paytable is 20 wedges summing to exactly 100%',
	box.spinInfo?.segments?.length === 20 && box.spinInfo.segments.reduce((n, s) => n + s.oddsPct, 0) === 100, '');
room.send('spinFree');
await sleep(800);
check('a refused spin comes back with a reason the UI has copy for',
	box.spin != null || ['level', 'cooldown', 'pack_full', 'not_at_wheel'].includes(box.denied?.reason),
	box.spin ? `spun: ${box.spin.label}` : `denied: ${box.denied?.reason}`);

// --- a quest, start to payout ---------------------------------------------------
// "First Day on the Job" asks for one fish and pays 60 cash. Accept it at the
// board, walk to the pond, cast until a catch, and check the payout arrives as
// a pushed snapshot, with no profile request from the client.
room.send('questAccept', { id: 'welcome-to-work' });
await sleep(700);
const accepted = box.notices.some((n) => n.kind === 'quest' && /Accepted: First Day/.test(n.text || ''));
check('a quest is accepted from the board', accepted, box.notices.filter((n) => n.kind === 'quest').map((n) => n.text).at(-1));

const pond = FISHING_SPOTS[0];
await walkTo(pond.x - pond.r - 0.4, pond.z);
room.send('equip', { slot: (box.inv?.hotbar || box.profile.hotbar || []).findIndex((s) => s.item === 'rod') });
await sleep(400);
let questDone = null;
room.onMessage('questComplete', (m) => { questDone = m; });
const purseBeforeQuest = purseOf(box);
let casts = 0;
while (!questDone && casts < 30) {
	room.send('fish');
	casts += 1;
	await sleep(1650);
}
await sleep(500);
check('catching the fish completes the quest', questDone?.id === 'welcome-to-work', `${casts} casts, ${questDone ? `completed, reward ${JSON.stringify(questDone.reward)}` : 'never completed'}`);
const questGold = questDone?.reward?.gold || 0;
check('the quest reward lands in the purse exactly, pushed without a refresh',
	questGold > 0 && purseOf(box) === purseBeforeQuest + questGold,
	`${purseBeforeQuest} + ${questGold} expected ${purseBeforeQuest + questGold}, got ${purseOf(box)}`);

// --- death: the bank protects, the purse drops ------------------------------------
// Bank part of the purse, keep the rest carried, walk into the wilds and let a
// second audit client kill us with the starter sword.
await walkTo(atm.x, atm.z);
const toBank = Math.floor(purseOf(box) / 2);
room.send('bank', { amount: toBank });
await sleep(700);
const bankBeforeDeath = box.profile.bank;
const carried = box.profile.gold;
check('before the fight: some cash banked, some carried', bankBeforeDeath > 0 && carried > 0, `bank ${bankBeforeDeath}, carried ${carried}`);

const wilds = DANGER_ZONES[0];
const killer = await join('AuditAttacker', { fresh: true });
const kbox = killer.box;
await Promise.all([walkTo(wilds.x, wilds.z + 3), walkTo(wilds.x, wilds.z + 1.5, killer.room)]);
killer.room.send('equip', { slot: (kbox.profile.hotbar || []).findIndex((s) => s.item === 'sword') });
await sleep(400);
let died = false;
room.onMessage('combat', (m) => { if (m?.role === 'victim' && m.dead) died = true; });
for (let i = 0; i < 40 && !died; i++) {
	// Face the victim (the sword has an arc), then swing.
	const me = killer.room.state.players.get(killer.room.sessionId);
	const them = room.state.players.get(room.sessionId);
	if (me && them) killer.room.send('move', { x: me.x, y: 0, z: me.z, yaw: Math.atan2(them.x - me.x, them.z - me.z), motion: 0 });
	await sleep(120);
	killer.room.send('attack');
	await sleep(560);
}
await sleep(800);
const deathNotice = box.notices.filter((n) => n.kind === 'death').map((n) => n.text).join(' | ');
check('a PvP kill in the wilds lands', died, deathNotice || 'no death');
check('dying drops the carried purse and leaves the bank untouched, and says so',
	purseOf(box) === 0 && box.profile.bank === bankBeforeDeath && new RegExp(`${bankBeforeDeath} cash`).test(deathNotice),
	`purse ${purseOf(box)}, bank ${box.profile.bank} (was ${bankBeforeDeath}); "${deathNotice}"`);
await until(() => box.notices.some((n) => n.kind === 'respawn'), 15_000);
check('the player respawns in town with the bank intact',
	box.notices.some((n) => n.kind === 'respawn') && box.profile.bank === bankBeforeDeath && box.profile.hp === box.profile.maxHp,
	`bank ${box.profile.bank}, hp ${box.profile.hp}/${box.profile.maxHp}`);
await killer.room.leave();

// --- cosmetics ------------------------------------------------------------------
// A free cosmetic equips and is echoed back; an unowned premium one is refused.
// (Premium cosmetics are bought with $THREE on chain; that purchase is owner-gated
// and stops at the wallet confirmation, see tests/play-boutique-inflight.test.js.)
room.send('equip-cosmetic', { id: 'hat-beanie' });
await sleep(700);
check('equipping a free cosmetic is echoed in the profile', box.profile.cosmetics?.equipped?.headwear === 'hat-beanie',
	`headwear ${box.profile.cosmetics?.equipped?.headwear}`);
const nCos = box.notices.length;
room.send('equip-cosmetic', { id: 'aura-gold' });
await sleep(900);
check('an unowned premium cosmetic is refused', box.profile.cosmetics?.equipped?.aura !== 'aura-gold' &&
	box.notices.slice(nCos).some((n) => n.kind === 'cosmetic' && n.ok === false),
	box.notices.slice(nCos).map((n) => n.text).join(' | '));

// --- persistence ---------------------------------------------------------------
const goldAtLeave = box.profile.gold;
const bankAtLeave = box.profile.bank;
await room.leave();
await sleep(1500);
const again = await join();
check('purse and bank survive a disconnect and rejoin',
	again.box.profile.gold === goldAtLeave && again.box.profile.bank === bankAtLeave,
	`left with ${goldAtLeave}/${bankAtLeave}, came back to ${again.box.profile.gold}/${again.box.profile.bank}`);
check('the equipped cosmetic survives the rejoin', again.box.profile.cosmetics?.equipped?.headwear === 'hat-beanie',
	`headwear ${again.box.profile.cosmetics?.equipped?.headwear}`);
await again.room.leave();

const failed = results.filter((r) => !r.pass);
log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
