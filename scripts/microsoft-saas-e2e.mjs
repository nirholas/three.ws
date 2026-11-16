#!/usr/bin/env node
// End-to-end proof of the Microsoft Marketplace SaaS offer against Microsoft's
// open-source SaaS Fulfillment API emulator
// (github.com/microsoft/Commercial-Marketplace-SaaS-API-Emulator), run before
// the offer is published in Partner Center.
//
//   npm run microsoft:saas-e2e
//   npm run microsoft:saas-e2e -- --emulator-dir /path/to/emulator/checkout
//
// What runs, all on this machine, nothing contacts Microsoft:
//
//   - The emulator, cloned once at a pinned commit into
//     ~/.cache/three-ws/saas-emulator/<sha> and built with its own
//     `npm install && tsc`, then started as a child process. It plays the
//     Fulfillment API v2: resolve, activate, Get Subscription, Get Operation,
//     listAvailablePlans, and it fires real webhooks for ChangePlan,
//     ChangeQuantity, Suspend, Reinstate, Renew and Unsubscribe.
//   - The real three.ws API (server/index.mjs, every api/** handler) on port
//     3126, in this process, with MS_MARKETPLACE_EMULATOR=1 and the endpoint
//     overrides pointing at the emulator and at the harness stub below. Its
//     database is an in-memory PGlite holding the full production schema and
//     every migration (scripts/lib/isolated-db.mjs); DATABASE_URL never points
//     anywhere real and the process env is reduced to an allowlist first.
//   - A harness stub for the three things the emulator does not provide:
//       1. the publisher token endpoint (an RS256 token carrying tid and appid,
//          which is all the emulator reads from it),
//       2. the Entra sign-in the landing page uses (authorize, token, signing
//          keys), signed with a key generated for this run and served only
//          through MS_MARKETPLACE_EMULATOR_LOGIN_BASE, which the API reads only
//          in emulator mode and which is refused in any production runtime,
//       3. the Metering API batchUsageEvent receiver, which enforces
//          Microsoft's documented contract (at most 25 events, the 24 hour
//          window, one event per resource, dimension and hour, per-event
//          statuses) against the emulator's live subscription state.
//     The stub also relays each webhook to the API unchanged and records the
//     verdict the API returned, so every step can assert it.
//
// After every lifecycle step the harness asserts the microsoft_saas_subscriptions
// and microsoft_saas_operations rows, users.plan, the webhook verdict, and the
// emulator's own copy of the operation and subscription. The metering pass
// seeds real usage_events rows, runs the real cron handler over HTTP, and
// checks batching, per-event settlement and idempotency on rerun. Exit 0 when
// every step passes, 1 otherwise.

import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMULATOR_REPO = 'https://github.com/microsoft/Commercial-Marketplace-SaaS-API-Emulator.git';
const EMULATOR_SHA = 'bb7bc6317128605b2f777ebe1c9969198733ae85';
const API_PORT = 3126;
const API = `http://127.0.0.1:${API_PORT}`;
const API_VERSION = '2018-08-31';
const MARKETPLACE_APP_ID = '20e940b3-4c77-4b0b-9a53-9e16a1b010a7';
const HOUR = 3_600_000;
const BATCH_MAX = 25;
const METERING_STATUSES = ['Accepted', 'Expired', 'Duplicate', 'Error', 'ResourceNotFound', 'ResourceNotAuthorized', 'ResourceNotActive', 'InvalidDimension', 'InvalidQuantity', 'BadArgument'];

// Identities for this run. Tenant and object ids are random v4 GUIDs, emails
// use the reserved .example domain.
const PUBLISHER = { tenantId: crypto.randomUUID(), clientId: crypto.randomUUID(), clientSecret: crypto.randomBytes(24).toString('base64url') };
const FOREIGN_PUBLISHER = { tenantId: crypto.randomUUID(), clientId: crypto.randomUUID() };
const SSO = { clientId: crypto.randomUUID(), clientSecret: crypto.randomBytes(24).toString('base64url') };
const PUBLISHER_ID = `${PUBLISHER.tenantId}${PUBLISHER.clientId}`;

function buyer(name, tenantId = crypto.randomUUID()) {
	return { tid: tenantId, oid: crypto.randomUUID(), email: `${name}@${name}.example`, name: `${name[0].toUpperCase()}${name.slice(1)} Buyer` };
}

// ── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
	const out = { emulatorDir: null, verbose: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--emulator-dir') out.emulatorDir = path.resolve(argv[++i] || '');
		else if (argv[i].startsWith('--emulator-dir=')) out.emulatorDir = path.resolve(argv[i].slice('--emulator-dir='.length));
		else if (argv[i] === '--verbose') out.verbose = true;
		else if (argv[i] === '--help' || argv[i] === '-h') {
			console.log('usage: node scripts/microsoft-saas-e2e.mjs [--emulator-dir <checkout>] [--verbose]');
			process.exit(0);
		} else {
			console.error(`unknown argument: ${argv[i]}`);
			process.exit(2);
		}
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));

// ── report ──────────────────────────────────────────────────────────────────

const results = [];
let currentStep = null;

function assert(cond, message) {
	if (!cond) throw new Error(message);
}

function assertEq(actual, expected, label) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

async function step(name, fn) {
	currentStep = { name, checks: 0 };
	const started = Date.now();
	try {
		const detail = await fn();
		results.push({ name, ok: true, ms: Date.now() - started, detail: detail || '' });
		console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
	} catch (err) {
		results.push({ name, ok: false, ms: Date.now() - started, detail: err?.message || String(err) });
		console.log(`  FAIL  ${name}\n        ${err?.stack || err}`);
		throw new StepFailed(name);
	}
}

class StepFailed extends Error {}

function log(...a) {
	if (args.verbose) console.log('        ', ...a);
}

