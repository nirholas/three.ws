// Developer API key management.
//   GET  /api/keys        list caller's keys (hashed, no secret)
//   POST /api/keys        create a new key; returns the plaintext secret ONCE

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { normalizeKeyScopes, mintApiKey } from '../_lib/api-keys.js';
import { CONNECTOR_PRESET, CONNECTOR_SCOPES, connectorViolations } from '../_lib/key-scopes.js';
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
	// 'connector' issues the fixed read/generate/agents:write grant for an
	// unattended AI agent and can never hold spend (api/_lib/key-scopes.js).
	preset: z.enum([CONNECTOR_PRESET]).optional(),
	expires_in_days: z.number().int().positive().max(3650).optional(),
	environment: z.enum(['live', 'test']).default('live'),
});

function rawScopeGiven(raw) {
	return raw != null && typeof raw === 'object' && Object.hasOwn(raw, 'scope');
}

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
			select id, name, prefix, scope, preset, last_used_at, expires_at, revoked_at, created_at,
				ip_allowlist, rotated_from, rotated_to, overlap_until
			from api_keys where user_id = ${user.id} order by created_at desc
		`;
		return json(res, 200, { keys: rows });
	}

	const rl = await limits.apiKeyManage(user.id);
	if (!rl.success) return rateLimited(res, rl);

	if (!(await requireCsrf(req, res, user.id))) return;

	const raw = await readJson(req);
	const body = parse(createSchema, raw);

	// Dedupe so "avatars:read avatars:read" stores one grant, not two: the stored
	// string is rendered verbatim as scope chips in the dashboard key table.
	// A connector key's grant is fixed by the preset. A caller may omit scope or
	// repeat exactly that grant; anything else, spend above all, is refused.
	const scopeInput = body.preset === CONNECTOR_PRESET && !rawScopeGiven(raw) ? CONNECTOR_SCOPES.join(' ') : body.scope;
	const { scopes: requestedScopes, invalid } = normalizeKeyScopes(scopeInput);
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

	if (body.preset === CONNECTOR_PRESET) {
		const beyond = connectorViolations(requestedScopes);
		if (beyond.length)
			return error(
				res,
				400,
				'validation_error',
				`a connector key can only hold ${CONNECTOR_SCOPES.join(', ')}; it can never hold ${beyond.join(', ')}`,
			);
	}

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
		preset: body.preset ?? null,
	});
	return json(res, 201, { key: { ...row, secret } });
});
