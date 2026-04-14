// RFC 7662 — OAuth 2.0 Token Introspection
// Minimal: authenticated clients can check if a token is active.

import { sql } from '../_lib/db.js';
import { authenticateBearer, verifyAccessToken } from '../_lib/auth.js';
import { sha256, constantTimeEquals } from '../_lib/crypto.js';
import { cors, method, readForm, wrap, json, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const form = await readForm(req);
	const { token, client_id, client_secret } = form;
	if (!token || !client_id) return error(res, 400, 'invalid_request', 'token and client_id required');

	const rows = await sql`select * from oauth_clients where client_id = ${client_id} limit 1`;
	const client = rows[0];
	if (!client) return json(res, 200, { active: false });

	if (client.client_type === 'confidential') {
		const hash = await sha256(client_secret ?? '');
		if (!client.client_secret_hash || !constantTimeEquals(hash, client.client_secret_hash)) {
			return error(res, 401, 'invalid_client', 'bad client credentials');
		}
	}

	try {
		const payload = await verifyAccessToken(token);
		// Only the issuing client can introspect its own access tokens. Prevents
		// any registered client from probing arbitrary tokens for user identity
		// or scope (especially relevant given open dynamic registration).
		if (payload.client_id && payload.client_id !== client_id) {
			return json(res, 200, { active: false });
		}
		return json(res, 200, {
			active: true,
			scope: payload.scope,
			client_id: payload.client_id,
			sub: payload.sub,
			aud: payload.aud,
			iss: payload.iss,
			exp: payload.exp,
			iat: payload.iat,
			token_type: 'Bearer',
		});
	} catch {
		// Maybe it's a refresh token.
		const h = await sha256(token);
		const r = await sql`select user_id, scope, expires_at, revoked_at from oauth_refresh_tokens
		                    where token_hash = ${h} and client_id = ${client_id} limit 1`;
		const row = r[0];
		if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
			return json(res, 200, { active: false });
		}
		return json(res, 200, {
			active: true,
			scope: row.scope,
			client_id,
			sub: row.user_id,
			token_type: 'refresh_token',
		});
	}
});
