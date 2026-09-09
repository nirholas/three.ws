#!/usr/bin/env node
/**
 * Stand up the whole dial-out rig and prove it, in one command.
 *
 * docs/home-relay.md described this rig as a sequence of docker commands with
 * `<id>` and `<token>` left for a human to fill in from output nobody had yet
 * produced. That is a recipe, not a proof: it cannot be re-run after a change,
 * so in practice it was never re-run at all. This script is the same rig, built
 * and torn down by machine, so the relay's central claim can be re-checked as
 * cheaply as a unit test.
 *
 * The claim under test is narrow and worth stating exactly: three.ws can drive
 * a Home Assistant it has no route to, because the house dials out and nothing
 * dials in.
 *
 * The topology, and why each piece sits where it does:
 *
 *   house-net   the house. A real Home Assistant with NO published port, so it
 *               is unreachable from anywhere except this network. It reaches
 *               the outside through host-gateway, which is what a real house's
 *               NAT gives it.
 *   cloud-net   three.ws. Both the relay AND every caller live here. Docker
 *               refuses to route between two user-defined bridges, so nothing
 *               in cloud-net can open a connection to the house. The relay is
 *               deliberately on this side: if it sat on the host, which can
 *               reach both bridges, the rig would prove less than it appears to.
 *
 * The only path between the two is the socket the house opens outbound to the
 * relay's host-published port. Every proof below runs from cloud-net, and each
 * begins by failing to reach the house directly.
 *
 *   node scripts/home-relay-live.mjs            # up, prove, tear down
 *   node scripts/home-relay-live.mjs --keep     # leave the rig running
 *   node scripts/home-relay-live.mjs --down     # tear a kept rig down
 *
 * Needs DATABASE_URL, because pairing is a real row in a real table. It creates
 * a throwaway owner and deletes it, along with its home, on the way out.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opts = parseArgs(process.argv.slice(2));
const NAME = opts.name || 'relay10';

/**
 * Marks every container this script creates, as `<LABEL>=1`. Nothing without it
 * is ever stopped or removed: this machine runs concurrent agents and several of
 * them keep their own Home Assistant containers alive.
 */
const LABEL = 'ws.three.home-relay-live';
const HOUSE = `threews-house-${NAME}`;
const RELAY = `threews-relay-${NAME}`;
const CONFIG_DIR = path.join(ROOT, `.ha-relay-${NAME}`);
const HOUSE_NET = 'house-net';
const CLOUD_NET = 'cloud-net';
const IMAGE = 'ghcr.io/home-assistant/home-assistant:stable';
const NODE_IMAGE = 'node:24-slim';
const OWNER = { name: 'Relay Lane', username: 'threews', password: 'threews-relay-lane' };

const results = [];
let failures = 0;

