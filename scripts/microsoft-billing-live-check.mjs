#!/usr/bin/env node
// Live check of the "Billed through Microsoft" section on /dashboard/billing,
// on a subscription bought through the real purchase path, without touching
// the production database or contacting Microsoft.
//
//   node scripts/microsoft-billing-live-check.mjs --emulator-dir <built emulator checkout>
//        [--api-port 3129] [--origin http://localhost:3128]
//
// What it does:
//   1. Reads (SELECT only) the last 23 hours of real usage_events of the
//      production account with the most MCP tool calls and agent messages, from
//      the database DATABASE_URL in .env.local points at. Nothing is written there.
//   2. Starts Microsoft's SaaS Fulfillment API emulator
//      (github.com/microsoft/Commercial-Marketplace-SaaS-API-Emulator, built
//      beforehand; scripts/microsoft-saas-e2e.mjs pins and builds it) with the
//      three.ws offer, where the team plan is priced per seat.
//   3. Starts a local stub for what the emulator lacks: the publisher token, the
//      Entra sign-in the landing page uses, and the Metering API receiver.
//   4. Starts the real Cloud Run server (server/index.mjs) on --api-port in
//      emulator mode against a throwaway in-process Postgres
//      (scripts/lib/isolated-db.mjs).
//   5. Buys the team plan with 3 seats the way a customer does: resolve the
//      purchase token, sign in with Microsoft, activate. Then it creates a team
//      for the buyer with two members, copies the step 1 usage under the buyer,
//      and runs the real metering cron so the usage meters hold Microsoft's
//      verdicts. The activation is moved 23 hours back first so the cron has
//      completed hours to meter (it never meters before activation).
//   6. Prints session cookies for the buyer, a team member, and an account with
//      no Microsoft subscription (the empty state), and keeps serving.
//
// Pair it with the Vite dev server for the UI:
//   DEV_API_PROXY=http://localhost:3129 npx vite --port 3128 --strictPort
// then set a printed cookie on localhost and open /dashboard/billing.

import 'dotenv/config';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';

loadEnv({ path: '.env.local', override: true });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const API_PORT = Number(flag('--api-port', 3129));
const ORIGIN = flag('--origin', 'http://localhost:3128');
const EMULATOR_DIR = flag('--emulator-dir', null);
const API = `http://localhost:${API_PORT}`;
const API_VERSION = '2018-08-31';
const MARKETPLACE_APP_ID = '20e940b3-4c77-4b0b-9a53-9e16a1b010a7';
const HOUR = 3_600_000;

const PUBLISHER = { tenantId: crypto.randomUUID(), clientId: crypto.randomUUID(), clientSecret: crypto.randomBytes(24).toString('base64url') };
const SSO = { clientId: crypto.randomUUID(), clientSecret: crypto.randomBytes(24).toString('base64url') };
const BUYER = { name: 'Avery Lindqvist', email: 'avery.lindqvist@contoso.example', tid: crypto.randomUUID(), oid: crypto.randomUUID() };

const say = (...lines) => process.stdout.write(`${lines.join('\n')}\n`);
const fail = (message) => { throw new Error(message); };

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.on('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

async function waitFor(label, fn, timeoutMs = 30_000) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		if (await fn().catch(() => false)) return;
		await new Promise((r) => setTimeout(r, 200));
	}
	fail(`timed out waiting for ${label}`);
}

// ── 1. real usage, read only ────────────────────────────────────────────────

async function readProductionUsage() {
	if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set in .env.local; it is needed to read real usage rows');
	const prod = neon(process.env.DATABASE_URL);
	const [top] = await prod.query(
		`select user_id from usage_events
		 where user_id is not null and status = 'ok' and kind in ('tool_call', 'llm') and created_at > now() - interval '23 hours'
		 group by user_id order by count(distinct kind) desc, count(*) desc limit 1`,
	);
	if (!top) fail('production has no tool_call or llm usage in the last 23 hours');
	return prod.query(
		`select kind, tool, status, provider, model, input_tokens, output_tokens, created_at
		 from usage_events where user_id = $1 and status = 'ok' and kind in ('tool_call', 'llm')
		 and created_at > now() - interval '23 hours' order by created_at limit 20000`,
		[top.user_id],
	);
}

