// Developer API key management.
//   GET  /api/keys        — list caller's keys (hashed, no secret)
//   POST /api/keys        — create a new key; returns plaintext ONCE

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { randomToken, sha256 } from '../_lib/crypto.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { z } from 'zod';

const ALLOWED_SCOPES = new Set(['avatars:read', 'avatars:write', 'avatars:delete', 'profile']);

const createSchema = z.object({
	name: z.string().trim().min(1).max(80),
	scope: z
		.string()
		.optional()
		.default('avatars:read avatars:write')
		.transform((s) => s.trim()),
	expires_in_days: z.number().int().positive().max(3650).optional(),
	environment: z.enum(['live', 'test']).default('live'),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to manage API keys');

	const rl = await limits.apiKeyManage(user.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	if (req.method === 'GET') {
		const rows = await sql`
			select id, name, prefix, scope, last_used_at, expires_at, revoked_at, created_at
			from api_keys where user_id = ${user.id} order by created_at desc
		`;
		return json(res, 200, { keys: rows });
	}

	const body = parse(createSchema, await readJson(req));

	const requestedScopes = body.scope.split(/\s+/).filter(Boolean);
	const invalid = requestedScopes.filter((s) => !ALLOWED_SCOPES.has(s));
	if (invalid.length)
		return error(res, 400, 'validation_error', `unknown scopes: ${invalid.join(', ')}`);

	const raw = `sk_${body.environment}_${randomToken(28)}`;
	const hash = await sha256(raw);
	const prefix = raw.slice(0, 12);
	const expires = body.expires_in_days
		? new Date(Date.now() + body.expires_in_days * 86400 * 1000).toISOString()
		: null;

	const [row] = await sql`
		insert into api_keys (user_id, name, prefix, token_hash, scope, expires_at)
		values (${user.id}, ${body.name}, ${prefix}, ${hash}, ${requestedScopes.join(' ')}, ${expires})
		returning id, name, prefix, scope, expires_at, created_at
	`;
	return json(res, 201, { key: { ...row, secret: raw } });
});
