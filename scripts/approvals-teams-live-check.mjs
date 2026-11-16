#!/usr/bin/env node
// Live check of agent approvals in Microsoft Teams, over HTTP against the real
// Cloud Run server (server/index.mjs) on a throwaway database.
//
//   npm run approvals:teams-live-check   (or: node scripts/approvals-teams-live-check.mjs [--port 8147])
//   node scripts/approvals-teams-live-check.mjs --serve [--port 8147] [--cookie-file <path>]
//
// What it proves, through the real route handlers:
//   1. A signed installationUpdate to /api/microsoft-teams/messages stores the
//      owner's 1:1 conversation reference.
//   2. POST /api/approvals/teams { action: "test" } (session + CSRF) creates the
//      labelled no-op request and the approvals fan-out posts a card to the
//      Bot Connector. The card is captured and validated against the Adaptive
//      Cards 1.5 schema.
//   3. The owner pressing Approve (a signed adaptiveCard/action invoke) decides
//      and executes it once; a second press and a replay change nothing.
//   4. Another linked account pressing the same button gets the restricted card,
//      and an altered button runs nothing.
//
// Isolation: the database is in-process PGlite with the production schema
// (scripts/lib/isolated-db.mjs) and DATABASE_URL is pointed at a .invalid host;
// JWT_SECRET is random per run; Redis, email and push credentials are dropped.
// Nothing reaches Microsoft: the only outbound calls intercepted are the bot
// token mint (login.microsoftonline.com), the Bot Framework signing keys
// (login.botframework.com, answered with a key generated here so the script can
// sign activities the way Teams does) and the Bot Connector
// (smba.trafficmanager.net), whose requests are captured and asserted.
//
// --serve leaves the server running with a signed-in owner session written to
// --cookie-file, so the /approvals panel can be driven in a browser:
//   DEV_API_PROXY=http://localhost:8147 npx vite --port 3147 --strictPort

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import Ajv from 'ajv';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };
import { SignJWT, generateKeyPair, exportJWK } from 'jose';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const serve = args.includes('--serve');
const PORT = Number(flag('--port', 8147));
const COOKIE_FILE = flag('--cookie-file', '/tmp/approvals-teams-cookie.txt');
const BASE = `http://127.0.0.1:${PORT}`;

for (const k of Object.keys(process.env)) {
	if (/^(UPSTASH_|REDIS_|KV_|RESEND_|SENDGRID_|SMTP_|VAPID_|WEB_PUSH|TELEGRAM_|DISCORD_)/.test(k))
		delete process.env[k];
}
const APP = '5d1c2b3a-0000-4000-8000-00000000b147';
process.env.MS_TEAMS_BOT_APP_ID = APP;
process.env.MS_TEAMS_BOT_APP_PASSWORD = 'live-check-secret';
process.env.MS_APP_ID ||= '9c1d6e1a-0000-4000-8000-00000000a147';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.DATABASE_URL = 'postgres://live-check@isolated.invalid/none';
process.env.PORT = String(PORT);

const say = (...lines) => process.stdout.write(`${lines.join('\n')}\n`);

const pair = await generateKeyPair('RS256');
const publicJwk = {
	...(await exportJWK(pair.publicKey)),
	kid: 'live-check',
	alg: 'RS256',
	use: 'sig',
};
const connectorPosts = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
	const u = String(url);
	if (u.startsWith('https://login.microsoftonline.com/')) {
		return Response.json({ access_token: 'live-check-connector-token', expires_in: 3600 });
	}
	if (u.startsWith('https://login.botframework.com/')) {
		return Response.json({ keys: [publicJwk] });
	}
	if (u.startsWith('https://smba.trafficmanager.net/')) {
		connectorPosts.push({
			url: u,
			method: init.method,
			headers: init.headers,
			body: init.body ? JSON.parse(init.body) : null,
		});
		return Response.json({ id: `activity-${connectorPosts.length}` });
	}
	return realFetch(url, init);
};

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const { sql } = await useIsolatedDb();
const { createSession, sessionCookie } = await import('../api/_lib/auth.js');
const { issueCsrf } = await import('../api/_lib/csrf.js');

const SERVICE = 'https://smba.trafficmanager.net/amer/';
const TENANT = '11111111-1111-4111-8111-111111111147';
const OWNER_OID = '22222222-2222-4222-8222-222222222147';
const OTHER_OID = '33333333-3333-4333-8333-333333333147';
const [owner] =
	await sql`insert into users (email, display_name) values ('approvals-owner@live-check.invalid', 'Ada Owner') returning id`;