// ── 3. stub: publisher token, Entra sign-in, Metering API ──────────────────

async function startStub(port, jose) {
	const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
	const kid = crypto.randomBytes(8).toString('hex');
	const jwk = { ...(await jose.exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
	const codes = new Map();
	const state = { nextBuyer: null, metered: 0 };
	const sign = (claims, ttl = 3600) => new jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' }).setIssuedAt().setExpirationTime(`${ttl}s`).sign(privateKey);
	const send = (res, status, body, headers = {}) => {
		res.writeHead(status, { 'content-type': 'application/json', ...headers });
		res.end(typeof body === 'string' ? body : JSON.stringify(body));
	};
	const body = (req) => new Promise((resolve) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
	});

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, `http://127.0.0.1:${port}`);
		const p = url.pathname;
		if (req.method === 'POST' && p === '/publisher-token') {
			const form = new URLSearchParams(await body(req));
			if (form.get('client_id') !== PUBLISHER.clientId || form.get('client_secret') !== PUBLISHER.clientSecret) return send(res, 401, { error: 'invalid_client' });
			const token = await sign({ aud: MARKETPLACE_APP_ID, iss: `https://sts.windows.net/${PUBLISHER.tenantId}/`, tid: PUBLISHER.tenantId, appid: PUBLISHER.clientId, oid: crypto.randomUUID() });
			return send(res, 200, { token_type: 'Bearer', expires_in: 3599, access_token: token });
		}
		if (req.method === 'GET' && p === '/login/organizations/oauth2/v2.0/authorize') {
			const q = url.searchParams;
			if (q.get('client_id') !== SSO.clientId || q.get('code_challenge_method') !== 'S256' || !state.nextBuyer) return send(res, 400, { error: 'invalid_request' });
			const code = crypto.randomBytes(24).toString('base64url');
			codes.set(code, { who: state.nextBuyer, nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') });
			state.nextBuyer = null;
			const back = new URL(q.get('redirect_uri'));
			back.searchParams.set('code', code);
			back.searchParams.set('state', q.get('state'));
			return send(res, 302, '', { location: back.toString() });
		}
		if (req.method === 'POST' && p === '/login/organizations/oauth2/v2.0/token') {
			const form = new URLSearchParams(await body(req));
			const grant = codes.get(form.get('code') || '');
			codes.delete(form.get('code') || '');
			const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
			if (!grant || challenge !== grant.challenge || form.get('client_secret') !== SSO.clientSecret) return send(res, 400, { error: 'invalid_grant' });
			const { who } = grant;
			const idToken = await sign({
				iss: `https://login.microsoftonline.com/${who.tid}/v2.0`, aud: SSO.clientId, tid: who.tid, oid: who.oid,
				sub: crypto.createHash('sha256').update(`${who.oid}:${SSO.clientId}`).digest('base64url'),
				nonce: grant.nonce, email: who.email, preferred_username: who.email, name: who.name, ver: '2.0',
			}, 600);
			return send(res, 200, { token_type: 'Bearer', expires_in: 3599, id_token: idToken, access_token: crypto.randomBytes(16).toString('hex') });
		}
		if (req.method === 'GET' && p === '/login/common/discovery/v2.0/keys') return send(res, 200, { keys: [jwk] });
		if (req.method === 'POST' && p === '/metering/batchUsageEvent') {
			// Accept each event the way Microsoft's Metering API answers a valid one.
			const { request = [] } = JSON.parse((await body(req)) || '{}');
			state.metered += request.length;
			const result = request.map((e) => ({
				usageEventId: crypto.randomUUID(), status: 'Accepted', messageTime: new Date().toISOString(),
				resourceId: e.resourceId, quantity: e.quantity, dimension: e.dimension, effectiveStartTime: e.effectiveStartTime, planId: e.planId,
			}));
			return send(res, 200, { result, count: result.length });
		}
		if (req.method === 'POST' && p === '/webhook') {
			const text = await body(req);
			const r = await fetch(`${API}/api/microsoft-marketplace/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
			return send(res, r.status, await r.text());
		}
		return send(res, 404, { error: 'not_found' });
	});
	await new Promise((r) => server.listen(port, '127.0.0.1', r));
	return { server, state };
}

// ── 2. emulator ─────────────────────────────────────────────────────────────

function buildOffer() {
	const plans = JSON.parse(readFileSync(path.join(ROOT, 'data', 'plans.json'), 'utf8')).plans;
	const ms = JSON.parse(readFileSync(path.join(ROOT, 'data', 'microsoft-marketplace.json'), 'utf8'));
	const dims = ms.dimensions.map((d) => ({ id: d.id, currency: 'USD', unitOfMeasure: d.unit, displayName: d.display_name }));
	const out = {};
	for (const [msPlan, threePlan] of Object.entries(ms.plans)) {
		const p = plans.find((x) => x.id === threePlan);
		out[msPlan] = {
			planId: msPlan, displayName: p.name, description: `three.ws ${p.name}`, isPrivate: false, hasFreeTrials: false,
			isPricePerSeat: threePlan === 'team', isStopSell: false, market: 'US',
			planComponents: { recurrentBillingTerms: [{ currency: 'USD', price: p.price_usd ?? p.price, termUnit: 'P1M', termDescription: '1 month' }], meteringDimensions: dims },
		};
	}
	return { offerId: ms.offer_id, displayName: 'three.ws', publisher: 'three.ws', persist: false, builtIn: false, plans: out };
}

function startEmulator(port, webhookUrl, dataDir) {
	const entry = path.join(EMULATOR_DIR, 'dist', 'index.js');
	if (!existsSync(entry)) fail(`no built emulator at ${entry}; build it with npm install && npx tsc in the checkout`);
	const child = spawn(process.execPath, [entry], {
		cwd: EMULATOR_DIR,
		env: {
			PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), WEBHOOK_URL: webhookUrl,
			PUBLISHER_TENANT_ID: PUBLISHER.tenantId, PUBLISHER_APP_ID: PUBLISHER.clientId, FILE_LOC: dataDir,
			SKIP_DATA_LOAD: 'true', NO_SAMPLES: 'true', OPERATION_TIMEOUT: 'PT1S', SUBSCRIPTION_UPDATE_DELAY: 'PT0S',
			WEBHOOK_CALL_DELAY: 'PT0S', WEBHOOK_CALL_PATCH_DELAY: 'PT2S',
		},
		stdio: ['ignore', 'ignore', 'inherit'],
	});
	return child;
}

// ── a browser: cookie jar over fetch, manual redirects ─────────────────────

class Browser {
	constructor() { this.jar = new Map(); }
	async fetch(url, init = {}) {
		const target = url.replace(ORIGIN, API);
		const headers = { 'user-agent': 'microsoft-billing-live-check', ...(init.headers || {}) };
		if (target.startsWith(API) && this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
		const res = await fetch(target, { ...init, headers, redirect: 'manual' });
		if (target.startsWith(API)) {
			for (const line of res.headers.getSetCookie()) {
				const [pair] = line.split(';');
				const eq = pair.indexOf('=');
				const v = pair.slice(eq + 1).trim();
				if (v) this.jar.set(pair.slice(0, eq).trim(), v); else this.jar.delete(pair.slice(0, eq).trim());
			}
		}
		return res;
	}
	next(res, from) {
		const loc = res.headers.get('location') || fail(`expected a redirect from ${from}, got ${res.status}`);
		return new URL(loc, from).toString();
	}
}

// ── main ────────────────────────────────────────────────────────────────────

if (!EMULATOR_DIR) fail('--emulator-dir is required (a built checkout of the SaaS API emulator)');
const usage = await readProductionUsage();
say(`read ${usage.length} real usage events from production (select only)`);

const ENV_ALLOW = /^(PATH|HOME|USER|LOGNAME|SHELL|TERM|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|TZ|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)$/;
const emulatorPort = await freePort();
const stubPort = await freePort();
const stubBase = `http://127.0.0.1:${stubPort}`;
const emulatorBase = `http://127.0.0.1:${emulatorPort}`;
for (const k of Object.keys(process.env)) if (!ENV_ALLOW.test(k)) delete process.env[k];
const CRON_SECRET = crypto.randomBytes(24).toString('base64url');
Object.assign(process.env, {
	NODE_ENV: 'development', PORT: String(API_PORT), PUBLIC_APP_ORIGIN: ORIGIN, APP_ORIGIN: ORIGIN,
	DATABASE_URL: 'postgres://isolated.invalid/three', JWT_SECRET: crypto.randomBytes(32).toString('base64url'), CRON_SECRET,
	MS_MARKETPLACE_EMULATOR: '1', MS_MARKETPLACE_API_BASE: `${emulatorBase}/api`, MS_MARKETPLACE_METERING_BASE: `${stubBase}/metering`,
	MS_MARKETPLACE_TOKEN_URL: `${stubBase}/publisher-token`, MS_MARKETPLACE_EMULATOR_LOGIN_BASE: `${stubBase}/login`,
	MS_MARKETPLACE_TENANT_ID: PUBLISHER.tenantId, MS_MARKETPLACE_CLIENT_ID: PUBLISHER.clientId, MS_MARKETPLACE_CLIENT_SECRET: PUBLISHER.clientSecret,
	MS_ENTRA_SSO_CLIENT_ID: SSO.clientId, MS_ENTRA_SSO_CLIENT_SECRET: SSO.clientSecret,
});

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const { sql } = await useIsolatedDb();
const jose = await import('jose');
const stub = await startStub(stubPort, jose);
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'three-ws-billing-emulator-'));
const emulator = startEmulator(emulatorPort, `${stubBase}/webhook`, dataDir);
const cleanup = () => { if (emulator.exitCode == null) emulator.kill('SIGTERM'); rmSync(dataDir, { recursive: true, force: true }); };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

await waitFor('the emulator', async () => (await fetch(`${emulatorBase}/api/util/config`)).ok);
const offerRes = await fetch(`${emulatorBase}/api/util/offers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildOffer()) });
if (!offerRes.ok) fail(`emulator refused the offer: ${offerRes.status} ${await offerRes.text()}`);

await import('../server/index.mjs');
await waitFor('the API', async () => (await fetch(`${API}/api/microsoft-marketplace/status`)).ok);

// 5. Buy the team plan, 3 seats, through resolve and Microsoft sign-in.
const subId = crypto.randomUUID();
const party = { emailId: BUYER.email, objectId: BUYER.oid, tenantId: BUYER.tid, puid: crypto.randomBytes(8).toString('hex') };
const token = Buffer.from(JSON.stringify({ id: subId, offerId: 'three-ws', planId: 'team', name: 'Contoso design studio', beneficiary: party, purchaser: party, quantity: 3 })).toString('base64');
const buyer = new Browser();
let r = await buyer.fetch(`${API}/api/microsoft-marketplace/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
if (r.status !== 200) fail(`resolve answered ${r.status}: ${await r.text()}`);
say(`resolved purchase ${subId} through POST /api/microsoft-marketplace/resolve`);
stub.state.nextBuyer = BUYER;
r = await buyer.fetch(`${API}/api/microsoft-marketplace/sso/start`);
let at = buyer.next(r, `${API}/api/microsoft-marketplace/sso/start`);
r = await fetch(at, { redirect: 'manual' });
at = buyer.next(r, at);
r = await buyer.fetch(at);
const landed = buyer.next(r, at);
const [row] = await sql`select * from microsoft_saas_subscriptions where id = ${subId}`;
if (!row?.user_id || row.saas_status !== 'Subscribed') fail(`activation did not finish (landed on ${landed}, status ${row?.saas_status})`);
const ownerId = row.user_id;
const [{ n: ownerSeats }] = await sql`select count(*)::int as n from microsoft_saas_seats where subscription_id = ${subId} and user_id = ${ownerId}`;
const [{ plan: ownerPlan }] = await sql`select plan from users where id = ${ownerId}`;
say(`signed in with Microsoft and activated: landed on ${landed}; owner seat ${ownerSeats ? 'assigned' : 'MISSING'}; owner plan ${ownerPlan}`);

// The buyer's team: two members who can be given seats.
const teamId = crypto.randomUUID();
await sql`insert into teams (id, owner_user_id, name, status) values (${teamId}, ${ownerId}, 'Contoso Design', 'active')`;
const members = [
	{ id: crypto.randomUUID(), email: 'jordan.okafor@contoso.example', name: 'Jordan Okafor' },
	{ id: crypto.randomUUID(), email: 'sam.reyes@contoso.example', name: 'Sam Reyes' },
];
for (const m of members) {
	await sql`insert into users (id, email, display_name) values (${m.id}, ${m.email}, ${m.name})`;
	await sql`insert into team_people (team_id, user_id, source, status, email, display_name) values (${teamId}, ${m.id}, 'tenant_join', 'active', ${m.email}, ${m.name})`;
}

// Real usage under the buyer, metered by the real cron.
for (const e of usage) {
	await sql`insert into usage_events (user_id, kind, tool, status, provider, model, input_tokens, output_tokens, created_at)
		values (${ownerId}, ${e.kind}, ${e.tool}, ${e.status}, ${e.provider}, ${e.model}, ${e.input_tokens}, ${e.output_tokens}, ${e.created_at})`;
}
await sql`update microsoft_saas_subscriptions set activated_at = ${new Date(Date.now() - 23 * HOUR)} where id = ${subId}`;
r = await fetch(`${API}/api/cron/microsoft-metering`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
say(`metering cron: ${r.status} ${await r.text()}`);

// The owner links the team and gives Jordan a seat through the real seats API,
// as the page does; Sam is left without one to assign from the UI.
const { issueCsrf } = await import('../api/_lib/csrf.js');
for (const op of [{ op: 'link_team', team_id: teamId }, { op: 'assign', user_id: members[0].id }]) {
	r = await buyer.fetch(`${API}/api/microsoft-marketplace/seats`, {
		method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': (await issueCsrf(ownerId)).token }, body: JSON.stringify({ subscription_id: subId, ...op }),
	});
	if (!r.ok) fail(`seats ${op.op} answered ${r.status}: ${await r.text()}`);
}
const [{ plan: memberPlan }] = await sql`select plan from users where id = ${members[0].id}`;
const [{ plan: unseatedPlan }] = await sql`select plan from users where id = ${members[1].id}`;
say(`linked team and assigned a seat: ${members[0].name} plan ${memberPlan}, ${members[1].name} (no seat) plan ${unseatedPlan}`);

// An account with no Microsoft subscription, for the empty state.
const emptyId = crypto.randomUUID();
await sql`insert into users (id, email, display_name) values (${emptyId}, 'riley.chen@fabrikam.example', 'Riley Chen')`;
const { createSession } = await import('../api/_lib/auth.js');
const memberCookie = await createSession({ userId: members[0].id, userAgent: 'microsoft-billing-live-check', recordActivity: false });
const emptyCookie = await createSession({ userId: emptyId, userAgent: 'microsoft-billing-live-check', recordActivity: false });

say(
	'',
	`API on ${API} (emulator mode, isolated database); pair with: DEV_API_PROXY=${API} npx vite --port ${new URL(ORIGIN).port} --strictPort`,
	`subscription ${subId}, team ${teamId}`,
	`owner  __Host-sid=${buyer.jar.get('__Host-sid')}`,
	`member __Host-sid=${memberCookie}`,
	`empty  __Host-sid=${emptyCookie}`,
	`emulator ${emulatorBase}, stub ${stubBase}`,
	'READY',
);
