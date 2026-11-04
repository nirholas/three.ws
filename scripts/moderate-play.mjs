// Moderate the live /play worlds: list who is online, mute, kick or ban a player.
//
// Sends a signed POST to the multiplayer server's /internal/moderate webhook
// (HMAC with MULTIPLAYER_SHARED_SECRET, falling back to HOLDER_PASS_SECRET, the
// same chain the server verifies with). Keep byte-compatible with
// verifyModerateSignature in multiplayer/src/presence-token.js. Mirrors
// scripts/announce-play.mjs.
//
//   node scripts/moderate-play.mjs list
//   node scripts/moderate-play.mjs mute rowdy --minutes 15 --reason "spam"
//   node scripts/moderate-play.mjs unmute rowdy
//   node scripts/moderate-play.mjs kick rowdy --reason "harassment"
//   node scripts/moderate-play.mjs ban rowdy --minutes 1440 --reason "abuse"   (omit --minutes for permanent)
//   node scripts/moderate-play.mjs unban --account <wallet>
//   node scripts/moderate-play.mjs mute --session <sessionId>
//   node scripts/moderate-play.mjs --server http://localhost:2567 list
//
// A target is a display name (default positional), --session <id>, --account
// <wallet> or --key <playerKey>. --coin <mint> narrows to one community world.

import crypto from 'node:crypto';
import fs from 'node:fs';

function loadDotEnv(path = '.env') {
	try {
		for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
			const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
			if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	} catch { /* no .env, rely on the environment */ }
}
loadDotEnv();

const DEFAULT_SERVER = 'https://three-ws-multiplayer-93741856042.us-central1.run.app';
const ACTIONS = ['list', 'mute', 'unmute', 'kick', 'ban', 'unban'];

const USAGE = `Usage: node scripts/moderate-play.mjs <${ACTIONS.join('|')}> [name] [--session id] [--account wallet] [--key playerKey] [--minutes n] [--reason text] [--coin mint] [--server url]`;

const args = process.argv.slice(2);
const opts = { server: DEFAULT_SERVER, session: '', account: '', key: '', minutes: 0, reason: '', coin: '' };
const positional = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === '--server') opts.server = args[++i] || opts.server;
	else if (a === '--session') opts.session = args[++i] || '';
	else if (a === '--account') opts.account = args[++i] || '';
	else if (a === '--key') opts.key = args[++i] || '';
	else if (a === '--minutes') opts.minutes = Number(args[++i]) || 0;
	else if (a === '--reason') opts.reason = args[++i] || '';
	else if (a === '--coin') opts.coin = args[++i] || '';
	else positional.push(a);
}

const action = positional.shift();
if (!ACTIONS.includes(action)) {
	console.error(USAGE);
	process.exit(1);
}
const name = positional.join(' ').trim();
if (action !== 'list' && !name && !opts.session && !opts.account && !opts.key) {
	console.error(`${action} needs a target: a name, --session, --account or --key.\n${USAGE}`);
	process.exit(1);
}

const secret = process.env.MULTIPLAYER_SHARED_SECRET || process.env.HOLDER_PASS_SECRET;
if (!secret) {
	console.error('No MULTIPLAYER_SHARED_SECRET or HOLDER_PASS_SECRET in the environment or .env.');
	process.exit(1);
}

const body = {
	action,
	...(name ? { name } : {}),
	...(opts.session ? { sessionId: opts.session } : {}),
	...(opts.account ? { account: opts.account } : {}),
	...(opts.key ? { playerKey: opts.key } : {}),
	...(opts.minutes > 0 ? { minutes: opts.minutes } : {}),
	...(opts.reason ? { reason: opts.reason } : {}),
	...(opts.coin ? { coin: opts.coin } : {}),
};
const ts = Math.floor(Date.now() / 1000);
const payloadHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64url');
const sig = crypto.createHmac('sha256', secret).update(`moderate:${ts}:${payloadHash}`).digest('base64url');

let resp;
try {
	resp = await fetch(`${opts.server.replace(/\/$/, '')}/internal/moderate`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-moderate-timestamp': String(ts),
			'x-moderate-signature': sig,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15000),
	});
} catch (err) {
	console.error(`Could not reach ${opts.server}: ${err.message}`);
	process.exit(1);
}
const result = await resp.json().catch(() => ({}));
if (!resp.ok) {
	console.error(`Moderate failed: HTTP ${resp.status}`, result);
	process.exit(1);
}

if (action === 'list') {
	const players = result.players || [];
	if (players.length === 0) console.log('Nobody is online.');
	for (const p of players) {
		console.log(`${p.muted ? '[muted] ' : ''}${p.name || '(unnamed)'}\t${p.sessionId}\t${p.coin || 'mainland'}\t${p.room}`);
	}
	console.log(`${players.length} player(s) online, ${result.bans ?? 0} active ban(s) on this instance.`);
} else {
	const matched = result.matched || [];
	if (matched.length === 0) {
		console.log(`${action}: nobody online matched${['ban', 'unban', 'unmute'].includes(action) && (opts.account || opts.key) ? ' (applied by identity)' : ''}.`);
	} else {
		for (const m of matched) console.log(`${action}: ${m.name || '(unnamed)'} (${m.sessionId}) in ${m.room}`);
	}
}