async function waitFor(label, fn, { timeoutMs = 20_000, intervalMs = 100 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		try {
			last = await fn();
			if (last) return last;
		} catch (err) {
			last = err;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`);
}

// ── emulator checkout ───────────────────────────────────────────────────────

function run(cmd, argv, cwd) {
	execFileSync(cmd, argv, { cwd, stdio: args.verbose ? 'inherit' : ['ignore', 'ignore', 'inherit'] });
}

function ensureEmulator() {
	const dir = args.emulatorDir || path.join(os.homedir(), '.cache', 'three-ws', 'saas-emulator', EMULATOR_SHA);
	if (existsSync(path.join(dir, 'dist', 'index.js'))) return dir;
	if (args.emulatorDir && !existsSync(path.join(dir, 'package.json'))) {
		throw new Error(`--emulator-dir ${dir} is not an emulator checkout (no package.json)`);
	}
	if (!existsSync(path.join(dir, 'package.json'))) {
		console.log(`  ..    cloning the SaaS API emulator at ${EMULATOR_SHA.slice(0, 7)} into ${dir}`);
		mkdirSync(path.dirname(dir), { recursive: true });
		run('git', ['clone', '--quiet', EMULATOR_REPO, dir]);
		run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', EMULATOR_SHA], dir);
	}
	console.log('  ..    building the emulator (npm install && tsc)');
	run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir);
	run(path.join(dir, 'node_modules', '.bin', 'tsc'), [], dir);
	if (!existsSync(path.join(dir, 'dist', 'index.js'))) throw new Error(`the emulator build did not produce ${path.join(dir, 'dist', 'index.js')}`);
	return dir;
}

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.unref();
		srv.on('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

function portInUse(port) {
	return new Promise((resolve) => {
		const sock = net.connect(port, '127.0.0.1');
		sock.once('connect', () => { sock.destroy(); resolve(true); });
		sock.once('error', () => resolve(false));
	});
}

// ── environment ─────────────────────────────────────────────────────────────

// Only these survive from the caller's shell. Everything the API reads is set
// explicitly below, so a developer's .env.local secrets or a production
// DATABASE_URL can never reach this run.
const ENV_ALLOW = /^(PATH|HOME|USER|LOGNAME|SHELL|TERM|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|TZ|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|SystemRoot|ComSpec|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA)$/;

function isolateEnv(stubBase, emulatorBase) {
	for (const k of Object.keys(process.env)) if (!ENV_ALLOW.test(k)) delete process.env[k];
	Object.assign(process.env, {
		NODE_ENV: 'development',
		PORT: String(API_PORT),
		PUBLIC_APP_ORIGIN: API,
		DATABASE_URL: 'postgres://isolated.invalid/three',
		JWT_SECRET: crypto.randomBytes(32).toString('base64url'),
		CRON_SECRET: crypto.randomBytes(24).toString('base64url'),
		MS_MARKETPLACE_EMULATOR: '1',
		MS_MARKETPLACE_API_BASE: `${emulatorBase}/api`,
		MS_MARKETPLACE_METERING_BASE: `${stubBase}/metering`,
		MS_MARKETPLACE_TOKEN_URL: `${stubBase}/publisher-token`,
		MS_MARKETPLACE_EMULATOR_LOGIN_BASE: `${stubBase}/login`,
		MS_MARKETPLACE_TENANT_ID: PUBLISHER.tenantId,
		MS_MARKETPLACE_CLIENT_ID: PUBLISHER.clientId,
		MS_MARKETPLACE_CLIENT_SECRET: PUBLISHER.clientSecret,
		MS_ENTRA_SSO_CLIENT_ID: SSO.clientId,
		MS_ENTRA_SSO_CLIENT_SECRET: SSO.clientSecret,
	});
}

// ── harness stub: publisher token, Entra sign-in, Metering API, webhook relay ─

async function startStub(port, jose) {
	const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
	const kid = crypto.randomBytes(8).toString('hex');
	const jwk = { ...(await jose.exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
	const base = `http://127.0.0.1:${port}`;

	const state = {
		emulatorBase: null,
		nextBuyer: null,
		codes: new Map(),
		accepted: new Map(),
		failNext: new Set(),
		meteringBatches: [],
		statusesReturned: new Set(),
		verdicts: new Map(),
		webhookBodies: new Map(),
	};

	const sign = (claims, ttlSec = 3600) =>
		new jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' }).setIssuedAt().setExpirationTime(`${ttlSec}s`).sign(privateKey);

	const publisherBearer = (publisher = PUBLISHER) =>
		sign({ aud: MARKETPLACE_APP_ID, iss: `https://sts.windows.net/${publisher.tenantId}/`, tid: publisher.tenantId, appid: publisher.clientId, oid: crypto.randomUUID() });

	const send = (res, status, body, headers = {}) => {
		const text = typeof body === 'string' ? body : JSON.stringify(body);
		res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers });
		res.end(text);
	};

	const readBody = (req) => new Promise((resolve, reject) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});

	const oauthError = (res, error, description) => send(res, 400, { error, error_description: description });

	async function handle(req, res) {
		const url = new URL(req.url, base);
		const p = url.pathname;

		// 1. Publisher app token (client credentials), as Entra issues it.
		if (req.method === 'POST' && p === '/publisher-token') {
			const form = new URLSearchParams(await readBody(req));
			if (form.get('grant_type') !== 'client_credentials') return oauthError(res, 'unsupported_grant_type', 'expected client_credentials');
			if (form.get('client_id') !== PUBLISHER.clientId || form.get('client_secret') !== PUBLISHER.clientSecret) return send(res, 401, { error: 'invalid_client', error_description: 'unknown client or wrong secret' });
			if (form.get('scope') !== `${MARKETPLACE_APP_ID}/.default`) return oauthError(res, 'invalid_scope', 'the scope must be the Marketplace API resource');
			return send(res, 200, { token_type: 'Bearer', expires_in: 3599, access_token: await publisherBearer() });
		}

		// 2. Entra sign-in for the landing page (OIDC code flow with PKCE).
		if (req.method === 'GET' && p === '/login/organizations/oauth2/v2.0/authorize') {
			const q = url.searchParams;
			const redirectUri = q.get('redirect_uri');
			if (q.get('client_id') !== SSO.clientId) return oauthError(res, 'unauthorized_client', 'unknown client_id');
			if (redirectUri !== `${API}/api/microsoft-marketplace/sso/callback`) return oauthError(res, 'invalid_request', `redirect_uri ${redirectUri} is not registered`);
			if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256') return oauthError(res, 'invalid_request', 'expected response_type=code with an S256 challenge');
			for (const k of ['state', 'nonce', 'code_challenge']) if (!q.get(k)) return oauthError(res, 'invalid_request', `${k} is required`);
			if (!/\bopenid\b/.test(q.get('scope') || '')) return oauthError(res, 'invalid_scope', 'openid is required');
			const who = state.nextBuyer;
			if (!who) return oauthError(res, 'access_denied', 'no buyer is signing in');
			state.nextBuyer = null;
			const code = crypto.randomBytes(24).toString('base64url');
			state.codes.set(code, { who, nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirectUri, loginHint: q.get('login_hint'), expiresAt: Date.now() + 120_000 });
			const back = new URL(redirectUri);
			back.searchParams.set('code', code);
			back.searchParams.set('state', q.get('state'));
			return send(res, 302, '', { location: back.toString() });
		}

		if (req.method === 'POST' && p === '/login/organizations/oauth2/v2.0/token') {
			const form = new URLSearchParams(await readBody(req));
			if (form.get('grant_type') !== 'authorization_code') return oauthError(res, 'unsupported_grant_type', 'expected authorization_code');
			if (form.get('client_id') !== SSO.clientId || form.get('client_secret') !== SSO.clientSecret) return send(res, 401, { error: 'invalid_client', error_description: 'unknown client or wrong secret' });
			const grant = state.codes.get(form.get('code') || '');
			state.codes.delete(form.get('code') || '');
			if (!grant || grant.expiresAt < Date.now()) return oauthError(res, 'invalid_grant', 'the code is unknown, used or expired');
			if (form.get('redirect_uri') !== grant.redirectUri) return oauthError(res, 'invalid_grant', 'redirect_uri differs from the authorize request');
			const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
			if (challenge !== grant.challenge) return oauthError(res, 'invalid_grant', 'the PKCE verifier does not match the challenge');
			const { who } = grant;
			const idToken = await sign({
				iss: `https://login.microsoftonline.com/${who.tid}/v2.0`,
				aud: SSO.clientId,
				tid: who.tid,
				oid: who.oid,
				sub: crypto.createHash('sha256').update(`${who.oid}:${SSO.clientId}`).digest('base64url'),
				nonce: grant.nonce,
				email: who.email,
				preferred_username: who.email,
				name: who.name,
				ver: '2.0',
			}, 600);
			return send(res, 200, { token_type: 'Bearer', scope: 'openid profile email', expires_in: 3599, id_token: idToken, access_token: crypto.randomBytes(16).toString('hex') });
		}

		if (req.method === 'GET' && p === '/login/common/discovery/v2.0/keys') {
			return send(res, 200, { keys: [jwk] });
		}

		// 3. Metering API.
		if (req.method === 'POST' && p === '/metering/batchUsageEvent') {
			if (url.searchParams.get('api-version') !== API_VERSION) return send(res, 400, { code: 'BadArgument', message: `api-version ${API_VERSION} is required` });
			const auth = String(req.headers.authorization || '');
			let claims;
			try {
				({ payload: claims } = await jose.jwtVerify(auth.replace(/^Bearer\s+/i, ''), publicKey, { audience: MARKETPLACE_APP_ID }));
			} catch {
				return send(res, 401, { code: 'Unauthorized', message: 'a valid bearer token for the Marketplace API is required' });
			}
			if (!claims.tid || !claims.appid) return send(res, 401, { code: 'Unauthorized', message: 'the token carries no tid or appid' });
			let body;
			try { body = JSON.parse(await readBody(req)); } catch { body = null; }
			const events = body?.request;
			if (!Array.isArray(events) || events.length === 0) return send(res, 400, { code: 'BadArgument', message: 'the body must be { request: [ ...usage events ] }' });
			if (events.length > BATCH_MAX) return send(res, 400, { code: 'BadArgument', message: `a batch holds at most ${BATCH_MAX} usage events; got ${events.length}` });
			state.meteringBatches.push(events.length);
			const result = [];
			const publishers = await emulatorJson(state.emulatorBase, 'GET', '/api/util/publishers');
			for (const ev of events) result.push(await meterOne(ev, `${claims.tid}${claims.appid}`, publishers));
			for (const r of result) state.statusesReturned.add(r.status);
			return send(res, 200, { count: result.length, result });
		}

		// 4. Webhook relay: forward byte-for-byte to the API, record the verdict.
		if (req.method === 'POST' && p === '/webhook') {
			const raw = await readBody(req);
			let parsed = null;
			try { parsed = JSON.parse(raw); } catch { parsed = null; }
			const upstream = await fetch(`${API}/api/microsoft-marketplace/webhook`, {
				method: 'POST',
				headers: { 'content-type': req.headers['content-type'] || 'application/json', ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) },
				body: raw,
			});
			const text = await upstream.text();
			let json = null;
			try { json = JSON.parse(text); } catch { json = null; }
			if (parsed?.id) {
				state.verdicts.set(parsed.id, { status: upstream.status, json });
				state.webhookBodies.set(parsed.id, raw);
			}
			log(`webhook ${parsed?.action} ${parsed?.id} -> ${upstream.status} ${text.slice(0, 200)}`);
			res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
			return res.end(text);
		}

		return send(res, 404, { error: 'not_found', path: p });
	}

	// Microsoft's documented echo of effectiveStartTime has no offset.
	const echoTime = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, '');

	async function meterOne(ev, publisherId, publishers) {
		const now = Date.now();
		const shape = {
			messageTime: new Date(now).toISOString(),
			resourceId: ev?.resourceId,
			quantity: ev?.quantity,
			dimension: ev?.dimension,
			effectiveStartTime: typeof ev?.effectiveStartTime === 'string' && !Number.isNaN(Date.parse(ev.effectiveStartTime)) ? echoTime(ev.effectiveStartTime) : ev?.effectiveStartTime,
			planId: ev?.planId,
		};
		const fail = (status, code, message) => ({ status, ...shape, error: { code, message } });

		const start = typeof ev?.effectiveStartTime === 'string' ? Date.parse(ev.effectiveStartTime) : NaN;
		if (typeof ev?.resourceId !== 'string' || !ev.resourceId || typeof ev?.dimension !== 'string' || !ev.dimension ||
			typeof ev?.planId !== 'string' || !ev.planId || typeof ev?.quantity !== 'number' || Number.isNaN(start) || start > now + 5 * 60_000) {
			return fail('BadArgument', 'BadArgument', 'One or more arguments are invalid.');
		}
		if (!(ev.quantity > 0) || !Number.isFinite(ev.quantity)) return fail('InvalidQuantity', 'BadArgument', 'The quantity passed is lower or equal to 0.');
		if (start < now - 24 * HOUR) return fail('Expired', 'BadArgument', 'The usage event is older than 24 hours.');

		const owner = Object.entries(publishers || {}).find(([, subs]) => subs && subs[ev.resourceId]);
		if (!owner) return fail('ResourceNotFound', 'NotFound', 'The resource was not found.');
		if (owner[0] !== publisherId) return fail('ResourceNotAuthorized', 'Forbidden', 'You are not authorized to provide usage for this resource.');
		const sub = owner[1][ev.resourceId].subscription;
		if (sub.saasSubscriptionStatus !== 'Subscribed') return fail('ResourceNotActive', 'BadArgument', `The resource is ${sub.saasSubscriptionStatus}.`);

		const offer = await emulatorJson(state.emulatorBase, 'GET', `/api/util/offers/${encodeURIComponent(sub.offerId)}`);
		const plan = offer?.plans?.[ev.planId];
		const declared = (plan?.planComponents?.meteringDimensions || []).filter(Boolean).map((d) => d.id);
		if (!plan || !declared.includes(ev.dimension)) return fail('InvalidDimension', 'BadArgument', `The dimension ${ev.dimension} is not declared on plan ${ev.planId}.`);

		const key = `${ev.resourceId}|${ev.dimension}|${Math.floor(start / HOUR)}`;
		const prior = state.accepted.get(key);
		if (prior) {
			return {
				status: 'Duplicate',
				...shape,
				messageTime: '0001-01-01T00:00:00',
				error: { additionalInfo: { acceptedMessage: { ...prior, status: 'Duplicate' } }, message: 'This usage event already exist.', code: 'Conflict' },
			};
		}
		if (state.failNext.has(ev.resourceId)) {
			state.failNext.delete(ev.resourceId);
			return fail('Error', 'InternalServerError', 'An internal error occurred; retry the event.');
		}
		const accepted = { usageEventId: crypto.randomUUID(), status: 'Accepted', ...shape };
		state.accepted.set(key, accepted);
		return accepted;
	}

	const server = http.createServer((req, res) => {
		handle(req, res).catch((err) => {
			console.error('[stub]', err);
			if (!res.headersSent) send(res, 500, { error: 'stub_error', message: String(err?.message || err) });
		});
	});
	await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
	return { server, state, base, publisherBearer };
}

