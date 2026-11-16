#!/usr/bin/env node
// Live check of Microsoft Marketplace free trials, from purchase to reminder,
// without touching the production database or contacting Microsoft.
//
//   node scripts/microsoft-trial-live-check.mjs [--emulator-dir <built emulator checkout>]
//        [--api-port 3131] [--origin http://localhost:3129]
//
// What it does:
//   1. Starts Microsoft's SaaS Fulfillment API emulator
//      (github.com/microsoft/Commercial-Marketplace-SaaS-API-Emulator, the
//      checkout scripts/microsoft-saas-e2e.mjs pins and builds under
//      ~/.cache/three-ws/saas-emulator/<sha>) with the three.ws offer, where the
//      Pro plan has free trials on and carries its data/plans.json price.
//   2. Starts a local stub for what the emulator lacks: the publisher token and
//      the Entra sign-in the landing page uses.
//   3. Starts the real Cloud Run server (server/index.mjs) on --api-port in
//      emulator mode against a throwaway in-process Postgres
//      (scripts/lib/isolated-db.mjs).
//   4. Buys the Pro plan the way a customer does, with Microsoft marking it a
//      free trial whose term ends in six days: resolve the purchase token, sign
//      in with Microsoft, activate. Prints the trial columns the real resolve,
//      activation and refresh wrote.
//   5. Runs the real reminder cron (GET /api/cron/microsoft-trial-reminders)
//      twice and prints both results and the notification count, which must be
//      exactly one for the seven day milestone.
//   6. Mints a second, unresolved trial purchase token for the landing page,
//      prints the buyer's session cookie, and keeps serving.
//
// Pair it with the Vite dev server for the UI:
//   DEV_API_PROXY=http://localhost:3131 npx vite --port 3129 --strictPort
// then set the printed cookie on localhost and open /microsoft/activate or any
// signed-in page for the banner.

import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const EMULATOR_SHA = 'bb7bc6317128605b2f777ebe1c9969198733ae85';
const API_PORT = Number(flag('--api-port', 3131));
const ORIGIN = flag('--origin', 'http://localhost:3129');
const EMULATOR_DIR = path.resolve(flag('--emulator-dir', path.join(os.homedir(), '.cache', 'three-ws', 'saas-emulator', EMULATOR_SHA)));
const API = `http://localhost:${API_PORT}`;
const MARKETPLACE_APP_ID = '20e940b3-4c77-4b0b-9a53-9e16a1b010a7';
const TRIAL_PLAN = 'pro';
const TRIAL_TERM = 'P6D';

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

// ── stub: publisher token and Entra sign-in ────────────────────────────────

