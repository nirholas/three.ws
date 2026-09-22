// Developer API key management.
//   GET  /api/keys        list caller's keys (hashed, no secret)
//   POST /api/keys        create a new key; returns the plaintext secret ONCE

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { normalizeKeyScopes, mintApiKey } from '../_lib/api-keys.js';
import { cors, json, method, readJson, wrap, error, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { z } from 'zod';

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

	// Listing is a read the dashboard performs on every load and after every
	// mutation; it rides its own bucket so it can never exhaust the mint budget
	// (or be exhausted by it). See limits.apiKeyList / apiKeyManage.
	if (req.method === 'GET') {
		const rlList = await limits.apiKeyList(user.id);
		if (!rlList.success) return rateLimited(res, rlList);
		const rows = await sql`
			select id, name, prefix, scope, last_used_at, expires_at, revoked_at, created_at
			from api_keys where user_id = ${user.id} order by created_at desc
		`;
		return json(res, 200, { keys: rows });
	}

	const rl = await limits.apiKeyManage(user.id);
	if (!rl.success) return rateLimited(res, rl);

	if (!(await requireCsrf(req, res, user.id))) return;

	const body = parse(createSchema, await readJson(req));

	// Dedupe so "avatars:read avatars:read" stores one grant, not two: the stored
	// string is rendered verbatim as scope chips in the dashboard key table.
	const { scopes: requestedScopes, invalid } = normalizeKeyScopes(body.scope);
	if (invalid.length)
		return error(res, 400, 'validation_error', `unknown scopes: ${invalid.join(', ')}`);
	// zod's .default() only fires on an absent field, so an explicit "" or "   "
	// reaches here as zero scopes and used to mint a 201 credential that
	// hasScope() can never satisfy: a key that is dead the moment it is issued,
	// with nothing telling the caller so. The dashboard already refuses to submit
	// an empty selection; the API has to enforce the same invariant for every
	// other client.
	if (!requestedScopes.length)
		return error(res, 400, 'validation_error', 'scope must name at least one permission');

	const expires = body.expires_in_days
		? new Date(Date.now() + body.expires_in_days * 86400 * 1000).toISOString()
		: null;

	const { row, secret } = await mintApiKey({
		userId: user.id,
		name: body.name,
		scopes: requestedScopes,
		expiresAt: expires,
		environment: body.environment,
		req,
	});
	return json(res, 201, { key: { ...row, secret } });
});
