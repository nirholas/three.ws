// RFC 7009 — OAuth 2.0 Token Revocation

import { sql } from '../_lib/db.js';
import { revokeRefreshToken } from '../_lib/auth.js';
import { sha256, constantTimeEquals } from '../_lib/crypto.js';
import { cors, method, readForm, wrap, json, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const form = await readForm(req);
	const { token, token_type_hint, client_id, client_secret } = form;
	if (!token || !client_id) return error(res, 400, 'invalid_request', 'token and client_id required');

	const rows = await sql`select * from oauth_clients where client_id = ${client_id} limit 1`;
	const client = rows[0];
	if (!client) return json(res, 200, {}); // RFC: respond 200 even if unknown, to prevent enumeration

	if (client.client_type === 'confidential') {
		const hash = await sha256(client_secret ?? '');
		if (!client.client_secret_hash || !constantTimeEquals(hash, client.client_secret_hash)) {
			return error(res, 401, 'invalid_client', 'bad client credentials');
		}
	}

	// Only refresh tokens are revocable server-side; access tokens are JWTs with short TTL.
	if (token_type_hint !== 'access_token') {
		await revokeRefreshToken(token, client_id);
	}

	return json(res, 200, {});
});