async function startStub(port, jose) {
	const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
	const kid = crypto.randomBytes(8).toString('hex');
	const jwk = { ...(await jose.exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
	const codes = new Map();
	const state = { nextBuyer: null };
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
			codes.set(code, { who: state.nextBuyer, nonce: q.get('nonce'), challenge: q.get('code_challenge') });
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

// ── emulator ────────────────────────────────────────────────────────────────

function buildOffer() {
	const plans = JSON.parse(readFileSync(path.join(ROOT, 'data', 'plans.json'), 'utf8')).plans;
	const ms = JSON.parse(readFileSync(path.join(ROOT, 'data', 'microsoft-marketplace.json'), 'utf8'));
	const out = {};
	for (const [msPlan, threePlan] of Object.entries(ms.plans)) {
		const p = plans.find((x) => x.id === threePlan);
		out[msPlan] = {
			planId: msPlan, displayName: p.name, description: `three.ws ${p.name}`, isPrivate: false, hasFreeTrials: msPlan === TRIAL_PLAN,
			isPricePerSeat: false, isStopSell: false, market: 'US',
			planComponents: { recurrentBillingTerms: [{ currency: 'USD', price: p.price_usd ?? p.price, termUnit: 'P1M', termDescription: '1 month' }], meteringDimensions: [] },
		};
	}
	return { offerId: ms.offer_id, displayName: 'three.ws', publisher: 'three.ws', persist: false, builtIn: false, plans: out };
}

function startEmulator(port, webhookUrl, dataDir) {
	const entry = path.join(EMULATOR_DIR, 'dist', 'index.js');
	if (!existsSync(entry)) fail(`no built emulator at ${entry}; run npm run microsoft:saas-e2e once (it clones and builds it) or pass --emulator-dir`);
	return spawn(process.execPath, [entry], {
		cwd: EMULATOR_DIR,
		env: {
			PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), WEBHOOK_URL: webhookUrl,
			PUBLISHER_TENANT_ID: PUBLISHER.tenantId, PUBLISHER_APP_ID: PUBLISHER.clientId, FILE_LOC: dataDir,
			SKIP_DATA_LOAD: 'true', NO_SAMPLES: 'true', OPERATION_TIMEOUT: 'PT1S', SUBSCRIPTION_UPDATE_DELAY: 'PT0S',
			WEBHOOK_CALL_DELAY: 'PT0S', WEBHOOK_CALL_PATCH_DELAY: 'PT2S',
		},
		stdio: ['ignore', 'ignore', 'inherit'],
	});
}

// ── a browser: cookie jar over fetch, manual redirects ─────────────────────

class Browser {
	constructor() { this.jar = new Map(); }
	async fetch(url, init = {}) {
		const target = url.replace(ORIGIN, API);
		const headers = { 'user-agent': 'microsoft-trial-live-check', ...(init.headers || {}) };
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

function purchaseToken(id, name) {
	const party = { emailId: BUYER.email, objectId: BUYER.oid, tenantId: BUYER.tid, puid: crypto.randomBytes(8).toString('hex') };
	return Buffer.from(JSON.stringify({
		id, offerId: 'three-ws', planId: TRIAL_PLAN, name, beneficiary: party, purchaser: party,
		isFreeTrial: true, term: { termUnit: TRIAL_TERM },
	})).toString('base64');
}

const trialCols = (row) => ({
	saas_status: row.saas_status, is_free_trial: row.is_free_trial,
	trial_started_at: row.trial_started_at, trial_ends_at: row.trial_ends_at,
	trial_converted_at: row.trial_converted_at, trial_cancelled_at: row.trial_cancelled_at,
	plan_price: row.plan_price, plan_currency: row.plan_currency, plan_term_unit: row.plan_term_unit, plan_price_plan_id: row.plan_price_plan_id,
});

// ── main ────────────────────────────────────────────────────────────────────

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
	MS_MARKETPLACE_EMULATOR: '1', MS_MARKETPLACE_API_BASE: `${emulatorBase}/api`,
	MS_MARKETPLACE_TOKEN_URL: `${stubBase}/publisher-token`, MS_MARKETPLACE_EMULATOR_LOGIN_BASE: `${stubBase}/login`,
	MS_MARKETPLACE_TENANT_ID: PUBLISHER.tenantId, MS_MARKETPLACE_CLIENT_ID: PUBLISHER.clientId, MS_MARKETPLACE_CLIENT_SECRET: PUBLISHER.clientSecret,
	MS_ENTRA_SSO_CLIENT_ID: SSO.clientId, MS_ENTRA_SSO_CLIENT_SECRET: SSO.clientSecret,
});

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const { sql } = await useIsolatedDb();
const jose = await import('jose');
const stub = await startStub(stubPort, jose);
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'three-ws-trial-emulator-'));
const emulator = startEmulator(emulatorPort, `${stubBase}/webhook`, dataDir);
const cleanup = () => { if (emulator.exitCode == null) emulator.kill('SIGTERM'); rmSync(dataDir, { recursive: true, force: true }); };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