function step(name, ok, detail) {
	results.push({ name, ok, detail });
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

function log(...args) {
	console.error('[rig]', ...args);
}

async function main() {
	if (opts.down) {
		await teardown();
		console.log('rig down.');
		return;
	}
	if (!process.env.DATABASE_URL) {
		console.error('DATABASE_URL is not set. It lives in .env.local; pairing writes a real row.');
		process.exit(2);
	}

	// One relay, two names. In production HOME_RELAY_URL is a single public
	// address; here the house and the platform each reach the same container by
	// a different route, so the two sides are configured separately and that
	// split is a property of the rig, not of the product.
	const relayHostPort = await freePort();
	const redeemPort = await freePort();
	const houseFacingRelay = `ws://relay.host:${relayHostPort}`;
	const cloudFacingRelay = `ws://${RELAY}:8899`;
	const signingKey = crypto.randomBytes(32).toString('hex');
	const serviceToken = crypto.randomBytes(32).toString('hex');

	let owner = null;
	let redeemServer = null;
	const { sql } = await import('../api/_lib/db.js');

	try {
		await ensureNetworks();
		const houseIp = await startHouse();
		await startRelay({ relayHostPort, signingKey, serviceToken });

		step(
			'cloud-net cannot open a connection to the house',
			!(await cloudNetCanReach(houseIp)),
			`a container on ${CLOUD_NET} fetching http://${houseIp}:8123 from the house on ${HOUSE_NET}`,
		);

		const token = await onboardHouse();
		await installIntegration();

		owner = await createOwner(sql);
		const { home, code } = await mintPairing({ owner, houseFacingRelay, signingKey, serviceToken });
		step(
			'a relayed home is stored with no Home Assistant credential',
			home.access_token_enc === '' && home.token_fingerprint === '' && home.base_url === `relay://${home.relay_id}`,
			`home ${home.id}: transport=${home.transport} relay_id=${home.relay_id} base_url=${home.base_url} access_token_enc=${JSON.stringify(home.access_token_enc)} token_fingerprint=${JSON.stringify(home.token_fingerprint)}`,
		);

		redeemServer = await serveRedeem({ port: redeemPort, houseFacingRelay, signingKey, serviceToken });
		await pairThroughConfigFlow({ token, code, redeemPort });
		await waitForDialIn({ relayHostPort, relayId: home.relay_id, serviceToken });
		step('the house dialled the relay and is online', true, `relay reports ${home.relay_id} connected`);

		await runProof('the unroutable end-to-end proof', [
			'node', 'scripts/home-relay-e2e.mjs',
			'--relay', cloudFacingRelay,
			'--relay-id', home.relay_id,
			'--service-token', serviceToken,
			'--unroutable', `http://${houseIp}:8123`,
		], { HOME_RELAY_SIGNING_KEY: signingKey });

		await runProof('the order 04 gate and the action log, over the relay', [
			'node', 'scripts/home-relay-gate-proof.mjs',
			'--home', home.id,
			'--user', owner.id,
		], {
			DATABASE_URL: process.env.DATABASE_URL,
			HOME_RELAY_URL: cloudFacingRelay,
			HOME_RELAY_SERVICE_TOKEN: serviceToken,
			HOME_RELAY_SIGNING_KEY: signingKey,
			HOME_ENCRYPTION_KEY: process.env.HOME_ENCRYPTION_KEY || '',
			// The gate proof's HTTP section mints a real session cookie and a real
			// CSRF token for the throwaway owner, and both are keyed on this. A
			// relayed home stores no credential, so nothing else in this rig needs
			// it and a per-run value is the right scope: the session it signs dies
			// with the owner this script deletes on the way out.
			JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
		});

		await proveKillAndRecover({ relayHostPort, relayId: home.relay_id, serviceToken });
	} finally {
		if (redeemServer) await new Promise((resolve) => redeemServer.close(resolve));
		if (owner) {
			await sql`delete from users where id = ${owner.id}`;
			log(`deleted the throwaway owner ${owner.id} and its home`);
		}
		if (!opts.keep) await teardown();
		else log(`rig kept up. Tear it down with: node scripts/home-relay-live.mjs --down --name ${NAME}`);
	}

	console.log(`\n${results.length - failures}/${results.length} checks passed.`);
	process.exit(failures ? 1 : 0);
}

// ------------------------------------------------------------------ the rig

async function ensureNetworks() {
	for (const network of [HOUSE_NET, CLOUD_NET]) {
		const existing = await docker(['network', 'ls', '--filter', `name=^${network}$`, '--format', '{{.Name}}']);
		if (existing.trim() !== network) {
			await docker(['network', 'create', network]);
			log(`created network ${network}`);
		}
	}
}

/** The house: a real Home Assistant with nothing published. */
async function startHouse() {
	if (await containerRunning(HOUSE)) {
		log(`house ${HOUSE} already up`);
	} else {
		await removeIfOurs(HOUSE);
		await removeConfigDir();
		fs.mkdirSync(CONFIG_DIR, { recursive: true });
		// demo gives the house lights and a lock to actually drive. Without it
		// the proof has nothing to turn on and reports a pass over an empty room.
		fs.writeFileSync(
			path.join(CONFIG_DIR, 'configuration.yaml'),
			'default_config:\n\ndemo:\n\nlogger:\n  default: info\n  logs:\n    custom_components.three_ws: debug\n',
		);
		await docker([
			'run', '-d', '--name', HOUSE, '--label', `${LABEL}=1`,
			'--network', HOUSE_NET,
			// How the house reaches the outside world, standing in for its NAT.
			'--add-host', 'relay.host:host-gateway',
			'-v', `${CONFIG_DIR}:/config`,
			IMAGE,
		]);
		log(`started the house ${HOUSE} with no published port`);
	}
	const ip = await houseIp();
	await waitForHouse(ip);
	return ip;
}

async function startRelay({ relayHostPort, signingKey, serviceToken }) {
	await removeIfOurs(RELAY);
	await docker([
		'run', '-d', '--name', RELAY, '--label', `${LABEL}=1`,
		'--network', CLOUD_NET,
		// Published so the house can dial in through host-gateway, which is the
		// only direction any connection is ever opened.
		'-p', `${relayHostPort}:8899`,
		'-v', `${ROOT}:/app`, '-w', '/app',
		'-e', 'PORT=8899',
		'-e', `HOME_RELAY_SIGNING_KEY=${signingKey}`,
		'-e', `HOME_RELAY_SERVICE_TOKEN=${serviceToken}`,
		NODE_IMAGE,
		'node', 'services/home-relay/src/index.js',
	]);
	await waitFor(async () => {
		const res = await fetch(`http://127.0.0.1:${relayHostPort}/healthz`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
		return res?.ok === true;
	}, { label: 'the relay to answer /healthz' });
	log(`relay ${RELAY} up on cloud-net, published at 127.0.0.1:${relayHostPort}`);
}

/** The isolation the whole design rests on, measured rather than assumed. */
async function cloudNetCanReach(ip) {
	const out = await docker([
		'run', '--rm', '--network', CLOUD_NET, '--label', `${LABEL}=1`, NODE_IMAGE,
		'node', '-e',
		`fetch('http://${ip}:8123/',{signal:AbortSignal.timeout(8000)}).then(r=>console.log('REACHED '+r.status),e=>console.log('BLOCKED '+e.name))`,
	]);
	log(`cloud-net -> house: ${out.trim()}`);
	return out.includes('REACHED');
}

async function teardown() {
	for (const container of [HOUSE, RELAY]) await removeIfOurs(container);
	await removeConfigDir();
	log('removed the containers and the config directory');
}

/**
 * Home Assistant runs as root inside its container and writes root-owned files
 * into the mounted config directory, so the unprivileged user driving this
 * script cannot delete them. Borrow root from a container to do it, scoped to
 * this rig's own directory by name.
 */
async function removeConfigDir() {
	if (!fs.existsSync(CONFIG_DIR)) return;
	await dockerRaw([
		'run', '--rm', '-v', `${ROOT}:/work`, '-w', '/work', NODE_IMAGE,
		'rm', '-rf', `.ha-relay-${NAME}`,
	]);
	fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
}

// ------------------------------------------------------------- the house API

/**
 * Home Assistant's real onboarding flow, the one the browser performs, then a
 * long-lived token. Driven from the host, which can route to house-net; only
 * the proofs need to run from a network that cannot.
 */
async function onboardHouse() {
	const ip = await houseIp();
	const baseUrl = `http://${ip}:8123`;
	const clientId = `${baseUrl}/`;
	// A fully onboarded instance does not serve /api/onboarding at all, so a 404
	// here is the answer "already done" rather than a failure. The rig reuses a
	// running house between runs, which is exactly when that happens.
	const steps = await json(`${baseUrl}/api/onboarding`, { optional: true });
	const done = steps ? new Set(steps.filter((s) => s.done).map((s) => s.step)) : new Set(['user']);

	let session;
	if (done.has('user')) {
		const flow = await json(`${baseUrl}/auth/login_flow`, {
			method: 'POST',
			body: { client_id: clientId, handler: ['homeassistant', null], redirect_uri: clientId, type: 'authorize' },
		});
		const result = await json(`${baseUrl}/auth/login_flow/${flow.flow_id}`, {
			method: 'POST',
			body: { client_id: clientId, username: OWNER.username, password: OWNER.password },
		});
		session = await exchangeCode(baseUrl, clientId, result.result);
	} else {
		const created = await json(`${baseUrl}/api/onboarding/users`, {
			method: 'POST',
			body: { client_id: clientId, ...OWNER, language: 'en' },
		});
		session = await exchangeCode(baseUrl, clientId, created.auth_code);
		for (const stage of ['core_config', 'analytics']) {
			await json(`${baseUrl}/api/onboarding/${stage}`, {
				method: 'POST',
				token: session.access_token,
				body: stage === 'analytics' ? { preferences: { base: false } } : {},
				optional: true,
			});
		}
		await json(`${baseUrl}/api/onboarding/integration`, {
			method: 'POST',
			token: session.access_token,
			body: { client_id: clientId, redirect_uri: clientId },
			optional: true,
		});
	}
	const token = await mintLongLivedToken(baseUrl, session.access_token);
	log('onboarded the house and minted a long-lived token');
	return token;
}

async function exchangeCode(baseUrl, clientId, code) {
	const res = await fetch(`${baseUrl}/auth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId }),
	});
	if (!res.ok) throw new Error(`token exchange returned ${res.status}: ${await res.text()}`);
	return res.json();
}

/** The long-lived token is a WebSocket command, not a REST call. */
async function mintLongLivedToken(baseUrl, accessToken) {
	const { WebSocket } = await import('ws');
	const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/api/websocket`);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => finish(new Error('timed out minting a long-lived token')), 30_000);
		const finish = (err, value) => {
			clearTimeout(timer);
			try {
				socket.close();
			} catch {
				// Already gone.
			}
			if (err) reject(err);
			else resolve(value);
		};
		socket.on('message', (raw) => {
			const frame = JSON.parse(String(raw));
			if (frame.type === 'auth_required') {
				socket.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
			} else if (frame.type === 'auth_ok') {
				socket.send(JSON.stringify({
					id: 1,
					type: 'auth/long_lived_access_token',
					client_name: `three.ws relay lane ${Date.now()}`,
					lifespan: 30,
				}));
			} else if (frame.id === 1) {
				if (frame.success) finish(null, frame.result);
				else finish(new Error(`long-lived token refused: ${JSON.stringify(frame.error)}`));
			}
		});
		socket.on('error', (err) => finish(err));
	});
}

