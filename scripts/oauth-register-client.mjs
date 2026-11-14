#!/usr/bin/env node
// Register a confidential OAuth client by hand, for a partner service that
// cannot use Dynamic Client Registration (POST /api/oauth/register).
//
//   node scripts/oauth-register-client.mjs --name "Microsoft Copilot Studio" \
//     --redirect-uri https://global.consent.azure-apim.net/redirect/<connector> \
//     [--redirect-uri <another>] [--client-uri https://copilotstudio.microsoft.com] \
//     [--scope "avatars:read profile"] [--apply]
//
// Without --apply it prints what it would insert and touches nothing. With
// --apply it inserts one row into oauth_clients with dynamically_registered =
// false and prints the client_id and client_secret once; only the secret's
// SHA-256 is stored, so record it immediately (for Microsoft, into the Key
// Vault secrets ClientId, ClientSecret, AuthorizationUrl and TokenUrl).
//
// Clients created here may skip PKCE (api/oauth/[action].js, pkceOptional),
// which Microsoft's MCP certification service requires. They still have to
// prove the secret at /oauth/token, and every self-registered client keeps
// mandatory PKCE.
//
// Environment: DATABASE_URL (node scripts/read-service-env.mjs '^DATABASE_URL$' --raw).

import { neon } from '@neondatabase/serverless';
import { randomToken, sha256 } from '../api/_lib/crypto.js';
import { filterRegisterableScope } from '../api/_lib/oauth-scopes.js';

const args = process.argv.slice(2);
const all = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const one = (n) => all(n)[0];

const name = one('--name');
const redirectUris = all('--redirect-uri');
const clientUri = one('--client-uri') || null;
const requestedScope = one('--scope') || 'avatars:read profile';
const apply = args.includes('--apply');

function fail(message) {
	console.error(`oauth-register-client: ${message}`);
	process.exit(1);
}

if (!name) fail('--name is required');
if (!redirectUris.length) fail('at least one --redirect-uri is required');
for (const uri of redirectUris) {
	let u;
	try { u = new URL(uri); } catch { fail(`not an absolute URI: ${uri}`); }
	if (u.protocol !== 'https:') fail(`redirect URIs must be https: ${uri}`);
}
if (clientUri && !/^https:\/\//.test(clientUri)) fail('--client-uri must be https');

const scope = filterRegisterableScope(requestedScope);
const origin = (process.env.PUBLIC_APP_ORIGIN || 'https://three.ws').replace(/\/$/, '');
const plan = { name, redirect_uris: redirectUris, client_uri: clientUri, scope, token_endpoint_auth_method: 'client_secret_basic', pkce: 'optional (hand-registered confidential client)' };

if (!apply) {
	console.log(JSON.stringify({ dry_run: true, would_insert: plan }, null, 2));
	console.log('Rerun with --apply to create the client.');
	process.exit(0);
}

if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set (node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)");
const sql = neon(process.env.DATABASE_URL);
const clientId = `mcp_${randomToken(18)}`;
const clientSecret = randomToken(32);
const secretHash = await sha256(clientSecret);

await sql`insert into oauth_clients (client_id, client_secret_hash, client_type, name, client_uri, redirect_uris, grant_types, response_types, token_endpoint_auth, scope, dynamically_registered) values (${clientId}, ${secretHash}, 'confidential', ${name}, ${clientUri}, ${redirectUris}, ${['authorization_code', 'refresh_token']}, ${['code']}, 'client_secret_basic', ${scope}, false)`;

console.log(JSON.stringify({
	...plan,
	client_id: clientId,
	client_secret: clientSecret,
	authorization_url: `${origin}/oauth/authorize`,
	token_url: `${origin}/oauth/token`,
	refresh_url: `${origin}/oauth/token`,
	note: 'The secret is shown once and only its hash is stored. Record it now.',
}, null, 2));
