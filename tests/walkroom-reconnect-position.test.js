// A reconnect must put the player back where the server last had them, not at
// spawn. WalkRoom's anti-teleport clamp refuses any move more than MAX_STEP_M
// (1.2 m) from the authoritative position, so a fresh session spawned at the
// origin can never walk back to the client's real spot: every peer would watch
// the reconnected player frozen at (0,0) for the rest of the session, however
// far they walk. Found by scripts/play-net-audit.mjs (disconnect scenario).
//
// Boots the real multiplayer entry point as a child process and talks to it
// with the real colyseus.js client, the same way scripts/play-reconnect-proof.mjs
// does. No mocks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'colyseus.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOM = 'walk_world';
const COIN = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child;
let server;

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.on('error', reject);
		s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
	});
}

async function join(pid, name, extra = {}) {
	const client = new Client(server);
	const room = await client.joinOrCreate(ROOM, {
		coin: COIN, tier: '', coinName: 'three.ws', coinSymbol: 'three', name, pid, ...extra,
	});
	// The server hands a guest a signed token with the join snapshot, which it
	// sends once the client says 'ready' (as CommunityNet does). Without replaying
	// it the rejoin resolves to a brand-new guest, a different person entirely.
	const token = new Promise((resolve) => {
		room.onMessage('guestToken', (m) => resolve(m?.token || ''));
		setTimeout(() => resolve(''), 20_000);
	});
	room.onMessage('*', () => {});
	await new Promise((resolve) => { room.onStateChange.once(() => resolve()); });
	room.send('ready');
	const guestToken = await token;
	if (!guestToken) throw new Error(`${name} never received a guest token`);
	return { room, guestToken };
}

// Walk in sub-clamp steps at roughly the client's real send rate.
async function walkTo(room, tx, tz) {
	let x = 0; let z = 0;
	while (Math.hypot(tx - x, tz - z) > 0.01) {
		const d = Math.hypot(tx - x, tz - z); const step = Math.min(0.9, d);
		x += ((tx - x) / d) * step; z += ((tz - z) / d) * step;
		room.send('move', { x, y: 0, z, yaw: 0, motion: 'run' });
		await sleep(90);
	}
}

async function until(fn, ms, what) {
	const start = Date.now();
	while (!fn()) {
		if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
		await sleep(50);
	}
}

const posOf = (observer, sessionId) => {
	const p = observer.room.state.players.get(sessionId);
	return p ? { x: p.x, z: p.z } : null;
};
const near = (p, x, z) => !!p && Math.abs(p.x - x) < 0.3 && Math.abs(p.z - z) < 0.3;

beforeAll(async () => {
	const port = await freePort();
	server = `ws://127.0.0.1:${port}`;
	child = spawn(process.execPath, ['multiplayer/src/index.js'], {
		cwd: root,
		env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let out = '';
	child.stdout.on('data', (b) => { out += b; });
	child.stderr.on('data', (b) => { out += b; });
	// A cold boot on a busy machine can take well over a minute.
	const deadline = Date.now() + 240_000;
	while (Date.now() < deadline) {
		if (/listening on ws:/.test(out)) return;
		if (child.exitCode !== null) throw new Error(`server exited: ${out.slice(-500)}`);
		await sleep(250);
	}
	throw new Error(`server never came up: ${out.slice(-500)}`);
}, 250_000);

afterAll(() => { try { child?.kill('SIGKILL'); } catch { /* already gone */ } });

describe('WalkRoom reconnect keeps the player where they were', () => {
	it('restores the last position after the old session already left', async () => {
		const watcher = await join('guest-rpos-watch', 'Watcher');
		const bob = await join('guest-rpos-bob', 'BobPos');
		await walkTo(bob.room, 4, 3);
		const oldId = bob.room.sessionId;
		await until(() => near(posOf(watcher, oldId), 4, 3), 4000, 'watcher to see Bob at (4,3)');

		await bob.room.leave(false);
		await until(() => !watcher.room.state.players.has(oldId), 4000, 'Bob to leave');

		const back = await join('guest-rpos-bob', 'BobPos', { prevSession: oldId, guestToken: bob.guestToken });
		await until(() => watcher.room.state.players.has(back.room.sessionId), 4000, 'Bob to rejoin');
		await sleep(300);
		expect(near(posOf(watcher, back.room.sessionId), 4, 3), JSON.stringify(posOf(watcher, back.room.sessionId))).toBe(true);

		// And the restored spot is a real anchor: the next ordinary step is accepted.
		back.room.send('move', { x: 4.5, y: 0, z: 3, yaw: 0, motion: 'run' });
		await until(() => near(posOf(watcher, back.room.sessionId), 4.5, 3), 3000, 'the post-reconnect step to land');
		await back.room.leave(true);
		await watcher.room.leave(true);
	}, 60_000);

	it('takes the position from a superseded session that is still half-open', async () => {
		const watcher = await join('guest-rpos-watch2', 'Watcher2');
		const amy = await join('guest-rpos-amy', 'AmyPos');
		await walkTo(amy.room, -3, 5);
		const oldId = amy.room.sessionId;
		await until(() => near(posOf(watcher, oldId), -3, 5), 4000, 'watcher to see Amy at (-3,5)');

		// The first socket stays open: the server still holds that session.
		const again = await join('guest-rpos-amy', 'AmyPos', { prevSession: oldId, guestToken: amy.guestToken });
		await until(() => !watcher.room.state.players.has(oldId), 4000, 'the superseded session to be retired');
		expect(near(posOf(watcher, again.room.sessionId), -3, 5), JSON.stringify(posOf(watcher, again.room.sessionId))).toBe(true);
		await again.room.leave(true);
		await watcher.room.leave(true);
	}, 60_000);

	it('a first join, and a prevSession naming a stranger, still spawn at the origin', async () => {
		const watcher = await join('guest-rpos-watch3', 'Watcher3');
		const carl = await join('guest-rpos-carl', 'CarlPos');
		await walkTo(carl.room, 6, 0);
		const carlId = carl.room.sessionId;
		await carl.room.leave(true);
		await until(() => !watcher.room.state.players.has(carlId), 4000, 'Carl to leave');

		const fresh = await join('guest-rpos-dana', 'DanaPos');
		await until(() => watcher.room.state.players.has(fresh.room.sessionId), 4000, 'Dana to join');
		expect(near(posOf(watcher, fresh.room.sessionId), 0, 0)).toBe(true);

		// Naming Carl's session without Carl's identity must not hand over his spot.
		const thief = await join('guest-rpos-eve', 'EvePos', { prevSession: carlId });
		await until(() => watcher.room.state.players.has(thief.room.sessionId), 4000, 'Eve to join');
		expect(near(posOf(watcher, thief.room.sessionId), 0, 0), JSON.stringify(posOf(watcher, thief.room.sessionId))).toBe(true);
		await fresh.room.leave(true);
		await thief.room.leave(true);
		await watcher.room.leave(true);
	}, 60_000);
});