/** Install the integration the way HACS does: copy it in and restart. */
async function installIntegration() {
	const source = path.join(ROOT, 'home-assistant-integration', 'custom_components', 'three_ws');
	const target = path.join(CONFIG_DIR, 'custom_components', 'three_ws');
	fs.rmSync(target, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.cpSync(source, target, { recursive: true });
	await docker(['restart', HOUSE]);
	await waitForHouse(await houseIp());
	log('installed the integration into the house and restarted it');
}

/**
 * Redeem the code through the integration's real config flow, which is the
 * screen a user fills in. Nothing is written into .storage by hand.
 */
async function pairThroughConfigFlow({ token, code, redeemPort }) {
	const baseUrl = `http://${await houseIp()}:8123`;
	await removeExistingEntries(baseUrl, token);
	const flow = await json(`${baseUrl}/api/config/config_entries/flow`, {
		method: 'POST',
		token,
		body: { handler: 'three_ws', show_advanced_options: false },
	});
	const result = await json(`${baseUrl}/api/config/config_entries/flow/${flow.flow_id}`, {
		method: 'POST',
		token,
		// relay.host is the house's name for the machine outside it, so this is
		// the same outbound-only route the relay socket uses.
		body: { pairing_code: code, platform_url: `http://relay.host:${redeemPort}` },
	});
	step(
		'the house redeemed the pairing code through its own config flow',
		result?.type === 'create_entry',
		result?.type === 'create_entry'
			? `config entry "${result.title}" created inside Home Assistant`
			: `flow returned ${JSON.stringify(result).slice(0, 300)}`,
	);
	if (result?.type !== 'create_entry') throw new Error('pairing failed, so nothing below would mean anything');
}

/**
 * Remove any three.ws config entry the house is already holding, so the run
 * under test is the only pairing in the house. Reusing a running house between
 * runs would otherwise leave a previous install token dialling a relay id that
 * no longer exists, which reads in the logs like a fault in the current run.
 *
 * This is also the uninstall path: removing the entry is what an owner does to
 * revoke from the house's end, and it drops the socket.
 */
async function removeExistingEntries(baseUrl, token) {
	const entries = await json(`${baseUrl}/api/config/config_entries/entry`, { token, optional: true });
	for (const entry of entries || []) {
		if (entry.domain !== 'three_ws') continue;
		await json(`${baseUrl}/api/config/config_entries/entry/${entry.entry_id}`, { method: 'DELETE', token, optional: true });
		log(`removed a previous three.ws config entry (${entry.entry_id})`);
	}
}

// ------------------------------------------------------------ the redeem API

/**
 * Serve the real /api/home/pair/redeem handler, and only that one, on a port
 * the house can reach. This is the production module, imported and called: the
 * point of the rig is that the house talks to our actual pairing code path.
 */
async function serveRedeem({ port, houseFacingRelay, signingKey, serviceToken }) {
	// The install token this endpoint mints must name the relay URL as the HOUSE
	// sees it, which is why the redeem side is configured separately from the
	// platform side above.
	process.env.HOME_RELAY_URL = houseFacingRelay;
	process.env.HOME_RELAY_SIGNING_KEY = signingKey;
	process.env.HOME_RELAY_SERVICE_TOKEN = serviceToken;
	const { default: handler } = await import('../api/home/pair/redeem.js');

	const server = http.createServer((req, res) => {
		handler(req, res).catch((err) => {
			console.error('[redeem]', err);
			if (!res.headersSent) res.writeHead(500).end('{"error":"handler_failed"}');
		});
	});
	await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
	log(`serving the real /api/home/pair/redeem handler on port ${port}`);
	return server;
}

// ------------------------------------------------------------------- pairing

async function createOwner(sql) {
	const [owner] = await sql`
		insert into users (email) values (${`home-relay-live-${Date.now()}@qa.three.ws`}) returning id`;
	log(`created the throwaway owner ${owner.id}`);
	return owner;
}

async function mintPairing({ owner, houseFacingRelay, signingKey, serviceToken }) {
	process.env.HOME_RELAY_URL = houseFacingRelay;
	process.env.HOME_RELAY_SIGNING_KEY = signingKey;
	process.env.HOME_RELAY_SERVICE_TOKEN = serviceToken;
	const relay = await import('../api/_lib/home/relay.js');
	const { sql } = await import('../api/_lib/db.js');
	const { home, code } = await relay.startPairing({ userId: owner.id, label: 'Unroutable house' });
	const [row] = await sql`
		select id, transport, relay_id, base_url, access_token_enc, token_fingerprint
		from home_connections where id = ${home.id}`;
	log(`minted a pairing code for home ${home.id}`);
	return { home: row, code };
}

async function waitForDialIn({ relayHostPort, relayId, serviceToken }) {
	await waitFor(async () => {
		const res = await fetch(`http://127.0.0.1:${relayHostPort}/v1/status?relay_id=${relayId}`, {
			headers: { authorization: `Bearer ${serviceToken}` },
			signal: AbortSignal.timeout(3000),
		}).catch(() => null);
		if (!res?.ok) return false;
		const body = await res.json().catch(() => null);
		return body?.online === true;
	}, { label: 'the house to dial the relay', timeout: 120_000 });
}

// -------------------------------------------------------------- the proofs

/** Every proof runs from cloud-net, which has no route to the house. */
async function runProof(label, argv, env) {
	console.log(`\n---- ${label} (from ${CLOUD_NET}) ----`);
	const args = ['run', '--rm', '--network', CLOUD_NET, '--label', `${LABEL}=1`, '-v', `${ROOT}:/app`, '-w', '/app'];
	for (const [key, value] of Object.entries(env)) {
		if (value) args.push('-e', `${key}=${value}`);
	}
	args.push(NODE_IMAGE, ...argv);
	const { code, out } = await dockerRaw(args);
	process.stdout.write(out);
	step(label, code === 0, `exit ${code}`);
	console.log(`---- end ${label} ----\n`);
}

/**
 * State 4: the add-on goes away and the home reports it honestly, then comes
 * back on its own. "On its own" is the part that matters, so nothing here
 * touches three.ws between the two halves.
 */
async function proveKillAndRecover({ relayHostPort, relayId, serviceToken }) {
	const status = async () => {
		const res = await fetch(`http://127.0.0.1:${relayHostPort}/v1/status?relay_id=${relayId}`, {
			headers: { authorization: `Bearer ${serviceToken}` },
			signal: AbortSignal.timeout(3000),
		}).catch(() => null);
		return res?.ok ? res.json() : null;
	};

	await docker(['stop', HOUSE]);
	const gone = await waitFor(async () => (await status())?.online === false, {
		label: 'the relay to notice the house is gone',
		timeout: 90_000,
	}).then(() => true, () => false);
	step(
		'killing the integration puts the home in the offline state',
		gone,
		gone ? `relay reports ${relayId} disconnected within the heartbeat window` : 'the relay still reported the house as connected',
	);

	await docker(['start', HOUSE]);
	const back = await waitFor(async () => (await status())?.online === true, {
		label: 'the house to come back on its own',
		timeout: 180_000,
	}).then(() => true, () => false);
	step(
		'restarting it recovers with no action on the three.ws side',
		back,
		back ? `${relayId} reconnected by itself, nothing was re-paired` : 'the house did not reconnect',
	);
}

// -------------------------------------------------------------- small parts

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		if (!argv[i].startsWith('--')) continue;
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith('--')) {
			out[key] = next;
			i += 1;
		} else {
			out[key] = true;
		}
	}
	return out;
}

