// OAuth 2.1 token endpoint.
// Grants supported:
//   - authorization_code (with PKCE)
//   - refresh_token (rotation + reuse detection)

import { sql } from '../_lib/db.js';
import { mintAccessToken, issueRefreshToken, rotateRefreshToken } from '../_lib/auth.js';
import { sha256, sha256Base64Url, constantTimeEquals } from '../_lib/crypto.js';
import { cors, method, readForm, wrap, error, json } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const form = await readForm(req);
	const clientId = form.client_id || basicAuthUser(req);
	if (!clientId) return error(res, 400, 'invalid_client', 'client_id required');

	const rl = await limits.oauthToken(clientId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many token requests');

	const rows = await sql`select * from oauth_clients where client_id = ${clientId} limit 1`;
	const client = rows[0];
	if (!client) return error(res, 400, 'invalid_client', 'unknown client');

	if (client.client_type === 'confidential') {
		const secret = form.client_secret || basicAuthPass(req) || '';
		const providedHash = await sha256(secret);
		if (
			!client.client_secret_hash ||
			!constantTimeEquals(providedHash, client.client_secret_hash)
		) {
			return error(res, 401, 'invalid_client', 'bad client credentials');
		}
	}

	const grantType = form.grant_type;
	if (grantType === 'authorization_code') return handleAuthCode(res, client, form);
	if (grantType === 'refresh_token') return handleRefresh(res, client, form);
	return error(res, 400, 'unsupported_grant_type', `grant_type=${grantType} not supported`);
});

async function handleAuthCode(res, client, form) {
	const { code, redirect_uri, code_verifier } = form;
	if (!code || !redirect_uri || !code_verifier) {
		return error(res, 400, 'invalid_request', 'code, redirect_uri, code_verifier required');
	}

	const rows = await sql`
		select * from oauth_auth_codes where code = ${code} limit 1
	`;
	const row = rows[0];
	if (!row) return error(res, 400, 'invalid_grant', 'unknown code');
	if (row.consumed_at) {
		await sql`update oauth_refresh_tokens set revoked_at = now()
		          where user_id = ${row.user_id} and client_id = ${client.client_id} and revoked_at is null`;
		return error(res, 400, 'invalid_grant', 'authorization code already used');
	}
	if (new Date(row.expires_at) < new Date())
		return error(res, 400, 'invalid_grant', 'code expired');
	if (row.client_id !== client.client_id)
		return error(res, 400, 'invalid_grant', 'client mismatch');
	if (row.redirect_uri !== redirect_uri)
		return error(res, 400, 'invalid_grant', 'redirect_uri mismatch');

	const computed = await sha256Base64Url(code_verifier);
	if (computed !== row.code_challenge)
		return error(res, 400, 'invalid_grant', 'PKCE verification failed');

	await sql`update oauth_auth_codes set consumed_at = now() where code = ${code}`;

	const accessToken = await mintAccessToken({
		userId: row.user_id,
		clientId: client.client_id,
		scope: row.scope,
		resource: row.resource || env.MCP_RESOURCE,
	});

	const wantsRefresh = client.grant_types.includes('refresh_token');
	const refresh = wantsRefresh
		? await issueRefreshToken({
				userId: row.user_id,
				clientId: client.client_id,
				scope: row.scope,
				resource: row.resource,
			})
		: null;

	return json(res, 200, {
		access_token: accessToken,
		token_type: 'Bearer',
		expires_in: 3600,
		scope: row.scope,
		...(refresh ? { refresh_token: refresh.token } : {}),
	});
}

async function handleRefresh(res, client, form) {
	const { refresh_token, scope } = form;
	if (!refresh_token) return error(res, 400, 'invalid_request', 'refresh_token required');

	let result;
	try {
		result = await rotateRefreshToken({
			oldSecret: refresh_token,
			clientId: client.client_id,
			// Narrow the rotated refresh token to the requested subset so a caller
			// can't re-widen back to the full grant on a later refresh.
			narrowScope: (stored) => (scope ? intersect(scope, stored) : stored),
		});
	} catch (err) {
		return error(res, err.status || 400, err.code || 'invalid_grant', err.message);
	}

	const accessToken = await mintAccessToken({
		userId: result.userId,
		clientId: client.client_id,
		scope: result.scope,
		resource: result.resource || env.MCP_RESOURCE,
	});

	return json(res, 200, {
		access_token: accessToken,
		token_type: 'Bearer',
		expires_in: 3600,
		scope: result.scope,
		refresh_token: result.next.token,
	});
}

function intersect(a, b) {
	const set = new Set(b.split(/\s+/).filter(Boolean));
	return (
		a
			.split(/\s+/)
			.filter((s) => set.has(s))
			.join(' ') || b
	);
}

function basicAuthUser(req) {
	const h = req.headers.authorization || '';
	if (!h.toLowerCase().startsWith('basic ')) return null;
	try {
		const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
		return decoded.split(':')[0];
	} catch {
		return null;
	}
}

function basicAuthPass(req) {
	const h = req.headers.authorization || '';
	if (!h.toLowerCase().startsWith('basic ')) return null;
	try {
		const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
		return decoded.split(':').slice(1).join(':');
	} catch {
		return null;
	}
}
