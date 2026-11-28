#!/usr/bin/env node
// End-to-end check of the Basecamp chatbot (`!threews <prompt>`) against a real
// forge, through the same HTTP handlers production runs.
//
// It serves api/basecamp/command.js and api/basecamp/forge-run.js from a local
// HTTP server, creates a real command URL for a three.ws account in a
// throwaway database (scripts/lib/isolated-db.mjs, PGlite with the production
// schema), and POSTs the exact payload Basecamp sends when someone types the
// command in a Campfire. The command handler answers the room line, dispatches
// the job to forge-run with the platform bearer, and the run makes a real
// model on the target deployment (STUDIO_API_BASE, default https://three.ws).
//
// The one thing not reached is Basecamp itself: there is no Basecamp account
// here, so the POST to the chat's callback URL is answered at the network
// boundary (the global fetch) with a 201 and its body is checked: the poster
// image, the viewer, AR and GLB links, all fetched for real.
//
//   CRON_SECRET=... node scripts/basecamp-forge-e2e.mjs --owner <three.ws user uuid> ["a prompt"] [--high|--draft]
//
// CRON_SECRET must be the target deployment's (scripts/read-service-env.mjs
// '^CRON_SECRET$' --raw), and --owner a real account on it: the model is made
// on that account, exactly as a real chatbot's models are made on its owner's.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { useIsolatedDb } from './lib/isolated-db.mjs';

const args = process.argv.slice(2);
const ownerAt = args.indexOf('--owner');
const owner = ownerAt >= 0 ? args[ownerAt + 1] : '';
const flag = args.find((a) => a === '--high' || a === '--draft') || '';
const prompt = args.find((a, i) => !a.startsWith('--') && i !== ownerAt + 1) || 'a low-poly lighthouse on a rocky island';

const log = (...m) => console.log(`[basecamp-e2e ${new Date().toISOString().slice(11, 19)}]`, ...m);
const fail = (msg) => {
	console.error(`FAIL: ${msg}`);
	process.exit(1);
};

if (!/^[0-9a-f-]{36}$/i.test(owner)) fail('pass --owner <uuid of a real account on the target deployment>');
if (!process.env.CRON_SECRET) fail('CRON_SECRET (the target deployment\'s) is required for the forge-run dispatch and the platform call');
process.env.STUDIO_API_BASE ||= 'https://three.ws';
delete process.env.NODE_ENV;

// Basecamp's side of the conversation: capture what the chatbot posts back.
const posted = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
	const url = typeof input === 'string' ? input : input.url;
	if (/^https:\/\/3\.basecampapi\.com\//.test(url)) {
		posted.push({ url, body: JSON.parse(init.body || '{}'), headers: init.headers });
		return new Response('{"id":1}', { status: 201, headers: { 'content-type': 'application/json' } });
	}
	return realFetch(input, init);
};

const { sql } = await useIsolatedDb();
await sql`insert into users (id, email, display_name) values (${owner}, ${`basecamp-e2e-${owner.slice(0, 8)}@users.three.ws.local`}, 'Basecamp e2e')`;

const { createChatbot, listChatbots } = await import('../api/_lib/basecamp-chatbots.js');
const command = (await import('../api/basecamp/command.js')).default;
const forgeRun = (await import('../api/basecamp/forge-run.js')).default;

const runs = [];
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://local');
	const m = url.pathname.match(/^\/api\/basecamp\/command\/(bc_[A-Za-z0-9_-]{43})\/?$/);
	if (m) {
		req.query = { token: m[1] };
		return command(req, res);
	}
	if (url.pathname === '/api/basecamp/forge-run') {
		req.query = {};
		const done = new Promise((resolve) => res.on('finish', resolve));
		runs.push(done);
		return forgeRun(req, res);
	}
	res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const { token } = await createChatbot(owner, { label: 'e2e Basecamp' });