function docker(args) {
	return dockerRaw(args).then(({ code, out }) => {
		if (code !== 0) throw new Error(`docker ${args.slice(0, 3).join(' ')} failed (${code}): ${out.slice(0, 400)}`);
		return out;
	});
}

function dockerRaw(args) {
	return new Promise((resolve) => {
		const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		child.stdout.on('data', (chunk) => {
			out += chunk;
		});
		child.stderr.on('data', (chunk) => {
			out += chunk;
		});
		child.on('close', (code) => resolve({ code, out }));
	});
}

/** Never stop or remove a container this script did not create. */
async function removeIfOurs(container) {
	const label = await dockerRaw(['inspect', '-f', '{{index .Config.Labels "' + LABEL + '"}}', container]);
	if (label.code !== 0) return;
	if (label.out.trim() !== '1') {
		log(`refusing to touch ${container}: it is not ours`);
		return;
	}
	await dockerRaw(['rm', '-f', container]);
}

async function containerRunning(container) {
	const res = await dockerRaw(['inspect', '-f', '{{.State.Running}}{{index .Config.Labels "' + LABEL + '"}}', container]);
	return res.code === 0 && res.out.trim() === 'true1';
}

async function houseIp() {
	const out = await docker(['inspect', '-f', `{{(index .NetworkSettings.Networks "${HOUSE_NET}").IPAddress}}`, HOUSE]);
	return out.trim();
}

async function waitForHouse(ip) {
	await waitFor(async () => {
		// `/api/` is the probe that works in both phases of this script's life.
		// `/api/onboarding` looks like the obvious choice and is a trap: it answers
		// 200 on a fresh instance and then stops existing once onboarding is done,
		// so a readiness check built on it waits out its whole timeout on the
		// restart AFTER the integration is installed. `/api/` answers 401 without
		// a token whether or not the instance has been onboarded, and a booting
		// instance refuses the connection instead of answering at all.
		const res = await fetch(`http://${ip}:8123/api/`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
		return res ? res.status === 401 || res.status === 200 : false;
	}, { label: 'Home Assistant to boot', timeout: 240_000 });
}

async function waitFor(condition, { timeout = 60_000, interval = 2000, label = 'condition' } = {}) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await condition()) return true;
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
	throw new Error(`timed out waiting for ${label}`);
}

async function json(url, { method: verb = 'GET', body, token, optional = false } = {}) {
	const res = await fetch(url, {
		method: verb,
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) {
		if (optional) return null;
		throw new Error(`${verb} ${url} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
	}
	return res.status === 204 ? null : res.json();
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

await main();
