// RFC 7591 — OAuth 2.0 Dynamic Client Registration
// MCP clients (including Claude) call this at first connect to register themselves.

import { sql } from '../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { randomToken, sha256 } from '../_lib/crypto.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { z } from 'zod';
import { parse } from '../_lib/validate.js';

const registerSchema = z.object({
	redirect_uris: z.array(z.string().url()).min(1).max(10),
	client_name: z.string().trim().min(1).max(120).optional(),
	client_uri: z.string().url().optional(),
	logo_uri: z.string().url().optional(),
	scope: z.string().max(500).optional(),
	grant_types: z.array(z.string()).optional(),
	response_types: z.array(z.string()).optional(),
	token_endpoint_auth_method: z.enum(['none', 'client_secret_basic', 'client_secret_post']).optional(),
	software_id: z.string().max(120).optional(),
	software_version: z.string().max(60).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	// RFC 7591 dynamic registration is unauthenticated by design, so cap per-IP
	// to deter DB flooding and mass minting of throwaway clients for CSRF / abuse.
	const rl = await limits.oauthRegisterIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many registrations from this IP');

	const body = parse(registerSchema, await readJson(req));

	// Security: only allow http redirect URIs for localhost (dev), per OAuth 2.1.
	for (const uri of body.redirect_uris) {
		const u = new URL(uri);
		if (u.protocol === 'http:' && !/^localhost$|^127\.0\.0\.1$/.test(u.hostname)) {
			return error(res, 400, 'invalid_redirect_uri', 'non-https redirect URIs only allowed for localhost');
		}
	}

	const authMethod = body.token_endpoint_auth_method ?? 'none';
	const clientType = authMethod === 'none' ? 'public' : 'confidential';

	const clientId = `mcp_${randomToken(18)}`;
	let clientSecret = null;
	let secretHash = null;
	if (clientType === 'confidential') {
		clientSecret = randomToken(32);
		secretHash = await sha256(clientSecret);
	}

	const scope = body.scope ?? 'avatars:read';
	const grantTypes = body.grant_types ?? ['authorization_code', 'refresh_token'];
	const responseTypes = body.response_types ?? ['code'];

	await sql`
		insert into oauth_clients (
			client_id, client_secret_hash, client_type, name, logo_uri, client_uri,
			redirect_uris, grant_types, response_types, token_endpoint_auth, scope,
			software_id, software_version, dynamically_registered
		) values (
			${clientId}, ${secretHash}, ${clientType},
			${body.client_name ?? 'MCP Client'},
			${body.logo_uri ?? null}, ${body.client_uri ?? null},
			${body.redirect_uris}, ${grantTypes}, ${responseTypes}, ${authMethod}, ${scope},
			${body.software_id ?? null}, ${body.software_version ?? null}, true
		)
	`;

	return json(res, 201, {
		client_id: clientId,
		...(clientSecret ? { client_secret: clientSecret } : {}),
		client_id_issued_at: Math.floor(Date.now() / 1000),
		token_endpoint_auth_method: authMethod,
		redirect_uris: body.redirect_uris,
		grant_types: grantTypes,
		response_types: responseTypes,
		scope,
		client_name: body.client_name ?? 'MCP Client',
	});
});