const [other] =
	await sql`insert into users (email, display_name) values ('approvals-other@live-check.invalid', 'Grace Other') returning id`;
await sql`insert into user_identities (user_id, provider, subject, display_name) values
	(${owner.id}, 'microsoft', ${`${TENANT}:${OWNER_OID}`}, 'Ada Owner'),
	(${other.id}, 'microsoft', ${`${TENANT}:${OTHER_OID}`}, 'Grace Other')`;

await import('../server/index.mjs');
for (let i = 0; i < 100; i += 1) {
	const ok = await realFetch(`${BASE}/api/healthz`).then(
		(r) => r.status < 500,
		() => false,
	);
	if (ok) break;
	await new Promise((r) => setTimeout(r, 100));
}

const activity = (oid, extra = {}) => ({
	serviceUrl: SERVICE,
	channelId: 'msteams',
	from: {
		id: `29:mri-${oid}`,
		aadObjectId: oid,
		name: oid === OWNER_OID ? 'Ada Owner' : 'Grace Other',
	},
	recipient: { id: `28:${APP}`, name: 'three.ws' },
	conversation: { id: `a:1personal-${oid}`, conversationType: 'personal', tenantId: TENANT },
	channelData: { tenant: { id: TENANT } },
	...extra,
});

async function postActivity(body) {
	const token = await new SignJWT({ serviceurl: body.serviceUrl })
		.setProtectedHeader({ alg: 'RS256', kid: 'live-check' })
		.setIssuer('https://api.botframework.com')
		.setAudience(APP)
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(pair.privateKey);
	const res = await realFetch(`${BASE}/api/microsoft-teams/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

const press = (oid, data, verb) =>
	postActivity(
		activity(oid, {
			type: 'invoke',
			name: 'adaptiveCard/action',
			id: `act-${randomBytes(4).toString('hex')}`,
			value: { action: { type: 'Action.Execute', verb, data }, trigger: 'manual' },
		}),
	);

function findAction(node, verb) {
	if (!node || typeof node !== 'object') return null;
	if (node.type === 'Action.Execute' && node.verb === verb) return node;
	for (const v of Object.values(node)) {
		const hit = findAction(v, verb);
		if (hit) return hit;
	}
	return null;
}
const cardText = (card) => JSON.stringify(card);

const { id: schemaId, ...schemaBody } = JSON.parse(
	readFileSync(
		new URL('../tests/fixtures/adaptive-card-1.5.schema.json', import.meta.url),
		'utf8',
	),
);
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
ajv.addMetaSchema(draft06);
const validateCard = ajv.compile({ $id: schemaId, ...schemaBody });
function assertValidCard(card, label) {
	assert.ok(
		validateCard(card),
		`${label} card fails the Adaptive Cards 1.5 schema: ${ajv.errorsText(validateCard.errors)}`,
	);
}

// The server installs an uncaughtException handler that keeps it alive, so a
// failed assertion must end the process itself or the run would hang.
async function main() {
	// 1. Install: the conversation reference is stored.
	const installed = await postActivity(
		activity(OWNER_OID, { type: 'installationUpdate', action: 'add', id: 'inst-add' }),
	);
	assert.equal(installed.status, 200, `installationUpdate answered ${installed.status}`);
	const [ref] =
		await sql`select conversation_id, service_url from teams_conversation_refs where aad_object_id = ${OWNER_OID}`;
	assert.equal(ref?.conversation_id, `a:1personal-${OWNER_OID}`);
	say(`ok 1  installationUpdate stored the 1:1 conversation reference (${ref.conversation_id})`);

	// 2. The settings endpoint sends the labelled test approval through the fan-out.
	const cookie = sessionCookie(
		await createSession({
			userId: owner.id,
			userAgent: 'approvals-teams-live-check',
			ip: '127.0.0.1',
			recordActivity: false,
		}),
	).split(';')[0];
	const status = await realFetch(`${BASE}/api/approvals/teams`, { headers: { cookie } }).then(
		(r) => r.json(),
	);
	assert.equal(status.linked, true);
	assert.equal(status.installed, true);
	assert.equal(status.bot_configured, true);
	say(
		`ok 2a GET /api/approvals/teams -> ${JSON.stringify({ linked: status.linked, installed: status.installed, bot_configured: status.bot_configured, enabled: status.enabled })}`,
	);

	const { token: csrf } = await issueCsrf(owner.id);
	const sent = await realFetch(`${BASE}/api/approvals/teams`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
		body: JSON.stringify({ action: 'test' }),
	});
	const sentBody = await sent.json();
	assert.equal(
		sent.status,
		201,
		`POST test answered ${sent.status}: ${JSON.stringify(sentBody)}`,
	);
	assert.equal(sentBody.delivered, 1);
	const delivered = connectorPosts.filter((p) => p.url.endsWith('/activities'));
	assert.equal(delivered.length, 1, 'exactly one card was posted to the Bot Connector');
	const post = delivered[0];
	assert.equal(
		post.url,
		`${SERVICE}v3/conversations/${encodeURIComponent(`a:1personal-${OWNER_OID}`)}/activities`,
	);
	assert.equal(post.headers.authorization, 'Bearer live-check-connector-token');
	const card = post.body.attachments[0].content;
	assert.equal(post.body.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
	assertValidCard(card, 'pending');
	assert.match(cardText(card), /Test approval \(nothing runs\)/);
	assert.deepEqual(card.refresh.userIds, [`29:mri-${OWNER_OID}`]);
	const [request] =
		await sql`select id, status, source from approval_requests where user_id = ${owner.id}`;
	assert.equal(request.status, 'pending');
	assert.equal(request.source, 'approval_test');
	say(
		`ok 2b POST /api/approvals/teams {action:"test"} -> Bot Connector POST ${post.url}`,
		`      card validates against Adaptive Cards 1.5; refresh scoped to ${card.refresh.userIds[0]}; request ${request.id} pending`,
	);

	// 3. The owner approves; repeats run nothing.
	const approve = findAction(card, 'approval.approve');
	assert.ok(approve, 'the card has an Approve Action.Execute');
	const first = await press(OWNER_OID, approve.data, approve.verb);
	assert.equal(first.status, 200);
	assert.equal(first.body.statusCode, 200);
	assert.equal(first.body.type, 'application/vnd.microsoft.card.adaptive');
	assertValidCard(first.body.value, 'decided');
	const [afterFirst] =
		await sql`select status, decided_via, executed_at, result from approval_requests where id = ${request.id}`;
	assert.equal(afterFirst.status, 'executed');
	assert.equal(afterFirst.decided_via, 'teams');
	assert.match(cardText(first.body.value), /Approved by Ada Owner/);
	say(
		`ok 3a owner Approve -> ${afterFirst.status} via ${afterFirst.decided_via}; executor note: ${afterFirst.result?.note}`,
	);

	const second = await press(OWNER_OID, approve.data, approve.verb);
	const replay = await press(OWNER_OID, approve.data, approve.verb);
	const [afterRepeat] =
		await sql`select status, executed_at from approval_requests where id = ${request.id}`;
	assert.equal(second.status, 200);
	assert.equal(replay.status, 200);
	assert.equal(afterRepeat.status, 'executed');
	assert.equal(
		new Date(afterRepeat.executed_at).getTime(),
		new Date(afterFirst.executed_at).getTime(),
		'a repeat press re-executed the action',
	);
	assertValidCard(second.body.value, 'repeat');
	say(
		'ok 3b double click and replay redraw the decided card; executed_at unchanged, nothing ran twice',
	);

	// 4. Wrong user and tampering.
	const intruder = await press(OTHER_OID, approve.data, approve.verb);
	assert.equal(intruder.status, 200);
	assertValidCard(intruder.body.value, 'restricted');
	assert.match(cardText(intruder.body.value), /Only the three\.ws account owner/);
	assert.doesNotMatch(cardText(intruder.body.value), /Test approval/);
	say('ok 4a another linked account gets the restricted card with no request details');

	const deny = findAction(card, 'approval.deny');
	const tampered = await press(
		OWNER_OID,
		{ ...deny.data, mac: `${deny.data.mac.slice(0, -2)}00` },
		'approval.deny',
	);
	assert.equal(tampered.status, 200);
	assert.match(cardText(tampered.body.value), /does not match the request on file/);
	const [afterTamper] = await sql`select status from approval_requests where id = ${request.id}`;
	assert.equal(afterTamper.status, 'executed');
	say('ok 4b an altered button is refused and changes nothing');

	say(
		'',
		'PASS: Teams approval delivery, decision, single execution, wrong user and tamper all verified over HTTP.',
	);
	return cookie;
}

let cookie;
try {
	cookie = await main();
} catch (err) {
	process.stderr.write(`\nFAIL: ${err?.stack || err}\n`);
	process.exit(1);
}

if (!serve) process.exit(0);
writeFileSync(COOKIE_FILE, cookie);
say(`Serving on ${BASE} (isolated database). Owner session cookie written to ${COOKIE_FILE}.`);