// ── emulator process and calls ──────────────────────────────────────────────

async function emulatorJson(base, method, p, body, headers = {}) {
	const res = await fetch(`${base}${p}`, {
		method,
		headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`emulator ${method} ${p} answered ${res.status}: ${text.slice(0, 300)}`);
	return text ? JSON.parse(text) : null;
}

function startEmulator(dir, port, webhookUrl, dataDir) {
	const child = spawn(process.execPath, ['./dist/index.js'], {
		cwd: dir,
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			PORT: String(port),
			WEBHOOK_URL: webhookUrl,
			PUBLISHER_TENANT_ID: PUBLISHER.tenantId,
			PUBLISHER_APP_ID: PUBLISHER.clientId,
			FILE_LOC: dataDir,
			SKIP_DATA_LOAD: 'true',
			NO_SAMPLES: 'true',
			OPERATION_TIMEOUT: 'PT1S',
			SUBSCRIPTION_UPDATE_DELAY: 'PT0S',
			WEBHOOK_CALL_DELAY: 'PT0S',
			WEBHOOK_CALL_PATCH_DELAY: 'PT2S',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const tail = [];
	const keep = (buf) => {
		for (const line of buf.toString('utf8').split('\n')) {
			if (!line.trim()) continue;
			tail.push(line);
			if (tail.length > 60) tail.shift();
			log(`[emulator] ${line}`);
		}
	};
	child.stdout.on('data', keep);
	child.stderr.on('data', keep);
	return { child, tail };
}

// ── browser: a cookie jar over fetch with manual redirects ──────────────────

class Browser {
	constructor() { this.jar = new Map(); }
	cookieHeader(url) {
		if (!url.startsWith(API)) return null;
		return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') || null;
	}
	store(url, res) {
		if (!url.startsWith(API)) return;
		for (const line of res.headers.getSetCookie()) {
			const [pair, ...attrs] = line.split(';');
			const eq = pair.indexOf('=');
			const name = pair.slice(0, eq).trim();
			const value = pair.slice(eq + 1).trim();
			const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
			if (!value || (maxAge && Number(maxAge.split('=')[1]) <= 0)) this.jar.delete(name);
			else this.jar.set(name, value);
		}
	}
	async fetch(url, init = {}) {
		const headers = { 'user-agent': 'three-ws-saas-e2e', ...(init.headers || {}) };
		const c = this.cookieHeader(url);
		if (c) headers.cookie = c;
		const res = await fetch(url, { ...init, headers, redirect: 'manual' });
		this.store(url, res);
		return res;
	}
}

function location(res, from) {
	const loc = res.headers.get('location');
	assert(loc, `expected a redirect from ${from}, got ${res.status}`);
	return new URL(loc, from).toString();
}

// ── main ────────────────────────────────────────────────────────────────────

let emulator = null;
let stub = null;
let dataDir = null;

function cleanup() {
	if (emulator?.child && emulator.child.exitCode == null) emulator.child.kill('SIGTERM');
	if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

async function main() {
	console.log('Microsoft Marketplace SaaS offer: end-to-end against the SaaS API emulator\n');
	if (await portInUse(API_PORT)) throw new Error(`port ${API_PORT} is busy; stop whatever listens there and rerun`);

	const emulatorDir = ensureEmulator();
	const emulatorPort = await freePort();
	const stubPort = await freePort();
	const emulatorBase = `http://127.0.0.1:${emulatorPort}`;
	const stubBase = `http://127.0.0.1:${stubPort}`;

	isolateEnv(stubBase, emulatorBase);

	const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
	const db = await useIsolatedDb();
	const { sql } = db;
	const jose = await import('jose');

	let lib;
	let SUB_A;
	const browsers = {};
	const users = {};

	await step('isolated database has the Microsoft SaaS schema', async () => {
		const tables = (await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'microsoft_saas_%' order by 1`).map((r) => r.table_name);
		for (const t of ['microsoft_saas_subscriptions', 'microsoft_saas_operations', 'microsoft_saas_usage_events']) assert(tables.includes(t), `missing table ${t}`);
		const msSkipped = (db.skipped || []).filter((s) => /microsoft/i.test(JSON.stringify(s)));
		assertEq(msSkipped, [], 'skipped Microsoft migrations');
		return `${tables.length} microsoft_saas_* tables, schema ${db.cached ? 'from cache' : 'built fresh'}`;
	});

	stub = await startStub(stubPort, jose);
	stub.state.emulatorBase = emulatorBase;
	dataDir = mkdtempSync(path.join(os.tmpdir(), 'three-ws-saas-emulator-'));

	await step('SaaS API emulator is up with the three-ws offer', async () => {
		emulator = startEmulator(emulatorDir, emulatorPort, `${stubBase}/webhook`, dataDir);
		await waitFor('the emulator to listen', async () => {
			if (emulator.child.exitCode != null) throw new Error(`the emulator exited (${emulator.child.exitCode}):\n${emulator.tail.join('\n')}`);
			const r = await fetch(`${emulatorBase}/api/util/config`).catch(() => null);
			return r?.ok;
		}, { timeoutMs: 30_000, intervalMs: 200 });
		const offer = buildOffer();
		await emulatorJson(emulatorBase, 'POST', '/api/util/offers', offer);
		const stored = await emulatorJson(emulatorBase, 'GET', '/api/util/offers/three-ws');
		assertEq(Object.keys(stored.plans).sort(), Object.keys(offer.plans).sort(), 'emulator offer plans');
		return `emulator ${EMULATOR_SHA.slice(0, 7)} on :${emulatorPort}, plans ${Object.keys(offer.plans).join(', ')}`;
	});

	await step(`three.ws API boots on :${API_PORT} in emulator mode`, async () => {
		await import('../server/index.mjs');
		lib = await import('../api/_lib/microsoft-marketplace.js');
		await waitFor('the API to listen', async () => (await fetch(`${API}/api/microsoft-marketplace/status`).catch(() => null))?.ok);
		const status = await (await fetch(`${API}/api/microsoft-marketplace/status`)).json();
		assertEq(status, { ready: true, sso: true, missing: [] }, 'status');
		const ep = lib.marketplaceEndpoints();
		assertEq([ep.fulfillmentBase, ep.meteringBase, ep.tokenUrl(PUBLISHER.tenantId)], [`${emulatorBase}/api`, `${stubBase}/metering`, `${stubBase}/publisher-token`], 'endpoints');
		return 'status ready, fulfillment -> emulator, metering + token -> stub';
	});

	// ── helpers bound to this run ─────────────────────────────────────────

	const subRow = async (id) => (await sql`select * from microsoft_saas_subscriptions where id = ${id}`)[0] || null;
	const opRow = async (id) => (await sql`select * from microsoft_saas_operations where id = ${id}`)[0] || null;
	const userPlan = async (userId) => (await sql`select plan from users where id = ${userId}`)[0]?.plan;
	const bearer = async () => `Bearer ${await stub.publisherBearer()}`;
	const emuSub = async (id) => emulatorJson(emulatorBase, 'GET', `/api/saas/subscriptions/${id}?api-version=${API_VERSION}`, undefined, { authorization: await bearer() });
	const emuOp = async (subId, opId) => emulatorJson(emulatorBase, 'GET', `/api/saas/subscriptions/${subId}/operations/${opId}?api-version=${API_VERSION}`, undefined, { authorization: await bearer() });

	async function purchase(label, { planId, quantity = undefined, who }) {
		const subId = crypto.randomUUID();
		const browser = new Browser();
		const party = { emailId: who.email, objectId: who.oid, tenantId: who.tid, puid: crypto.randomBytes(8).toString('hex') };
		const token = Buffer.from(JSON.stringify({
			id: subId, offerId: 'three-ws', planId, name: `three.ws ${label}`,
			beneficiary: party, purchaser: party, ...(quantity != null ? { quantity } : {}),
		})).toString('base64');

		let r = await browser.fetch(`${API}/api/microsoft-marketplace/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
		const resolved = await r.json();
		assertEq(r.status, 200, `resolve status (${JSON.stringify(resolved)})`);
		assertEq([resolved.subscription.status, resolved.subscription.plan_id, resolved.plan_known, resolved.subscription.linked], ['PendingFulfillmentStart', planId, true, false], 'resolve body');
		let row = await subRow(subId);
		assertEq([row.saas_status, row.plan_id, row.user_id, row.beneficiary_tenant_id], ['PendingFulfillmentStart', planId, null, who.tid], 'row after resolve');

		stub.state.nextBuyer = who;
		r = await browser.fetch(`${API}/api/microsoft-marketplace/sso/start`);
		const authorize = location(r, `${API}/api/microsoft-marketplace/sso/start`);
		assert(authorize.startsWith(`${stubBase}/login/organizations/oauth2/v2.0/authorize`), `sso/start sent the browser to ${authorize}`);
		assertEq(new URL(authorize).searchParams.get('login_hint'), who.email, 'login_hint');
		r = await browser.fetch(authorize);
		const callback = location(r, authorize);
		assert(callback.startsWith(`${API}/api/microsoft-marketplace/sso/callback?`), `authorize returned to ${callback}`);
		r = await browser.fetch(callback);
		const landed = location(r, callback);
		assertEq(landed, `${API}/microsoft/activate?subscription=${subId}`, 'landing redirect');
		assert(browser.jar.has('__Host-sid'), 'no session cookie after activation');

		row = await subRow(subId);
		assert(row.user_id, 'subscription not linked to a user');
		assertEq([row.saas_status, row.plan_id], ['Subscribed', planId], 'row after activation');
		assert(row.activated_at, 'activated_at not set');
		const identity = (await sql`select provider, subject from user_identities where user_id = ${row.user_id}`)[0];
		assertEq([identity?.provider, identity?.subject], ['microsoft', `${who.tid}:${who.oid}`], 'linked identity');
		assertEq(await userPlan(row.user_id), lib.planForMicrosoftPlan(planId), 'users.plan after activation');
		assertEq((await emuSub(subId)).saasSubscriptionStatus, 'Subscribed', 'emulator status after activation');

		const mine = await (await browser.fetch(`${API}/api/microsoft-marketplace/subscriptions`)).json();
		assert(JSON.stringify(mine).includes(subId), 'the signed-in buyer does not see the subscription');
		browsers[subId] = browser;
		users[subId] = row.user_id;
		return subId;
	}

	async function trigger(subId, action, body) {
		const p = action === 'patch' ? `/api/webhook/subscription/${subId}` : `/api/webhook/subscription/${subId}/${action}`;
		const res = await fetch(`${emulatorBase}${p}`, {
			method: action === 'patch' ? 'PATCH' : 'POST',
			headers: { 'content-type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await res.text();
		assertEq(res.status, 202, `emulator ${action} trigger (${text.slice(0, 200)})`);
		const loc = res.headers.get('operation-location');
		assert(loc, 'the emulator returned no Operation-Location');
		return new URL(loc).pathname.split('/').pop();
	}

	async function settled(opId) {
		return waitFor(`operation ${opId} to settle`, async () => {
			const v = stub.state.verdicts.get(opId);
			const row = await opRow(opId);
			return v && row && row.outcome !== 'received' ? { verdict: v, row } : null;
		});
	}

	async function emuOpFinal(subId, opId, expected) {
		return waitFor(`emulator operation ${opId} to reach ${expected}`, async () => {
			const op = await emuOp(subId, opId);
			return op.status === expected ? op : op.status === 'InProgress' || op.status === 'NotStarted' ? null : Promise.reject(new Error(`emulator operation is ${op.status}, expected ${expected}`));
		});
	}

	async function expectState(subId, { status, planId, quantity, plan }) {
		const row = await subRow(subId);
		assertEq(row.saas_status, status, 'subscription row status');
		if (planId !== undefined) assertEq(row.plan_id, planId, 'subscription row plan');
		if (quantity !== undefined) assertEq(row.quantity, quantity, 'subscription row quantity');
		assertEq(await userPlan(users[subId]), plan, 'users.plan');
		const emu = await waitFor(`emulator subscription to be ${status}`, async () => {
			const s = await emuSub(subId);
			return s.saasSubscriptionStatus === status && (planId === undefined || s.planId === planId) && (quantity === undefined || (s.quantity ?? null) === quantity) ? s : null;
		});
		return emu;
	}

	// ── lifecycle ─────────────────────────────────────────────────────────

	const contoso = buyer('contoso');

	await step('purchase: resolve, Entra sign-in, activation (pro)', async () => {
		SUB_A = await purchase('lifecycle', { planId: 'pro', who: contoso });
		return `subscription ${SUB_A}, users.plan pro`;
	});

	await step('sign-in from another tenant is refused for that purchase', async () => {
		const subId = crypto.randomUUID();
		const browser = new Browser();
		const party = { emailId: contoso.email, objectId: contoso.oid, tenantId: contoso.tid };
		const token = Buffer.from(JSON.stringify({ id: subId, offerId: 'three-ws', planId: 'pro', beneficiary: party, purchaser: party })).toString('base64');
		let r = await browser.fetch(`${API}/api/microsoft-marketplace/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
		assertEq(r.status, 200, 'resolve');
		stub.state.nextBuyer = buyer('intruder');
		r = await browser.fetch(`${API}/api/microsoft-marketplace/sso/start`);
		const authorize = location(r, `${API}/api/microsoft-marketplace/sso/start`);
		r = await browser.fetch(authorize);
		r = await browser.fetch(location(r, authorize));
		assertEq(location(r, `${API}/api/microsoft-marketplace/sso/callback`), `${API}/microsoft/activate?error=tenant_mismatch`, 'callback redirect');
		const row = await subRow(subId);
		assertEq([row.saas_status, row.user_id], ['PendingFulfillmentStart', null], 'row stays unclaimed');
		assertEq((await emuSub(subId)).saasSubscriptionStatus, 'PendingFulfillmentStart', 'emulator not activated');
		return 'tenant_mismatch, not activated';
	});

	await step('ChangePlan pro -> team: accepted with a 200 and no PATCH', async () => {
		const opId = await trigger(SUB_A, 'patch', { planId: 'team' });
		const { verdict, row } = await settled(opId);
		assertEq([verdict.status, verdict.json?.outcome], [200, 'acknowledged_success'], 'webhook verdict');
		assertEq([row.action, row.plan_id, row.outcome], ['ChangePlan', 'team', 'acknowledged_success'], 'operation row');
		const op = await emuOpFinal(SUB_A, opId, 'Succeeded');
		assert(!op.errorMessage, `emulator flagged the operation: ${op.errorMessage}`);
		await expectState(SUB_A, { status: 'Subscribed', planId: 'team', plan: 'team' });
		return `op ${opId.slice(0, 8)} Succeeded, users.plan team`;
	});

	let refusedOp;
	await step('ChangePlan team -> legacy-gold (not sold on three.ws): refused with a 400', async () => {
		refusedOp = await trigger(SUB_A, 'patch', { planId: 'legacy-gold' });
		const { verdict, row } = await settled(refusedOp);
		assertEq([verdict.status, verdict.json?.error], [400, 'unknown_plan'], 'webhook verdict');
		assertEq([row.action, row.plan_id, row.outcome], ['ChangePlan', 'legacy-gold', 'acknowledged_failure'], 'operation row');
		await emuOpFinal(SUB_A, refusedOp, 'Failed');
		await expectState(SUB_A, { status: 'Subscribed', planId: 'team', plan: 'team' });
		return 'emulator operation Failed, plan stays team';
	});

	await step('ChangeQuantity -> 5: accepted, seat count stored, owner holds the first seat', async () => {
		const opId = await trigger(SUB_A, 'patch', { quantity: 5 });
		const { verdict, row } = await settled(opId);
		assertEq([verdict.status, verdict.json?.outcome], [200, 'acknowledged_success'], 'webhook verdict');
		assertEq([row.action, Number(row.quantity), row.outcome], ['ChangeQuantity', 5, 'acknowledged_success'], 'operation row');
		const op = await emuOpFinal(SUB_A, opId, 'Succeeded');
		assert(!op.errorMessage, `emulator flagged the operation: ${op.errorMessage}`);
		await expectState(SUB_A, { status: 'Subscribed', planId: 'team', quantity: 5, plan: 'team' });
		const seats = await sql`select user_id from microsoft_saas_seats where subscription_id = ${SUB_A}`;
		assertEq(seats.map((r) => r.user_id), [users[SUB_A]], 'seat holders');
		return 'quantity 5, owner seat 1/5, emulator Succeeded';
	});

	await step('Suspend: entitlement removed', async () => {
		const opId = await trigger(SUB_A, 'suspend');
		const { verdict, row } = await settled(opId);
		assertEq([verdict.status, verdict.json?.outcome], [200, 'applied'], 'webhook verdict');
		assertEq([row.action, row.outcome], ['Suspend', 'applied'], 'operation row');
		await expectState(SUB_A, { status: 'Suspended', plan: 'free' });
		return 'Suspended, users.plan free';
	});

	await step('Reinstate: entitlement restored', async () => {
		const opId = await trigger(SUB_A, 'reinstate');
		const { verdict, row } = await settled(opId);
		assertEq([verdict.status, verdict.json?.outcome], [200, 'applied'], 'webhook verdict');
		assertEq([row.action, row.outcome], ['Reinstate', 'applied'], 'operation row');
		await expectState(SUB_A, { status: 'Subscribed', planId: 'team', quantity: 5, plan: 'team' });
		return 'Subscribed, users.plan team';
	});

	await step('Renew: subscription refreshed, entitlement kept', async () => {
		const opId = await trigger(SUB_A, 'renew');
		const { verdict, row } = await settled(opId);
		assertEq([verdict.status, verdict.json?.outcome], [200, 'applied'], 'webhook verdict');
		assertEq([row.action, row.outcome], ['Renew', 'applied'], 'operation row');
		await expectState(SUB_A, { status: 'Subscribed', planId: 'team', plan: 'team' });
		return 'Subscribed, users.plan team';
	});

	await step('webhook redelivery is idempotent and keeps its verdict', async () => {
		const replay = (opId) => fetch(`${API}/api/microsoft-marketplace/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: stub.state.webhookBodies.get(opId) });
		let r = await replay(refusedOp);
		assertEq([r.status, (await r.json()).error], [400, 'unknown_plan'], 'refused operation replayed');
		const accepted = [...stub.state.verdicts].find(([, v]) => v.json?.outcome === 'acknowledged_success')[0];
		r = await replay(accepted);
		assertEq([r.status, (await r.json()).duplicate], [200, true], 'accepted operation replayed');
		r = await fetch(`${API}/api/microsoft-marketplace/webhook`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...JSON.parse(stub.state.webhookBodies.get(accepted)), id: crypto.randomUUID() }),
		});
		assertEq(r.status, 400, 'forged operation id (not known to Microsoft)');
		await expectState(SUB_A, { status: 'Subscribed', planId: 'team', plan: 'team' });
		return 'refused stays 400, accepted is a 200 duplicate, a forged id is a 400';
	});

	// ── metering ──────────────────────────────────────────────────────────

	const metering = {};
	const runCron = async (label) => {
		const res = await fetch(`${API}/api/cron/microsoft-metering`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
		const body = await res.json();
		assertEq(res.status, 200, `${label} cron status (${JSON.stringify(body)})`);
		log(label, JSON.stringify(body));
		return body;
	};
	const usageRows = async (subId) => sql`select dimension, effective_start_time, quantity, status, usage_event_id, attempts, message from microsoft_saas_usage_events where subscription_id = ${subId} order by dimension, effective_start_time`;
	const hourAgo = (n) => new Date(Math.floor(Date.now() / HOUR) * HOUR - n * HOUR);

	await step('metering: unauthenticated cron call is refused', async () => {
		const res = await fetch(`${API}/api/cron/microsoft-metering`);
		assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
		return `${res.status}`;
	});

	await step('metering: four more buyers subscribe through the real flow', async () => {
		metering.B = await purchase('metering-pro', { planId: 'pro', who: buyer('fabrikam') });
		metering.C = await purchase('metering-team', { planId: 'team', who: buyer('woodgrove') });
		metering.D = await purchase('metering-enterprise', { planId: 'enterprise', who: buyer('tailspin') });
		metering.E = await purchase('metering-gone', { planId: 'pro', who: buyer('northwind') });
		const pid = encodeURIComponent(PUBLISHER_ID);
		const del = await fetch(`${emulatorBase}/api/util/publishers/${pid}/subscriptions/${metering.E}`, { method: 'DELETE' });
		assert(del.ok, `could not delete subscription E from the emulator (${del.status})`);
		return 'B pro, C team, D enterprise, E pro (then removed from Microsoft)';
	});

	const seeded = {};
	await step('metering: seed real usage_events and backdate activation', async () => {
		const all = [SUB_A, metering.B, metering.C, metering.D, metering.E];
		await sql`update microsoft_saas_subscriptions set activated_at = ${hourAgo(20)}, metered_through = null where id = any(${all}::text[])`;
		const insert = async (subId, kind, hoursBack, n, status = 'ok') => {
			const at = new Date(hourAgo(hoursBack).getTime() + 17 * 60_000);
			for (let i = 0; i < n; i++) {
				await sql`insert into usage_events (user_id, kind, tool, status, created_at) values (${users[subId]}, ${kind}, ${kind === 'tool_call' ? 'forge.generate' : null}, ${status}, ${new Date(at.getTime() + i * 1000)})`;
			}
			if (status === 'ok') {
				const dim = kind === 'tool_call' ? 'mcp_tool_calls' : 'agent_messages';
				const key = `${subId}|${dim}|${hourAgo(hoursBack).toISOString()}`;
				seeded[key] = (seeded[key] || 0) + n;
			}
		};
		// B: 14 hours of tool calls and messages, 28 rows, so the cron posts more than one batch.
		for (let h = 2; h <= 15; h++) {
			await insert(metering.B, 'tool_call', h, (h % 4) + 1);
			await insert(metering.B, 'llm', h, (h % 3) + 1);
		}
		await insert(metering.B, 'tool_call', 3, 2, 'error');
		await insert(metering.C, 'tool_call', 3, 5);
		await insert(metering.D, 'tool_call', 3, 6);
		await insert(metering.D, 'llm', 3, 2);
		await insert(metering.E, 'tool_call', 3, 3);
		// A row a crashed tick left pending 26 hours ago: past Microsoft's window.
		await sql`insert into microsoft_saas_usage_events (subscription_id, plan_id, dimension, effective_start_time, quantity) values (${metering.B}, 'pro', 'mcp_tool_calls', ${hourAgo(26)}, 9)`;
		return `${Object.keys(seeded).length} (subscription, dimension, hour) cells, 2 failed tool calls that must not bill`;
	});

	let run1;
	await step('metering run 1: batches of at most 25, per-event settlement', async () => {
		stub.state.failNext.add(metering.C);
		stub.state.meteringBatches.length = 0;
		run1 = await runCron('run 1');
		assert(stub.state.meteringBatches.length >= 2, `expected more than one batch, got ${JSON.stringify(stub.state.meteringBatches)}`);
		assert(Math.max(...stub.state.meteringBatches) <= BATCH_MAX, `a batch exceeded ${BATCH_MAX}: ${JSON.stringify(stub.state.meteringBatches)}`);

		const b = await usageRows(metering.B);
		const stale = b.find((r) => new Date(r.effective_start_time).getTime() === hourAgo(26).getTime());
		assertEq([stale?.status, stale?.attempts], ['expired', 0], 'the 26 hour old row expires locally without a post');
		const bLive = b.filter((r) => r !== stale);
		assertEq(bLive.length, 28, 'B rows recorded');
		assert(bLive.every((r) => r.status === 'accepted' && r.usage_event_id), `B rows not all accepted with an event id: ${JSON.stringify(bLive.filter((r) => r.status !== 'accepted' || !r.usage_event_id))}`);
		for (const r of bLive) {
			const key = `${metering.B}|${r.dimension}|${new Date(r.effective_start_time).toISOString()}`;
			assertEq(Number(r.quantity), seeded[key], `B quantity ${key}`);
		}
		const c = await usageRows(metering.C);
		assertEq(c.map((r) => [r.dimension, r.status, r.attempts]), [['mcp_tool_calls', 'pending', 1]], 'C stays pending after a transient Error');
		const d = await usageRows(metering.D);
		assertEq(d.map((r) => [r.dimension, r.status]), [['agent_messages', 'rejected'], ['mcp_tool_calls', 'accepted']], 'D settlement');
		assert(/not declared/.test(d[0].message), `D rejection message: ${d[0].message}`);
		const e = await usageRows(metering.E);
		assertEq(e.map((r) => [r.dimension, r.status]), [['mcp_tool_calls', 'rejected']], 'E settlement (resource gone)');
		const a = await usageRows(SUB_A);
		assertEq(a.length, 0, 'A had no usage and records nothing');
		assertEq([run1.recorded, run1.accepted, run1.rejected, run1.retrying, run1.expired], [28 + 1 + 2 + 1, 29, 2, 1, 1], 'run 1 tally');
		return `batches ${JSON.stringify(stub.state.meteringBatches)}, ${run1.accepted} accepted, ${run1.rejected} rejected, ${run1.retrying} retrying, ${run1.expired} expired`;
	});

	await step('metering run 2: suspended subscription records nothing, its pending row stays pending', async () => {
		const opId = await trigger(metering.C, 'suspend');
		await settled(opId);
		await expectState(metering.C, { status: 'Suspended', plan: 'free' });
		const before = Number((await sql`select count(*)::int as n from microsoft_saas_usage_events`)[0].n);
		const run2 = await runCron('run 2');
		const after = Number((await sql`select count(*)::int as n from microsoft_saas_usage_events`)[0].n);
		assertEq(after, before, 'no new rows');
		assertEq(run2.recorded, 0, 'run 2 recorded');
		const c = await usageRows(metering.C);
		assertEq(c.map((r) => [r.status, r.attempts, r.message]), [['pending', 2, 'The resource is Suspended.']], 'C after ResourceNotActive');
		return 'ResourceNotActive keeps the row for retry';
	});

	await step('metering run 3: reinstated subscription settles its pending row', async () => {
		const opId = await trigger(metering.C, 'reinstate');
		await settled(opId);
		await expectState(metering.C, { status: 'Subscribed', plan: 'team' });
		await runCron('run 3');
		const c = await usageRows(metering.C);
		assertEq(c.map((r) => [r.status, Number(r.quantity), Boolean(r.usage_event_id)]), [['accepted', 5, true]], 'C after reinstate');
		return 'C accepted with quantity 5';
	});

	await step('metering run 4: a row Microsoft already accepted settles as Duplicate and keeps the accepted event id', async () => {
		const [victim] = await sql`select id, usage_event_id from microsoft_saas_usage_events where subscription_id = ${metering.B} and status = 'accepted' order by effective_start_time desc limit 1`;
		await sql`update microsoft_saas_usage_events set status = 'pending', usage_event_id = null where id = ${victim.id}`;
		await runCron('run 4');
		const [after] = await sql`select status, usage_event_id, message from microsoft_saas_usage_events where id = ${victim.id}`;
		assert(stub.state.statusesReturned.has('Duplicate'), 'the receiver never answered Duplicate');
		assertEq([after.status, after.usage_event_id], ['accepted', victim.usage_event_id], 'duplicate settlement');
		return `kept ${victim.usage_event_id}`;
	});

	await step('metering run 5: rerun is idempotent (nothing recorded, nothing posted)', async () => {
		const accepted = [...stub.state.accepted.values()].reduce((sum, a) => sum + a.quantity, 0);
		const batches = stub.state.meteringBatches.length;
		const run5 = await runCron('run 5');
		assertEq([run5.recorded, run5.posted], [0, 0], 'run 5 recorded/posted');
		assertEq(stub.state.meteringBatches.length, batches, 'no batch sent');
		const billed = [...stub.state.accepted.values()].reduce((sum, a) => sum + a.quantity, 0);
		assertEq(billed, accepted, 'Microsoft-side accepted quantity unchanged');
		const expected = Object.entries(seeded).filter(([k]) => !k.startsWith(metering.E) && !(k.startsWith(metering.D) && k.includes('agent_messages'))).reduce((s, [, n]) => s + n, 0);
		assertEq(billed, expected, 'accepted quantity equals the billable seeded usage');
		return `${billed} units accepted in total, matching the seeded billable usage`;
	});

	await step('metering contract: InvalidQuantity, BadArgument, Expired, ResourceNotAuthorized, batch limit', async () => {
		const foreignSub = crypto.randomUUID();
		const foreignToken = await stub.publisherBearer(FOREIGN_PUBLISHER);
		await emulatorJson(emulatorBase, 'POST', `/api/saas/subscriptions/resolve?api-version=${API_VERSION}`, undefined, {
			authorization: `Bearer ${foreignToken}`,
			'x-ms-marketplace-token': Buffer.from(JSON.stringify({ id: foreignSub, offerId: 'three-ws', planId: 'pro' })).toString('base64'),
		});
		const hour = hourAgo(1).toISOString();
		const r = await lib.postUsageBatch([
			{ resourceId: metering.B, quantity: 0, dimension: 'mcp_tool_calls', effectiveStartTime: hour, planId: 'pro' },
			{ resourceId: metering.B, quantity: 1, dimension: 'mcp_tool_calls', effectiveStartTime: hour },
			{ resourceId: metering.B, quantity: 1, dimension: 'mcp_tool_calls', effectiveStartTime: hourAgo(25).toISOString(), planId: 'pro' },
			{ resourceId: foreignSub, quantity: 1, dimension: 'mcp_tool_calls', effectiveStartTime: hour, planId: 'pro' },
		]);
		assertEq(r.result.map((x) => x.status), ['InvalidQuantity', 'BadArgument', 'Expired', 'ResourceNotAuthorized'], 'per-event statuses');

		let threw = null;
		try { await lib.postUsageBatch(Array.from({ length: BATCH_MAX + 1 }, () => ({}))); } catch (err) { threw = err; }
		assert(threw && /25/.test(threw.message), 'postUsageBatch accepted 26 events');
		const raw = await fetch(`${stubBase}/metering/batchUsageEvent?api-version=${API_VERSION}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: await bearer() },
			body: JSON.stringify({ request: Array.from({ length: BATCH_MAX + 1 }, () => ({ resourceId: metering.B, quantity: 1, dimension: 'mcp_tool_calls', effectiveStartTime: hour, planId: 'pro' })) }),
		});
		assertEq(raw.status, 400, 'receiver answer to 26 events');

		const missing = METERING_STATUSES.filter((s) => !stub.state.statusesReturned.has(s));
		assertEq(missing, [], 'documented statuses never returned');
		return `all ${METERING_STATUSES.length} documented statuses returned at least once`;
	});

	await step('Unsubscribe: entitlement ends for good', async () => {
		const opId = await trigger(SUB_A, 'unsubscribe');
		const { verdict, row } = await settled(opId);
		assertEq([verdict.status, verdict.json?.outcome], [200, 'applied'], 'webhook verdict');
		assertEq([row.action, row.outcome], ['Unsubscribe', 'applied'], 'operation row');
		await expectState(SUB_A, { status: 'Unsubscribed', plan: 'free' });
		const recorded = await runCron('after unsubscribe');
		assertEq(recorded.recorded, 0, 'an unsubscribed subscription is never metered');
		return 'Unsubscribed, users.plan free';
	});

	await step('every lifecycle operation is on record', async () => {
		const ops = await sql`select action, outcome from microsoft_saas_operations where subscription_id = ${SUB_A} order by received_at`;
		assertEq(ops.map((o) => `${o.action}:${o.outcome}`), [
			'ChangePlan:acknowledged_success', 'ChangePlan:acknowledged_failure', 'ChangeQuantity:acknowledged_success',
			'Suspend:applied', 'Reinstate:applied', 'Renew:applied', 'Unsubscribe:applied',
		], 'operations for the lifecycle subscription');
		return `${ops.length} operations`;
	});
}

function buildOffer() {
	const plans = JSON.parse(readFileSync(path.join(ROOT, 'data', 'plans.json'), 'utf8')).plans;
	const ms = JSON.parse(readFileSync(path.join(ROOT, 'data', 'microsoft-marketplace.json'), 'utf8'));
	const dimensions = (ids) => ms.dimensions.filter((d) => ids.includes(d.id)).map((d) => ({ id: d.id, currency: 'USD', unitOfMeasure: d.unit, displayName: d.display_name }));
	const plan = (planId, displayName, price, dims) => ({
		planId, displayName, description: `three.ws ${displayName}`, isPrivate: false, hasFreeTrials: false, isPricePerSeat: false, isStopSell: false, market: 'US',
		planComponents: {
			recurrentBillingTerms: [{ currency: 'USD', price, termUnit: 'P1M', termDescription: '1 month' }],
			meteringDimensions: dimensions(dims),
		},
	});
	const all = ms.dimensions.map((d) => d.id);
	const out = {};
	for (const [msPlan, threePlan] of Object.entries(ms.plans)) {
		const p = plans.find((x) => x.id === threePlan);
		// Enterprise declares one dimension only: a Partner Center misconfiguration
		// the metering cron must reject (InvalidDimension) and alert on.
		out[msPlan] = plan(msPlan, p.name, p.price_usd ?? p.price, msPlan === 'enterprise' ? ['mcp_tool_calls'] : all);
	}
	// A plan that exists in Partner Center but is not sold on three.ws.
	out['legacy-gold'] = plan('legacy-gold', 'Legacy Gold', 199, all);
	return { offerId: ms.offer_id, displayName: 'three.ws', publisher: 'three.ws', persist: false, builtIn: false, plans: out };
}

main()
	.then(() => finish(0))
	.catch((err) => {
		if (!(err instanceof StepFailed)) {
			console.log(`  FAIL  ${currentStep?.name || 'setup'}\n        ${err?.stack || err}`);
			results.push({ name: currentStep?.name || 'setup', ok: false, detail: err?.message || String(err) });
		}
		if (emulator?.tail?.length && args.verbose) console.log(`\nemulator log tail:\n${emulator.tail.join('\n')}`);
		finish(1);
	});

function finish(code) {
	const passed = results.filter((r) => r.ok).length;
	console.log(`\n${code === 0 ? 'PASS' : 'FAIL'}: ${passed}/${results.length} steps${code === 0 ? '' : ' (rerun with --verbose for webhook and emulator logs)'}`);
	if (stub?.server) stub.server.close();
	cleanup();
	process.exit(code);
}
