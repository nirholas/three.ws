// Live check for Teams activity feed notifications, on real code and a throwaway
// database (scripts/lib/isolated-db.mjs). Nothing here touches production or
// Microsoft: the only thing intercepted is the outbound fetch to login.microsoftonline.com
// and graph.microsoft.com, which is captured and printed so the payload can be read.
//
//   node scripts/teams-activity-live-check.mjs
//       Settles a Teams-started Forge job for a linked person and asserts the
//       Graph request the sender made (recipient, activity type, parameters,
//       deep link).
//
//   node scripts/teams-activity-live-check.mjs --serve [--port 8087]
//       The same, then leaves the real API server running on the isolated
//       database with a signed-in session, and writes the cookie to
//       --cookie-file, so the settings panel can be driven in a browser:
//         DEV_API_PROXY=http://localhost:8087 npm run dev -- --port 3146

import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { useIsolatedDb } from './lib/isolated-db.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1] ?? true;
};
const serve = args.includes('--serve');
const port = String(flag('--port', '8087'));
const cookieFile = flag('--cookie-file', '/tmp/teams-activity-cookie.txt');

process.env.MS_TEAMS_BOT_APP_ID ||= '5d1c2b3a-0000-4000-8000-00000000b071';
process.env.MS_TEAMS_BOT_APP_PASSWORD ||= 'live-check-secret';
process.env.MS_APP_ID ||= '9c1d6e1a-0000-4000-8000-00000000a0a0';
process.env.JWT_SECRET ||= 'live-check-jwt-secret-live-check-jwt-secret';
process.env.PORT = port;

const db = await useIsolatedDb();

const captured = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
	const u = String(url);
	if (u.startsWith('https://login.microsoftonline.com/')) {
		captured.push({ url: u, body: String(init?.body) });
		return Response.json({ access_token: 'live-check-token', expires_in: 3600 });
	}
	if (u.startsWith('https://graph.microsoft.com/')) {
		captured.push({ url: u, headers: init.headers, body: JSON.parse(init.body) });
		return new Response(null, { status: 202 });
	}
	return realFetch(url, init);
};

const identity = await import('../api/_lib/teams-identity.js');
const { announceSettled, forgeKey } = await import('../api/_lib/teams-forge.js');
const { createSession, sessionCookie } = await import('../api/_lib/auth.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const AAD = '22222222-2222-4222-8222-222222222222';
const [user] = await db.sql`insert into users (email, display_name) values ('live-check@example.test', 'Live Check') returning id`;
const { code } = await identity.createLinkCode(user.id);
await identity.redeemLinkCode(code, { tenantId: TENANT, aadObjectId: AAD });

const key = forgeKey('live-check-conversation', 'live-check-activity');
await announceSettled({
	key, state: 'done', prompt: 'a low-poly red fox',
	by: { tenantId: TENANT, aadObjectId: AAD },
	result: { viewerUrl: 'https://three.ws/forge?share=live', posterUrl: null },
});
await new Promise((r) => setTimeout(r, 500));

const send = captured.find((c) => c.url.includes('/teamwork/sendActivityNotification'));
assert.ok(send, 'the Forge completion reached the Graph sender');
assert.equal(send.url, `https://graph.microsoft.com/v1.0/users/${AAD}/teamwork/sendActivityNotification`);
assert.equal(send.body.activityType, 'forgeJobCompleted');
assert.deepEqual(send.body.templateParameters, [{ name: 'prompt', value: 'a low-poly red fox' }]);
const context = JSON.parse(new URL(send.body.topic.webUrl).searchParams.get('context'));
assert.equal(context.subEntityId, `job:${key}`);
console.log('Graph request:', JSON.stringify({ url: send.url, ...send.body }, null, 2));
const [row] = await db.sql`select last_sent_at, last_error_code from teams_identities where aad_object_id = ${AAD}`;
assert.ok(row.last_sent_at && !row.last_error_code, 'the send was recorded on the identity');
console.log('OK: Forge completion -> notification fan-out -> Graph sender, payload and deep link verified.');

if (!serve) process.exit(0);

const token = await createSession({ userId: user.id, userAgent: 'live-check', ip: '127.0.0.1', recordActivity: false });
const cookie = sessionCookie(token).split(';')[0];
writeFileSync(cookieFile, cookie);
await import('../server/index.mjs');
console.log(`API server on :${port} (isolated database). Session cookie written to ${cookieFile}.`);