await waitFor('the emulator', async () => (await fetch(`${emulatorBase}/api/util/config`)).ok);
const offerRes = await fetch(`${emulatorBase}/api/util/offers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildOffer()) });
if (!offerRes.ok) fail(`emulator refused the offer: ${offerRes.status} ${await offerRes.text()}`);

await import('../server/index.mjs');
await waitFor('the API', async () => (await fetch(`${API}/api/microsoft-marketplace/status`)).ok);

// 4. Buy the Pro plan as a free trial through resolve and Microsoft sign-in.
const subId = crypto.randomUUID();
const buyer = new Browser();
let r = await buyer.fetch(`${API}/api/microsoft-marketplace/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: purchaseToken(subId, 'Contoso design studio') }) });
if (r.status !== 200) fail(`resolve answered ${r.status}: ${await r.text()}`);
const resolved = await r.json();
const rs = resolved.subscription || resolved;
say(`resolved purchase ${subId}: is_free_trial ${rs.is_free_trial}, trial_ends_at ${rs.trial_ends_at}, plan_price_label ${JSON.stringify(rs.plan_price_label)}`);
let [row] = await sql`select * from microsoft_saas_subscriptions where id = ${subId}`;
say(`  after resolve: ${JSON.stringify(trialCols(row))}`);

stub.state.nextBuyer = BUYER;
r = await buyer.fetch(`${API}/api/microsoft-marketplace/sso/start`);
let at = buyer.next(r, `${API}/api/microsoft-marketplace/sso/start`);
r = await fetch(at, { redirect: 'manual' });
at = buyer.next(r, at);
r = await buyer.fetch(at);
const landed = buyer.next(r, at);
[row] = await sql`select * from microsoft_saas_subscriptions where id = ${subId}`;
if (!row?.user_id || row.saas_status !== 'Subscribed') fail(`activation did not finish (landed on ${landed}, status ${row?.saas_status})`);
if (!row.is_free_trial || !row.trial_started_at || !row.trial_ends_at) fail(`activation did not record the trial: ${JSON.stringify(trialCols(row))}`);
const [{ plan: buyerPlan }] = await sql`select plan from users where id = ${row.user_id}`;
say(`signed in with Microsoft and activated: landed on ${landed}; plan ${buyerPlan}`, `  after activation: ${JSON.stringify(trialCols(row))}`);
const audits = await sql`select action from audit_log where action like 'microsoft_marketplace:trial_%' order by created_at`.catch((err) => [{ action: `audit_log unreadable: ${err.message}` }]);
say(`  trial audit entries: ${audits.map((a) => a.action).join(', ') || 'none'}`);

// 5. The real reminder cron, twice.
const counts = async () => {
	const [{ n }] = await sql`select count(*)::int as n from user_notifications where user_id = ${row.user_id} and type = 'microsoft_trial_ending'`;
	return n;
};
for (const pass of [1, 2]) {
	r = await fetch(`${API}/api/cron/microsoft-trial-reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
	say(`reminder cron pass ${pass}: ${r.status} ${await r.text()}`, `  microsoft_trial_ending notifications for the buyer: ${await counts()}`);
}
const ledger = await sql`select milestone, notification_id, email_to, email_status, email_error, email_attempts from microsoft_saas_trial_reminders where subscription_id = ${subId}`;
say(`  reminder ledger: ${JSON.stringify(ledger)}`);
if ((await counts()) !== 1 || ledger.length !== 1) fail('expected exactly one notification and one ledger row for the seven day milestone');

// 6. A second purchase, left unresolved, for the landing page.
const pendingToken = purchaseToken(crypto.randomUUID(), 'Fabrikam studio');

say(
	'',
	`API on ${API} (emulator mode, isolated database); pair with: DEV_API_PROXY=${API} npx vite --port ${new URL(ORIGIN).port} --strictPort`,
	`subscription ${subId}`,
	`buyer __Host-sid=${buyer.jar.get('__Host-sid')}`,
	`pending token ${pendingToken}`,
	`emulator ${emulatorBase}, stub ${stubBase}`,
	'READY',
);
