#!/usr/bin/env node
// Live check of /api/grok/stats through the real server, on a throwaway database.
//
//   npm run grok:stats-live-check            run the traffic, print the stats, exit
//   npm run grok:stats-live-check -- --serve keep the API up so a dev server can read it:
//     DEV_API_PROXY=http://127.0.0.1:8281 npm run dev -- --port 3281 --strictPort
//
// What it proves, end to end through the code Cloud Run runs (server/index.mjs,
// api/mcp-grok.js, api/_mcp-studio/dispatch.js, api/_lib/usage.js,
// api/grok/stats.js):
//   1. real JSON-RPC calls to /api/mcp-grok, anonymous (an MCP session) and
//      signed in (an API key minted for a real users row), each land in
//      usage_events with the surface, a hashed client label and the account;
//   2. an anonymous model request is refused with sign_in_required;
//   3. GET /api/grok/stats counts exactly that traffic, and serves no user id,
//      client label, email or key.
//
// Isolation: the database is PGlite with the production schema
// (scripts/lib/isolated-db.mjs), so nothing reaches Neon. Redis and QStash
// credentials are dropped from this process, so usage writes take the direct
// insert path and rate limits stay in memory. JWT_SECRET is random per run.
// The forge is not configured here, so a signed-in model call ends as a tool
// error and no model is counted; production counts models from real Grok
// traffic once this ships.

import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const SERVE = args.includes('--serve');
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 8281);
const BASE = `http://127.0.0.1:${PORT}`;

for (const key of Object.keys(process.env)) {
	if (/^(UPSTASH_|KV_|REDIS_|QSTASH_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
	PORT: String(PORT),
	NODE_ENV: 'development',
	DATABASE_URL: 'postgres://isolated.pglite/db',
	JWT_SECRET: randomBytes(32).toString('hex'),
	APP_ORIGIN: BASE,
	PUBLIC_APP_ORIGIN: BASE,
});

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const db = await useIsolatedDb();
await import('../server/index.mjs');

async function waitForServer() {
	for (let i = 0; i < 120; i++) {
		try {
			const r = await fetch(`${BASE}/api/version`);
			if (r.ok) return;
		} catch {
			/* not listening yet */
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`server did not answer on ${BASE}/api/version`);
}

function rpcClient({ bearer = null } = {}) {
	let session = null;
	let id = 0;
	return async function rpc(method, params = {}) {
		const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
		if (session) headers['mcp-session-id'] = session;
		if (bearer) headers.authorization = `Bearer ${bearer}`;
		const r = await fetch(`${BASE}/api/mcp-grok`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
		session = r.headers.get('mcp-session-id') || session;
		const text = await r.text();
		const line = text.trim().startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))?.slice(5);
		const body = line ? JSON.parse(line) : null;
		if (!r.ok || body?.error) throw new Error(`${method} -> HTTP ${r.status} ${JSON.stringify(body?.error || text.slice(0, 200))}`);
		return body.result;
	};
}

async function settle(sql, expected) {
	for (let i = 0; i < 100; i++) {
		const [{ c }] = await sql`select count(*)::int as c from usage_events where meta->>'server' = 'mcp-grok'`;
		if (c >= expected) return c;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`expected ${expected} Grok usage rows`);
}

await waitForServer();
const { sql } = db;
const [user] = await sql`insert into users (email, display_name) values ('grok.live.check@contoso.example', 'Grok live check') returning id`;
const { mintApiKey } = await import('../api/_lib/api-keys.js');
const minted = await mintApiKey({ userId: user.id, name: 'grok stats live check', scopes: ['avatars:read', 'avatars:write'] });
const apiKey = minted.secret;

const anon = rpcClient();
await anon('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok-stats-live-check', version: '1' } });
await anon('tools/list');
await anon('tools/call', { name: 'search_docs', arguments: { query: 'rig a model' } });
await anon('tools/call', { name: 'search_catalog', arguments: { q: 'chair', limit: 1 } });
const refused = await anon('tools/call', { name: 'forge_free', arguments: { prompt: 'a brass telescope' } });

const signedIn = rpcClient({ bearer: apiKey });
await signedIn('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok-stats-live-check', version: '1' } });
await signedIn('tools/call', { name: 'search_catalog', arguments: { q: 'lamp', limit: 1 } });
const forge = await signedIn('tools/call', { name: 'forge_free', arguments: { prompt: 'a brass telescope' } });

await settle(sql, 5);
const rows = await sql`select tool, status, client_id, user_id is not null as signed_in, meta ? 'glb' as made from usage_events where meta->>'server' = 'mcp-grok' order by created_at`;
const statsRes = await fetch(`${BASE}/api/grok/stats`);
const stats = await statsRes.json();
const served = JSON.stringify(stats);
const leaks = [String(user.id), 'contoso.example', apiKey, ...rows.map((r) => r.client_id).filter(Boolean)].filter((v) => served.includes(v));

console.log(JSON.stringify({
	refused_anonymous_model: refused?.structuredContent?.status,
	signed_in_model_call: forge?.isError ? `tool error (no forge here): ${forge.content?.[0]?.text?.slice(0, 120)}` : 'model returned',
	usage_rows: rows.map((r) => ({ tool: r.tool, status: r.status, label: r.client_id?.replace(/[0-9a-f]{16}$/, '<hash>'), signed_in: r.signed_in, made: r.made })),
	stats_http: statsRes.status,
	stats_cache: statsRes.headers.get('cache-control'),
	stats,
	leaks,
}, null, 2));

if (statsRes.status !== 200 || leaks.length) process.exitCode = 1;
if (!SERVE) process.exit();
console.log(`\nServing ${BASE} on the isolated database. Point a dev server at it with DEV_API_PROXY=${BASE}. Ctrl+C to stop.`);