const commandUrl = `${base}/api/basecamp/command/${token}`;
log(`command URL created (…${token.slice(-4)}), forge at ${process.env.STUDIO_API_BASE}`);

const callback = `https://3.basecampapi.com/195539477/integrations/${randomUUID().replace(/-/g, '').slice(0, 24)}/buckets/2085958496/chats/9007199254741775/lines`;
const payload = {
	command: `${prompt}${flag ? ` ${flag}` : ''}`,
	creator: {
		id: 1049715913,
		name: 'three.ws e2e',
		// The shape of a Basecamp attachable sgid (base64 payload, `--`, hex
		// digest); Basecamp would resolve it to the person on delivery.
		attachable_sgid: `${Buffer.from(`gid://bc3/Person/1049715913?expires_in&purpose=attachable&e2e=${Date.now()}`).toString('base64')}--${randomUUID().replace(/-/g, '')}`,
	},
	callback_url: callback,
};

const help = await realFetch(commandUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'help', callback_url: callback }) });
const helpLine = await help.text();
if (help.status !== 200 || !/!threews/.test(helpLine)) fail(`help answered ${help.status}: ${helpLine}`);
log('help line ok');

const res = await realFetch(commandUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
const line = await res.text();
log(`command answered ${res.status} ${res.headers.get('content-type')}: ${line.replace(/<[^>]+>/g, '').slice(0, 140)}`);
if (res.status !== 200 || !/^text\/html/.test(res.headers.get('content-type') || '')) fail('the command URL must answer 200 text/html');

const again = await realFetch(commandUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
const againLine = await again.text();
if (!/already/i.test(againLine)) fail(`a repeated command should be recognised as a duplicate, got: ${againLine}`);
log('duplicate within the window recognised');

if (!runs.length) fail('the command did not dispatch to /api/basecamp/forge-run');
const started = Date.now();
await runs[0];
log(`forge-run finished in ${Math.round((Date.now() - started) / 1000)}s`);

if (posted.length !== 1) fail(`expected exactly one line posted back to the chat, got ${posted.length}`);
const { body, url: postedTo } = posted[0];
if (postedTo !== callback) fail(`posted to ${postedTo}, not the callback URL`);
const html = String(body.content || '');
log(`line posted back:\n${html}`);

const href = (text) => html.match(new RegExp(`<a href="([^"]+)">${text}</a>`))?.[1]?.replace(/&amp;/g, '&');
const viewer = href('Open in 3D');
const ar = href('View in AR on your phone');
const glb = href('Download GLB');
const poster = html.match(/<img src="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
if (!html.includes('bc-attachment')) fail('the line does not mention the requester');
if (!glb) fail('no Download GLB link in the line');

async function probe(url, label) {
	const r = await realFetch(url, { headers: { range: 'bytes=0-15' }, redirect: 'manual' });
	const buf = Buffer.from(await r.arrayBuffer());
	log(`${label} ${r.status} ${r.headers.get('content-type') || ''} ${url}`);
	if (r.status >= 400) fail(`${label} did not resolve (${r.status})`);
	return buf;
}
const magic = (await probe(glb, 'GLB')).subarray(0, 4).toString('latin1');
if (magic !== 'glTF') fail(`the GLB link did not return a glTF binary (magic "${magic}")`);
if (poster) await probe(poster, 'poster');
if (viewer) await probe(viewer, 'viewer');
if (ar) await probe(ar, 'AR');

const [row] = await listChatbots(owner);
if (row.command_count !== 1) fail(`the chatbot recorded ${row.command_count} commands, expected 1`);
if (row.last_basecamp_account !== '195539477') fail(`recorded Basecamp account ${row.last_basecamp_account}`);
log('command count and Basecamp account recorded on the chatbot');

server.close();
log('PASS');
console.log(JSON.stringify({ prompt, glbUrl: glb, posterUrl: poster || null, viewerUrl: viewer || null, arUrl: ar || null, line: html }, null, 2));
process.exit(0);
