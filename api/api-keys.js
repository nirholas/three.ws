import { randomToken, sha256 } from './_lib/crypto.js';
import { sql } from './_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from './_lib/auth.js';
import { cors, json, error, wrap, method, readJson, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { requireCsrf } from './_lib/csrf.js';
import { parse } from './_lib/validate.js';
import { z } from 'zod';
import { API_KEY_SCOPES } from './_lib/api-keys.js';
import { CONNECTOR_PRESET, CONNECTOR_SCOPES, expandKeyScopes } from './_lib/key-scopes.js';

const ALLOWED_SCOPES = new Set(API_KEY_SCOPES);

const createSchema = z.object({
	name: z.string().trim().min(1).max(80),
	scope: z
		.string()
		.optional()
		.default('avatars:read avatars:write')
		.transform((s) => s.trim()),
	// 'connector' issues the fixed read/generate/agents:write grant for an
	// unattended AI agent (Grok Bot). It can never hold spend (key-scopes.js).
	preset: z.enum([CONNECTOR_PRESET]).optional(),
	expires_at: z.string().datetime().optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	if (bearer && !hasScope(bearer.scope, 'profile'))
		return error(res, 403, 'insufficient_scope', 'requires profile scope');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'GET') {
		const rows = await sql`
			select id, name, prefix, scope, last_used_at, expires_at, revoked_at, created_at
			from api_keys
			where user_id = ${userId} and revoked_at is null
			order by created_at desc
		`;
		return json(res, 200, { data: rows });
	}

	// POST — create. CSRF-guard the cookie-authenticated path so a logged-in
	// user can't be tricked into minting a key cross-site. requireCsrf is a
	// no-op for Bearer callers (the token itself is proof of intent).
	if (!(await requireCsrf(req, res, userId))) return;

	const raw = await readJson(req);
	const body = parse(createSchema, raw);
	const connector = body.preset === CONNECTOR_PRESET;
	if (connector && raw && typeof raw === 'object' && Object.hasOwn(raw, 'scope'))
		return error(res, 400, 'validation_error', 'a connector key has a fixed grant; omit scope');

	// Validate requested scopes are all known
	const requestedScopes = connector ? [...CONNECTOR_SCOPES] : body.scope.split(/\s+/).filter(Boolean);
	const invalid = requestedScopes.filter((s) => !ALLOWED_SCOPES.has(s));
	if (invalid.length)
		return error(res, 400, 'validation_error', `unknown scopes: ${invalid.join(', ')}`);

	// A bearer caller can only mint a key at or below its own grant. `profile`
	// is the gate to reach this endpoint, not a license to escalate: without
	// this, an OAuth token a third-party client was granted for `profile` alone
	// (or a narrow API key) could mint a non-expiring `wallet:write agents:write`
	// key and walk out of the consent the user actually gave.
	if (bearer) {
		const needed = connector ? expandKeyScopes(CONNECTOR_SCOPES.join(' ')).filter((s) => !CONNECTOR_SCOPES.includes(s) || s === 'agents:write') : requestedScopes;
		const beyond = needed.filter((s) => !hasScope(bearer.scope, s));
		if (beyond.length)
			return error(
				res,
				403,
				'insufficient_scope',
				`a bearer credential cannot mint scopes it does not hold: ${beyond.join(', ')}`,
			);
	}

	const token = `sk_live_${randomToken(32)}`;
	const prefix = token.slice(0, 14); // "sk_live_" + 6 chars
	const tokenHash = await sha256(token);

	const [row] = await sql`
		insert into api_keys (user_id, name, prefix, token_hash, scope, expires_at, preset)
		values (
			${userId},
			${body.name},
			${prefix},
			${tokenHash},
			${requestedScopes.join(' ')},
			${body.expires_at ?? null},
			${connector ? CONNECTOR_PRESET : null}
		)
		returning id, name, prefix, scope, preset, expires_at, created_at
	`;

	// token is returned only on creation — not stored in plaintext
	return json(res, 201, { data: { ...row, token } });
});
