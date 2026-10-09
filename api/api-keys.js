import { randomToken, sha256 } from './_lib/crypto.js';
import { sql } from './_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from './_lib/auth.js';
import { cors, json, error, wrap, method, readJson, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { requireCsrf } from './_lib/csrf.js';
import { parse } from './_lib/validate.js';
import { z } from 'zod';
import { API_KEY_SCOPES, mintApiKey, presetScopes } from './_lib/api-keys.js';
import { CONNECTOR_MARKER } from './_lib/spend-scope.js';

const ALLOWED_SCOPES = new Set(API_KEY_SCOPES);

const createSchema = z.object({
	name: z.string().trim().min(1).max(80),
	scope: z
		.string()
		.optional()
		.default('avatars:read avatars:write')
		.transform((s) => s.trim()),
	expires_at: z.string().datetime().optional(),
	// A named preset replaces `scope`; see KEY_PRESETS in _lib/api-keys.js.
	// `three-ws setup --client grok-bot` asks for `connector`, the key an AI
	// agent holds unattended.
	preset: z.enum(['connector']).optional(),
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

	const body = parse(createSchema, await readJson(req));

	if (body.preset) return mintPreset(req, res, { userId, bearer, body });

	// Validate requested scopes are all known
	const requestedScopes = body.scope.split(/\s+/).filter(Boolean);
	const invalid = requestedScopes.filter((s) => !ALLOWED_SCOPES.has(s));
	if (invalid.length)
		return error(res, 400, 'validation_error', `unknown scopes: ${invalid.join(', ')}`);

	// A bearer caller can only mint a key at or below its own grant. `profile`
	// is the gate to reach this endpoint, not a license to escalate: without
	// this, an OAuth token a third-party client was granted for `profile` alone
	// (or a narrow API key) could mint a non-expiring `wallet:write agents:write`
	// key and walk out of the consent the user actually gave.
	if (bearer) {
		const beyond = requestedScopes.filter((s) => !hasScope(bearer.scope, s));
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
		insert into api_keys (user_id, name, prefix, token_hash, scope, expires_at)
		values (
			${userId},
			${body.name},
			${prefix},
			${tokenHash},
			${requestedScopes.join(' ')},
			${body.expires_at ?? null}
		)
		returning id, name, prefix, scope, expires_at, created_at
	`;

	// token is returned only on creation — not stored in plaintext
	return json(res, 201, { data: { ...row, token } });
});

// A preset key. The preset fixes the scope set and ignores `scope`, so a
// request can never ask a connector key into carrying a spend scope. A bearer
// caller still cannot mint beyond its own grant: it gets the preset's scopes
// it holds, plus the marker that caps the key for as long as it lives.
async function mintPreset(req, res, { userId, bearer, body }) {
	const preset = presetScopes(body.preset);
	const granted = preset.filter((s) => s === CONNECTOR_MARKER || !bearer || hasScope(bearer.scope, s));
	if (!granted.some((s) => s !== CONNECTOR_MARKER))
		return error(res, 403, 'insufficient_scope', `this credential holds none of the scopes a ${body.preset} key carries`);
	const { row, secret } = await mintApiKey({
		userId,
		name: body.name,
		scopes: granted,
		expiresAt: body.expires_at ?? null,
		req,
		via: bearer ? `bearer:${body.preset}` : `session:${body.preset}`,
	});
	return json(res, 201, { data: { ...row, token: secret } });
}
