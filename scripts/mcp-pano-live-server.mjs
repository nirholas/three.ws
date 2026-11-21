#!/usr/bin/env node
// Local API server for the 360 MCP tools live proof (scripts/mcp-pano-live-proof.mjs).
//
//   PORT=3345 node scripts/mcp-pano-live-server.mjs --key-file <path>
//
// Runs the real server/index.mjs (the process that serves production) on a
// throwaway in-process Postgres (scripts/lib/isolated-db.mjs), so the account
// and API key it mints never touch production. Worker URLs are taken from the
// caller's environment (GCP_PANO2SPLAT_URL, GCP_PANODEPTH_URL); when they are
// unset the lanes answer their real `unconfigured` result. The API key is
// written to --key-file (mode 0600), never printed.

import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const keyFile = args.includes('--key-file') ? args[args.indexOf('--key-file') + 1] : null;
if (!keyFile) {
	process.stderr.write('usage: mcp-pano-live-server.mjs --key-file <path>\n');
	process.exit(2);
}

process.env.DATABASE_URL = 'postgres://isolated.invalid/isolated';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
for (const v of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'RESEND_API_KEY']) {
	delete process.env[v];
}

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const { sql } = await useIsolatedDb();

const [user] = await sql`insert into users (email, display_name, email_verified) values ('mcp-pano-proof@example.invalid', 'MCP pano proof', true) returning id`;
const token = `sk_live_${randomBytes(32).toString('hex')}`;
const hash = createHash('sha256').update(token).digest('hex');
await sql`insert into api_keys (user_id, name, token_hash, prefix, scope) values (${user.id}, 'mcp pano proof', ${hash}, ${token.slice(0, 14)}, 'avatars:read avatars:write')`;
writeFileSync(keyFile, token, { mode: 0o600 });
process.stdout.write(`mcp-pano live server: user ${user.id}, key written to ${keyFile}\n`);

await import('../server/index.mjs');
